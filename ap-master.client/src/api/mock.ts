import { classify } from './classifier.ts';
import { ApiError } from './contract.ts';
import type { ApiClient } from './contract.ts';
import { ConversationStatus, RequestType, TicketSeverity, TicketStatus } from './types.ts';
import type {
    ChatRequest,
    ChatResponse,
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
 *  - classification is a port of RuleBasedClassifier (see classifier.ts)
 *  - technical support raises a ticket and marks the conversation Escalated
 *  - service issues move the conversation to Troubleshooting, no ticket; a failed
 *    fix raises a ServiceIssue ticket
 *  - a complaint is a ticket of type Complaint, starting Open, with keyword-derived
 *    severity and category; only High escalates
 *  - a reply to troubleshooting steps is read as an answer, not reclassified
 *  - senders are "Customer" and "AI"; references look like TKT-1A2B3C4D / CMP-6D4A1140
 *
 * It stands in for the server running without an AI key: classification is the rule
 * result alone (the server only asks the AI when the rules are unsure), and replies
 * are plausible fixed copy rather than DummyAIService's bracketed placeholder — the
 * point is to exercise the UI, not to reproduce a placeholder.
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

/** Mirrors TicketService.DetermineSeverity */
function complaintSeverity(description: string): TicketSeverity {
    const text = description.toLowerCase();
    if (includesAny(text, ['legal', 'court', 'data breach', 'danger'])) {
        return TicketSeverity.High;
    }
    if (includesAny(text, ['refund', 'billing', 'charged'])) {
        return TicketSeverity.Medium;
    }
    return TicketSeverity.Low;
}

/** Mirrors TicketService.DetermineCategory */
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
const SEEDED_CUSTOMERS = ['John Doe', 'Sarah Jones', 'Sophie Smith', 'Michael Brown', 'Emily Davis'];

export class MockApiClient implements ApiClient {
    // Per instance, like the rest of the data, so a customer registered in one test
    // (or one page load) never leaks into the next.
    private customers: CustomerDto[] = SEEDED_CUSTOMERS.map((name, index) => ({
        id: index + 1,
        name,
        email: emailFor(name),
    }));
    private conversations: ConversationDetail[] = [];
    private tickets: TicketDto[] = [];
    private nextId = 100;
    private nextReference = 40412;
    private readonly latencyMs: number;
    private readonly slowLatencyMs: number;

    constructor(options: MockApiOptions = {}) {
        this.latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
        this.slowLatencyMs = options.slowLatencyMs ?? DEFAULT_SLOW_LATENCY_MS;
        this.seed();
    }

    private findCustomer(id: number): CustomerDto {
        const found = this.customers.find((c) => c.id === id);
        if (!found) throw new ApiError('Resource not found', 404, `Customer ${id} was not found.`);
        return found;
    }

    private id(): number {
        this.nextId += 1;
        return this.nextId;
    }

    /**
     * Mirrors TicketService.GenerateReference: CMP- for a complaint, TKT- otherwise, then
     * 8 uppercase hex characters. The server's are random; these count up, so tests can
     * predict them.
     */
    private reference(type: RequestType): string {
        this.nextReference += 1;
        const prefix = type === RequestType.Complaint ? 'CMP' : 'TKT';
        return `${prefix}-${this.nextReference.toString(16).toUpperCase().padStart(8, '0')}`;
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
            customerName: this.findCustomer(1).name,
            requestType: RequestType.TechnicalSupport,
            status: ConversationStatus.Escalated,
            createdAt: isoMinutesAgo(90),
            updatedAt: isoMinutesAgo(89),
            messages,
        });

        this.tickets.push(
            this.newTicket(
                ticketId,
                1,
                convoId,
                RequestType.TechnicalSupport,
                'My router will not connect since the firmware update last night.',
                isoMinutesAgo(89),
            ),
        );

        const lineFault = this.newTicket(
            this.id(),
            2,
            null,
            RequestType.ServiceIssue,
            'Line fault reported by engineer; awaiting replacement part.',
            isoMinutesAgo(300),
        );
        lineFault.status = TicketStatus.InProgress;
        this.tickets.push(lineFault);

        this.tickets.push(
            this.newTicket(
                this.id(),
                3,
                null,
                RequestType.Complaint,
                'Third technician visit missed without notice. I am considering legal advice.',
                isoMinutesAgo(45),
            ),
        );
    }

    async sendMessage(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
        const text = request.message;

        await delay(text.includes('trigger-slow') ? this.slowLatencyMs : this.latencyMs, signal);

        if (text.includes('trigger-error')) {
            throw new ApiError('The assistant is temporarily unavailable.', 503, undefined, 'mock-0001');
        }

        // Mirrors ChatService: the customer must exist, and a conversation belonging to
        // someone else is reported as not found rather than joined.
        const customer = this.findCustomer(request.customerId);
        let conversation: ConversationDetail | undefined;
        if (request.conversationId != null) {
            conversation = this.conversations.find(
                (c) => c.id === request.conversationId && c.customerId === customer.id,
            );
            if (!conversation) {
                throw new ApiError(
                    'Resource not found',
                    404,
                    `Conversation ${request.conversationId} was not found.`,
                );
            }
        }

        // A reply to troubleshooting steps is judged against the conversation's state rather
        // than classified afresh: "still not working" is an answer, not a new enquiry.
        if (conversation && conversation.status === ConversationStatus.Troubleshooting) {
            const outcome = troubleshootingOutcome(text);
            if (outcome !== 'unclear') {
                return this.resolveTroubleshooting(conversation, text, outcome);
            }
        }

        const requestType = classify(text).requestType;
        if (!conversation) {
            const convoId = this.id();
            conversation = {
                id: convoId,
                customerId: customer.id,
                customerName: customer.name,
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
                const ticket = this.createTicket(conversation, RequestType.TechnicalSupport, text);
                ticketId = ticket.id;
                escalated = true;
                conversation.status = ConversationStatus.Escalated;
                reply = ticketReply(ticket.id);
                break;
            }
            case RequestType.Complaint: {
                const complaint = this.createTicket(conversation, RequestType.Complaint, text);
                ticketId = complaint.id;
                escalated = complaint.escalated;
                conversation.status = escalated
                    ? ConversationStatus.Escalated
                    : ConversationStatus.Active;
                reply = complaintReply(complaint);
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
        const ticket = this.createTicket(conversation, RequestType.ServiceIssue, history);
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

    private createTicket(
        conversation: ConversationDetail,
        type: RequestType,
        description: string,
    ): TicketDto {
        const ticket = this.newTicket(
            this.id(),
            conversation.customerId,
            conversation.id,
            type,
            description,
            nowIso(),
        );
        this.tickets.push(ticket);
        return ticket;
    }

    /**
     * Mirrors TicketService.CreateTicketAsync: a complaint starts Open with a severity and
     * category, and escalates itself when the severity is High; anything else starts
     * AwaitingTechnician with neither.
     */
    private newTicket(
        id: number,
        customerId: number,
        conversationId: number | null,
        type: RequestType,
        description: string,
        createdAt: string,
    ): TicketDto {
        const ticket: TicketDto = {
            id,
            reference: this.reference(type),
            type,
            customerId,
            conversationId,
            description,
            status: TicketStatus.AwaitingTechnician,
            category: null,
            severity: null,
            escalated: false,
            createdAt,
            updatedAt: createdAt,
        };

        if (type === RequestType.Complaint) {
            const severity = complaintSeverity(description);
            ticket.status = TicketStatus.Open;
            ticket.category = complaintCategory(description);
            ticket.severity = severity;
            ticket.escalated = severity === TicketSeverity.High;
        }

        return ticket;
    }

    async getCustomer(id: number, signal?: AbortSignal): Promise<CustomerDto> {
        await delay(this.latencyMs, signal);
        return { ...this.findCustomer(id) };
    }

    async createCustomer(
        request: CreateCustomerRequest,
        signal?: AbortSignal,
    ): Promise<CustomerDto> {
        await delay(this.latencyMs, signal);
        // Mirrors CustomerService.CreateAsync: trimmed name, lower-cased email, unique email.
        const email = request.email.trim().toLowerCase();
        if (this.customers.some((c) => c.email === email)) {
            throw new ApiError('Conflict', 409, 'A customer with this email address already exists.');
        }
        const created: CustomerDto = { id: this.id(), name: request.name.trim(), email };
        this.customers.push(created);
        return { ...created };
    }

    /** Mirrors GET /api/customers/{id}/conversations — one customer's, newest first. */
    async listConversations(
        customerId: number,
        signal?: AbortSignal,
    ): Promise<ConversationSummary[]> {
        await delay(this.latencyMs, signal);
        const { name } = this.findCustomer(customerId);

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
            .filter((t) => filter?.type === undefined || t.type === filter.type)
            .filter((t) => filter?.severity === undefined || t.severity === filter.severity)
            .filter((t) => filter?.escalated === undefined || t.escalated === filter.escalated)
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
        found.updatedAt = nowIso();
        return { ...found };
    }

    async closeTicket(id: number, signal?: AbortSignal): Promise<TicketDto> {
        await delay(this.latencyMs, signal);
        const found = this.findTicket(id);

        if (found.status === TicketStatus.Closed) {
            throw new ApiError('Conflict', 409, `Ticket ${found.reference} is already closed.`);
        }

        found.status = TicketStatus.Closed;
        found.updatedAt = nowIso();
        return { ...found };
    }

    async escalateTicket(id: number, signal?: AbortSignal): Promise<TicketDto> {
        await delay(this.latencyMs, signal);
        const found = this.findTicket(id);

        if (found.escalated) {
            throw new ApiError(
                'Conflict',
                409,
                `Ticket ${found.reference} has already been escalated.`,
            );
        }

        found.escalated = true;
        found.updatedAt = nowIso();
        return { ...found };
    }

    private findTicket(id: number): TicketDto {
        const found = this.tickets.find((t) => t.id === id);
        if (!found) throw new ApiError('Resource not found', 404, `Ticket ${id} was not found.`);
        return found;
    }
}

/** The server's own wording for a raised ticket. */
function ticketReply(ticketId: number): string {
    return (
        'Your request has been passed to our technical support team. ' +
        `A support ticket has been created with ID ${ticketId}. ` +
        'Our team will be in touch shortly.'
    );
}

/** The server's own wording for a logged complaint; it never claims one is resolved. */
function complaintReply(complaint: TicketDto): string {
    return complaint.escalated
        ? "I'm sorry to hear about this. Your complaint has been recorded and escalated to a senior member of our team. " +
              `Your complaint reference is ${complaint.reference}.`
        : "I'm sorry to hear about this. Your complaint has been recorded and will be reviewed by our customer service team. " +
              `Your complaint reference is ${complaint.reference}.`;
}
