import { useCallback } from 'react';
import { useApi } from '../../api/index.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { formatRelative } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { ComplaintSeverityBadge, ComplaintStatusBadge } from './StatusBadges.tsx';

export function ComplaintsPanel() {
    const api = useApi();

    const load = useCallback((signal: AbortSignal) => api.listComplaints(signal), [api]);
    const { data: complaints, error, loading, reload } = useAsync(load);

    return (
        <section className="panel" aria-label="Complaints">
            <header className="panel__header">
                <h2>Complaints</h2>
                <Button variant="ghost" size="sm" onClick={reload}>
                    Refresh
                </Button>
            </header>

            {loading ? <Skeleton rows={3} label="Loading complaints" /> : null}

            {error ? <ErrorBanner error={error} onRetry={reload} /> : null}

            {complaints && !loading && complaints.length === 0 ? (
                <EmptyState
                    title="No complaints logged"
                    description="A complaint raised in a chat conversation will appear here."
                />
            ) : null}

            {complaints && !loading && complaints.length > 0 ? (
                <ul className="card-list">
                    {complaints.map((complaint) => (
                        <li key={complaint.id} className="card">
                            <div className="card__header">
                                <h3>{complaint.reference}</h3>
                                <span className="card__meta">
                                    {formatRelative(complaint.updatedAt)}
                                </span>
                            </div>
                            <p className="card__body">{complaint.description}</p>
                            <div className="card__badges">
                                <ComplaintStatusBadge status={complaint.status} />
                                <ComplaintSeverityBadge severity={complaint.severity} />
                                <Badge tone="neutral">{complaint.category}</Badge>
                                {complaint.escalated ? <Badge tone="danger">Escalated</Badge> : null}
                            </div>
                            <p className="card__meta">Raised by {complaint.customerName}</p>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
