import { describe, expect, it } from 'vitest';
import { MockApiClient } from './mock.ts';
import { ConversationStatus, RequestType, TicketSeverity, TicketStatus } from './types.ts';

/**
 * These pin the mock to what the real POST /api/chat was observed to do, so
 * the UI cannot be built against behaviour the server does not have.
 */
function client() {
    return new MockApiClient({ latencyMs: 0, slowLatencyMs: 0 });
}

describe('MockApiClient mirrors the server contract', () => {
    it('raises a ticket for technical support and flags the conversation escalated', async () => {
        const api = client();
        const response = await api.sendMessage({ customerId: 1, message: 'My router will not connect' });

        expect(response.requestType).toBe(RequestType.TechnicalSupport);
        expect(response.ticketId).not.toBeNull();
        expect(response.escalated).toBe(true);

        const conversation = await api.getConversation(response.conversationId);
        expect(conversation.status).toBe(ConversationStatus.Escalated);
    });

    it('does not raise a ticket for a service issue', async () => {
        const api = client();
        const before = (await api.listTickets()).length;

        const response = await api.sendMessage({ customerId: 1, message: 'My broadband is slow' });

        expect(response.requestType).toBe(RequestType.ServiceIssue);
        expect(response.ticketId).toBeNull();
        expect(response.escalated).toBe(false);
        expect((await api.listTickets()).length).toBe(before);

        const conversation = await api.getConversation(response.conversationId);
        expect(conversation.status).toBe(ConversationStatus.Troubleshooting);
    });

    it('escalates only a high-severity complaint', async () => {
        const api = client();

        const low = await api.sendMessage({ customerId: 1, message: 'I want to complain about the delay' });
        expect(low.escalated).toBe(false);

        const high = await api.sendMessage({ customerId: 1, message: 'I am unhappy and will go to court' });
        expect(high.escalated).toBe(true);

        const complaints = await api.listTickets({ type: RequestType.Complaint, customerId: 1 });
        const severities = complaints.map((c) => c.severity);
        expect(severities).toContain(TicketSeverity.Low);
        expect(severities).toContain(TicketSeverity.High);
    });

    it('records a complaint as a ticket and returns its id', async () => {
        const api = client();
        const response = await api.sendMessage({
            customerId: 1,
            message: 'I am disappointed I was charged twice',
        });

        expect(response.ticketId).not.toBeNull();
        const complaint = await api.getTicket(response.ticketId!);
        expect(complaint).toMatchObject({
            type: RequestType.Complaint,
            status: TicketStatus.Open,
            // Derived the way TicketService does.
            category: 'Billing',
            severity: TicketSeverity.Medium,
            escalated: false,
        });
        expect(complaint.reference).toMatch(/^CMP-[0-9A-F]{8}$/);
    });

    it('gives a support ticket no severity or category, and starts it awaiting a technician', async () => {
        const api = client();
        const response = await api.sendMessage({ customerId: 1, message: 'My router will not connect' });

        const ticket = await api.getTicket(response.ticketId!);
        expect(ticket).toMatchObject({
            type: RequestType.TechnicalSupport,
            status: TicketStatus.AwaitingTechnician,
            category: null,
            severity: null,
            escalated: false,
        });
        expect(ticket.reference).toMatch(/^TKT-[0-9A-F]{8}$/);
    });

    it('filters tickets by type, severity and escalation', async () => {
        const api = client();

        const complaints = await api.listTickets({ type: RequestType.Complaint });
        expect(complaints.length).toBeGreaterThan(0);
        expect(complaints.every((t) => t.type === RequestType.Complaint)).toBe(true);

        const high = await api.listTickets({ severity: TicketSeverity.High });
        expect(high.every((t) => t.severity === TicketSeverity.High)).toBe(true);

        // false is a filter in its own right, not "no filter".
        const notEscalated = await api.listTickets({ escalated: false });
        expect(notEscalated.length).toBeGreaterThan(0);
        expect(notEscalated.every((t) => !t.escalated)).toBe(true);
    });

    it('escalates any ticket once, and refuses a second time', async () => {
        const api = client();
        const response = await api.sendMessage({ customerId: 1, message: 'My router will not connect' });

        const escalated = await api.escalateTicket(response.ticketId!);
        expect(escalated.escalated).toBe(true);

        await expect(api.escalateTicket(response.ticketId!)).rejects.toMatchObject({ status: 409 });
    });

    it('stores senders as "Customer" and "AI"', async () => {
        const api = client();
        const response = await api.sendMessage({ customerId: 1, message: 'How do I read my bill?' });

        const { messages } = await api.getConversation(response.conversationId);
        expect(messages.map((m) => m.sender)).toEqual(['Customer', 'AI']);
    });

    it('seeds the same customers as DbSeeder', async () => {
        const api = client();
        const response = await api.sendMessage({ customerId: 5, message: 'hello' });

        const [conversation] = await api.listConversations(5);
        expect(conversation.id).toBe(response.conversationId);
        expect(conversation.customerName).toBe('Emily Davis');
        expect(await api.getCustomer(5)).toMatchObject({ name: 'Emily Davis' });
    });

    it('lists only the conversations belonging to that customer', async () => {
        const api = client();
        await api.sendMessage({ customerId: 2, message: 'hello' });
        await api.sendMessage({ customerId: 3, message: 'hello' });

        const forTwo = await api.listConversations(2);
        expect(forTwo).toHaveLength(1);
        expect(forTwo[0].customerId).toBe(2);
    });

    it('closes the conversation when troubleshooting worked', async () => {
        const api = client();
        const issue = await api.sendMessage({ customerId: 1, message: 'My broadband is slow' });
        expect(issue.message).toMatch(/Did that fix the problem/);

        const reply = await api.sendMessage({
            customerId: 1,
            conversationId: issue.conversationId,
            message: 'that worked, thanks',
        });

        expect(reply.ticketId).toBeNull();
        expect(reply.escalated).toBe(false);
        const conversation = await api.getConversation(issue.conversationId);
        expect(conversation.status).toBe(ConversationStatus.Resolved);
    });

    it('raises a ticket when troubleshooting did not work', async () => {
        const api = client();
        const issue = await api.sendMessage({ customerId: 1, message: 'My broadband is slow' });

        const reply = await api.sendMessage({
            customerId: 1,
            conversationId: issue.conversationId,
            message: 'no, still not working',
        });

        expect(reply.ticketId).not.toBeNull();
        expect(reply.escalated).toBe(true);
        // "still not working" is an answer, not a fresh service-issue enquiry.
        expect(reply.requestType).toBe(RequestType.ServiceIssue);
        expect((await api.getTicket(reply.ticketId!)).type).toBe(RequestType.ServiceIssue);

        const conversation = await api.getConversation(issue.conversationId);
        expect(conversation.status).toBe(ConversationStatus.Escalated);
    });
});
