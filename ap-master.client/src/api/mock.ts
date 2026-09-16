import { ApiError } from './contract.ts';
import type { ApiClient } from './contract.ts';
import {
    ComplaintSeverity,
    ComplaintStatus,
    ConversationStatus,
    RequestType,
    TicketPriority,
    TicketStatus,
} from './types.ts';
import type {
    ChatRequest,
    ChatResponse,
    ComplaintDto,
    ComplaintRequest,
    ConversationDetail,
    ConversationSummary,
    MessageDto,
    TicketDto,
    TicketFilter,
} from './types.ts';

/**
 * In-memory implementation of ApiClient. No server required.
 *
 * It is deliberately stateful for the lifetime of the page: sending a message
 * appends to a conversation, a technical fault opens a ticket, a serious
 * complaint escalates, and the dashboard reads back what the chat produced.
 * That makes it possible to build and demo the whole UI with no backend.
 *
 * It mirrors the server's ChatService as it actually behaves, so the UI built
 * against it does not surprise anyone at integration:
 *  - classification uses the same keywords as ClassificationService
 *  - technical support raises a ticket and marks the conversation Escalated
 *  - service issues move the conversation to Troubleshooting, no ticket
 *  - complaints get keyword-derived severity and category; only High escalates
 *  - senders are "Customer" and "AI"; complaint references look like C-12345
 *
 * Where the server is still a stub (the AI reply is the literal
 * "not implemented"), the mock returns plausible copy instead — the point is to
 * exercise the UI, not to reproduce a placeholder.
 *
 * Two testing affordances, so error and latency states can be built properly:
 *  - a message containing "trigger-error" makes sendMessage fail with a 503
 *  - a message containing "trigger-slow" makes that one request take 5 seconds
 */

const DEFAULT_LATENCY_MS = 450;
const DEFAULT_SLOW_LATENCY_MS = 5000;

export interface MockApiOptions {
    /** Simulated round-trip time. Tests pass 0 so they do not wait on a fake network. */
    latencyMs?: number;
    /** Delay applied to a message containing "trigger-slow". */
    slowLatencyMs?: number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
        );
    });
}

function includesAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
}

/** Mirrors Services/ClassificationService.cs */
function classify(message: string): RequestType {
    const text = message.toLowerCase();
    if (includesAny(text, ['complaint', 'complain', 'unhappy', 'disappointed'])) {
        return RequestType.Complaint;
    }
    if (includesAny(text, ['router', 'technical', 'cannot connect', "can't connect"])) {
        return RequestType.TechnicalSupport;
    }
    if (includesAny(text, ['slow', 'outage', 'not working', 'disconnect'])) {
        return RequestType.ServiceIssue;
    }
    return RequestType.CustomerEnquiry;
}

/** Mirrors ComplaintService.DetermineSeverity */
function complaintSeverity(description: string): ComplaintSeverity {
    const text = description.toLowerCase();
    if (includesAny(text, ['legal', 'court', 'data breach', 'danger'])) {
        return ComplaintSeverity.High;
    }
    if (includesAny(text, ['refund', 'billing', 'charged'])) {
        return ComplaintSeverity.Medium;
    }
    return ComplaintSeverity.Low;
}

/** Mirrors ComplaintService.DetermineCategory */
function complaintCategory(description: string): string {
    const text = description.toLowerCase();
    if (includesAny(text, ['bill', 'charged', 'refund'])) return 'Billing';
    if (includesAny(text, ['internet', 'broadband'])) return 'Service';
    if (includesAny(text, ['technician', 'technical'])) return 'Technical Support';
    return 'General';
}

/** Stand-ins for the AI reply on the two paths the server hands to IAIService. */
const AI_REPLIES: Record<
    typeof RequestType.CustomerEnquiry | typeof RequestType.ServiceIssue,
    string
> = {
    [RequestType.CustomerEnquiry]:
        'Thanks for getting in touch with Telegroup. I can help with that — could you tell me a little more about what you need?',
    [RequestType.ServiceIssue]:
        "I can see that could be disruptive. I'm checking the network status in your area now. In the meantime, try restarting your router and let me know if the speed improves.",
};

const SENDER_CUSTOMER = 'Customer';
const SENDER_AI = 'AI';

function nowIso(): string {
    return new Date().toISOString();
}

function isoMinutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Mirrors Development/DbSeeder.cs */
const CUSTOMERS: { id: number; name: string }[] = [
    { id: 1, name: 'John Doe' },
    { id: 2, name: 'Sarah Jones' },
    { id: 3, name: 'Sophie Smith' },
    { id: 4, name: 'Michael Brown' },
    { id: 5, name: 'Emily Davis' },
];

