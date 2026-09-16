import { useCallback, useState } from 'react';
import { TicketStatus, isAbort, ticketStatusLabel, useApi } from '../../api/index.ts';
import type { ApiError, TicketDto } from '../../api/index.ts';
import { useAbortSignal } from '../../hooks/useAbortSignal.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { toApiError } from '../../lib/errors.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { TicketPriorityBadge, TicketStatusBadge } from './StatusBadges.tsx';

export interface TicketDetailProps {
    ticketId: number;
    onClose: () => void;
    /** Keeps the list in step with a status change made here. */
    onPatched: (ticket: TicketDto) => void;
}

const statuses = Object.values(TicketStatus);

/**
 * A status change is applied locally first and rolled back if the server
 * refuses it, so an agent working through a queue is never waiting on a round
 * trip — but never left believing a change that did not happen either.
 */
export function TicketDetail({ ticketId, onClose, onPatched }: TicketDetailProps) {
    const api = useApi();
    const signalFor = useAbortSignal();

    const load = useCallback(
        (signal: AbortSignal) => api.getTicket(ticketId, signal),
        [api, ticketId],
    );
    const { data: ticket, error, loading, reload, setData } = useAsync(load);

    const [saving, setSaving] = useState(false);
    const [updateError, setUpdateError] = useState<ApiError | null>(null);

    async function changeStatus(next: TicketStatus) {
        if (!ticket) return;

        const previous = ticket;
        const optimistic: TicketDto = { ...ticket, status: next };

        setData(optimistic);
        onPatched(optimistic);
        setSaving(true);
        setUpdateError(null);

        try {
            const updated = await api.updateTicketStatus(ticket.id, next, signalFor());
            setData(updated);
            onPatched(updated);
            setSaving(false);
        } catch (cause) {
            if (isAbort(cause)) return;
            setData(previous);
            onPatched(previous);
            setUpdateError(toApiError(cause));
            setSaving(false);
        }
    }

    return (
        <section className="panel detail" aria-label={`Ticket ${ticketId}`}>
            <header className="detail__header">
                <h2>Ticket #{ticketId}</h2>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                </Button>
            </header>

            {loading ? <Skeleton rows={2} label="Loading ticket" /> : null}

            {error ? <ErrorBanner error={error} onRetry={reload} /> : null}

            {ticket ? (
                <>
                    <dl className="detail__facts">
                        <div>
                            <dt>Customer</dt>
                            <dd>{ticket.customerName}</dd>
                        </div>
                        <div>
                            <dt>Raised</dt>
                            <dd>{formatDateTime(ticket.createdAt)}</dd>
                        </div>
                        <div>
                            <dt>Last updated</dt>
                            <dd>{formatDateTime(ticket.updatedAt)}</dd>
                        </div>
                        <div>
                            <dt>Priority</dt>
                            <dd>
                                <TicketPriorityBadge priority={ticket.priority} />
                            </dd>
                        </div>
                        <div>
                            <dt>Status</dt>
                            <dd>
                                <TicketStatusBadge status={ticket.status} />
                            </dd>
                        </div>
                    </dl>

                    <p className="detail__description">{ticket.description}</p>

                    {updateError ? <ErrorBanner error={updateError} /> : null}

                    <div className="detail__actions" role="group" aria-label="Change status">
                        {statuses.map((status) => (
                            <Button
                                key={status}
                                size="sm"
                                variant={status === ticket.status ? 'primary' : 'secondary'}
                                disabled={status === ticket.status || saving}
                                onClick={() => void changeStatus(status)}
                            >
                                {ticketStatusLabel[status]}
                            </Button>
                        ))}
                    </div>
                </>
            ) : null}
        </section>
    );
}
