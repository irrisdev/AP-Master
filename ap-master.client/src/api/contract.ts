import type {
    ChatRequest,
    ChatResponse,
    ConversationDetail,
    ConversationSummary,
    CreateCustomerRequest,
    CustomerDto,
    TicketDto,
    TicketEventHandlers,
    TicketFilter,
    TicketStatus,
} from './types.ts';

/**
 * The single seam between the UI and the server.
 *
 * Components depend on this interface, never on `fetch`. Two implementations
 * satisfy it: `MockApiClient` (in-memory, no server needed) and `HttpApiClient`
 * (real endpoints). Switching between them changes no component code.
 */
export interface ApiClient {
    sendMessage(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;

    getCustomer(id: number, signal?: AbortSignal): Promise<CustomerDto>;
    createCustomer(request: CreateCustomerRequest, signal?: AbortSignal): Promise<CustomerDto>;

    /**
     * Conversations belong to a customer: the server has no "all conversations"
     * endpoint, so the dashboard looks them up one customer at a time.
     */
    listConversations(customerId: number, signal?: AbortSignal): Promise<ConversationSummary[]>;
    getConversation(id: number, signal?: AbortSignal): Promise<ConversationDetail>;

    listTickets(filter?: TicketFilter, signal?: AbortSignal): Promise<TicketDto[]>;
    getTicket(id: number, signal?: AbortSignal): Promise<TicketDto>;
    updateTicketStatus(id: number, status: TicketStatus, signal?: AbortSignal): Promise<TicketDto>;
    /** Closing is its own endpoint: a closed ticket cannot be reopened. */
    closeTicket(id: number, signal?: AbortSignal): Promise<TicketDto>;
    /** Manual escalation to senior staff by an agent. One-way: escalating twice is a 409. */
    escalateTicket(id: number, signal?: AbortSignal): Promise<TicketDto>;

    /**
     * Ticket events as they happen (new tickets, status changes, escalations), so the
     * dashboard stays current without polling. Returns a function that unsubscribes.
     */
    subscribeToTickets(handlers: TicketEventHandlers): () => void;
}

/**
 * Every failure from either implementation surfaces as one of these, so error
 * handling in components does not have to care which implementation is active.
 *
 * `status` is 0 when the request never reached the server (network down, DNS,
 * server not running) — the common case while the backend is still being built.
 */
export class ApiError extends Error {
    readonly status: number;
    readonly detail?: string;
    readonly traceId?: string;
    /** From a 429's Retry-After header: how long to wait before trying again. */
    readonly retryAfterSeconds?: number;

    constructor(
        message: string,
        status: number,
        detail?: string,
        traceId?: string,
        retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.detail = detail;
        this.traceId = traceId;
        this.retryAfterSeconds = retryAfterSeconds;
    }

    /** True when retrying the same request might plausibly succeed. */
    get isRetryable(): boolean {
        // 501 means the endpoint does not exist yet: retrying it will never help.
        if (this.status === 501) return false;
        return this.status === 0 || this.status === 429 || this.status >= 500;
    }
}

/** Aborts (user navigated away, component unmounted) are not real errors. */
export function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}