function customerName(id: number): string {
    return CUSTOMERS.find((c) => c.id === id)?.name ?? `Customer ${id}`;
}

export class MockApiClient implements ApiClient {
    private conversations: ConversationDetail[] = [];
    private tickets: TicketDto[] = [];
    private complaints: ComplaintDto[] = [];
    private nextId = 100;
    private nextReference = 40412;
    private readonly latencyMs: number;
    private readonly slowLatencyMs: number;

    constructor(options: MockApiOptions = {}) {
        this.latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
        this.slowLatencyMs = options.slowLatencyMs ?? DEFAULT_SLOW_LATENCY_MS;
        this.seed();
    }

    private id(): number {
        this.nextId += 1;
        return this.nextId;
    }

    /** The server draws these at random; sequential is enough for a stand-in. */
    private reference(): string {
        this.nextReference += 1;
        return `C-${this.nextReference}`;
    }

    private seed(): void {
        const convoId = this.id();
        const ticketId = this.id();
        const messages: MessageDto[] = [
            {
                id: this.id(),
                conversationId: convoId,
                sender: SENDER_CUSTOMER,
                content: 'My router will not connect since the firmware update last night.',
                timestamp: isoMinutesAgo(90),
            },
            {
                id: this.id(),
                conversationId: convoId,
                sender: SENDER_AI,
                content: ticketReply(ticketId),
                timestamp: isoMinutesAgo(89),
            },
        ];

        this.conversations.push({
            id: convoId,
            customerId: 1,
            customerName: customerName(1),
            requestType: RequestType.TechnicalSupport,
            status: ConversationStatus.Escalated,
            createdAt: isoMinutesAgo(90),
            updatedAt: isoMinutesAgo(89),
            messageCount: messages.length,
            lastMessage: messages[messages.length - 1].content,
            messages,
        });

        this.tickets.push({
            id: ticketId,
            customerId: 1,
            customerName: customerName(1),
            conversationId: convoId,
            description: 'My router will not connect since the firmware update last night.',
            status: TicketStatus.AwaitingTechnician,
            priority: TicketPriority.Medium,
            createdAt: isoMinutesAgo(89),
            updatedAt: isoMinutesAgo(89),
        });

        this.tickets.push({
            id: this.id(),
            customerId: 2,
            customerName: customerName(2),
            conversationId: null,
            description: 'Line fault reported by engineer; awaiting replacement part.',
            status: TicketStatus.InProgress,
            priority: TicketPriority.Medium,
            createdAt: isoMinutesAgo(300),
            updatedAt: isoMinutesAgo(30),
        });

        this.complaints.push({
            id: this.id(),
            customerId: 3,
            customerName: customerName(3),
            conversationId: null,
            reference: this.reference(),
            description: 'Third technician visit missed without notice. I am considering legal advice.',
            category: 'Technical Support',
            severity: ComplaintSeverity.High,
            status: ComplaintStatus.Open,
            escalated: true,
            createdAt: isoMinutesAgo(1440),
            updatedAt: isoMinutesAgo(200),
        });
    }

    async sendMessage(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
        const text = request.message;

        await delay(text.includes('trigger-slow') ? this.slowLatencyMs : this.latencyMs, signal);

        if (text.includes('trigger-error')) {
            throw new ApiError('The assistant is temporarily unavailable.', 503, undefined, 'mock-0001');
        }

        const requestType = classify(text);

        let conversation = this.conversations.find((c) => c.id === request.conversationId);
        if (!conversation) {
            const convoId = this.id();
            conversation = {
                id: convoId,
                customerId: request.customerId,
                customerName: customerName(request.customerId),
                requestType,
                status: ConversationStatus.Active,
                createdAt: nowIso(),
                updatedAt: nowIso(),
                messageCount: 0,
                lastMessage: '',
                messages: [],
            };
            this.conversations.push(conversation);
        }

        this.appendMessage(conversation, SENDER_CUSTOMER, text);

        let reply: string;
        let escalated = false;
        let ticketId: number | null = null;

        switch (requestType) {
            case RequestType.TechnicalSupport: {
                const ticket = this.createTicket(conversation, text);
                ticketId = ticket.id;
                escalated = true;
                conversation.status = ConversationStatus.Escalated;
                reply = ticketReply(ticket.id);
                break;
            }
            case RequestType.Complaint: {
                const complaint = this.recordComplaint(
                    request.customerId,
                    conversation.id,
                    text,
                    undefined,
                );
                escalated = complaint.escalated;
                conversation.status = escalated
                    ? ConversationStatus.Escalated
                    : ConversationStatus.Active;
                reply = `Your complaint has been recorded. Your complaint reference is ${complaint.reference}`;
                break;
            }
            case RequestType.ServiceIssue: {
                conversation.status = ConversationStatus.Troubleshooting;
                reply = AI_REPLIES[RequestType.ServiceIssue];
                break;
            }
            default: {
                reply = AI_REPLIES[RequestType.CustomerEnquiry];
            }
        }

        this.appendMessage(conversation, SENDER_AI, reply);
        conversation.requestType = requestType;

        return {
            conversationId: conversation.id,
            requestType,
            message: reply,
            escalated,
            ticketId,
        };
    }

