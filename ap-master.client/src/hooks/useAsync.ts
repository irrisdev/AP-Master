import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { isAbort } from '../api/index.ts';
import type { ApiError } from '../api/index.ts';
import { toApiError } from '../lib/errors.ts';

/** A cancellable read. The signal is aborted if the component unmounts or reloads. */
export type AsyncOperation<T> = (signal: AbortSignal) => Promise<T>;

export interface AsyncResult<T> {
    data: T | null;
    error: ApiError | null;
    loading: boolean;
    /** Run the operation again, e.g. from a Retry button. */
    reload: () => void;
    /** Write to the local copy — used for optimistic updates. */
    setData: Dispatch<SetStateAction<T | null>>;
}

interface Outcome<T> {
    /** The request this outcome answers. */
    request: object;
    data: T | null;
    error: ApiError | null;
}

/**
 * Runs one cancellable API call and exposes its loading / error / data state.
 *
 * Pass a memoised operation (useCallback) — it identifies the request, so an
 * inline arrow would re-fetch on every render.
 *
 * "Loading" is derived rather than stored: the hook is loading exactly when the
 * outcome it holds does not answer the request it is making. That removes a
 * whole class of bug where a flag and the data it describes drift apart.
 *
 * Aborts are never surfaced as errors — cancelling a request the user no longer
 * wants is not a failure.
 */
export function useAsync<T>(operation: AsyncOperation<T>): AsyncResult<T> {
    const [attempt, setAttempt] = useState(0);
    const [outcome, setOutcome] = useState<Outcome<T> | null>(null);

    // Identity of the request in flight. A new operation or a reload makes a new one.
    const request = useMemo(() => ({ operation, attempt }), [operation, attempt]);

    useEffect(() => {
        const controller = new AbortController();
        let live = true;

        request.operation(controller.signal).then(
            (data) => {
                if (live) setOutcome({ request, data, error: null });
            },
            (cause: unknown) => {
                if (live && !isAbort(cause)) {
                    setOutcome({ request, data: null, error: toApiError(cause) });
                }
            },
        );

        return () => {
            live = false;
            controller.abort();
        };
    }, [request]);

    const current = outcome !== null && outcome.request === request ? outcome : null;

    const reload = useCallback(() => setAttempt((n) => n + 1), []);

    const setData = useCallback<Dispatch<SetStateAction<T | null>>>((update) => {
        setOutcome((held) => {
            if (held === null) return held;
            const next =
                typeof update === 'function'
                    ? (update as (previous: T | null) => T | null)(held.data)
                    : update;
            return { ...held, data: next };
        });
    }, []);

    return {
        data: current?.data ?? null,
        error: current?.error ?? null,
        loading: current === null,
        reload,
        setData,
    };
}
