import { useCallback, useEffect, useState } from 'react';
import {
    ConversationStatus,
    RequestType,
    TicketStatus,
    isAbort,
    requestTypeLabel,
    useApi,
} from '../../api/index.ts';
import type { ApiError, ChatResponse, CustomerDto, TicketDto } from '../../api/index.ts';
import { useAbortSignal } from '../../hooks/useAbortSignal.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { toApiError } from '../../lib/errors.ts';
import { Button } from '../ui/Button.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Composer } from './Composer.tsx';
import { ConversationHistory } from './ConversationHistory.tsx';
import { MessageList } from './MessageList.tsx';
import { nextEntryId, toTranscript } from './transcript.ts';
import type { TranscriptEntry, TranscriptMessage, TranscriptNotice } from './transcript.ts';
import './chat.css';

interface FailedSend {
    entryId: string;
    text: string;
}

/** The answers ChatService's troubleshooting step understands, offered as one-tap replies. */
const quickReplies = {
    fixed: 'Yes, that fixed it',
    notFixed: "No, it's still not working",
} as const;

export interface ChatViewProps {
    /** Who the chat acts for. Every message is sent, and every conversation stored, under this id. */
    customer: CustomerDto;
    /** Leave this customer and pick another. */
    onSwitchCustomer: () => void;
}

/**
 * The customer-facing conversation.
 *
 * The customer's message is rendered before the server has seen it and then
 * reconciled, so the interface never feels like it is waiting on the network.
 * A send that fails leaves the message on screen marked "Not sent" and offers a
 * retry against the same entry, so nothing the customer typed is lost.
 *
 * What the assistant did about a message — a ticket raised, a complaint logged —
 * is shown inline as a notice, once per ticket. A logged complaint ends the
 * conversation, and the customer is offered a fresh one. When troubleshooting
 * steps ask "did that fix it?", the two answers are offered as buttons.
 *
 * Beside the chat is the customer's own conversation history, read back from the
 * server, so it is visible that what they say is kept against their account. A
 * past conversation can be reopened; any ticket it raised is shown with its
 * current status.
 */
