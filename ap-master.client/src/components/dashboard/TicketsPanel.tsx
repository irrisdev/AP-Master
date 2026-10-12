import { useCallback, useEffect, useRef, useState } from 'react';
import {
    RequestType,
    TicketSeverity,
    TicketStatus,
    isOpenTicketStatus,
    ticketSeverityLabel,
    ticketStatusLabel,
    useApi,
} from '../../api/index.ts';
import type { TicketDto, TicketFilter, TicketType } from '../../api/index.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { useCustomerNames } from '../../hooks/useCustomerNames.ts';
import { useTicketFeed } from '../../hooks/useTicketFeed.ts';
import { formatRelative } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Select } from '../ui/Select.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { TextField } from '../ui/TextField.tsx';
import { TicketDetail } from './TicketDetail.tsx';
import {
    EscalatedBadge,
    LiveIndicator,
    RequestTypeBadge,
    TicketSeverityBadge,
    TicketStatusBadge,
} from './StatusBadges.tsx';

const anyValue = '';

/** How long a ticket that has just arrived stays highlighted. */
const HIGHLIGHT_MS = 8_000;

type TypeChoice = 'all' | `${TicketType}`;

const typeChoices: { value: TypeChoice; label: string; type?: TicketType }[] = [
    { value: 'all', label: 'All tickets' },
    { value: String(RequestType.TechnicalSupport) as TypeChoice, label: 'Technical support', type: RequestType.TechnicalSupport },
    { value: String(RequestType.ServiceIssue) as TypeChoice, label: 'Service issues', type: RequestType.ServiceIssue },
    { value: String(RequestType.Complaint) as TypeChoice, label: 'Complaints', type: RequestType.Complaint },
];

// Every status, in workflow order, for the filter.
const statusOptions = [
    { value: anyValue, label: 'Any status' },
    ...[
        TicketStatus.Open,
        TicketStatus.AwaitingTechnician,
        TicketStatus.InProgress,
        TicketStatus.Resolved,
        TicketStatus.Closed,
    ].map((status) => ({ value: String(status), label: ticketStatusLabel[status] })),
];

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

/** The same test the server applies, so a pushed ticket only joins the list if a reload would show it. */
function matches(ticket: TicketDto, filter: TicketFilter): boolean {
    return (
        (filter.status === undefined || ticket.status === filter.status) &&
        (filter.type === undefined || ticket.type === filter.type) &&
        (filter.severity === undefined || ticket.severity === filter.severity) &&
        (filter.escalated === undefined || ticket.escalated === filter.escalated) &&
        (filter.customerId === undefined || ticket.customerId === filter.customerId)
    );
}

/** Insert or replace by id, keeping newest first. */
function upsert(list: TicketDto[], ticket: TicketDto): TicketDto[] {
    const without = list.filter((row) => row.id !== ticket.id);
    return [ticket, ...without].sort((a, b) => b.id - a.id);
}

/**
 * The agent's queue: every ticket the assistant has raised — support requests,
 * failed troubleshooting and complaints — in one list, newest first.
 *
 * It stays current on its own: new tickets and changes made by other agents are
 * pushed by the server and merged in, briefly highlighted, and announced to screen
 * readers. Filtering happens on the server; pushed tickets are checked against the
 * same filter so the list never shows something a reload would not.
 */
