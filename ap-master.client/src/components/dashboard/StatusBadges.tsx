import {
    ConversationStatus,
    RequestType,
    TicketSeverity,
    TicketStatus,
    conversationStatusLabel,
    requestTypeLabel,
    ticketSeverityLabel,
    ticketStatusLabel,
} from '../../api/index.ts';
import type { LiveConnectionState } from '../../api/index.ts';
import { Badge } from '../ui/Badge.tsx';
import type { BadgeTone } from '../ui/Badge.tsx';

/*
 * Enum-to-colour mapping lives here rather than in each list, so a status means
 * the same thing wherever it is shown.
 */

const ticketStatusTone: Record<TicketStatus, BadgeTone> = {
    [TicketStatus.Open]: 'warning',
    [TicketStatus.AwaitingTechnician]: 'warning',
    [TicketStatus.InProgress]: 'info',
    [TicketStatus.Resolved]: 'success',
    [TicketStatus.Closed]: 'neutral',
};

const ticketSeverityTone: Record<TicketSeverity, BadgeTone> = {
    [TicketSeverity.Low]: 'neutral',
    [TicketSeverity.Medium]: 'warning',
    [TicketSeverity.High]: 'danger',
};

const conversationStatusTone: Record<ConversationStatus, BadgeTone> = {
    [ConversationStatus.Active]: 'info',
    [ConversationStatus.Troubleshooting]: 'warning',
    [ConversationStatus.Resolved]: 'success',
    [ConversationStatus.Escalated]: 'danger',
    [ConversationStatus.Closed]: 'neutral',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
    return <Badge tone={ticketStatusTone[status]}>{ticketStatusLabel[status]}</Badge>;
}

export function TicketSeverityBadge({ severity }: { severity: TicketSeverity }) {
    return (
        <Badge tone={ticketSeverityTone[severity]} label="Severity">
            {ticketSeverityLabel[severity]}
        </Badge>
    );
}

export function EscalatedBadge() {
    return <Badge tone="danger">Escalated</Badge>;
}

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
    return <Badge tone={conversationStatusTone[status]}>{conversationStatusLabel[status]}</Badge>;
}

/** Also used for a ticket's type: a ticket's type is the request that raised it. */
export function RequestTypeBadge({ requestType }: { requestType: RequestType }) {
    return (
        <Badge tone={requestType === RequestType.Complaint ? 'warning' : 'accent'}>
            {requestTypeLabel[requestType]}
        </Badge>
    );
}

const liveLabel: Record<LiveConnectionState, string> = {
    live: 'Live',
    connecting: 'Connecting…',
    offline: 'Offline',
};

/** Whether the dashboard is receiving updates as they happen. */
export function LiveIndicator({ state }: { state: LiveConnectionState }) {
    return (
        <span
            className={`live live--${state}`}
            title={
                state === 'live'
                    ? 'New tickets and changes appear here as they happen.'
                    : state === 'connecting'
                      ? 'Connecting to live updates…'
                      : 'Live updates are unavailable. Use Refresh to see the latest.'
            }
        >
            <span className="live__dot" aria-hidden="true" />
            {liveLabel[state]}
        </span>
    );
}
