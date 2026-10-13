import { useCallback } from 'react';
import { useApi } from '../../api/index.ts';
import { useAsync } from '../../hooks/useAsync.ts';
import { formatDateTime } from '../../lib/format.ts';
import { MessageBubble } from '../chat/MessageBubble.tsx';
import { toTranscript } from '../chat/transcript.ts';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { ConversationStatusBadge, RequestTypeBadge } from './StatusBadges.tsx';

export interface ConversationTranscriptProps {
    conversationId: number;
}

/**
 * Read-only transcript of a conversation, using the same bubbles as live chat.
 * Shown in the Conversations tab and beneath a ticket, so an agent sees exactly
 * what the customer said without asking them to repeat it.
 */
export function ConversationTranscript({ conversationId }: ConversationTranscriptProps) {
    const api = useApi();

    const load = useCallback(
        (signal: AbortSignal) => api.getConversation(conversationId, signal),
        [api, conversationId],
    );
    const { data: conversation, error, loading, reload } = useAsync(load);

    if (loading) return <Skeleton rows={3} label="Loading conversation" />;
    if (error) return <ErrorBanner error={error} onRetry={reload} />;
    if (!conversation) return null;

    return (
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
                <div className="thread" tabIndex={0} aria-label={`Conversation ${conversationId} transcript`}>
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
    );
}
