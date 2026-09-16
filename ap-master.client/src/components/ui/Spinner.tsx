export interface SpinnerProps {
    size?: 'sm' | 'md';
    /** Announced to assistive technology; omit inside an element that already says it. */
    label?: string;
}

export function Spinner({ size = 'md', label }: SpinnerProps) {
    return (
        <span className={`spinner spinner--${size}`} role={label ? 'status' : undefined}>
            <span className="spinner__disc" aria-hidden="true" />
            {label ? <span className="visually-hidden">{label}</span> : null}
        </span>
    );
}
