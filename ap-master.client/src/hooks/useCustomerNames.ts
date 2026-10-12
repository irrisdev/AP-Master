import { useEffect, useState } from 'react';
import { useApi } from '../api/index.ts';

/**
 * Names for a set of customer IDs, fetched once each and cached for the life of the
 * component. Tickets only carry a customer ID; agents recognise people by name.
 * An ID that can't be resolved simply has no entry, and callers fall back to "#id".
 */
export function useCustomerNames(ids: readonly number[]): ReadonlyMap<number, string> {
    const api = useApi();
    const [names, setNames] = useState<ReadonlyMap<number, string>>(new Map());
    const key = [...new Set(ids)].sort((a, b) => a - b).join(',');

    useEffect(() => {
        const wanted = key === '' ? [] : key.split(',').map(Number);
        const missing = wanted.filter((id) => !names.has(id));
        if (missing.length === 0) return;

        const controller = new AbortController();

        void Promise.all(
            missing.map((id) =>
                api
                    .getCustomer(id, controller.signal)
                    .then((customer) => [id, customer.name] as const)
                    .catch(() => null),
            ),
        ).then((results) => {
            if (controller.signal.aborted) return;
            const found = results.filter((result) => result !== null);
            if (found.length === 0) return;
            setNames((current) => new Map([...current, ...found]));
        });

        return () => controller.abort();
        // `names` is deliberately left out: it changes as a result of this effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, key]);

    return names;
}
