import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/index.ts';
import { useAsync } from './useAsync.ts';
import type { AsyncOperation } from './useAsync.ts';

function Probe({
    operation,
    keepPreviousData,
}: {
    operation: AsyncOperation<string>;
    keepPreviousData?: boolean;
}) {
    const { data, error, loading, reload } = useAsync(operation, { keepPreviousData });

    return (
        <div>
            <p data-testid="state">
                {loading ? 'loading' : (error?.message ?? data ?? 'nothing')}
            </p>
            <p data-testid="data">{data ?? 'none'}</p>
            <button type="button" onClick={reload}>
                Reload
            </button>
        </div>
    );
}

function state() {
    return screen.getByTestId('state').textContent;
}

describe('useAsync', () => {
    it('reports loading, then the data', async () => {
        const operation: AsyncOperation<string> = () => Promise.resolve('done');
        render(<Probe operation={operation} />);

        expect(state()).toBe('loading');
        await waitFor(() => expect(state()).toBe('done'));
    });

    it('surfaces a failure as an error', async () => {
        const operation: AsyncOperation<string> = () => Promise.reject(new ApiError('Nope.', 500));
        render(<Probe operation={operation} />);

        await waitFor(() => expect(state()).toBe('Nope.'));
    });

    it('aborts the request when the component unmounts', () => {
        let captured: AbortSignal | undefined;
        const operation: AsyncOperation<string> = (signal) =>
            new Promise(() => {
                captured = signal;
            });

        const { unmount } = render(<Probe operation={operation} />);
        expect(captured?.aborted).toBe(false);

        unmount();
        expect(captured?.aborted).toBe(true);
    });

    it('does not render a cancellation as an error', async () => {
        const operation: AsyncOperation<string> = () =>
            Promise.reject(new DOMException('Aborted', 'AbortError'));
        render(<Probe operation={operation} />);

        // An abort leaves the hook loading: nothing failed, the answer never came.
        await Promise.resolve();
        expect(state()).toBe('loading');
    });

    it('runs the operation again on reload', async () => {
        let calls = 0;
        const operation: AsyncOperation<string> = () => {
            calls += 1;
            return Promise.resolve(`call ${calls}`);
        };

        const user = userEvent.setup();
        render(<Probe operation={operation} />);
        await waitFor(() => expect(state()).toBe('call 1'));

        await user.click(screen.getByRole('button', { name: 'Reload' }));
        await waitFor(() => expect(state()).toBe('call 2'));
    });

    it('drops the data during a reload by default', async () => {
        let calls = 0;
        const operation: AsyncOperation<string> = () => {
            calls += 1;
            return calls === 1 ? Promise.resolve('first') : new Promise<string>(() => {});
        };

        const user = userEvent.setup();
        render(<Probe operation={operation} />);
        await waitFor(() => expect(state()).toBe('first'));

        await user.click(screen.getByRole('button', { name: 'Reload' }));

        expect(state()).toBe('loading');
        expect(screen.getByTestId('data')).toHaveTextContent('none');
    });

    it('keeps the last data on screen during a reload when asked to', async () => {
        let calls = 0;
        let finish: (value: string) => void = () => {};
        const operation: AsyncOperation<string> = () => {
            calls += 1;
            if (calls === 1) return Promise.resolve('first');
            return new Promise<string>((resolve) => {
                finish = resolve;
            });
        };

        const user = userEvent.setup();
        render(<Probe operation={operation} keepPreviousData />);
        await waitFor(() => expect(state()).toBe('first'));

        await user.click(screen.getByRole('button', { name: 'Reload' }));

        // Still loading, but the old answer stays visible instead of a blank.
        expect(state()).toBe('loading');
        expect(screen.getByTestId('data')).toHaveTextContent('first');

        finish('second');
        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));
    });
});
