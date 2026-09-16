import { useCallback, useEffect, useRef } from 'react';

/**
 * Signals for user-initiated writes (sending a message, changing a status).
 *
 * Each call abandons the previous request — the newest intent wins — and
 * unmounting abandons whatever is still in flight, so no response is applied to
 * a component that has gone away.
 */
export function useAbortSignal(): () => AbortSignal {
    const controller = useRef<AbortController | null>(null);

    useEffect(() => () => controller.current?.abort(), []);

    return useCallback(() => {
        controller.current?.abort();
        const next = new AbortController();
        controller.current = next;
        return next.signal;
    }, []);
}
