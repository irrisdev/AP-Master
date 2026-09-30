import { useCallback } from 'react';
import { useApi } from '../../api/index.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { formatDateTime } from '../../lib/format.ts';
import { MessageBubble } from '../chat/MessageBubble.tsx';
import { toTranscript } from '../chat/transcript.ts';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { ConversationStatusBadge, RequestTypeBadge } from './StatusBadges.tsx';

export interface ConversationThreadProps {
    conversationId: number;
    onClose: () => void;
}

/** Read-only view of a past conversation, using the same bubbles as live chat. */
export function ConversationThread({ conversationId, onClose }: ConversationThreadProps) {
    const api = useApi();

    const load = useCallback(
        (signal: AbortSignal) => api.getConversation(conversationId, signal),
        [api, conversationId],
    );
    const { data: conversation, error, loading, reload } = useAsync(load);

    return (
        <section className="panel detail" aria-label={`Conversation ${conversationId}`}>
            <header className="detail__header">
                <h2>Conversation #{conversationId}</h2>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                </Button>
            </header>

            {loading ? <Skeleton rows={3} label="Loading conversation" /> : null}

            {error ? <ErrorBanner error={error} onRetry={reload} /> : null}

            {conversation ? (
                <>
                    <div className="card__badges">
                        <RequestTypeBadge requestType={conversation.requestType} />
                        <ConversationStatusBadge status={conversation.status} />
                        <span className="card__meta">
                            {conversation.customerName ? `${conversation.customerName} · ` : ''}
                            started {formatDateTime(conversation.createdAt)}
                        </span>
                    </div>

                    {conversation.messages.length === 0 ? (
                        <EmptyState title="No messages" description="This conversation is empty." />
                    ) : (
                        <div className="thread">
                            {toTranscript(conversation.messages).map((message) => (
                                <MessageBubble
                                    key={message.id}
                                    role={message.role}
                                    content={message.content}
                                    timestamp={message.timestamp}
                                />
                            ))}
                        </div>
                    )}
                </>
            ) : null}
        </section>
    );
}
