import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import type { HubConnection } from '@microsoft/signalr';
import type { LiveConnectionState, TicketDto, TicketEventHandlers } from './types.ts';

/** Event names sent on the server's StaffHub (Hubs/StaffHub.cs). */
const TICKET_CREATED = 'TicketCreated';
const TICKET_UPDATED = 'TicketUpdated';

/** How long to wait before trying again when the first connection attempt fails. */
const RETRY_START_MS = 10_000;

/**
 * One SignalR connection to the staff hub, shared by every subscriber on the page.
 *
 * It connects when the first subscriber arrives and disconnects when the last one
 * leaves, so a page that isn't showing tickets holds no socket open. Dropped
 * connections reconnect on their own; subscribers hear about it through
 * `onConnectionChange` so the UI can say whether it is live.
 */
export class TicketFeed {
    private readonly subscribers = new Set<TicketEventHandlers>();
    private connection: HubConnection | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private state: LiveConnectionState = 'offline';
    private readonly url: string;
    private readonly normalise: (ticket: TicketDto) => TicketDto;

    constructor(url: string, normalise: (ticket: TicketDto) => TicketDto) {
        this.url = url;
        this.normalise = normalise;
    }

    subscribe(handlers: TicketEventHandlers): () => void {
        this.subscribers.add(handlers);
        handlers.onConnectionChange?.(this.state);

        if (this.subscribers.size === 1) void this.start();

        return () => {
            this.subscribers.delete(handlers);
            if (this.subscribers.size === 0) void this.stop();
        };
    }

    private setState(state: LiveConnectionState) {
        this.state = state;
        for (const subscriber of this.subscribers) subscriber.onConnectionChange?.(state);
    }

    private async start(): Promise<void> {
        const connection = new HubConnectionBuilder()
            .withUrl(this.url)
            .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
            .configureLogging(LogLevel.Warning)
            .build();

        connection.on(TICKET_CREATED, (ticket: TicketDto) => {
            const normalised = this.normalise(ticket);
            for (const subscriber of this.subscribers) subscriber.onCreated?.(normalised);
        });
        connection.on(TICKET_UPDATED, (ticket: TicketDto) => {
            const normalised = this.normalise(ticket);
            for (const subscriber of this.subscribers) subscriber.onUpdated?.(normalised);
        });
        connection.onreconnecting(() => this.setState('connecting'));
        connection.onreconnected(() => this.setState('live'));
        connection.onclose(() => {
            if (this.connection === connection) this.setState('offline');
        });

        this.connection = connection;
        this.setState('connecting');

        try {
            await connection.start();
            // Everyone may have unsubscribed while we were connecting.
            if (this.connection === connection) this.setState('live');
            else await connection.stop();
        } catch {
            if (this.connection !== connection) return; // stopped on purpose
            this.connection = null;
            this.setState('offline');
            this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                if (this.subscribers.size > 0 && this.connection === null) void this.start();
            }, RETRY_START_MS);
        }
    }

    private async stop(): Promise<void> {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }

        const connection = this.connection;
        this.connection = null;
        this.state = 'offline';
        await connection?.stop().catch(() => undefined);
    }
}
