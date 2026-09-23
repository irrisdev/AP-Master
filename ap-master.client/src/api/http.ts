import { ApiError } from './contract.ts';
import type { ApiClient } from './contract.ts';
import type {
    ChatRequest,
    ChatResponse,
    ComplaintDto,
    ConversationDetail,
    ConversationSummary,
    CreateCustomerRequest,
    CustomerDto,
    MessageDto,
    TicketDto,
} from './types.ts';

/**
 * RFC 7807 ProblemDetails as ASP.NET Core emits it. Validation failures carry an
 * `errors` map instead of `detail`; `traceId` is the id to quote when reporting a fault.
 */
interface ProblemDetails {
    title?: string;
    detail?: string;
    status?: number;
    traceId?: string;
    errors?: Record<string, string[]>;
}

/**
 * A message for a failure that carried no ProblemDetails body. `statusText` is
 * not a safe fallback: it is empty over HTTP/2 and through some proxies.
 */
function describeStatus(status: number): string {
    if (status === 404) return 'That is not available.';
    if (status === 401 || status === 403) return 'You are not allowed to do that.';
    if (status >= 500) return 'The server ran into a problem.';
    return `The request failed (${status}).`;
}

/** Flattens a validation `errors` map into one readable line. */
function describeErrors(errors: Record<string, string[]> | undefined): string | undefined {
    if (!errors) return undefined;
    const lines = Object.values(errors).flat();
    return lines.length > 0 ? lines.join(' ') : undefined;
}

/**
 * The server writes UTC, but EF Core reads `DateTime`s back out of SQLite with no `Kind`,
 * so they serialise as "2026-09-23T14:01:50.43" with no offset. `new Date()` would read
 * that as *local* time and every timestamp would drift by the browser's offset. Mark it as
 * UTC unless the server already said otherwise.
 */
function asUtc(timestamp: string): string {
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`;
}

/**
 * Endpoints the server has not implemented yet. Failing here with a clear message beats
 * letting the UI show the router's bare 404, which reads as a client bug.
 */
function notBuiltYet<T>(what: string): Promise<T> {
    // Rejected, not thrown: these are async methods, and a synchronous throw would
    // escape callers that only attach a .catch().
    return Promise.reject(
        new ApiError(
            `${what} is not available yet.`,
            501,
            'The server does not expose this endpoint yet. Switch to mock mode to see the UI with sample data.',
        ),
    );
}

/**
 * Real implementation. Talks to the ASP.NET server over relative URLs, which the
 * Vite dev proxy forwards to the backend (see the `^/api` rule in vite.config.ts).
 */
export class HttpApiClient implements ApiClient {
    private readonly baseUrl: string;

    constructor(baseUrl = '/api') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    private async request<T>(
        path: string,
        init: RequestInit,
        signal?: AbortSignal,
    ): Promise<T> {
        let response: Response;

        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                ...init,
                signal,
                headers: {
                    Accept: 'application/json',
                    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                    ...init.headers,
                },
            });
        } catch (error) {
            // Aborts must propagate untouched so callers can ignore them.
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            throw new ApiError('Could not reach the server.', 0);
        }

        if (!response.ok) {
            let problem: ProblemDetails = {};
            try {
                problem = (await response.json()) as ProblemDetails;
            } catch {
                // Body was not JSON; fall back to the status text below.
            }
            throw new ApiError(
                problem.title ?? describeStatus(response.status),
                response.status,
                problem.detail ?? describeErrors(problem.errors),
                problem.traceId,
            );
        }

        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
    }

    sendMessage(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
        return this.request<ChatResponse>(
            '/chat',
            { method: 'POST', body: JSON.stringify(request) },
            signal,
        );
    }

    getCustomer(id: number, signal?: AbortSignal): Promise<CustomerDto> {
        return this.request<CustomerDto>(`/customers/${id}`, { method: 'GET' }, signal);
    }

    createCustomer(request: CreateCustomerRequest, signal?: AbortSignal): Promise<CustomerDto> {
        return this.request<CustomerDto>(
            '/customers',
            { method: 'POST', body: JSON.stringify(request) },
            signal,
        );
    }

    async listConversations(
        customerId: number,
        signal?: AbortSignal,
    ): Promise<ConversationSummary[]> {
        const [customer, conversations] = await Promise.all([
            this.getCustomer(customerId, signal),
            this.request<ConversationSummary[]>(
                `/customers/${customerId}/conversations`,
                { method: 'GET' },
                signal,
            ),
        ]);

        return conversations.map((conversation) => ({
            ...conversation,
            createdAt: asUtc(conversation.createdAt),
            updatedAt: asUtc(conversation.updatedAt),
            customerName: customer.name,
        }));
    }

    /**
     * Assembled from two endpoints — the conversation and its messages — because the
     * server has no single read model for the pair. The customer's name is a third
     * call, and is allowed to fail: a missing name should not hide the transcript.
     */
    async getConversation(id: number, signal?: AbortSignal): Promise<ConversationDetail> {
        const [conversation, messages] = await Promise.all([
            this.request<ConversationSummary>(`/conversations/${id}`, { method: 'GET' }, signal),
            this.request<MessageDto[]>(`/conversations/${id}/messages`, { method: 'GET' }, signal),
        ]);

        const customer = await this.getCustomer(conversation.customerId, signal).catch(() => null);

        return {
            ...conversation,
            createdAt: asUtc(conversation.createdAt),
            updatedAt: asUtc(conversation.updatedAt),
            customerName: customer?.name,
            messages: messages.map((message) => ({
                ...message,
                createdAt: asUtc(message.createdAt),
            })),
        };
    }

    /* ------------------------------------------------------------------------
     * Not implemented on the server yet. The shapes below are agreed proposals;
     * swap each body for a real `this.request(...)` as the endpoints land.
     * ---------------------------------------------------------------------- */

    listTickets(): Promise<TicketDto[]> {
        return notBuiltYet('The ticket queue');
    }

    getTicket(): Promise<TicketDto> {
        return notBuiltYet('Ticket detail');
    }

    updateTicketStatus(): Promise<TicketDto> {
        return notBuiltYet('Updating a ticket');
    }

    listComplaints(): Promise<ComplaintDto[]> {
        return notBuiltYet('The complaints list');
    }

    createComplaint(): Promise<ComplaintDto> {
        return notBuiltYet('Logging a complaint directly');
    }
}
