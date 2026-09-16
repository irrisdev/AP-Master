import type { TranscriptNotice } from './transcript.ts';

export interface TranscriptNoticeCardProps {
    notice: TranscriptNotice;
}

/**
 * The visible result of triage — a ticket raised, a complaint escalated — shown
 * inline in the conversation where the customer will actually see it.
 */
export function TranscriptNoticeCard({ notice }: TranscriptNoticeCardProps) {
    return (
        <aside className={`notice notice--${notice.tone}`}>
            <strong className="notice__title">{notice.title}</strong>
            <p className="notice__detail">{notice.detail}</p>
        </aside>
    );
}
