export interface SkeletonProps {
    /** How many placeholder rows to draw. */
    rows?: number;
    /** Announced while the real content loads. */
    label?: string;
}

/**
 * Placeholder rows sized like the content they stand in for, so the layout does
 * not jump when the data arrives.
 */
export function Skeleton({ rows = 3, label = 'Loading' }: SkeletonProps) {
    return (
        <div className="skeleton" role="status" aria-live="polite">
            <span className="visually-hidden">{label}</span>
            {Array.from({ length: rows }, (_, index) => (
                <span key={index} className="skeleton__row" aria-hidden="true" />
            ))}
        </div>
    );
}