export function TicketsPanel() {
    const api = useApi();

    const [typeChoice, setTypeChoice] = useState<TypeChoice>('all');
    const [status, setStatus] = useState<TicketStatus | undefined>(undefined);
    const [severity, setSeverity] = useState<TicketSeverity | undefined>(undefined);
    const [escalated, setEscalated] = useState<boolean | undefined>(undefined);
    const [customerId, setCustomerId] = useState<number | undefined>(undefined);
    const [customerDraft, setCustomerDraft] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
    const [announcement, setAnnouncement] = useState('');
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

    const type = typeChoices.find((choice) => choice.value === typeChoice)?.type;
    const isComplaintView = type === RequestType.Complaint;
    // Severity only exists on complaints, so the filter only makes sense there.
    const filter: TicketFilter = {
        status,
        type,
        severity: isComplaintView ? severity : undefined,
        escalated,
        customerId,
    };

    // Memoised on the filter values, so they, not the identity of an inline arrow,
    // decide when the list refetches.
    const effectiveSeverity = filter.severity;
    const load = useCallback(
        (signal: AbortSignal) =>
            api.listTickets({ status, type, severity: effectiveSeverity, escalated, customerId }, signal),
        [api, status, type, effectiveSeverity, escalated, customerId],
    );
    const { data: tickets, error, loading, reload, setData } = useAsync(load, { keepPreviousData: true });

    // Every ticket, unfiltered, for the queue summary and the counts on each type.
    const loadAll = useCallback((signal: AbortSignal) => api.listTickets(undefined, signal), [api]);
    const {
        data: allTickets,
        reload: reloadAll,
        setData: setAllTickets,
    } = useAsync(loadAll, { keepPreviousData: true });

    const names = useCustomerNames((tickets ?? []).map((ticket) => ticket.customerId));

    useEffect(() => {
        const pending = timers.current;
        return () => pending.forEach(clearTimeout);
    }, []);

    function highlight(id: number) {
        setFresh((current) => new Set(current).add(id));
        clearTimeout(timers.current.get(id));
        timers.current.set(
            id,
            setTimeout(() => {
                timers.current.delete(id);
                setFresh((current) => {
                    const next = new Set(current);
                    next.delete(id);
                    return next;
                });
            }, HIGHLIGHT_MS),
        );
    }

    const live = useTicketFeed({
        onCreated: (ticket) => {
            setAllTickets((current) => (current ? upsert(current, ticket) : current));
            if (matches(ticket, filter)) {
                setData((current) => (current ? upsert(current, ticket) : current));
                highlight(ticket.id);
            }
            setAnnouncement(`New ticket ${ticket.reference} raised.`);
        },
        onUpdated: (ticket) => {
            setAllTickets((current) => (current ? upsert(current, ticket) : current));
            setData((current) => {
                if (!current) return current;
                const listed = current.some((row) => row.id === ticket.id);
                if (matches(ticket, filter)) return listed ? upsert(current, ticket) : current;
                // It no longer fits the filter (e.g. it was closed while filtering for open ones).
                return current.filter((row) => row.id !== ticket.id);
            });
        },
        onReconnected: () => {
            reload();
            reloadAll();
        },
    });

    /** Keeps both lists in step with a change made in the detail panel. */
    const patch = useCallback(
        (ticket: TicketDto) => {
            setData((current) =>
                current ? current.map((row) => (row.id === ticket.id ? ticket : row)) : current,
            );
            setAllTickets((current) =>
                current ? current.map((row) => (row.id === ticket.id ? ticket : row)) : current,
            );
        },
        [setData, setAllTickets],
    );

    const filtered =
        typeChoice !== 'all' ||
        status !== undefined ||
        filter.severity !== undefined ||
        escalated !== undefined ||
        customerId !== undefined;

    function clearFilters() {
        setTypeChoice('all');
        setStatus(undefined);
        setSeverity(undefined);
        setEscalated(undefined);
        setCustomerId(undefined);
        setCustomerDraft('');
    }

    function refresh() {
        reload();
        reloadAll();
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

    const openCount = (choice: (typeof typeChoices)[number]) =>
        allTickets?.filter(
            (ticket) =>
                isOpenTicketStatus(ticket.status) && (choice.type === undefined || ticket.type === choice.type),
        ).length;

    return (
        <div className="queue">
            <QueueSummary tickets={allTickets} />

            <div className={`dashboard__split ${selectedId === null ? 'dashboard__split--single' : ''}`.trim()}>
                <section className="panel" aria-label="Ticket queue" aria-busy={loading || undefined}>
                    <header className="panel__header">
                        <h2>Ticket queue</h2>
                        <div className="panel__tools">
                            <LiveIndicator state={live} />
                            <Button variant="ghost" size="sm" onClick={refresh}>
                                Refresh
                            </Button>
                        </div>
                    </header>

                    <p className="visually-hidden" role="status">
                        {announcement}
                    </p>

                    <p className="panel__hint">
                        Select a ticket to see the customer’s conversation and update its status.
                    </p>

                    <SegmentedControl
                        label="Ticket type"
                        options={typeChoices.map((choice) => ({
                            value: choice.value,
                            label: choice.label,
                            count: openCount(choice),
                        }))}
                        value={typeChoice}
                        onChange={(next) => {
                            setTypeChoice(next);
                            setSelectedId(null);
                        }}
                    />

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
                        {isComplaintView ? (
                            <Select
                                label="Severity"
                                value={severity === undefined ? anyValue : String(severity)}
                                options={severityOptions}
                                onChange={(event) =>
                                    setSeverity(
                                        event.target.value === anyValue
                                            ? undefined
                                            : (Number(event.target.value) as TicketSeverity),
                                    )
                                }
                            />
                        ) : null}
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
                        <div className="field--inline field--narrow">
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

                    {loading && !tickets ? <Skeleton rows={4} label="Loading tickets" /> : null}

                    {error ? <ErrorBanner error={error} onRetry={reload} /> : null}

                    {tickets && !loading && tickets.length === 0 ? (
                        <EmptyState
                            title="No tickets match"
                            description={
                                filtered
                                    ? 'Nothing matches the current filters.'
                                    : 'Tickets raised from a chat conversation will appear here as they happen.'
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

                    {tickets && tickets.length > 0 ? (
                        <div className="table-scroll">
                            <table className="table">
                                <caption className="visually-hidden">
                                    Tickets, newest first
                                </caption>
                                <thead>
                                    <tr>
                                        <th scope="col">Ticket</th>
                                        <th scope="col">Type</th>
                                        <th scope="col">Customer</th>
                                        <th scope="col">Summary</th>
                                        <th scope="col">Status</th>
                                        <th scope="col" className="table__col--optional">Raised</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tickets.map((ticket) => (
                                        <tr
                                            key={ticket.id}
                                            className={[
                                                ticket.id === selectedId ? 'table__row--selected' : '',
                                                fresh.has(ticket.id) ? 'table__row--new' : '',
                                            ]
                                                .join(' ')
                                                .trim()}
                                        >
                                            <th scope="row">
                                                <button
                                                    type="button"
                                                    className="link-button"
                                                    aria-pressed={ticket.id === selectedId}
                                                    onClick={() => setSelectedId(ticket.id)}
                                                >
                                                    {ticket.reference}
                                                </button>
                                                {fresh.has(ticket.id) ? (
                                                    <span className="table__new">New</span>
                                                ) : null}
                                            </th>
                                            <td>
                                                <RequestTypeBadge requestType={ticket.type} />
                                            </td>
                                            <td className="table__customer">
                                                {names.get(ticket.customerId) ?? `#${ticket.customerId}`}
                                            </td>
                                            <td className="table__summary" title={ticket.description}>
                                                {ticket.description}
                                            </td>
                                            <td>
                                                <span className="table__badges">
                                                    <TicketStatusBadge status={ticket.status} />
                                                    {ticket.severity !== null ? (
                                                        <TicketSeverityBadge severity={ticket.severity} />
                                                    ) : null}
                                                    {ticket.escalated ? <EscalatedBadge /> : null}
                                                </span>
                                            </td>
                                            <td className="table__time table__col--optional">
                                                <time dateTime={ticket.createdAt}>
                                                    {formatRelative(ticket.createdAt)}
                                                </time>
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
                        key={selectedId}
                        ticketId={selectedId}
                        onClose={() => setSelectedId(null)}
                        onPatched={patch}
                    />
                ) : null}
            </div>
        </div>
    );
}

/** The queue at a glance: what needs doing now. */
function QueueSummary({ tickets }: { tickets: TicketDto[] | null }) {
    const open = tickets?.filter((ticket) => isOpenTicketStatus(ticket.status)) ?? [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const stats = [
        {
            label: 'Needs action',
            value: open.length,
            hint: 'Tickets not yet resolved or closed',
        },
        {
            label: 'Awaiting a technician',
            value: open.filter((ticket) => ticket.status === TicketStatus.AwaitingTechnician).length,
            hint: 'Support tickets nobody has picked up',
        },
        {
            label: 'Open complaints',
            value: open.filter((ticket) => ticket.type === RequestType.Complaint).length,
            hint: 'Complaints still being handled',
        },
        {
            label: 'Escalated',
            value: open.filter((ticket) => ticket.escalated).length,
            hint: 'Open tickets with senior staff',
            tone: 'danger' as const,
        },
        {
            label: 'Raised today',
            value: tickets?.filter((ticket) => new Date(ticket.createdAt) >= startOfToday).length ?? 0,
            hint: 'Tickets created since midnight',
        },
    ];

    return (
        <section className="stats" aria-label="Queue summary">
            {stats.map((stat) => (
                <div
                    key={stat.label}
                    className={`stat ${stat.tone && stat.value > 0 ? `stat--${stat.tone}` : ''}`.trim()}
                    title={stat.hint}
                >
                    <span className="stat__value">{tickets ? stat.value : '–'}</span>
                    <span className="stat__label">{stat.label}</span>
                </div>
            ))}
        </section>
    );
}
