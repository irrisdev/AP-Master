import { describe, expect, it } from 'vitest';
import { MockApiClient } from './mock.ts';
import { ComplaintSeverity, ConversationStatus, RequestType } from './types.ts';

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

        const complaints = await api.listComplaints();
        const severities = complaints.map((c) => c.severity);
        expect(severities).toContain(ComplaintSeverity.Low);
        expect(severities).toContain(ComplaintSeverity.High);
    });

    it('derives the complaint category the way ComplaintService does', async () => {
        const api = client();
        await api.sendMessage({ customerId: 1, message: 'I am disappointed I was charged twice' });

        const [latest] = await api.listComplaints();
        expect(latest.category).toBe('Billing');
        expect(latest.severity).toBe(ComplaintSeverity.Medium);
        expect(latest.reference).toMatch(/^CMP-[0-9A-F]{8}$/);
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

        const conversation = await api.getConversation(issue.conversationId);
        expect(conversation.status).toBe(ConversationStatus.Escalated);
    });
});
