import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './contract.ts';
import { HttpApiClient } from './http.ts';

function respond(status: number, body: unknown) {
    return vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/problem+json' },
        }),
    );
}

async function failure(client: HttpApiClient): Promise<ApiError> {
    try {
        await client.sendMessage({ customerId: 1, message: 'x' });
    } catch (error) {
        if (error instanceof ApiError) return error;
        throw error;
    }
    throw new Error('expected the request to fail');
}

/** Shapes below are what the ASP.NET server was observed to return. */
describe('HttpApiClient error handling', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads the trace id from a ProblemDetails response', async () => {
        vi.stubGlobal(
            'fetch',
            respond(500, {
                title: 'An unexpected error occurred.',
                status: 500,
                detail: 'Please try again later.',
                traceId: '00-abc-def-00',
            }),
        );

        const error = await failure(new HttpApiClient());

        expect(error.status).toBe(500);
        expect(error.message).toBe('An unexpected error occurred.');
        expect(error.detail).toBe('Please try again later.');
        expect(error.traceId).toBe('00-abc-def-00');
        expect(error.isRetryable).toBe(true);
    });

    it('flattens a validation errors map into the detail', async () => {
        vi.stubGlobal(
            'fetch',
            respond(400, {
                title: 'One or more validation errors occurred.',
                status: 400,
                errors: {
                    Message: ['The Message field is required.', 'Minimum length is 1.'],
                },
                traceId: '00-123-456-00',
            }),
        );

        const error = await failure(new HttpApiClient());

        expect(error.status).toBe(400);
        expect(error.detail).toBe('The Message field is required. Minimum length is 1.');
        expect(error.isRetryable).toBe(false);
    });

    it('still says something for a bodiless 404 with no status text', async () => {
        // What an unrouted /api path looks like through the Vite proxy.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response(null, { status: 404, statusText: '' })),
        );

        const error = await failure(new HttpApiClient());

        expect(error.status).toBe(404);
        expect(error.message).toBe('That is not available.');
        expect(error.isRetryable).toBe(false);
    });

    it('reports an unreachable server as status 0', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

        const error = await failure(new HttpApiClient());

        expect(error.status).toBe(0);
        expect(error.isRetryable).toBe(true);
    });

    it('reads a conversation as UTC even though the server sends no offset', async () => {
        // EF Core reads DateTimes back out of SQLite with no Kind, so the JSON has no "Z".
        const conversation = {
            id: 7,
            customerId: 1,
            requestType: 2,
            status: 1,
            createdAt: '2026-09-23T14:01:50.4376397',
            updatedAt: '2026-09-23T14:01:50.472274',
        };
        const messages = [
            {
                id: 50,
                conversationId: 7,
                sender: 'Customer',
                content: 'My broadband is slow',
                createdAt: '2026-09-23T14:01:50.4376397',
            },
        ];

        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) =>
                Promise.resolve(
                    Response.json(
                        url.endsWith('/messages')
                            ? messages
                            : url.includes('/customers/')
                              ? { id: 1, name: 'John Doe', email: 'johndoe@example.com' }
                              : conversation,
                    ),
                ),
            ),
        );

        const detail = await new HttpApiClient().getConversation(7);

        expect(detail.createdAt).toBe('2026-09-23T14:01:50.4376397Z');
        expect(detail.messages[0].createdAt).toBe('2026-09-23T14:01:50.4376397Z');
        expect(new Date(detail.createdAt).getUTCHours()).toBe(14);
        // Assembled from the separate endpoints rather than one read model.
        expect(detail.customerName).toBe('John Doe');
    });

    it('does not double-stamp a timestamp that already carries a zone', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) =>
                Promise.resolve(
                    Response.json(
                        url.endsWith('/messages')
                            ? []
                            : url.includes('/customers/')
                              ? { id: 1, name: 'John Doe', email: 'j@example.com' }
                              : {
                                    id: 7,
                                    customerId: 1,
                                    requestType: 0,
                                    status: 0,
                                    createdAt: '2026-09-23T14:01:50Z',
                                    updatedAt: '2026-09-23T14:01:50+01:00',
                                },
                    ),
                ),
            ),
        );

        const detail = await new HttpApiClient().getConversation(7);

        expect(detail.createdAt).toBe('2026-09-23T14:01:50Z');
        expect(detail.updatedAt).toBe('2026-09-23T14:01:50+01:00');
    });

    it('sends only the filters that are set, and omits the query string entirely when none are', async () => {
        const fetchSpy = vi.fn(() => Promise.resolve(Response.json([])));
        vi.stubGlobal('fetch', fetchSpy);
        const client = new HttpApiClient();

        await client.listTickets();
        expect(fetchSpy).toHaveBeenLastCalledWith('/api/tickets', expect.anything());

        await client.listTickets({ status: 1 });
        expect(fetchSpy).toHaveBeenLastCalledWith('/api/tickets?status=1', expect.anything());

        await client.listTickets({ status: 1, customerId: 7 });
        expect(fetchSpy).toHaveBeenLastCalledWith(
            '/api/tickets?status=1&customerId=7',
            expect.anything(),
        );
    });

    it('passes a false escalated filter rather than dropping it', async () => {
        // `if (filter.escalated)` would silently lose "not escalated".
        const fetchSpy = vi.fn(() => Promise.resolve(Response.json([])));
        vi.stubGlobal('fetch', fetchSpy);

        await new HttpApiClient().listComplaints({ escalated: false });

        expect(fetchSpy).toHaveBeenLastCalledWith(
            '/api/complaints?escalated=false',
            expect.anything(),
        );
    });

    it('uses PUT for a ticket status change, as the server expects', async () => {
        const fetchSpy = vi.fn(() => Promise.resolve(Response.json({ id: 1 })));
        vi.stubGlobal('fetch', fetchSpy);

        await new HttpApiClient().updateTicketStatus(1, 2);

        expect(fetchSpy).toHaveBeenLastCalledWith(
            '/api/tickets/1/status',
            expect.objectContaining({ method: 'PUT', body: '{"status":2}' }),
        );
    });

    it('surfaces a 409 conflict with the explanation the server gave', async () => {
        vi.stubGlobal(
            'fetch',
            respond(409, {
                title: 'Conflict',
                status: 409,
                detail: 'Ticket TKT-000001 is already closed.',
                traceId: '00-abc-00',
            }),
        );

        const error = await new HttpApiClient().closeTicket(1).catch((cause: unknown) => cause);

        expect(error).toMatchObject({
            status: 409,
            message: 'Conflict',
            detail: 'Ticket TKT-000001 is already closed.',
        });
        // Retrying a conflict will not help.
        expect((error as ApiError).isRetryable).toBe(false);
    });

    it('lets an abort through untouched', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
        );

        await expect(
            new HttpApiClient().sendMessage({ customerId: 1, message: 'x' }),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });
});