export function ChatView({ customer, onSwitchCustomer }: ChatViewProps) {
    const api = useApi();
    const signalFor = useAbortSignal();
    const openSignalFor = useAbortSignal();

    const loadHistory = useCallback(
        (signal: AbortSignal) => api.listConversations(customer.id, signal),
        [api, customer.id],
    );
    const history = useAsync(loadHistory, { keepPreviousData: true });
    const [opening, setOpening] = useState(false);

    const [entries, setEntries] = useState<TranscriptEntry[]>([]);
    const [conversationId, setConversationId] = useState<number | null>(null);
    const [conversationStatus, setConversationStatus] = useState<ConversationStatus | null>(null);
    const [seenTickets, setSeenTickets] = useState<ReadonlySet<number>>(new Set());
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [failed, setFailed] = useState<FailedSend | null>(null);
    const cooldown = useCooldown();

    const ended = conversationStatus === ConversationStatus.Closed;
    const troubleshooting = conversationStatus === ConversationStatus.Troubleshooting;

    function updateStatus(entryId: string, status: TranscriptMessage['status']) {
        setEntries((current) =>
            current.map((entry) =>
                entry.kind === 'message' && entry.id === entryId ? { ...entry, status } : entry,
            ),
        );
    }

    async function send(text: string, existingEntryId?: string) {
        const entryId = existingEntryId ?? nextEntryId('message');

        if (existingEntryId) {
            updateStatus(entryId, 'pending');
        } else {
            setEntries((current) => [
                ...current,
                {
                    kind: 'message',
                    id: entryId,
                    role: 'customer',
                    content: text,
                    timestamp: new Date().toISOString(),
                    status: 'pending',
                },
            ]);
            setDraft('');
        }

        setSending(true);
        setError(null);

        try {
            const response = await api.sendMessage(
                { customerId: customer.id, conversationId, message: text },
                signalFor(),
            );

            const notices = outcomeNotices(response, seenTickets);
            if (response.ticketId != null) {
                const ticketId = response.ticketId;
                setSeenTickets((current) => new Set(current).add(ticketId));
            }

            setConversationId(response.conversationId);
            setConversationStatus(response.conversationStatus);
            setEntries((current) => [
                ...current.map((entry) =>
                    entry.kind === 'message' && entry.id === entryId
                        ? { ...entry, status: 'sent' as const }
                        : entry,
                ),
                {
                    kind: 'message',
                    id: nextEntryId('reply'),
                    role: 'assistant',
                    content: response.message,
                    timestamp: new Date().toISOString(),
                    status: 'sent',
                    badge: requestTypeLabel[response.requestType],
                },
                ...notices,
            ]);
            setFailed(null);
            setSending(false);
            // A new conversation, or a changed status, should show in the history.
            history.reload();
        } catch (cause) {
            // An abort means this component went away; there is nobody to tell.
            if (isAbort(cause)) return;
            const apiError = toApiError(cause);
            updateStatus(entryId, 'failed');
            setError(apiError);
            setFailed({ entryId, text });
            setSending(false);

            if (apiError.status === 429) cooldown.start(apiError.retryAfterSeconds ?? 5);
            // The conversation may have been closed elsewhere (e.g. in another tab).
            if (apiError.status === 409 && conversationId !== null) void refreshStatus(conversationId);
        }
    }

    async function refreshStatus(id: number) {
        try {
            const conversation = await api.getConversation(id, openSignalFor());
            setConversationStatus(conversation.status);
        } catch {
            // Not worth a second error banner; the first one already explains the failure.
        }
    }

    function startNewConversation() {
        setEntries([]);
        setConversationId(null);
        setConversationStatus(null);
        setSeenTickets(new Set());
        setDraft('');
        setError(null);
        setFailed(null);
    }

    async function openConversation(id: number) {
        if (id === conversationId) return;

        setOpening(true);
        setError(null);
        try {
            const signal = openSignalFor();
            const [conversation, tickets] = await Promise.all([
                api.getConversation(id, signal),
                // Tickets are a nice-to-have here: never let them stop the transcript opening.
                api.listTickets({ customerId: customer.id }, signal).catch((cause: unknown) => {
                    if (isAbort(cause)) throw cause;
                    return [] as TicketDto[];
                }),
            ]);
            const raised = tickets.filter((ticket) => ticket.conversationId === id);

            setEntries([...toTranscript(conversation.messages), ...raised.map(ticketStatusNotice)]);
            setConversationId(conversation.id);
            setConversationStatus(conversation.status);
            setSeenTickets(new Set(raised.map((ticket) => ticket.id)));
            setDraft('');
            setFailed(null);
        } catch (cause) {
            if (isAbort(cause)) return;
            setError(toApiError(cause));
        }
        setOpening(false);
    }

    const blockedReason = cooldown.secondsLeft > 0
        ? `You can send again in ${cooldown.secondsLeft} second${cooldown.secondsLeft === 1 ? '' : 's'}.`
        : undefined;

    return (
        <section className="chat" aria-label="Chat with Telegroup">
            <header className="chat__header">
                <div>
                    <h1>Chat with Telegroup</h1>
                    <p className="chat__subtitle">
                        Ask about your account, report a fault, or raise a complaint.
                    </p>
                </div>
                {entries.length > 0 ? (
                    <Button variant="ghost" size="sm" onClick={startNewConversation}>
                        New conversation
                    </Button>
                ) : null}
            </header>

            <div className="chat__identity">
                <span className="chat__avatar" aria-hidden="true">
                    {initials(customer.name)}
                </span>
                <p className="chat__identity-text">
                    <span className="visually-hidden">Chatting as </span>
                    <strong>{customer.name}</strong>
                    <span className="chat__identity-meta">
                        Customer #{customer.id} · {customer.email}
                    </span>
                </p>
                <Button variant="secondary" size="sm" onClick={onSwitchCustomer}>
                    Switch customer
                </Button>
            </div>

            <div className="chat__layout">
                <ConversationHistory
                    conversations={history.data}
                    error={history.error}
                    onRetry={history.reload}
                    activeId={conversationId}
                    onOpen={(id) => void openConversation(id)}
                    opening={opening || sending}
                />

                <div className="chat__main">
                    <MessageList
                        entries={entries}
                        awaitingReply={sending}
                        empty={<EmptyChat onPick={(text) => void send(text)} />}
                    />

                    {error ? (
                        <div className="chat__error">
                            <ErrorBanner
                                error={error}
                                onRetry={
                                    failed && !ended && cooldown.secondsLeft === 0
                                        ? () => void send(failed.text, failed.entryId)
                                        : undefined
                                }
                            />
                        </div>
                    ) : null}

                    {ended ? (
                        <div className="chat__ended" role="status">
                            <div>
                                <strong>This conversation has ended.</strong>
                                <p>
                                    Your complaint is with our team, who can see everything you
                                    said. For anything else, start a new conversation.
                                </p>
                            </div>
                            <Button variant="primary" onClick={startNewConversation}>
                                Start a new conversation
                            </Button>
                        </div>
                    ) : (
                        <>
                            {troubleshooting && !sending ? (
                                <div className="quick-replies" role="group" aria-label="Did that fix the problem?">
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={Boolean(blockedReason)}
                                        onClick={() => void send(quickReplies.fixed)}
                                    >
                                        {quickReplies.fixed}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={Boolean(blockedReason)}
                                        onClick={() => void send(quickReplies.notFixed)}
                                    >
                                        {quickReplies.notFixed}
                                    </Button>
                                </div>
                            ) : null}

                            <Composer
                                value={draft}
                                onChange={setDraft}
                                onSend={() => void send(draft)}
                                sending={sending}
                                blockedReason={blockedReason}
                            />
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}

/** Example openers, one per thing the assistant can do, so a first-time user knows where to start. */
const starters = [
    'What broadband packages do you offer?',
    'My router won’t turn on and I need an engineer',
    'My internet keeps dropping out',
    'I want to make a complaint',
];

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
    return (
        <>
            <p>
                Tell us what you need in your own words — for example{' '}
                <em>“my broadband has been slow since Tuesday”</em>.
            </p>
            <div className="starters" role="group" aria-label="Example messages">
                {starters.map((text) => (
                    <button key={text} type="button" className="starter" onClick={() => onPick(text)}>
                        {text}
                    </button>
                ))}
            </div>
        </>
    );
}

/**
 * A countdown after the server says "too many requests". Sending is paused until it
 * reaches zero; the customer can keep typing meanwhile.
 */
function useCooldown() {
    const [until, setUntil] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (until === null) return;
        const timer = setInterval(() => {
            const current = Date.now();
            setNow(current);
            if (current >= until) setUntil(null);
        }, 250);
        return () => clearInterval(timer);
    }, [until]);

    const start = useCallback((seconds: number) => {
        const current = Date.now();
        setNow(current);
        setUntil(current + Math.max(1, seconds) * 1000);
    }, []);

    return {
        secondsLeft: until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000)),
        start,
    };
}

