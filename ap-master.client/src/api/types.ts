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
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

export const TicketStatus = {
    AwaitingTechnician: 0,
    InProgress: 1,
    Resolved: 2,
    Closed: 3,
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketPriority = {
    Low: 0,
    Medium: 1,
    High: 2,
    Critical: 3,
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

export const ComplaintStatus = {
    Open: 0,
    InProgress: 1,
    Resolved: 2,
    Closed: 3,
} as const;
export type ComplaintStatus = (typeof ComplaintStatus)[keyof typeof ComplaintStatus];

export const ComplaintSeverity = {
    Low: 0,
    Medium: 1,
    High: 2,
} as const;
export type ComplaintSeverity = (typeof ComplaintSeverity)[keyof typeof ComplaintSeverity];

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
};

export const ticketStatusLabel: Record<TicketStatus, string> = {
    [TicketStatus.AwaitingTechnician]: 'Awaiting technician',
    [TicketStatus.InProgress]: 'In progress',
    [TicketStatus.Resolved]: 'Resolved',
    [TicketStatus.Closed]: 'Closed',
};

export const ticketPriorityLabel: Record<TicketPriority, string> = {
    [TicketPriority.Low]: 'Low',
    [TicketPriority.Medium]: 'Medium',
    [TicketPriority.High]: 'High',
    [TicketPriority.Critical]: 'Critical',
};

export const complaintStatusLabel: Record<ComplaintStatus, string> = {
    [ComplaintStatus.Open]: 'Open',
    [ComplaintStatus.InProgress]: 'In progress',
    [ComplaintStatus.Resolved]: 'Resolved',
    [ComplaintStatus.Closed]: 'Closed',
};

export const complaintSeverityLabel: Record<ComplaintSeverity, string> = {
    [ComplaintSeverity.Low]: 'Low',
    [ComplaintSeverity.Medium]: 'Medium',
    [ComplaintSeverity.High]: 'High',
};

/* --------------------------------------------- validation limits (mirrors) */

/** Mirrors the DataAnnotations on the server DTOs so the UI rejects the same input. */
export const limits = {
    chatMessageMin: 1,
    chatMessageMax: 2000,
    complaintDescriptionMin: 5,
    complaintDescriptionMax: 5000,
    complaintCategoryMax: 100,
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
    requestType: RequestType;
    message: string;
    escalated: boolean;
    ticketId?: number | null;
}

/** Mirrors DTOs/ComplaintRequest.cs */
export interface ComplaintRequest {
    customerId: number;
    conversationId?: number | null;
    description: string;
    category?: string | null;
}

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

/* ------------------------------------------------------- PROPOSED shapes */
/* No server DTO exists for these yet. They are the frontend's proposal for  */
/* the read models the dashboard needs. Agree them with whoever builds the   */
/* endpoints before treating them as settled.                               */

export interface TicketDto {
    id: number;
    customerId: number;
    customerName: string;
    conversationId?: number | null;
    description: string;
    status: TicketStatus;
    priority: TicketPriority;
    createdAt: string;
    updatedAt: string;
}

export interface ComplaintDto {
    id: number;
    customerId: number;
    customerName: string;
    conversationId?: number | null;
    reference: string;
    description: string;
    category: string;
    severity: ComplaintSeverity;
    status: ComplaintStatus;
    escalated: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface TicketFilter {
    status?: TicketStatus;
    priority?: TicketPriority;
}
