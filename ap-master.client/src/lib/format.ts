const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const dateTime = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
});

/** 14:32 — for message timestamps, where the day is obvious from context. */
export function formatTime(iso: string): string {
    return time.format(new Date(iso));
}

/** 9 Sep, 14:32 — for list rows spanning more than one day. */
export function formatDateTime(iso: string): string {
    return dateTime.format(new Date(iso));
}

/** "5 minutes ago", falling back to an absolute date once that stops being useful. */
export function formatRelative(iso: string, now: number = Date.now()): string {
    const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.round(hours / 24);
    if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`;

    return formatDateTime(iso);
}
