import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api/index.ts';
import type { LiveConnectionState, TicketDto } from '../api/index.ts';

export interface TicketFeedHandlers {
    onCreated?: (ticket: TicketDto) => void;
    onUpdated?: (ticket: TicketDto) => void;
    /** Called when the feed comes back after a drop, so the caller can catch up on anything missed. */
    onReconnected?: () => void;
}

/**
 * Subscribes the component to ticket events for as long as it is mounted, and
 * reports whether the feed is live.
 *
 * The handlers are read through a ref, so passing inline functions does not tear
 * the subscription down and set it up again on every render.
 */
export function useTicketFeed(handlers: TicketFeedHandlers): LiveConnectionState {
    const api = useApi();
    const [state, setState] = useState<LiveConnectionState>('connecting');
    const latest = useRef(handlers);

    useEffect(() => {
        latest.current = handlers;
    });

    useEffect(() => {
        let wasLive = false;

        return api.subscribeToTickets({
            onCreated: (ticket) => latest.current.onCreated?.(ticket),
            onUpdated: (ticket) => latest.current.onUpdated?.(ticket),
            onConnectionChange: (next) => {
                setState(next);
                if (next === 'live') {
                    if (wasLive) latest.current.onReconnected?.();
                    wasLive = true;
                }
            },
        });
    }, [api]);

    return state;
}
