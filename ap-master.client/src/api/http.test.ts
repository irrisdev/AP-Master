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
