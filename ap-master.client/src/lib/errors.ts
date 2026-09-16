import { ApiError } from '../api/index.ts';

/**
 * Normalises anything thrown by an API call into an ApiError, so rendering code
 * only ever handles one error shape.
 *
 * Status 0 means "never reached the server", which is also the right assumption
 * for an unexpected failure: it is worth offering a retry.
 */
export function toApiError(cause: unknown): ApiError {
    if (cause instanceof ApiError) return cause;
    if (cause instanceof Error) return new ApiError(cause.message, 0);
    return new ApiError('Something went wrong.', 0);
}
