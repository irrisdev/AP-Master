import { useCallback, useState } from 'react';
import {
    ComplaintSeverity,
    ComplaintStatus,
    complaintSeverityLabel,
    complaintStatusLabel,
    isAbort,
    useApi,
} from '../../api/index.ts';
import type { ApiError, ComplaintDto } from '../../api/index.ts';
import { useAbortSignal } from '../../hooks/useAbortSignal.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { toApiError } from '../../lib/errors.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Select } from '../ui/Select.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { ComplaintSeverityBadge, ComplaintStatusBadge } from './StatusBadges.tsx';

const anyValue = '';

const statusOptions = [
    { value: anyValue, label: 'Any status' },
    ...Object.values(ComplaintStatus).map((status) => ({
        value: String(status),
        label: complaintStatusLabel[status],
    })),
];

const severityOptions = [
    { value: anyValue, label: 'Any severity' },
    ...Object.values(ComplaintSeverity).map((severity) => ({
        value: String(severity),
        label: complaintSeverityLabel[severity],
    })),
];

const escalatedOptions = [
    { value: anyValue, label: 'Any' },
    { value: 'true', label: 'Escalated' },
    { value: 'false', label: 'Not escalated' },
];

export function ComplaintsPanel() {
    const api = useApi();
    const signalFor = useAbortSignal();

    const [status, setStatus] = useState<ComplaintStatus | undefined>(undefined);
    const [severity, setSeverity] = useState<ComplaintSeverity | undefined>(undefined);
    const [escalated, setEscalated] = useState<boolean | undefined>(undefined);

    const load = useCallback(
        (signal: AbortSignal) => api.listComplaints({ status, severity, escalated }, signal),
        [api, status, severity, escalated],
    );
    const { data: complaints, error, loading, reload, setData } = useAsync(load);

    const [escalatingId, setEscalatingId] = useState<number | null>(null);
    const [escalateError, setEscalateError] = useState<ApiError | null>(null);

    const filtered = status !== undefined || severity !== undefined || escalated !== undefined;

    function clearFilters() {
        setStatus(undefined);
        setSeverity(undefined);
        setEscalated(undefined);
    }

    function replace(updated: ComplaintDto) {
        setData((current) =>
            current ? current.map((row) => (row.id === updated.id ? updated : row)) : current,
        );
    }

    /** Escalation is one-way, so it is not applied optimistically: wait for the server. */
    async function escalate(complaint: ComplaintDto) {
        setEscalatingId(complaint.id);
        setEscalateError(null);

        try {
            replace(await api.escalateComplaint(complaint.id, signalFor()));
        } catch (cause) {
            if (isAbort(cause)) return;
            setEscalateError(toApiError(cause));
        } finally {
            setEscalatingId(null);
        }
    }

    return (
        <section className="panel" aria-label="Complaints">
            <header className="panel__header">
                <h2>Complaints</h2>
                <Button variant="ghost" size="sm" onClick={reload}>
                    Refresh
                </Button>
            </header>

            <div className="filters">
                <Select
                    label="Status"
                    value={status === undefined ? anyValue : String(status)}
                    options={statusOptions}
                    onChange={(event) =>
                        setStatus(
                            event.target.value === anyValue
                                ? undefined
                                : (Number(event.target.value) as ComplaintStatus),
                        )
                    }
                />
                <Select
                    label="Severity"
                    value={severity === undefined ? anyValue : String(severity)}
                    options={severityOptions}
                    onChange={(event) =>
                        setSeverity(
                            event.target.value === anyValue
                                ? undefined
                                : (Number(event.target.value) as ComplaintSeverity),
                        )
                    }
                />
                <Select
                    label="Escalation"
                    value={escalated === undefined ? anyValue : String(escalated)}
                    options={escalatedOptions}
                    onChange={(event) =>
                        setEscalated(
                            event.target.value === anyValue
                                ? undefined
                                : event.target.value === 'true',
                        )
                    }
                />
                {filtered ? (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                        Clear filters
                    </Button>
                ) : null}
            </div>

            {loading ? <Skeleton rows={3} label="Loading complaints" /> : null}

            {error ? <ErrorBanner error={error} onRetry={reload} /> : null}

            {escalateError ? <ErrorBanner error={escalateError} /> : null}

            {complaints && !loading && complaints.length === 0 ? (
                <EmptyState
                    title={filtered ? 'No complaints match' : 'No complaints logged'}
                    description={
                        filtered
                            ? 'Nothing matches the current filters.'
                            : 'A complaint raised in a chat conversation will appear here.'
                    }
                    action={
                        filtered ? (
                            <Button size="sm" onClick={clearFilters}>
                                Clear filters
                            </Button>
                        ) : null
                    }
                />
            ) : null}

            {complaints && !loading && complaints.length > 0 ? (
                <ul className="card-list">
                    {complaints.map((complaint) => (
                        <li key={complaint.id} className="card">
                            <div className="card__header">
                                <h3>{complaint.reference}</h3>
                                <span className="card__meta">Customer #{complaint.customerId}</span>
                            </div>
                            <p className="card__body">{complaint.description}</p>
                            <div className="card__badges">
                                <ComplaintStatusBadge status={complaint.status} />
                                <ComplaintSeverityBadge severity={complaint.severity} />
                                <Badge tone="neutral">{complaint.category}</Badge>
                                {complaint.escalated ? <Badge tone="danger">Escalated</Badge> : null}
                            </div>
                            {complaint.escalated ? null : (
                                <div className="card__actions">
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={escalatingId === complaint.id}
                                        onClick={() => void escalate(complaint)}
                                    >
                                        Escalate
                                    </Button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
