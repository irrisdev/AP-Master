/**
 * Mirrors of the server's DTOs and enums.
 *
 * Two things drive the shapes here:
 *  - ASP.NET Core serialises property names as camelCase by default.
 *  - ASP.NET Core serialises enums as INTEGERS by default (no JsonStringEnumConverter
 *    is registered on the server), so the enum mirrors below are numeric.
 *
 * They are written as `as const` objects rather than TypeScript `enum`s because the
 * project sets `erasableSyntaxOnly`, which forbids `enum`.
 *
 * If the server later registers a JsonStringEnumConverter, only this file changes:
 * swap the numeric values for the string names.
 */

/* ------------------------------------------------------------------ enums */

export const RequestType = {
    CustomerEnquiry: 0,
    TechnicalSupport: 1,
    ServiceIssue: 2,
    Complaint: 3,
} as const;
export type RequestType = (typeof RequestType)[keyof typeof RequestType];

export const ConversationStatus = {
    Active: 0,
    Troubleshooting: 1,
    Resolved: 2,
    Escalated: 3,
    /** The session has ended (a complaint was logged); the server refuses further messages. */
    Closed: 4,
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

/**
 * A ticket is anything the chatbot hands to staff: a technical support request, a service
 * issue troubleshooting couldn't fix, or a formal complaint. `Open` was added last on the
 * server so the other values kept their numbers.
 */
export const TicketStatus = {
    AwaitingTechnician: 0,
    InProgress: 1,
    Resolved: 2,
    Closed: 3,
    /** Starting status for complaints (support tickets start at AwaitingTechnician). */
    Open: 4,
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

/** Only complaints have a severity. */
export const TicketSeverity = {
    Low: 0,
    Medium: 1,
    High: 2,
} as const;
export type TicketSeverity = (typeof TicketSeverity)[keyof typeof TicketSeverity];

/** The request types that produce tickets. A customer enquiry never does. */
export const ticketTypes = [
    RequestType.TechnicalSupport,
    RequestType.ServiceIssue,
    RequestType.Complaint,
] as const;
export type TicketType = (typeof ticketTypes)[number];

/**
 * Statuses an agent can move a ticket between, in workflow order. Closing has its own
 * endpoint and is irreversible, so it is not one of them.
 */
export function workflowStatusesFor(type: TicketType): TicketStatus[] {
    const start = type === RequestType.Complaint ? TicketStatus.Open : TicketStatus.AwaitingTechnician;
    return [start, TicketStatus.InProgress, TicketStatus.Resolved];
}

/** Still needs someone to act on it. */
export function isOpenTicketStatus(status: TicketStatus): boolean {
    return status !== TicketStatus.Resolved && status !== TicketStatus.Closed;
}

/* ----------------------------------------------------- display labels */

export const requestTypeLabel: Record<RequestType, string> = {
    [RequestType.CustomerEnquiry]: 'Customer enquiry',
    [RequestType.TechnicalSupport]: 'Technical support',
    [RequestType.ServiceIssue]: 'Service issue',
    [RequestType.Complaint]: 'Complaint',
};

export const conversationStatusLabel: Record<ConversationStatus, string> = {
    [ConversationStatus.Active]: 'Active',
    [ConversationStatus.Troubleshooting]: 'Troubleshooting',
    [ConversationStatus.Resolved]: 'Resolved',
    [ConversationStatus.Escalated]: 'Escalated',
    [ConversationStatus.Closed]: 'Closed',
};

export const ticketStatusLabel: Record<TicketStatus, string> = {
    [TicketStatus.Open]: 'Open',
    [TicketStatus.AwaitingTechnician]: 'Awaiting technician',
    [TicketStatus.InProgress]: 'In progress',
    [TicketStatus.Resolved]: 'Resolved',
    [TicketStatus.Closed]: 'Closed',
};

export const ticketSeverityLabel: Record<TicketSeverity, string> = {
    [TicketSeverity.Low]: 'Low',
    [TicketSeverity.Medium]: 'Medium',
    [TicketSeverity.High]: 'High',
};

/* --------------------------------------------- validation limits (mirrors) */

/** Mirrors the DataAnnotations on the server DTOs so the UI rejects the same input. */
export const limits = {
    chatMessageMin: 1,
    chatMessageMax: 2000,
    customerNameMax: 100,
    customerEmailMax: 254,
} as const;

/* ------------------------------------------------- DTOs mirrored from C# */
/* These three already exist server-side and are considered firm.           */

/** Mirrors DTOs/ChatRequest.cs */
export interface ChatRequest {
    customerId: number;
    conversationId?: number | null;
    message: string;
}

/** Mirrors DTOs/ChatReponse.cs (class name is ChatResponse; the filename is misspelled) */
export interface ChatResponse {
    conversationId: number;
    /** The conversation's status after this turn. `Closed` means the session has ended. */
    conversationStatus: ConversationStatus;
    requestType: RequestType;
    message: string;
    escalated: boolean;
    /** Set when the reply relates to a ticket: one just raised, or an open one being followed up. */
    ticketId?: number | null;
    /** That ticket's customer-facing reference, e.g. TKT-1A2B3C4D or CMP-6D4A1140. */
    ticketReference?: string | null;
}

/* Tickets (complaints included) are only ever raised by the chat flow, which classifies
   the message and derives a complaint's severity and category itself. */

/** Mirrors DTOs/CustomerDtos.cs — CustomerResponse */
export interface CustomerDto {
    id: number;
    name: string;
    email: string;
}

/** Mirrors DTOs/CustomerDtos.cs — CreateCustomerRequest */
export interface CreateCustomerRequest {
    name: string;
    email: string;
}

/** Mirrors DTOs/MessageDtos.cs — MessageResponse */
export interface MessageDto {
    id: number;
    conversationId: number;
    /** Server-side `Message.Sender` is currently a plain string, not an enum. */
    sender: string;
    content: string;
    /**
     * Server-local timestamp. SQLite hands EF Core a `DateTime` with no `Kind`, so the
     * JSON carries no timezone suffix; `HttpApiClient` marks these as UTC on the way in.
     */
    createdAt: string;
}

/** Mirrors DTOs/ConversationDtos.cs — ConversationResponse */
export interface ConversationSummary {
    id: number;
    customerId: number;
    requestType: RequestType;
    status: ConversationStatus;
    createdAt: string;
    updatedAt: string;
    /**
     * Not part of ConversationResponse. `HttpApiClient` fills it in from the customer
     * endpoint so the dashboard can name the person rather than showing a bare id.
     */
    customerName?: string;
}

/** A conversation plus its messages: two server calls, assembled client-side. */
export interface ConversationDetail extends ConversationSummary {
    messages: MessageDto[];
}

/** Mirrors DTOs/TicketDtos.cs — TicketResponse. Complaints are tickets with type Complaint. */
export interface TicketDto {
    id: number;
    /** Customer-facing reference: TKT-1A2B3C4D for support, CMP-6D4A1140 for complaints (older tickets: TKT-000042). */
    reference: string;
    type: TicketType;
    customerId: number;
    conversationId?: number | null;
    description: string;
    status: TicketStatus;
    /** Complaints only. */
    category: string | null;
    /** Complaints only. */
    severity: TicketSeverity | null;
    /** Escalated to senior staff: automatically for a High-severity complaint, or by an agent. */
    escalated: boolean;
    createdAt: string;
    updatedAt: string;
}

/** Query parameters accepted by GET /api/tickets. */
export interface TicketFilter {
    status?: TicketStatus;
    type?: TicketType;
    severity?: TicketSeverity;
    escalated?: boolean;
    customerId?: number;
}

/** A ticket event pushed by the server (SignalR in live mode). */
export interface TicketEventHandlers {
    onCreated?: (ticket: TicketDto) => void;
    onUpdated?: (ticket: TicketDto) => void;
    /** Whether events are currently flowing. */
    onConnectionChange?: (state: LiveConnectionState) => void;
}

export type LiveConnectionState = 'connecting' | 'live' | 'offline';
