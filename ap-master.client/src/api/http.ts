import { ApiError } from './contract.ts';
import type { ApiClient } from './contract.ts';
import type {
    ChatRequest,
    ChatResponse,
    ComplaintDto,
    ComplaintRequest,
    ConversationDetail,
    ConversationSummary,
    TicketDto,
    TicketFilter,
    TicketStatus,
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

    listConversations(signal?: AbortSignal): Promise<ConversationSummary[]> {
        return this.request<ConversationSummary[]>('/conversations', { method: 'GET' }, signal);
    }

    getConversation(id: number, signal?: AbortSignal): Promise<ConversationDetail> {
        return this.request<ConversationDetail>(`/conversations/${id}`, { method: 'GET' }, signal);
    }

    listTickets(filter?: TicketFilter, signal?: AbortSignal): Promise<TicketDto[]> {
        const query = new URLSearchParams();
        if (filter?.status !== undefined) query.set('status', String(filter.status));
        if (filter?.priority !== undefined) query.set('priority', String(filter.priority));
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        return this.request<TicketDto[]>(`/tickets${suffix}`, { method: 'GET' }, signal);
    }

    getTicket(id: number, signal?: AbortSignal): Promise<TicketDto> {
        return this.request<TicketDto>(`/tickets/${id}`, { method: 'GET' }, signal);
    }

    updateTicketStatus(
        id: number,
        status: TicketStatus,
        signal?: AbortSignal,
    ): Promise<TicketDto> {
        return this.request<TicketDto>(
            `/tickets/${id}/status`,
            { method: 'PATCH', body: JSON.stringify({ status }) },
            signal,
        );
    }

    listComplaints(signal?: AbortSignal): Promise<ComplaintDto[]> {
        return this.request<ComplaintDto[]>('/complaints', { method: 'GET' }, signal);
    }

    createComplaint(request: ComplaintRequest, signal?: AbortSignal): Promise<ComplaintDto> {
        return this.request<ComplaintDto>(
            '/complaints',
            { method: 'POST', body: JSON.stringify(request) },
            signal,
        );
    }
}
