import { useCallback, useState } from 'react';
import { useApi } from '../../api/index.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { formatRelative } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { ConversationThread } from './ConversationThread.tsx';
import { ConversationStatusBadge, RequestTypeBadge } from './StatusBadges.tsx';

export function ConversationsPanel() {
    const api = useApi();
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const load = useCallback((signal: AbortSignal) => api.listConversations(signal), [api]);
    const { data: conversations, error, loading, reload } = useAsync(load);

    return (
        <div className="dashboard__split">
            <section className="panel" aria-label="Conversations">
                <header className="panel__header">
                    <h2>Conversations</h2>
                    <Button variant="ghost" size="sm" onClick={reload}>
                        Refresh
                    </Button>
                </header>

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
                                            {conversation.customerName}
                                        </button>
                                    </h3>
                                    <span className="card__meta">
                                        {formatRelative(conversation.updatedAt)}
                                    </span>
                                </div>
                                <p className="card__body">{conversation.lastMessage}</p>
                                <div className="card__badges">
                                    <RequestTypeBadge requestType={conversation.requestType} />
                                    <ConversationStatusBadge status={conversation.status} />
                                    <span className="card__meta">
                                        {conversation.messageCount} messages
                                    </span>
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