/** "Jane Doe" becomes "JD", for the avatar beside the customer's name. */
function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
}

/**
 * Turns the triage outcome into something the customer can actually read. A follow-up
 * about a ticket the customer has already been told about adds nothing, so each ticket
 * gets one notice. Nothing here promises a timescale: the server never does either.
 */
function outcomeNotices(response: ChatResponse, seen: ReadonlySet<number>): TranscriptEntry[] {
    if (response.ticketId == null || seen.has(response.ticketId)) return [];

    const reference = response.ticketReference ?? `#${response.ticketId}`;

    if (response.requestType === RequestType.Complaint) {
        return [
            {
                kind: 'notice',
                id: nextEntryId('notice'),
                tone: response.escalated ? 'escalation' : 'info',
                title: response.escalated
                    ? `Complaint ${reference} logged and escalated`
                    : `Complaint ${reference} logged`,
                detail: response.escalated
                    ? 'Because of how serious this is, a senior member of our team will contact you.'
                    : 'Our customer service team will review it and contact you.',
            },
        ];
    }

    return [
        {
            kind: 'notice',
            id: nextEntryId('notice'),
            tone: 'info',
            title: `Support ticket ${reference} raised`,
            detail: 'A technician will review it and contact you. They can see this whole conversation.',
        },
    ];
}

const ticketProgress: Record<TicketStatus, string> = {
    [TicketStatus.Open]: 'Waiting to be reviewed by our team.',
    [TicketStatus.AwaitingTechnician]: 'Waiting for a technician to pick it up.',
    [TicketStatus.InProgress]: 'Our team is working on it.',
    [TicketStatus.Resolved]: 'Our team has marked it as resolved.',
    [TicketStatus.Closed]: 'This ticket is closed.',
};

/** Where a ticket raised in a reopened conversation has got to. */
function ticketStatusNotice(ticket: TicketDto): TranscriptNotice {
    const kind = ticket.type === RequestType.Complaint ? 'Complaint' : 'Support ticket';
    return {
        kind: 'notice',
        id: `ticket-${ticket.id}`,
        tone: ticket.escalated && ticket.status !== TicketStatus.Closed ? 'escalation' : 'info',
        title: `${kind} ${ticket.reference}`,
        detail: ticketProgress[ticket.status],
    };
}
