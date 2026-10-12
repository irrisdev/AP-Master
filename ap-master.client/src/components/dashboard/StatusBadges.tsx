import {
    ConversationStatus,
    TicketSeverity,
    TicketStatus,
    conversationStatusLabel,
    requestTypeLabel,
    ticketSeverityLabel,
    ticketStatusLabel,
} from '../../api/index.ts';
import type { RequestType } from '../../api/index.ts';
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

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
    return <Badge tone={conversationStatusTone[status]}>{conversationStatusLabel[status]}</Badge>;
}

/** Serves for a ticket's type too: a ticket's type is the request type that raised it. */
export function RequestTypeBadge({ requestType }: { requestType: RequestType }) {
    return <Badge tone="accent">{requestTypeLabel[requestType]}</Badge>;
}
