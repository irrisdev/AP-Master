import { useCallback, useState } from 'react';
import {
    RequestType,
    TicketSeverity,
    TicketStatus,
    requestTypeLabel,
    ticketSeverityLabel,
    ticketStatusLabel,
    useApi,
} from '../../api/index.ts';
import type { TicketDto } from '../../api/index.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Select } from '../ui/Select.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { TextField } from '../ui/TextField.tsx';
import { TicketDetail } from './TicketDetail.tsx';
import { Badge } from '../ui/Badge.tsx';
import { RequestTypeBadge, TicketSeverityBadge, TicketStatusBadge } from './StatusBadges.tsx';

const anyValue = '';

const statusOptions = [
    { value: anyValue, label: 'Any status' },
    ...Object.values(TicketStatus).map((status) => ({
        value: String(status),
        label: ticketStatusLabel[status],
    })),
];

/** A customer enquiry never raises a ticket, so it is not offered. */
const typeOptions = [
    { value: anyValue, label: 'Any type' },
    ...[RequestType.TechnicalSupport, RequestType.ServiceIssue, RequestType.Complaint].map(
        (type) => ({ value: String(type), label: requestTypeLabel[type] }),
    ),
];

/** Only complaints have a severity, so choosing one narrows the list to complaints. */
const severityOptions = [
    { value: anyValue, label: 'Any severity' },
    ...Object.values(TicketSeverity).map((severity) => ({
        value: String(severity),
        label: ticketSeverityLabel[severity],
    })),
];

const escalatedOptions = [
    { value: anyValue, label: 'Any' },
    { value: 'true', label: 'Escalated' },
    { value: 'false', label: 'Not escalated' },
];

/** The select's string value back to an enum member, or undefined for "any". */
function optional<T extends number>(value: string): T | undefined {
    return value === anyValue ? undefined : (Number(value) as T);
}

export function TicketsPanel() {
    const api = useApi();

    const [status, setStatus] = useState<TicketStatus | undefined>(undefined);
    const [type, setType] = useState<RequestType | undefined>(undefined);
    const [severity, setSeverity] = useState<TicketSeverity | undefined>(undefined);
    const [escalated, setEscalated] = useState<boolean | undefined>(undefined);
    const [customerId, setCustomerId] = useState<number | undefined>(undefined);
    const [customerDraft, setCustomerDraft] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(null);

    // Memoised so the filter values, not the identity of an inline arrow, decide
    // when the list refetches.
    const load = useCallback(
        (signal: AbortSignal) =>
            api.listTickets({ status, type, severity, escalated, customerId }, signal),
        [api, status, type, severity, escalated, customerId],
    );

    const { data: tickets, error, loading, reload, setData } = useAsync(load);

    const patch = useCallback(
        (ticket: TicketDto) => {
            setData((current) =>
                current ? current.map((row) => (row.id === ticket.id ? ticket : row)) : current,
            );
        },
        [setData],
    );

    const filtered =
        status !== undefined ||
        type !== undefined ||
        severity !== undefined ||
        escalated !== undefined ||
        customerId !== undefined;

    function clearFilters() {
        setStatus(undefined);
        setType(undefined);
        setSeverity(undefined);
        setEscalated(undefined);
        setCustomerId(undefined);
        setCustomerDraft('');
    }

    /** Blank, or anything that is not a positive integer, means "any customer". */
    function commitCustomer() {
        const parsed = Number(customerDraft.trim());
        setCustomerId(
            customerDraft.trim() !== '' && Number.isInteger(parsed) && parsed > 0
                ? parsed
                : undefined,
        );
    }

    return (
        <div
            className={`dashboard__split${selectedId === null ? ' dashboard__split--single' : ''}`}
        >
            <section className="panel" aria-label="Tickets">
                <header className="panel__header">
                    <h2>Tickets</h2>
                    <Button variant="ghost" size="sm" onClick={reload}>
                        Refresh
                    </Button>
                </header>

                <form
                    className="filters"
                    onSubmit={(event) => {
                        event.preventDefault();
                        commitCustomer();
                    }}
                >
                    <Select
                        label="Status"
                        value={status === undefined ? anyValue : String(status)}
                        options={statusOptions}
                        onChange={(event) => setStatus(optional<TicketStatus>(event.target.value))}
                    />
                    <Select
                        label="Type"
                        value={type === undefined ? anyValue : String(type)}
                        options={typeOptions}
                        onChange={(event) => setType(optional<RequestType>(event.target.value))}
                    />
                    <Select
                        label="Severity"
                        value={severity === undefined ? anyValue : String(severity)}
                        options={severityOptions}
                        onChange={(event) =>
                            setSeverity(optional<TicketSeverity>(event.target.value))
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
                    <div className="field--inline">
                        <TextField
                            label="Customer ID"
                            type="number"
                            min={1}
                            inputMode="numeric"
                            placeholder="Any"
                            value={customerDraft}
                            onChange={(event) => setCustomerDraft(event.target.value)}
                            onBlur={commitCustomer}
                        />
                    </div>
                    {filtered ? (
                        <Button variant="ghost" size="sm" onClick={clearFilters}>
                            Clear filters
                        </Button>
                    ) : null}
                </form>

                {loading ? <Skeleton rows={4} label="Loading tickets" /> : null}

                {error ? <ErrorBanner error={error} onRetry={reload} /> : null}

                {tickets && !loading && tickets.length === 0 ? (
                    <EmptyState
                        title="No tickets match"
                        description={
                            filtered
                                ? 'Nothing matches the current filters.'
                                : 'Tickets and complaints raised from a chat conversation will appear here.'
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

                {tickets && !loading && tickets.length > 0 ? (
                    <div className="table-scroll">
                        <table className="table">
                            <caption className="visually-hidden">
                                Tickets and complaints, newest first
                            </caption>
                            <thead>
                                <tr>
                                    <th scope="col">Ticket</th>
                                    <th scope="col">Type</th>
                                    <th scope="col">Customer</th>
                                    <th scope="col">Summary</th>
                                    <th scope="col">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tickets.map((ticket) => (
                                    <tr
                                        key={ticket.id}
                                        className={
                                            ticket.id === selectedId ? 'table__row--selected' : ''
                                        }
                                    >
                                        <th scope="row">
                                            <button
                                                type="button"
                                                className="link-button"
                                                onClick={() => setSelectedId(ticket.id)}
                                            >
                                                {ticket.reference}
                                            </button>
                                        </th>
                                        <td>
                                            <RequestTypeBadge requestType={ticket.type} />
                                        </td>
                                        <td>#{ticket.customerId}</td>
                                        <td className="table__summary">{ticket.description}</td>
                                        <td>
                                            <div className="badge-row">
                                                <TicketStatusBadge status={ticket.status} />
                                                {ticket.severity != null ? (
                                                    <TicketSeverityBadge
                                                        severity={ticket.severity}
                                                    />
                                                ) : null}
                                                {ticket.escalated ? (
                                                    <Badge tone="danger">Escalated</Badge>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : null}
            </section>

            {selectedId !== null ? (
                <TicketDetail
                    ticketId={selectedId}
                    onClose={() => setSelectedId(null)}
                    onPatched={patch}
                />
            ) : null}
        </div>
    );
}
