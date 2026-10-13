import { describe, expect, it } from 'vitest';
import { MockApiClient } from './mock.ts';
import { ConversationStatus, RequestType, TicketSeverity, TicketStatus } from './types.ts';
import type { TicketDto } from './types.ts';

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

    it('logs a complaint as a ticket, with the category and severity TicketService would give it', async () => {
        const api = client();
        const response = await api.sendMessage({ customerId: 1, message: 'I am disappointed I was charged twice' });

        const [latest] = await api.listTickets({ type: RequestType.Complaint });
        expect(latest.id).toBe(response.ticketId);
        expect(latest.reference).toBe(response.ticketReference);
        expect(latest.reference).toMatch(/^CMP-[0-9A-F]{8}$/);
        expect(latest.status).toBe(TicketStatus.Open);
        expect(latest.category).toBe('Billing');
        expect(latest.severity).toBe(TicketSeverity.Medium);
    });

    it('asks what happened before logging a complaint with no details', async () => {
        const api = client();
        const ask = await api.sendMessage({ customerId: 1, message: 'I want to make a complaint' });

        expect(ask.ticketId).toBeNull();
        expect(ask.message).toMatch(/Could you tell me what happened/);
        expect(ask.conversationStatus).toBe(ConversationStatus.Active);

        // The next message stays on the complaint and becomes it.
        const logged = await api.sendMessage({
            customerId: 1,
            conversationId: ask.conversationId,
            message: 'The engineer missed two appointments',
        });
        expect(logged.requestType).toBe(RequestType.Complaint);
        expect(logged.ticketReference).toMatch(/^CMP-/);
    });

    it('ends the conversation once a complaint is logged, and refuses further messages', async () => {
        const api = client();
        const logged = await api.sendMessage({ customerId: 1, message: 'I want to complain, the engineer was rude' });

        expect(logged.conversationStatus).toBe(ConversationStatus.Closed);
        await expect(
            api.sendMessage({ customerId: 1, conversationId: logged.conversationId, message: 'hello?' }),
        ).rejects.toMatchObject({ status: 409 });
    });

    it('reuses the open ticket for a second technical request in the same conversation', async () => {
        const api = client();
        const first = await api.sendMessage({ customerId: 1, message: 'I need an engineer to install a socket' });
        const second = await api.sendMessage({
            customerId: 1,
            conversationId: first.conversationId,
            message: 'Can the engineer install a second socket too?',
        });

        expect(second.ticketId).toBe(first.ticketId);
        expect(second.ticketReference).toBe(first.ticketReference);
    });

    it('treats "still not working" after a ticket as news for the technician, not new troubleshooting', async () => {
        const api = client();
        const issue = await api.sendMessage({ customerId: 1, message: 'My broadband is slow' });
        const ticketed = await api.sendMessage({ customerId: 1, conversationId: issue.conversationId, message: 'No, still not working' });

        const again = await api.sendMessage({
            customerId: 1,
            conversationId: issue.conversationId,
            message: 'It is still slow and not working today',
        });

        expect(again.ticketId).toBe(ticketed.ticketId);
        expect(again.message).not.toMatch(/Did that fix the problem/);
        expect(again.conversationStatus).toBe(ConversationStatus.Escalated);
    });

    it('pushes ticket events to subscribers, like the server hub', async () => {
        const api = client();
        const created: TicketDto[] = [];
        const updated: TicketDto[] = [];
        const states: string[] = [];
        const unsubscribe = api.subscribeToTickets({
            onCreated: (ticket) => created.push(ticket),
            onUpdated: (ticket) => updated.push(ticket),
            onConnectionChange: (state) => states.push(state),
        });

        const chat = await api.sendMessage({ customerId: 1, message: 'I need an engineer to install a socket' });
        await api.escalateTicket(chat.ticketId!);
        await Promise.resolve(); // events are delivered asynchronously

        expect(states).toEqual(['live']);
        expect(created.map((t) => t.id)).toEqual([chat.ticketId]);
        expect(updated[0]).toMatchObject({ id: chat.ticketId, escalated: true });

        unsubscribe();
        await api.updateTicketStatus(chat.ticketId!, TicketStatus.Resolved);
        await Promise.resolve();
        expect(updated).toHaveLength(1);
    });

    it('refuses to escalate a ticket twice', async () => {
        const api = client();
        const chat = await api.sendMessage({ customerId: 1, message: 'I need an engineer to install a socket' });

        await api.escalateTicket(chat.ticketId!);
        await expect(api.escalateTicket(chat.ticketId!)).rejects.toMatchObject({ status: 409 });
    });

    it('filters tickets by type, severity and escalation', async () => {
        const api = client();

        expect((await api.listTickets({ type: RequestType.ServiceIssue })).every((t) => t.type === RequestType.ServiceIssue)).toBe(true);
        const high = await api.listTickets({ severity: TicketSeverity.High });
        expect(high.length).toBeGreaterThan(0);
        expect(high.every((t) => t.type === RequestType.Complaint && t.escalated)).toBe(true);
        expect((await api.listTickets({ escalated: false })).every((t) => !t.escalated)).toBe(true);
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

        const ticket = await api.getTicket(reply.ticketId!);
        expect(ticket.type).toBe(RequestType.ServiceIssue);
        expect(ticket.description).toContain('My broadband is slow');

        const conversation = await api.getConversation(issue.conversationId);
        expect(conversation.status).toBe(ConversationStatus.Escalated);
    });
});
