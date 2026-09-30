import type { ApiError, ConversationSummary } from '../../api/index.ts';
import { formatRelative } from '../../lib/format.ts';
import { ConversationStatusBadge, RequestTypeBadge } from '../dashboard/StatusBadges.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';

export interface ConversationHistoryProps {
    conversations: ConversationSummary[] | null;
    error: ApiError | null;
    onRetry: () => void;
    /** The conversation open in the chat, if it has been saved yet. */
    activeId: number | null;
    onOpen: (id: number) => void;
    /** True while a past conversation's messages are being fetched. */
    opening?: boolean;
}

/**
 * The signed-in customer's conversations, newest first. This is what shows a demo
 * audience that every conversation is stored against the customer who had it.
 */
export function ConversationHistory({
    conversations,
    error,
    onRetry,
    activeId,
    onOpen,
    opening = false,
}: ConversationHistoryProps) {
    return (
        <nav className="history" aria-label="Your conversations">
            <h2 className="history__title">Your conversations</h2>

            {error ? <ErrorBanner error={error} onRetry={onRetry} /> : null}

            {!conversations && !error ? <Skeleton rows={2} label="Loading your conversations" /> : null}

            {conversations && conversations.length === 0 ? (
                <p className="history__empty">
                    Nothing yet. Your first message starts a conversation, and it will be listed
                    here.
                </p>
            ) : null}

            {conversations && conversations.length > 0 ? (
                <ul className="history__list">
                    {conversations.map((conversation) => {
                        const active = conversation.id === activeId;
                        return (
                            <li key={conversation.id}>
                                <button
                                    type="button"
                                    className={`history__item ${active ? 'history__item--active' : ''}`.trim()}
                                    aria-current={active ? 'true' : undefined}
                                    disabled={opening}
                                    onClick={() => onOpen(conversation.id)}
                                >
                                    <span className="history__item-header">
                                        <span className="history__item-name">
                                            Conversation #{conversation.id}
                                        </span>
                                        <span className="history__item-time">
                                            {formatRelative(conversation.updatedAt)}
                                        </span>
                                    </span>
                                    <span className="history__item-badges">
                                        <RequestTypeBadge requestType={conversation.requestType} />
                                        <ConversationStatusBadge status={conversation.status} />
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </nav>
    );
}
