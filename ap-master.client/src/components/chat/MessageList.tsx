import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Badge } from '../ui/Badge.tsx';
import { MessageBubble } from './MessageBubble.tsx';
import { TranscriptNoticeCard } from './TranscriptNoticeCard.tsx';
import type { TranscriptEntry } from './transcript.ts';

export interface MessageListProps {
    entries: TranscriptEntry[];
    /** True while a reply is being waited on. */
    awaitingReply?: boolean;
    /** Shown in place of the transcript before the first message is sent. */
    empty?: ReactNode;
}

/**
 * The conversation transcript.
 *
 * It is a live region so a screen-reader user hears the assistant's reply
 * without hunting for it, and it is focusable so a keyboard user can scroll the
 * history without a pointer.
 */
export function MessageList({ entries, awaitingReply = false, empty }: MessageListProps) {
    const scroller = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = scroller.current;
        if (element) element.scrollTop = element.scrollHeight;
    }, [entries, awaitingReply]);

    return (
        <div
            className="message-list"
            ref={scroller}
            role="log"
            aria-live="polite"
            aria-label="Conversation"
            tabIndex={0}
        >
            {entries.length === 0 && !awaitingReply && empty ? (
                <div className="message-list__empty">{empty}</div>
            ) : null}

            {entries.map((entry) =>
                entry.kind === 'notice' ? (
                    <TranscriptNoticeCard key={entry.id} notice={entry} />
                ) : (
                    <MessageBubble
                        key={entry.id}
                        role={entry.role}
                        content={entry.content}
                        timestamp={entry.timestamp}
                        status={entry.status}
                        badge={
                            entry.badge ? (
                                <Badge tone="accent" label="Triaged as">
                                    {entry.badge}
                                </Badge>
                            ) : null
                        }
                    />
                ),
            )}

            {awaitingReply ? (
                <div className="typing" role="status">
                    <span className="visually-hidden">The assistant is replying</span>
                    <span className="typing__dot" aria-hidden="true" />
                    <span className="typing__dot" aria-hidden="true" />
                    <span className="typing__dot" aria-hidden="true" />
                </div>
            ) : null}
        </div>
    );
}
