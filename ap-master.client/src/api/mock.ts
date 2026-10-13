import { classify, confidenceThreshold, normalise } from './classifier.ts';
import { ApiError } from './contract.ts';
import type { ApiClient } from './contract.ts';
import {
    ConversationStatus,
    RequestType,
    TicketSeverity,
    TicketStatus,
    isOpenTicketStatus,
} from './types.ts';
import type {
    ChatRequest,
    ChatResponse,
    ConversationDetail,
    ConversationSummary,
    CreateCustomerRequest,
    CustomerDto,
    TicketDto,
    TicketEventHandlers,
    TicketFilter,
    TicketType,
} from './types.ts';

/**
 * In-memory implementation of ApiClient. No server required.
 *
 * It is deliberately stateful for the lifetime of the page: sending a message
 * appends to a conversation, a technical fault opens a ticket, a complaint is
 * logged and ends the session, and the dashboard reads back — live — what the
 * chat produced. That makes it possible to build and demo the whole UI with no
 * backend.
 *
 * It mirrors the server's ChatService as it actually behaves, so the UI built
 * against it does not surprise anyone at integration:
 *  - classification is a port of RuleBasedClassifier (see classifier.ts); follow-ups
 *    stay on the current topic unless the rules are confident about a new one
 *  - technical support raises a ticket and marks the conversation Escalated
 *  - service issues move the conversation to Troubleshooting; "no" raises a ticket
 *  - a complaint with no details is asked for them first; once logged it gets a
 *    keyword-derived severity and category, High escalates, and the conversation closes
 *  - a second request in the same conversation reuses the open ticket
 *  - every ticket change is pushed to subscribers, like the server's StaffHub
 *  - senders are "Customer" and "AI"; references are TKT-/CMP- plus 8 hex characters
 *
 * It stands in for the server running without an AI key: classification is the rule
 * result alone, and replies are plausible fixed copy rather than DummyAIService's
 * bracketed placeholder — the point is to exercise the UI, not to reproduce a placeholder.
 *
 * Testing affordances, so error and latency states can be built properly:
 *  - a message containing "trigger-error" makes sendMessage fail with a 503
 *  - a message containing "trigger-busy" is rejected with a 429 and Retry-After: 5
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
    if (includesAny(text, ['legal', 'court', 'data breach', 'danger'])) return TicketSeverity.High;
    if (includesAny(text, ['refund', 'billing', 'charged'])) return TicketSeverity.Medium;
    return TicketSeverity.Low;
}

/** Mirrors TicketService.DetermineCategory */
function complaintCategory(description: string): string {
    const text = description.toLowerCase();
    if (includesAny(text, ['bill', 'charged', 'refund'])) return 'Billing';
    if (includesAny(text, ['internet', 'broadband'])) return 'Service';
    if (includesAny(text, ['technician', 'technical', 'engineer', 'router', 'install'])) return 'Technical Support';
    return 'General';
}

/** Mirrors ComplaintDetails.IntentWords: words that say "I want to complain" rather than what went wrong. */
const COMPLAINT_INTENT_WORDS = new Set([
    'i', "i'd", 'id', "i'm", 'im', "i've", 'ive', 'me', 'my', 'we', "we'd",
    'want', 'wanna', 'would', 'like', 'need', 'wish', 'have', 'got', 'to', 'do',
    'make', 'file', 'lodge', 'raise', 'submit', 'register', 'log', 'put', 'in', 'open', 'start',
    'a', 'an', 'the', 'this', 'that', 'it', 'is', 'am', 'be', 'something', 'some',
    'complain', 'complains', 'complaint', 'complaints', 'complaining', 'formal', 'official',
    'please', 'pls', 'plz', 'hi', 'hello', 'hey', 'hiya', 'ok', 'okay', 'yes', 'yeah', 'yea',
    'can', 'could', 'you', 'help', 'with', 'about', 'for', 'how', 'so', 'just', 'really', 'very',
    'again', 'now', 'today', 'here', 'there', 'one', 'another', 'new',
]);

