import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
    tone?: BadgeTone;
    children: ReactNode;
    /** Optional prefix read as part of the badge, e.g. "Priority". */
    label?: string;
}

export function Badge({ tone = 'neutral', label, children }: BadgeProps) {
    return (
        <span className={`badge badge--${tone}`}>
            {label ? <span className="badge__label">{label}</span> : null}
            {children}
        </span>
    );
}
