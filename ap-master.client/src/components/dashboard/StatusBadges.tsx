import {
    ComplaintSeverity,
    ComplaintStatus,
    ConversationStatus,
    TicketPriority,
    TicketStatus,
    complaintSeverityLabel,
    complaintStatusLabel,
    conversationStatusLabel,
    requestTypeLabel,
    ticketPriorityLabel,
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
    [TicketStatus.AwaitingTechnician]: 'warning',
    [TicketStatus.InProgress]: 'info',
    [TicketStatus.Resolved]: 'success',
    [TicketStatus.Closed]: 'neutral',
};

const ticketPriorityTone: Record<TicketPriority, BadgeTone> = {
    [TicketPriority.Low]: 'neutral',
    [TicketPriority.Medium]: 'info',
    [TicketPriority.High]: 'warning',
    [TicketPriority.Critical]: 'danger',
};

const complaintStatusTone: Record<ComplaintStatus, BadgeTone> = {
    [ComplaintStatus.Open]: 'warning',
    [ComplaintStatus.InProgress]: 'info',
    [ComplaintStatus.Resolved]: 'success',
    [ComplaintStatus.Closed]: 'neutral',
};

const complaintSeverityTone: Record<ComplaintSeverity, BadgeTone> = {
    [ComplaintSeverity.Low]: 'neutral',
    [ComplaintSeverity.Medium]: 'warning',
    [ComplaintSeverity.High]: 'danger',
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

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
    return (
        <Badge tone={ticketPriorityTone[priority]} label="Priority">
            {ticketPriorityLabel[priority]}
        </Badge>
    );
}

export function ComplaintStatusBadge({ status }: { status: ComplaintStatus }) {
    return <Badge tone={complaintStatusTone[status]}>{complaintStatusLabel[status]}</Badge>;
}

export function ComplaintSeverityBadge({ severity }: { severity: ComplaintSeverity }) {
    return (
        <Badge tone={complaintSeverityTone[severity]} label="Severity">
            {complaintSeverityLabel[severity]}
        </Badge>
    );
}

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
    return <Badge tone={conversationStatusTone[status]}>{conversationStatusLabel[status]}</Badge>;
}

export function RequestTypeBadge({ requestType }: { requestType: RequestType }) {
    return <Badge tone="accent">{requestTypeLabel[requestType]}</Badge>;
}