/** Mirrors ComplaintDetails.HasDetails */
function complaintHasDetails(message: string): boolean {
    return normalise(message)
        .split(' ')
        .filter(Boolean)
        .some((word) => !COMPLAINT_INTENT_WORDS.has(word));
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

const SENDER_CUSTOMER = 'Customer';
const SENDER_AI = 'AI';

/** The server's fixed wording around the AI's text (see ChatService). */
const replies = {
    enquiry:
        'Thanks for getting in touch with Telegroup. I can help with that — could you tell me a little more about what you need?',
    troubleshooting:
        "I'm sorry your connection is playing up. Here are a few things to try:\n\n" +
        '1. Switch your router off at the wall, wait 30 seconds, then switch it back on.\n' +
        '2. Check the cable between the router and the wall socket is pushed fully in.\n' +
        '3. If you are on Wi-Fi, try a device closer to the router.\n\n' +
        "Did that fix the problem? Let me know - if it's still not working, I'll raise a support ticket for you.",
    troubleshootingResolved:
        "Great, I'm glad that's sorted. If anything else comes up, just send another message.",
    askForComplaintDetails:
        "I'm sorry you've had a bad experience, and I'll make sure your complaint is properly recorded. " +
        "Could you tell me what happened? For example, what went wrong, when it happened, and what you'd like " +
        'us to do to put it right.',
    technicalSupport: (reference: string) =>
        "I'm sorry you're having trouble with your equipment.\n\n" +
        `I've raised a support ticket with our technical team. Your reference is ${reference}. ` +
        "A technician will review it and contact you to arrange the next steps. They can see everything you've " +
        'said in this chat, so feel free to add any more details here.',
    serviceIssueTicket: (reference: string) =>
        `Sorry that didn't fix it. I've raised a support ticket (reference ${reference}) with our technical team, ` +
        "including the details you've given me. They'll be in touch shortly.",
    complaint: (complaint: TicketDto) =>
        "I'm really sorry to hear about this, and I understand why you're unhappy.\n\n" +
        `I've logged this as a formal complaint. Your reference is ${complaint.reference}. ` +
        (complaint.escalated
            ? 'Because of how serious this is, it has been escalated to a senior member of our team, who will contact you. '
            : 'Our customer service team will review it and contact you. ') +
        "The team can see everything you've said here. This conversation is now closed; if there's anything " +
        'else you need, start a new conversation and quote your reference.',
    openTicket: (ticket: TicketDto) =>
        `You already have an open support ticket, reference ${ticket.reference}, and our technical team can see ` +
        "everything you've said in this conversation. They'll be in touch shortly.",
};

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
    private readonly subscribers = new Set<TicketEventHandlers>();
    private nextId = 100;
    private nextReference = 0x4a7c10;
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

    /** Mirrors TicketService.GenerateReference — TKT- or CMP- plus 8 uppercase hex characters. */
    private reference(type: TicketType): string {
        this.nextReference += 0x1f3;
        const prefix = type === RequestType.Complaint ? 'CMP' : 'TKT';
        return `${prefix}-${this.nextReference.toString(16).toUpperCase().padStart(8, '0')}`;
    }

    private seed(): void {
        const convoId = this.id();
        const description = 'My router will not connect since the firmware update last night.';
        const ticket = this.addTicket({
            type: RequestType.TechnicalSupport,
            customerId: 1,
            conversationId: convoId,
            description,
            createdAt: isoMinutesAgo(89),
        });

        this.conversations.push({
            id: convoId,
            customerId: 1,
            customerName: this.findCustomer(1).name,
            requestType: RequestType.TechnicalSupport,
            status: ConversationStatus.Escalated,
            createdAt: isoMinutesAgo(90),
            updatedAt: isoMinutesAgo(89),
            messages: [
                {
                    id: this.id(),
                    conversationId: convoId,
                    sender: SENDER_CUSTOMER,
                    content: description,
                    createdAt: isoMinutesAgo(90),
                },
                {
                    id: this.id(),
                    conversationId: convoId,
                    sender: SENDER_AI,
                    content: replies.technicalSupport(ticket.reference),
                    createdAt: isoMinutesAgo(89),
                },
            ],
        });

        const lineFault = this.addTicket({
            type: RequestType.ServiceIssue,
            customerId: 2,
            conversationId: null,
            description: 'Broadband keeps dropping out every evening; restarting the router did not help.',
            createdAt: isoMinutesAgo(240),
        });
        lineFault.status = TicketStatus.InProgress;

        this.addTicket({
            type: RequestType.Complaint,
            customerId: 3,
            conversationId: null,
            description: 'Third technician visit missed without notice. I am considering legal advice.',
            createdAt: isoMinutesAgo(30),
        });
    }

    async sendMessage(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
        const text = request.message;

        await delay(text.includes('trigger-slow') ? this.slowLatencyMs : this.latencyMs, signal);

        if (text.includes('trigger-error')) {
            throw new ApiError('The assistant is temporarily unavailable.', 503, undefined, 'mock-0001');
        }
        if (text.includes('trigger-busy')) {
            throw new ApiError(
                'Too many requests',
                429,
                "You're sending requests too quickly. Please wait 5 seconds and try again.",
                'mock-0429',
                5,
            );
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
            if (conversation.status === ConversationStatus.Closed) {
                throw new ApiError(
                    'Conflict',
                    409,
                    'This conversation has ended. Please start a new conversation.',
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

        const requestType = conversation ? this.classifyFollowUp(conversation, text) : classify(text).requestType;

        if (!conversation) {
            conversation = {
                id: this.id(),
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

        // Never open a second complaint or support ticket for the same problem in one conversation.
        const openSupportTicket = this.openTicketFor(conversation.id, false);
        if (requestType === RequestType.TechnicalSupport && openSupportTicket) {
            return this.reply(conversation, conversation.requestType, replies.openTicket(openSupportTicket), true, openSupportTicket);
        }

        switch (requestType) {
            case RequestType.TechnicalSupport: {
                const ticket = this.createTicket(RequestType.TechnicalSupport, conversation, text);
                conversation.status = ConversationStatus.Escalated;
                conversation.requestType = requestType;
                return this.reply(conversation, requestType, replies.technicalSupport(ticket.reference), true, ticket);
            }
            case RequestType.Complaint: {
                conversation.requestType = requestType;
                if (!complaintHasDetails(text)) {
                    conversation.status = ConversationStatus.Active;
                    return this.reply(conversation, requestType, replies.askForComplaintDetails, false, null);
                }
                const complaint = this.createTicket(RequestType.Complaint, conversation, text);
                conversation.status = ConversationStatus.Closed;
                return this.reply(conversation, requestType, replies.complaint(complaint), complaint.escalated, complaint);
            }
            case RequestType.ServiceIssue: {
                conversation.status = ConversationStatus.Troubleshooting;
                conversation.requestType = requestType;
                return this.reply(conversation, requestType, replies.troubleshooting, false, null);
            }
            default: {
                if (conversation.status !== ConversationStatus.Escalated) {
                    conversation.status = ConversationStatus.Active;
                }
                conversation.requestType = RequestType.CustomerEnquiry;
                return this.reply(conversation, RequestType.CustomerEnquiry, replies.enquiry, false, null);
            }
        }
    }

    /**
     * Mirrors ChatService.RouteFollowUpAsync: confident rules win, otherwise the message stays
     * on the current topic. While a complaint is waiting for its details, the reply is the
     * complaint, whatever it mentions, unless it is clearly a question. After a ticket has
     * been raised, unclear follow-ups become questions about it.
     */
    private classifyFollowUp(conversation: ConversationDetail, text: string): RequestType {
        const complaintLogged = this.tickets.some(
            (t) => t.conversationId === conversation.id && t.type === RequestType.Complaint,
        );
        const awaitingComplaintDetails =
            conversation.requestType === RequestType.Complaint && !complaintLogged;

        const topic = awaitingComplaintDetails
            ? RequestType.Complaint
            : conversation.requestType === RequestType.Complaint ||
                conversation.requestType === RequestType.TechnicalSupport
              ? RequestType.CustomerEnquiry
              : conversation.requestType;

        const rules = classify(text);
        const classified = rules.confidence >= confidenceThreshold ? rules.requestType : topic;

        return awaitingComplaintDetails && classified !== RequestType.CustomerEnquiry
            ? RequestType.Complaint
            : classified;
    }

    /**
     * Mirrors ChatService's troubleshooting branch: resolved closes the issue,
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
            return this.reply(conversation, RequestType.ServiceIssue, replies.troubleshootingResolved, false, null);
        }

        const existing = this.openTicketFor(conversation.id, false);
        if (existing) {
            return this.reply(conversation, RequestType.ServiceIssue, replies.openTicket(existing), true, existing);
        }

        const history = conversation.messages
            .filter((m) => m.sender === SENDER_CUSTOMER)
            .map((m) => m.content)
            .join('\n');
        const ticket = this.createTicket(RequestType.ServiceIssue, conversation, history);
        conversation.status = ConversationStatus.Escalated;

        return this.reply(conversation, RequestType.ServiceIssue, replies.serviceIssueTicket(ticket.reference), true, ticket);
    }

    private reply(
        conversation: ConversationDetail,
        requestType: RequestType,
        message: string,
        escalated: boolean,
        ticket: TicketDto | null,
    ): ChatResponse {
        this.appendMessage(conversation, SENDER_AI, message);
        return {
            conversationId: conversation.id,
            conversationStatus: conversation.status,
            requestType,
            message,
            escalated,
            ticketId: ticket?.id ?? null,
            ticketReference: ticket?.reference ?? null,
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

    private openTicketFor(conversationId: number, complaints: boolean): TicketDto | undefined {
        return this.tickets
            .filter(
                (t) =>
                    t.conversationId === conversationId &&
                    (t.type === RequestType.Complaint) === complaints &&
                    isOpenTicketStatus(t.status),
            )
            .sort((a, b) => b.id - a.id)[0];
    }

    /** Mirrors TicketService.CreateTicketAsync, including the complaint business rules. */
    private addTicket(input: {
        type: TicketType;
        customerId: number;
        conversationId: number | null;
        description: string;
        createdAt?: string;
    }): TicketDto {
        const complaint = input.type === RequestType.Complaint;
        const severity = complaint ? complaintSeverity(input.description) : null;
        const createdAt = input.createdAt ?? nowIso();

        const ticket: TicketDto = {
            id: this.id(),
            reference: this.reference(input.type),
            type: input.type,
            customerId: input.customerId,
            conversationId: input.conversationId,
            description: input.description.trim(),
            status: complaint ? TicketStatus.Open : TicketStatus.AwaitingTechnician,
            category: complaint ? complaintCategory(input.description) : null,
            severity,
            escalated: severity === TicketSeverity.High,
            createdAt,
            updatedAt: createdAt,
        };
        this.tickets.push(ticket);
        return ticket;
    }

    private createTicket(type: TicketType, conversation: ConversationDetail, description: string): TicketDto {
        const ticket = this.addTicket({
            type,
            customerId: conversation.customerId,
            conversationId: conversation.id,
            description,
        });
        this.emit('created', ticket);
        return ticket;
    }

    /** Mirrors SignalRTicketNotifier. Asynchronous, as a pushed event would be. */
    private emit(kind: 'created' | 'updated', ticket: TicketDto) {
        const copy = { ...ticket };
        queueMicrotask(() => {
            for (const subscriber of this.subscribers) {
                if (kind === 'created') subscriber.onCreated?.({ ...copy });
                else subscriber.onUpdated?.({ ...copy });
            }
        });
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
        if (!found) throw new ApiError('Resource not found', 404, `Conversation ${id} was not found.`);
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
        this.emit('updated', found);
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
        this.emit('updated', found);
        return { ...found };
    }

    async escalateTicket(id: number, signal?: AbortSignal): Promise<TicketDto> {
        await delay(this.latencyMs, signal);
        const found = this.findTicket(id);

        if (found.escalated) {
            throw new ApiError('Conflict', 409, `Ticket ${found.reference} has already been escalated.`);
        }

        found.escalated = true;
        found.updatedAt = nowIso();
        this.emit('updated', found);
        return { ...found };
    }

    /** In-memory, so it is always live. */
    subscribeToTickets(handlers: TicketEventHandlers): () => void {
        this.subscribers.add(handlers);
        handlers.onConnectionChange?.('live');
        return () => {
            this.subscribers.delete(handlers);
        };
    }

    private findTicket(id: number): TicketDto {
        const found = this.tickets.find((t) => t.id === id);
        if (!found) throw new ApiError('Resource not found', 404, `Ticket ${id} was not found.`);
        return found;
    }
}

