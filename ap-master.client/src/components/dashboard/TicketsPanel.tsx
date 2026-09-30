import { useCallback, useState } from 'react';
import { TicketStatus, ticketStatusLabel, useApi } from '../../api/index.ts';
import type { TicketDto } from '../../api/index.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Select } from '../ui/Select.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { TextField } from '../ui/TextField.tsx';
import { TicketDetail } from './TicketDetail.tsx';
import { TicketStatusBadge } from './StatusBadges.tsx';

const anyValue = '';

const statusOptions = [
    { value: anyValue, label: 'Any status' },
    ...Object.values(TicketStatus).map((status) => ({
        value: String(status),
        label: ticketStatusLabel[status],
    })),
];

export function TicketsPanel() {
    const api = useApi();

    const [status, setStatus] = useState<TicketStatus | undefined>(undefined);
    const [customerId, setCustomerId] = useState<number | undefined>(undefined);
    const [customerDraft, setCustomerDraft] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(null);

    // Memoised so the filter values, not the identity of an inline arrow, decide
    // when the list refetches.
    const load = useCallback(
        (signal: AbortSignal) => api.listTickets({ status, customerId }, signal),
        [api, status, customerId],
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

    const filtered = status !== undefined || customerId !== undefined;

    function clearFilters() {
        setStatus(undefined);
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
        <div className="dashboard__split">
            <section className="panel" aria-label="Support tickets">
                <header className="panel__header">
                    <h2>Support tickets</h2>
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
                        onChange={(event) =>
                            setStatus(
                                event.target.value === anyValue
                                    ? undefined
                                    : (Number(event.target.value) as TicketStatus),
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
                                : 'Tickets raised from a chat conversation will appear here.'
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
                                Support tickets, newest first
                            </caption>
                            <thead>
                                <tr>
                                    <th scope="col">Ticket</th>
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
                                        <td>#{ticket.customerId}</td>
                                        <td className="table__summary">{ticket.description}</td>
                                        <td>
                                            <TicketStatusBadge status={ticket.status} />
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
