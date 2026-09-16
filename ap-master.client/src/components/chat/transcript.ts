import type { MessageDto } from '../../api/index.ts';

export type MessageRoleView = 'customer' | 'assistant';
export type MessageStatus = 'sent' | 'pending' | 'failed';

export interface TranscriptMessage {
    kind: 'message';
    id: string;
    role: MessageRoleView;
    content: string;
    timestamp: string;
    status: MessageStatus;
    /** Triage outcome shown against the reply, e.g. "Technical support". */
    badge?: string;
}

export interface TranscriptNotice {
    kind: 'notice';
    id: string;
    tone: 'info' | 'escalation';
    title: string;
    detail: string;
}

/**
 * The chat is a stream of two things: messages, and the consequences of a
 * message — a ticket raised, a complaint escalated. Modelling both as entries
 * keeps them in the order they happened instead of banishing the outcome to a
 * corner of the screen where nobody reads it.
 */
export type TranscriptEntry = TranscriptMessage | TranscriptNotice;

let sequence = 0;

export function nextEntryId(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}`;
}

/**
 * `Message.Sender` is a free-text string on the server today, so match loosely
 * and treat anything that is not the customer as the assistant.
 */
export function roleFromSender(sender: string): MessageRoleView {
    const value = sender.trim().toLowerCase();
    return value === 'user' || value === 'customer' ? 'customer' : 'assistant';
}

export function toTranscript(messages: MessageDto[]): TranscriptMessage[] {
    return messages.map((message) => ({
        kind: 'message',
        id: `msg-${message.id}`,
        role: roleFromSender(message.sender),
        content: message.content,
        timestamp: message.timestamp,
        status: 'sent',
    }));
}
