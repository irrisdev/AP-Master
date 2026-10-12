import { useCallback, useState } from 'react';
import {
    RequestType,
    TicketStatus,
    isAbort,
    requestTypeLabel,
    ticketStatusLabel,
    useApi,
    workflowStatusesFor,
} from '../../api/index.ts';
import type { ApiError, TicketDto } from '../../api/index.ts';
import { useAbortSignal } from '../../hooks/useAbortSignal.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { useCustomerNames } from '../../hooks/useCustomerNames.ts';
import { useTicketFeed } from '../../hooks/useTicketFeed.ts';
import { toApiError } from '../../lib/errors.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { ConversationTranscript } from './ConversationTranscript.tsx';
import {
    EscalatedBadge,
    RequestTypeBadge,
    TicketSeverityBadge,
    TicketStatusBadge,
} from './StatusBadges.tsx';

export interface TicketDetailProps {
    ticketId: number;
    onClose: () => void;
    /** Keeps the list in step with a change made here. */
    onPatched: (ticket: TicketDto) => void;
}

/**
 * One ticket, with everything an agent needs to act on it: what kind of ticket it
 * is, who raised it, the complaint's category and severity, the conversation that
 * produced it, and the actions available at its current stage.
 *
 * A status change is applied locally first and rolled back if the server refuses
 * it, so an agent working through a queue is never waiting on a round trip — but
 * never left believing a change that did not happen either. Escalation is one-way,
 * so it waits for the server instead.
 */
export function TicketDetail({ ticketId, onClose, onPatched }: TicketDetailProps) {
    const api = useApi();
    const signalFor = useAbortSignal();

    const load = useCallback(
        (signal: AbortSignal) => api.getTicket(ticketId, signal),
        [api, ticketId],
    );
    const { data: ticket, error, loading, reload, setData } = useAsync(load);
    const names = useCustomerNames(ticket ? [ticket.customerId] : []);

    // Another agent may change this ticket while it is open here.
    useTicketFeed({
        onUpdated: (updated) => {
            if (updated.id === ticketId) setData(updated);
        },
    });

    const [saving, setSaving] = useState(false);
    const [escalating, setEscalating] = useState(false);
    const [updateError, setUpdateError] = useState<ApiError | null>(null);

    /** Shows `next` immediately and rolls back if the server refuses. */
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

    const closed = ticket?.status === TicketStatus.Closed;
    const busy = saving || escalating;

    return (
        <section
            className="panel detail"
            aria-label={ticket ? `Ticket ${ticket.reference}` : `Ticket ${ticketId}`}
        >
            <header className="detail__header">
                <h2>{ticket ? ticket.reference : 'Ticket'}</h2>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                </Button>
            </header>

            {loading ? <Skeleton rows={2} label="Loading ticket" /> : null}

            {error ? <ErrorBanner error={error} onRetry={reload} /> : null}

            {ticket ? (
                <>
                    <div className="card__badges">
                        <RequestTypeBadge requestType={ticket.type} />
                        <TicketStatusBadge status={ticket.status} />
                        {ticket.severity !== null ? <TicketSeverityBadge severity={ticket.severity} /> : null}
                        {ticket.escalated ? <EscalatedBadge /> : null}
                    </div>

                    <dl className="detail__facts">
                        <div>
                            <dt>Customer</dt>
                            <dd>
                                {names.get(ticket.customerId) ?? 'Customer'}{' '}
                                <span className="detail__muted">#{ticket.customerId}</span>
                            </dd>
                        </div>
                        <div>
                            <dt>Type</dt>
                            <dd>{requestTypeLabel[ticket.type]}</dd>
                        </div>
                        {ticket.category ? (
                            <div>
                                <dt>Category</dt>
                                <dd>{ticket.category}</dd>
                            </div>
                        ) : null}
                        <div>
                            <dt>Raised</dt>
                            <dd>
                                <time dateTime={ticket.createdAt}>{formatDateTime(ticket.createdAt)}</time>
                            </dd>
                        </div>
                        {/* Created and updated are written microseconds apart; only a real change is worth showing. */}
                        {Date.parse(ticket.updatedAt) - Date.parse(ticket.createdAt) >= 60_000 ? (
                            <div>
                                <dt>Last updated</dt>
                                <dd>
                                    <time dateTime={ticket.updatedAt}>{formatDateTime(ticket.updatedAt)}</time>
                                </dd>
                            </div>
                        ) : null}
                    </dl>

                    <div>
                        <h3 className="detail__subheading">
                            {ticket.type === RequestType.Complaint ? 'Complaint' : 'Problem reported'}
                        </h3>
                        <p className="detail__description">{ticket.description}</p>
                    </div>

                    {updateError ? <ErrorBanner error={updateError} /> : null}

                    {closed ? (
                        <p className="detail__note">This ticket is closed and cannot be reopened.</p>
                    ) : (
                        <>
                            <div className="detail__actions" role="group" aria-label="Change status">
                                {workflowStatusesFor(ticket.type).map((status) => (
                                    <Button
                                        key={status}
                                        size="sm"
                                        variant={status === ticket.status ? 'primary' : 'secondary'}
                                        aria-pressed={status === ticket.status}
                                        disabled={status === ticket.status || busy}
                                        onClick={() => void changeStatus(ticket, status)}
                                    >
                                        {ticketStatusLabel[status]}
                                    </Button>
                                ))}
                            </div>
                            <div className="detail__actions detail__actions--secondary">
                                {ticket.escalated ? null : (
                                    <Button
                                        size="sm"
                                        variant="danger"
                                        loading={escalating}
                                        disabled={busy}
                                        onClick={() => void escalate(ticket)}
                                    >
                                        Escalate to senior staff
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => void closeTicket(ticket)}
                                >
                                    Close ticket
                                </Button>
                            </div>
                        </>
                    )}

                    {ticket.conversationId != null ? (
                        <div className="detail__conversation">
                            <h3 className="detail__subheading">
                                Conversation #{ticket.conversationId}
                            </h3>
                            <ConversationTranscript conversationId={ticket.conversationId} />
                        </div>
                    ) : (
                        <p className="detail__note">This ticket has no linked conversation.</p>
                    )}
                </>
            ) : null}
        </section>
    );
}
