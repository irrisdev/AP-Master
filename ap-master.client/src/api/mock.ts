import { ApiError } from './contract.ts';
import type { ApiClient } from './contract.ts';
import {
    ComplaintSeverity,
    ComplaintStatus,
    ConversationStatus,
    RequestType,
    TicketStatus,
} from './types.ts';
import type {
    ChatRequest,
    ChatResponse,
    ComplaintDto,
    ComplaintFilter,
    ConversationDetail,
    ConversationSummary,
    CreateCustomerRequest,
    CustomerDto,
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
 *  - a reply to troubleshooting steps is read as an answer, not reclassified
 *  - senders are "Customer" and "AI"; references look like TKT-000042 / CMP-6D4A1140
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

/** Mirrors TroubleshootingOutcomeDetector.Detect — negatives first, so "not fixed" is not "fixed". */
function troubleshootingOutcome(message: string): 'resolved' | 'not-resolved' | 'unclear' {
    const text = message.trim().toLowerCase();

    const notResolved = [
        'not working', 'still not', 'still broken', 'still down', 'still getting', 'still having',
        'still no', 'still the same', "didn't work", 'didnt work', 'did not work', "didn't help",
        'didnt help', 'did not help', "doesn't work", 'doesnt work', 'does not work', 'not fixed',
        'not resolved', 'unresolved', 'same problem', 'same issue', 'no luck', 'no change',
    ];
    const resolved = [
        'fixed', 'working now', 'works now', 'resolved', 'sorted', 'that worked', 'it worked',
        'all good', 'problem solved', 'back up', 'back online', 'that helped',
    ];

    if (includesAny(text, notResolved) || startsWithWord(text, 'no')) return 'not-resolved';
    if (includesAny(text, resolved) || startsWithWord(text, 'yes')) return 'resolved';
    return 'unclear';
}

/** Matches "no", "no." and "no it isn't", but not "nothing" or "now". */
function startsWithWord(text: string, word: string): boolean {
    return text.startsWith(word) && (text.length === word.length || !/[a-z]/.test(text[word.length]));
}

/** Mirrors TicketReference.For — the reference is derived from the id, not stored. */
function ticketReference(ticketId: number): string {
    return `TKT-${String(ticketId).padStart(6, '0')}`;
}

/** Mirrors DbSeeder's email convention, so the mock's customers look like the seeded ones. */
function emailFor(name: string): string {
    return `${name.toLowerCase().replace(/[^a-z]/g, '')}@example.com`;
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

    /** Mirrors ComplaintService.GenerateReference — CMP- plus 8 uppercase hex characters. */
    private reference(): string {
        this.nextReference += 1;
        return `CMP-${this.nextReference.toString(16).toUpperCase().padStart(8, '0')}`;
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
                createdAt: isoMinutesAgo(90),
            },
            {
                id: this.id(),
                conversationId: convoId,
                sender: SENDER_AI,
                content: ticketReply(ticketId),
                createdAt: isoMinutesAgo(89),
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
            messages,
        });

        this.tickets.push({
            id: ticketId,
            reference: ticketReference(ticketId),
            customerId: 1,
            conversationId: convoId,
            description: 'My router will not connect since the firmware update last night.',
            status: TicketStatus.AwaitingTechnician,
        });

        const secondTicketId = this.id();
        this.tickets.push({
            id: secondTicketId,
            reference: ticketReference(secondTicketId),
            customerId: 2,
            conversationId: null,
            description: 'Line fault reported by engineer; awaiting replacement part.',
            status: TicketStatus.InProgress,
        });

        this.complaints.push({
            id: this.id(),
            reference: this.reference(),
            customerId: 3,
            conversationId: null,
            description: 'Third technician visit missed without notice. I am considering legal advice.',
            category: 'Technical Support',
            severity: ComplaintSeverity.High,
            status: ComplaintStatus.Open,
            escalated: true,
        });
    }

    async sendMessage(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
        const text = request.message;

        await delay(text.includes('trigger-slow') ? this.slowLatencyMs : this.latencyMs, signal);

        if (text.includes('trigger-error')) {
            throw new ApiError('The assistant is temporarily unavailable.', 503, undefined, 'mock-0001');
        }

        let conversation = this.conversations.find((c) => c.id === request.conversationId);

        // A reply to troubleshooting steps is judged against the conversation's state rather
        // than classified afresh: "still not working" is an answer, not a new enquiry.
        if (conversation && conversation.status === ConversationStatus.Troubleshooting) {
            const outcome = troubleshootingOutcome(text);
            if (outcome !== 'unclear') {
                return this.resolveTroubleshooting(conversation, text, outcome);
            }
        }

        const requestType = classify(text);
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
                // ChatService appends this prompt to the AI's steps; the answer drives the
                // troubleshooting branch on the next turn.
                reply = `${AI_REPLIES[RequestType.ServiceIssue]}\n\nDid that fix the problem? Let me know - if it's still not working, I'll raise a support ticket for you.`;
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

    /**
     * Mirrors ChatService's troubleshooting branch: resolved closes the conversation,
     * not resolved raises a ticket carrying the whole customer side of the thread.
     */
    private resolveTroubleshooting(
        conversation: ConversationDetail,
        text: string,
        outcome: 'resolved' | 'not-resolved',
    ): ChatResponse {
        this.appendMessage(conversation, SENDER_CUSTOMER, text);

        if (outcome === 'resolved') {
            conversation.status = ConversationStatus.Resolved;
            const reply =
                "Great, I'm glad that's sorted. If anything else comes up, just send another message.";
            this.appendMessage(conversation, SENDER_AI, reply);

            return {
                conversationId: conversation.id,
                requestType: RequestType.ServiceIssue,
                message: reply,
                escalated: false,
                ticketId: null,
            };
        }

        const history = conversation.messages
            .filter((m) => m.sender === SENDER_CUSTOMER)
            .map((m) => m.content)
            .join('\n');
        const ticket = this.createTicket(conversation, history);
        conversation.status = ConversationStatus.Escalated;

        const reply =
            `Sorry that didn't fix it. I've raised a support ticket (ID ${ticket.id}) with our ` +
            "technical team, including the details you've given me. They'll be in touch shortly.";
        this.appendMessage(conversation, SENDER_AI, reply);

        return {
            conversationId: conversation.id,
            requestType: RequestType.ServiceIssue,
            message: reply,
            escalated: true,
            ticketId: ticket.id,
        };
    }

    private appendMessage(conversation: ConversationDetail, sender: string, content: string) {
        conversation.messages.push({
            id: this.id(),
            conversationId: conversation.id,
            sender,
            content,
            createdAt: nowIso(),
        });
        conversation.updatedAt = nowIso();
    }

    private createTicket(conversation: ConversationDetail, description: string): TicketDto {
        const id = this.id();
        const ticket: TicketDto = {
            id,
            reference: ticketReference(id),
            customerId: conversation.customerId,
            conversationId: conversation.id,
            description,
            status: TicketStatus.AwaitingTechnician,
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
            reference: this.reference(),
            customerId,
            conversationId,
            description,
            category: category ?? complaintCategory(description),
            severity,
            status: ComplaintStatus.Open,
            escalated: severity === ComplaintSeverity.High,
        };
        this.complaints.push(complaint);
        return complaint;
    }

    async getCustomer(id: number, signal?: AbortSignal): Promise<CustomerDto> {
        await delay(this.latencyMs, signal);
        const found = CUSTOMERS.find((c) => c.id === id);
        if (!found) throw new ApiError('Resource not found', 404, `Customer ${id} was not found.`);
        return { id: found.id, name: found.name, email: emailFor(found.name) };
    }

    async createCustomer(
        request: CreateCustomerRequest,
        signal?: AbortSignal,
    ): Promise<CustomerDto> {
        await delay(this.latencyMs, signal);
        const email = request.email.trim().toLowerCase();
        if (CUSTOMERS.some((c) => emailFor(c.name) === email)) {
            throw new ApiError('Conflict', 409, 'A customer with this email address already exists.');
        }
        const created = { id: this.id(), name: request.name.trim() };
        CUSTOMERS.push(created);
        return { ...created, email };
    }

    /** Mirrors GET /api/customers/{id}/conversations — one customer's, newest first. */
    async listConversations(
        customerId: number,
        signal?: AbortSignal,
    ): Promise<ConversationSummary[]> {
        await delay(this.latencyMs, signal);
        const name = CUSTOMERS.find((c) => c.id === customerId)?.name;
        if (!name) {
            throw new ApiError('Resource not found', 404, `Customer ${customerId} was not found.`);
        }

        return this.conversations
            .filter((c) => c.customerId === customerId)
            .map(
                (c): ConversationSummary => ({
                    id: c.id,
                    customerId: c.customerId,
                    customerName: name,
                    requestType: c.requestType,
                    status: c.status,
                    createdAt: c.createdAt,
                    updatedAt: c.updatedAt,
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

    /** Newest first, matching the server's OrderByDescending(t => t.Id). */
    async listTickets(filter?: TicketFilter, signal?: AbortSignal): Promise<TicketDto[]> {
        await delay(this.latencyMs, signal);
        return this.tickets
            .filter((t) => filter?.status === undefined || t.status === filter.status)
            .filter((t) => filter?.customerId === undefined || t.customerId === filter.customerId)
            .sort((a, b) => b.id - a.id)
            .map((t) => ({ ...t }));
    }

    async getTicket(id: number, signal?: AbortSignal): Promise<TicketDto> {
        await delay(this.latencyMs, signal);
        return { ...this.findTicket(id) };
    }

    async updateTicketStatus(
        id: number,
        status: TicketStatus,
        signal?: AbortSignal,
    ): Promise<TicketDto> {
        await delay(this.latencyMs, signal);
        const found = this.findTicket(id);

        if (found.status === status) return { ...found }; // nothing to change

        if (found.status === TicketStatus.Closed) {
            throw new ApiError(
                'Conflict',
                409,
                `Ticket ${found.reference} is closed and cannot be reopened.`,
            );
        }

        found.status = status;
        return { ...found };
    }

    async closeTicket(id: number, signal?: AbortSignal): Promise<TicketDto> {
        await delay(this.latencyMs, signal);
        const found = this.findTicket(id);

        if (found.status === TicketStatus.Closed) {
            throw new ApiError('Conflict', 409, `Ticket ${found.reference} is already closed.`);
        }

        found.status = TicketStatus.Closed;
        return { ...found };
    }

    async listComplaints(filter?: ComplaintFilter, signal?: AbortSignal): Promise<ComplaintDto[]> {
        await delay(this.latencyMs, signal);
        return this.complaints
            .filter((c) => filter?.status === undefined || c.status === filter.status)
            .filter((c) => filter?.severity === undefined || c.severity === filter.severity)
            .filter((c) => filter?.escalated === undefined || c.escalated === filter.escalated)
            .sort((a, b) => b.id - a.id)
            .map((c) => ({ ...c }));
    }

    async getComplaint(id: number, signal?: AbortSignal): Promise<ComplaintDto> {
        await delay(this.latencyMs, signal);
        return { ...this.findComplaint(id) };
    }

    async escalateComplaint(id: number, signal?: AbortSignal): Promise<ComplaintDto> {
        await delay(this.latencyMs, signal);
        const found = this.findComplaint(id);

        if (found.escalated) {
            throw new ApiError(
                'Conflict',
                409,
                `Complaint ${found.reference} has already been escalated.`,
            );
        }

        found.escalated = true;
        return { ...found };
    }

    private findTicket(id: number): TicketDto {
        const found = this.tickets.find((t) => t.id === id);
        if (!found) throw new ApiError('Resource not found', 404, `Ticket ${id} was not found.`);
        return found;
    }

    private findComplaint(id: number): ComplaintDto {
        const found = this.complaints.find((c) => c.id === id);
        if (!found) throw new ApiError('Resource not found', 404, `Complaint ${id} was not found.`);
        return found;
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
