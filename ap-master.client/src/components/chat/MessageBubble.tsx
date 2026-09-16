import type { ReactNode } from 'react';
import { formatTime } from '../../lib/format.ts';
import type { MessageRoleView, MessageStatus } from './transcript.ts';

export interface MessageBubbleProps {
    role: MessageRoleView;
    content: string;
    timestamp: string;
    status?: MessageStatus;
    badge?: ReactNode;
}

export function MessageBubble({
    role,
    content,
    timestamp,
    status = 'sent',
    badge,
}: MessageBubbleProps) {
    const who = role === 'customer' ? 'You' : 'Telegroup assistant';

    return (
        <article className={`bubble bubble--${role} bubble--${status}`}>
            <header className="bubble__meta">
                <span className="bubble__who">{who}</span>
                <time className="bubble__time" dateTime={timestamp}>
                    {formatTime(timestamp)}
                </time>
            </header>
            <p className="bubble__body">{content}</p>
            {badge ? <div className="bubble__badge">{badge}</div> : null}
            {status === 'failed' ? <p className="bubble__status">Not sent</p> : null}
        </article>
    );
}
