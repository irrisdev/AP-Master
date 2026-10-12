import { useCallback, useState } from 'react';
import {
    RequestType,
    TicketStatus,
    isAbort,
    ticketStatusLabel,
    useApi,
} from '../../api/index.ts';
import type { ApiError, TicketDto } from '../../api/index.ts';
import { useAbortSignal } from '../../hooks/useAbortSignal.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { toApiError } from '../../lib/errors.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { RequestTypeBadge, TicketSeverityBadge, TicketStatusBadge } from './StatusBadges.tsx';

export interface TicketDetailProps {
    ticketId: number;
    onClose: () => void;
    /** Keeps the list in step with a status change made here. */
    onPatched: (ticket: TicketDto) => void;
}

/**
 * The statuses an agent can move a ticket between. A complaint starts Open and a support
 * ticket starts AwaitingTechnician, so each offers its own starting status rather than
 * the other's. Closing has its own endpoint and is irreversible, so it is not one of these.
 */
function statusesFor(ticket: TicketDto): TicketStatus[] {
    const start =
        ticket.type === RequestType.Complaint ? TicketStatus.Open : TicketStatus.AwaitingTechnician;
    return [start, TicketStatus.InProgress, TicketStatus.Resolved];
}

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

    const closed = ticket?.status === TicketStatus.Closed;

    const [saving, setSaving] = useState(false);
    const [updateError, setUpdateError] = useState<ApiError | null>(null);
    const [escalating, setEscalating] = useState(false);

    /**
     * Shows `next` immediately and rolls back if the server refuses — closing a
     * ticket that is already closed comes back as a 409.
     */
    async function applyStatus(
        previous: TicketDto,
        next: TicketStatus,
        send: () => Promise<TicketDto>,
    ) {
        const optimistic: TicketDto = { ...previous, status: next };

        setData(optimistic);
        onPatched(optimistic);
        setSaving(true);
        setUpdateError(null);

        try {
            const updated = await send();
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

    function changeStatus(current: TicketDto, next: TicketStatus) {
        return applyStatus(current, next, () =>
            api.updateTicketStatus(current.id, next, signalFor()),
        );
    }

    function closeTicket(current: TicketDto) {
        return applyStatus(current, TicketStatus.Closed, () =>
            api.closeTicket(current.id, signalFor()),
        );
    }

    /**
     * Escalation is one-way and promises the customer a senior response, so unlike a
     * status change it is not applied optimistically: wait for the server to agree.
     */
    async function escalate(current: TicketDto) {
        setEscalating(true);
        setUpdateError(null);

        try {
            const updated = await api.escalateTicket(current.id, signalFor());
            setData(updated);
            onPatched(updated);
        } catch (cause) {
            if (isAbort(cause)) return;
            setUpdateError(toApiError(cause));
        }
        setEscalating(false);
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
                            <dt>Reference</dt>
                            <dd>{ticket.reference}</dd>
                        </div>
                        <div>
                            <dt>Type</dt>
                            <dd>
                                <RequestTypeBadge requestType={ticket.type} />
                            </dd>
                        </div>
                        <div>
                            <dt>Customer</dt>
                            <dd>#{ticket.customerId}</dd>
                        </div>
                        {ticket.conversationId != null ? (
                            <div>
                                <dt>Conversation</dt>
                                <dd>#{ticket.conversationId}</dd>
                            </div>
                        ) : null}
                        <div>
                            <dt>Status</dt>
                            <dd>
                                <TicketStatusBadge status={ticket.status} />
                            </dd>
                        </div>
                        {ticket.category != null ? (
                            <div>
                                <dt>Category</dt>
                                <dd>{ticket.category}</dd>
                            </div>
                        ) : null}
                        {ticket.severity != null ? (
                            <div>
                                <dt>Severity</dt>
                                <dd>
                                    <TicketSeverityBadge severity={ticket.severity} />
                                </dd>
                            </div>
                        ) : null}
                        <div>
                            <dt>Escalation</dt>
                            <dd>
                                {ticket.escalated ? (
                                    <Badge tone="danger">Escalated</Badge>
                                ) : (
                                    'Not escalated'
                                )}
                            </dd>
                        </div>
                    </dl>

                    <p className="detail__description">{ticket.description}</p>

                    {updateError ? <ErrorBanner error={updateError} /> : null}

                    {closed ? (
                        <p className="detail__note">
                            This ticket is closed and cannot be reopened.
                        </p>
                    ) : (
                        <div className="detail__actions" role="group" aria-label="Change status">
                            {statusesFor(ticket).map((status) => (
                                <Button
                                    key={status}
                                    size="sm"
                                    variant={status === ticket.status ? 'primary' : 'secondary'}
                                    disabled={status === ticket.status || saving}
                                    onClick={() => void changeStatus(ticket, status)}
                                >
                                    {ticketStatusLabel[status]}
                                </Button>
                            ))}
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={saving}
                                onClick={() => void closeTicket(ticket)}
                            >
                                Close ticket
                            </Button>
                        </div>
                    )}

                    {ticket.escalated || closed ? null : (
                        <div className="detail__actions">
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={escalating}
                                onClick={() => void escalate(ticket)}
                            >
                                Escalate to senior staff
                            </Button>
                        </div>
                    )}
                </>
            ) : null}
        </section>
    );
}
