import type { ApiError } from '../../api/index.ts';
import { Button } from './Button.tsx';

export interface ErrorBannerProps {
    error: ApiError;
    /** Rendered only when the error is worth retrying. */
    onRetry?: () => void;
    /** Overrides the error's own message where the screen has better context. */
    title?: string;
}

/**
 * The single way a failure is shown. It leans on ApiError.isRetryable so a 400
 * does not offer a pointless retry, and surfaces the correlation id when the
 * server sends one — that is what makes a reported fault traceable in the logs.
 */
export function ErrorBanner({ error, onRetry, title }: ErrorBannerProps) {
    return (
        <div className="error-banner" role="alert">
            <div className="error-banner__body">
                <strong className="error-banner__title">{title ?? error.message}</strong>
                {error.detail ? <p className="error-banner__detail">{error.detail}</p> : null}
                {error.traceId ? (
                    <p className="error-banner__detail">
                        Reference <code>{error.traceId}</code>
                    </p>
                ) : null}
            </div>
            {onRetry && error.isRetryable ? (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                    Try again
                </Button>
            ) : null}
        </div>
    );
}
