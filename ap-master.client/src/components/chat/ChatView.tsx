import { useCallback, useRef, useState } from 'react';
import { RequestType, isAbort, requestTypeLabel, useApi } from '../../api/index.ts';
import type { ApiError, ChatResponse, CustomerDto } from '../../api/index.ts';
import { useAbortSignal } from '../../hooks/useAbortSignal.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { toApiError } from '../../lib/errors.ts';
import { Button } from '../ui/Button.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Composer } from './Composer.tsx';
import { ConversationHistory } from './ConversationHistory.tsx';
import { MessageList } from './MessageList.tsx';
import { nextEntryId, toTranscript } from './transcript.ts';
import type { TranscriptEntry, TranscriptMessage } from './transcript.ts';
import './chat.css';

interface FailedSend {
    entryId: string;
    text: string;
}

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
 * Beside the chat is the customer's own conversation history, read back from the
 * server, so it is visible that what they say is kept against their account. Any past
 * conversation can be reopened and carried on.
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
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [failed, setFailed] = useState<FailedSend | null>(null);
    // Tickets this conversation already has. A follow-up on an open ticket returns its id
    // again, and the customer should hear that it was raised once, not on every reply.
    const knownTickets = useRef(new Set<number>());

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

            setConversationId(response.conversationId);
            const notices = outcomeNotices(response, knownTickets.current);
            if (response.ticketId != null) knownTickets.current.add(response.ticketId);
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
            updateStatus(entryId, 'failed');
            setError(toApiError(cause));
            setFailed({ entryId, text });
            setSending(false);
        }
    }

    function startNewConversation() {
        setEntries([]);
        setConversationId(null);
        knownTickets.current = new Set();
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
            // The tickets are only there to avoid repeating a notice, so failing to read
            // them must not stop the transcript opening.
            const [conversation, tickets] = await Promise.all([
                api.getConversation(id, signal),
                api.listTickets({ customerId: customer.id }, signal).catch((cause: unknown) => {
                    if (isAbort(cause)) throw cause;
                    return [];
                }),
            ]);
            knownTickets.current = new Set(
                tickets.filter((t) => t.conversationId === id).map((t) => t.id),
            );
            setEntries(toTranscript(conversation.messages));
            setConversationId(conversation.id);
            setDraft('');
            setFailed(null);
        } catch (cause) {
            if (isAbort(cause)) return;
            setError(toApiError(cause));
        }
        setOpening(false);
    }

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
                        empty={
                            <>
                                Start by telling us what has happened — for example{' '}
                                <em>“my broadband has been slow since Tuesday”</em>.
                            </>
                        }
                    />

                    {error ? (
                        <div className="chat__error">
                            <ErrorBanner
                                error={error}
                                onRetry={
                                    failed ? () => void send(failed.text, failed.entryId) : undefined
                                }
                            />
                        </div>
                    ) : null}

                    <Composer
                        value={draft}
                        onChange={setDraft}
                        onSend={() => void send(draft)}
                        sending={sending}
                    />
                </div>
            </div>
        </section>
    );
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
 * Turns the triage outcome into something the customer can actually read.
 *
 * A complaint is a ticket too, so `ticketId` alone does not say which kind was raised:
 * the request type does. A ticket id already in `known` is a follow-up on an open case
 * and gets no notice, because nothing new happened.
 */
function outcomeNotices(response: ChatResponse, known: ReadonlySet<number>): TranscriptEntry[] {
    if (response.ticketId == null || known.has(response.ticketId)) return [];

    if (response.requestType === RequestType.Complaint) {
        return [
            response.escalated
                ? {
                      kind: 'notice',
                      id: nextEntryId('notice'),
                      tone: 'escalation',
                      title: 'Complaint logged and escalated',
                      detail: 'A manager will be in touch within two working days.',
                  }
                : {
                      kind: 'notice',
                      id: nextEntryId('notice'),
                      tone: 'info',
                      title: 'Complaint logged',
                      detail: 'Our customer service team will review it and be in touch.',
                  },
        ];
    }

    // The server also sets `escalated` when a support ticket is raised; the ticket
    // notice covers that, since an engineer picking it up is the escalation.
    return [
        {
            kind: 'notice',
            id: nextEntryId('notice'),
            tone: 'info',
            title: `Support ticket #${response.ticketId} raised`,
            detail: 'An engineer will pick this up. You can follow it on the agent dashboard.',
        },
    ];
}