    private appendMessage(conversation: ConversationDetail, sender: string, content: string) {
        conversation.messages.push({
            id: this.id(),
            conversationId: conversation.id,
            sender,
            content,
            timestamp: nowIso(),
        });
        conversation.messageCount = conversation.messages.length;
        conversation.lastMessage = content;
        conversation.updatedAt = nowIso();
    }

    private createTicket(conversation: ConversationDetail, description: string): TicketDto {
        const ticket: TicketDto = {
            id: this.id(),
            customerId: conversation.customerId,
            customerName: conversation.customerName,
            conversationId: conversation.id,
            description,
            status: TicketStatus.AwaitingTechnician,
            // The server has no priority column yet; Medium until that is decided.
            priority: TicketPriority.Medium,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        this.tickets.push(ticket);
        return ticket;
    }

    private recordComplaint(
        customerId: number,
        conversationId: number | null,
        description: string,
        category: string | undefined,
    ): ComplaintDto {
        const severity = complaintSeverity(description);
        const complaint: ComplaintDto = {
            id: this.id(),
            customerId,
            customerName: customerName(customerId),
            conversationId,
            reference: this.reference(),
            description,
            category: category ?? complaintCategory(description),
            severity,
            status: ComplaintStatus.Open,
            escalated: severity === ComplaintSeverity.High,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        this.complaints.push(complaint);
        return complaint;
    }

    async listConversations(signal?: AbortSignal): Promise<ConversationSummary[]> {
        await delay(this.latencyMs, signal);
        return this.conversations
            .map(
                (c): ConversationSummary => ({
                    id: c.id,
                    customerId: c.customerId,
                    customerName: c.customerName,
                    requestType: c.requestType,
                    status: c.status,
                    createdAt: c.createdAt,
                    updatedAt: c.updatedAt,
                    messageCount: c.messageCount,
                    lastMessage: c.lastMessage,
                }),
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async getConversation(id: number, signal?: AbortSignal): Promise<ConversationDetail> {
        await delay(this.latencyMs, signal);
        const found = this.conversations.find((c) => c.id === id);
        if (!found) throw new ApiError('Conversation not found.', 404);
        return structuredClone(found);
    }

    async listTickets(filter?: TicketFilter, signal?: AbortSignal): Promise<TicketDto[]> {
        await delay(this.latencyMs, signal);
        return this.tickets
            .filter((t) => filter?.status === undefined || t.status === filter.status)
            .filter((t) => filter?.priority === undefined || t.priority === filter.priority)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async getTicket(id: number, signal?: AbortSignal): Promise<TicketDto> {
        await delay(this.latencyMs, signal);
        const found = this.tickets.find((t) => t.id === id);
        if (!found) throw new ApiError('Ticket not found.', 404);
        return { ...found };
    }

    async updateTicketStatus(
        id: number,
        status: TicketStatus,
        signal?: AbortSignal,
    ): Promise<TicketDto> {
        await delay(this.latencyMs, signal);
        const found = this.tickets.find((t) => t.id === id);
        if (!found) throw new ApiError('Ticket not found.', 404);
        found.status = status;
        found.updatedAt = nowIso();
        return { ...found };
    }

    async listComplaints(signal?: AbortSignal): Promise<ComplaintDto[]> {
        await delay(this.latencyMs, signal);
        return [...this.complaints].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async createComplaint(request: ComplaintRequest, signal?: AbortSignal): Promise<ComplaintDto> {
        await delay(this.latencyMs, signal);
        const complaint = this.recordComplaint(
            request.customerId,
            request.conversationId ?? null,
            request.description,
            request.category ?? undefined,
        );
        return { ...complaint };
    }
}

/** The server's own wording for a raised ticket. */
function ticketReply(ticketId: number): string {
    return (
        'Your request has been passed to our technical support team. ' +
        `A support ticket has been created with ID: ${ticketId}. ` +
        'Our team will reach out to you shortly.'
    );
}
