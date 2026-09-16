import { useState } from 'react';
import { RequestType, isAbort, requestTypeLabel, useApi } from '../../api/index.ts';
import type { ApiError, ChatResponse } from '../../api/index.ts';
import { currentCustomerId } from '../../config.ts';
import { useAbortSignal } from '../../hooks/useAbortSignal.ts';
import { toApiError } from '../../lib/errors.ts';
import { Button } from '../ui/Button.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Composer } from './Composer.tsx';
import { MessageList } from './MessageList.tsx';
import { nextEntryId } from './transcript.ts';
import type { TranscriptEntry, TranscriptMessage } from './transcript.ts';
import './chat.css';

interface FailedSend {
    entryId: string;
    text: string;
}

/**
 * The customer-facing conversation.
 *
 * The customer's message is rendered before the server has seen it and then
 * reconciled, so the interface never feels like it is waiting on the network.
 * A send that fails leaves the message on screen marked "Not sent" and offers a
 * retry against the same entry, so nothing the customer typed is lost.
 */
export function ChatView() {
    const api = useApi();
    const signalFor = useAbortSignal();

    const [entries, setEntries] = useState<TranscriptEntry[]>([]);
    const [conversationId, setConversationId] = useState<number | null>(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [failed, setFailed] = useState<FailedSend | null>(null);

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
                { customerId: currentCustomerId, conversationId, message: text },
                signalFor(),
            );

            setConversationId(response.conversationId);
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
                ...outcomeNotices(response),
            ]);
            setFailed(null);
            setSending(false);
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
        setDraft('');
        setError(null);
        setFailed(null);
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
                        onRetry={failed ? () => void send(failed.text, failed.entryId) : undefined}
                    />
                </div>
            ) : null}

            <Composer
                value={draft}
                onChange={setDraft}
                onSend={() => void send(draft)}
                sending={sending}
            />
        </section>
    );
}

/** Turns the triage outcome into something the customer can actually read. */
function outcomeNotices(response: ChatResponse): TranscriptEntry[] {
    const notices: TranscriptEntry[] = [];

    if (response.ticketId != null) {
        notices.push({
            kind: 'notice',
            id: nextEntryId('notice'),
            tone: 'info',
            title: `Support ticket #${response.ticketId} raised`,
            detail: 'An engineer will pick this up. You can follow it on the agent dashboard.',
        });
    }

    // The server also sets `escalated` when a ticket is raised, and the ticket notice
    // above already covers that; a complaint escalation is a different promise.
    if (response.escalated && response.requestType === RequestType.Complaint) {
        notices.push({
            kind: 'notice',
            id: nextEntryId('notice'),
            tone: 'escalation',
            title: 'Complaint logged and escalated',
            detail: 'A manager will be in touch within two working days.',
        });
    }

    return notices;
}
