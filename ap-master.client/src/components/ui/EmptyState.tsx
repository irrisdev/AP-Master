import type { ReactNode } from 'react';

export interface EmptyStateProps {
    title: string;
    description?: string;
    action?: ReactNode;
}

/** Shown wherever a list has loaded successfully but has nothing in it. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
    return (
        <div className="empty-state">
            <h3 className="empty-state__title">{title}</h3>
            {description ? <p className="empty-state__body">{description}</p> : null}
            {action ? <div className="empty-state__action">{action}</div> : null}
        </div>
    );
}
