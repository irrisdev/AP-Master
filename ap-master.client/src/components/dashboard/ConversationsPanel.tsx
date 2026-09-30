import { useCallback, useState } from 'react';
import { useApi } from '../../api/index.ts';
import { demoCustomerId } from '../../config.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { formatRelative } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { TextField } from '../ui/TextField.tsx';
import { ConversationThread } from './ConversationThread.tsx';
import { ConversationStatusBadge, RequestTypeBadge } from './StatusBadges.tsx';

/**
 * Conversations are read per customer: the server exposes
 * GET /api/customers/{id}/conversations and has no "everything" endpoint, so the
 * agent looks a customer up rather than scrolling one global queue.
 */
export interface ConversationsPanelProps {
    /** Whose conversations to show first; falls back to the first demo customer. */
    initialCustomerId?: number;
}

export function ConversationsPanel({ initialCustomerId = demoCustomerId }: ConversationsPanelProps) {
    const api = useApi();
    const [customerId, setCustomerId] = useState(initialCustomerId);
    const [draftId, setDraftId] = useState(String(initialCustomerId));
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const load = useCallback(
        (signal: AbortSignal) => api.listConversations(customerId, signal),
        [api, customerId],
    );
    const { data: conversations, error, loading, reload } = useAsync(load);

    function lookUp(event: React.FormEvent) {
        event.preventDefault();
        const parsed = Number(draftId);
        if (!Number.isInteger(parsed) || parsed < 1) return;
        setSelectedId(null);
        // Same customer: the id has not changed, so re-run the request explicitly.
        if (parsed === customerId) reload();
        else setCustomerId(parsed);
    }

    return (
        <div className="dashboard__split">
            <section className="panel" aria-label="Conversations">
                <header className="panel__header">
                    <h2>Conversations</h2>
                    <Button variant="ghost" size="sm" onClick={reload}>
                        Refresh
                    </Button>
                </header>

                <form className="filters" onSubmit={lookUp}>
                    <div className="field--inline">
                        <TextField
                            label="Customer ID"
                            type="number"
                            min={1}
                            inputMode="numeric"
                            value={draftId}
                            onChange={(event) => setDraftId(event.target.value)}
                        />
                    </div>
                    <Button type="submit" variant="secondary" size="sm">
                        Look up
                    </Button>
                </form>

                {loading ? <Skeleton rows={3} label="Loading conversations" /> : null}

                {error ? <ErrorBanner error={error} onRetry={reload} /> : null}

                {conversations && !loading && conversations.length === 0 ? (
                    <EmptyState
                        title="No conversations yet"
                        description="Send a message from the chat view and it will show up here."
                    />
                ) : null}

                {conversations && !loading && conversations.length > 0 ? (
                    <ul className="card-list">
                        {conversations.map((conversation) => (
                            <li
                                key={conversation.id}
                                className={`card ${
                                    conversation.id === selectedId ? 'card--selected' : ''
                                }`.trim()}
                            >
                                <div className="card__header">
                                    <h3>
                                        <button
                                            type="button"
                                            className="link-button"
                                            onClick={() => setSelectedId(conversation.id)}
                                        >
                                            Conversation #{conversation.id}
                                        </button>
                                    </h3>
                                    <span className="card__meta">
                                        {formatRelative(conversation.updatedAt)}
                                    </span>
                                </div>
                                {conversation.customerName ? (
                                    <p className="card__body">{conversation.customerName}</p>
                                ) : null}
                                <div className="card__badges">
                                    <RequestTypeBadge requestType={conversation.requestType} />
                                    <ConversationStatusBadge status={conversation.status} />
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </section>

            {selectedId !== null ? (
                <ConversationThread
                    conversationId={selectedId}
                    onClose={() => setSelectedId(null)}
                />
            ) : null}
        </div>
    );
}
