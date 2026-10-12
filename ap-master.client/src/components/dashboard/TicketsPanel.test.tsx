import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, RequestType, TicketStatus } from '../../api/index.ts';
import { instantMock, renderWithApi } from '../../test/render.tsx';
import { TicketsPanel } from './TicketsPanel.tsx';

/*
 * The mock seeds three tickets, one of each type:
 *  - technical support for John Doe (customer 1), from a conversation, awaiting a technician
 *  - a service issue for Sarah Jones (customer 2), in progress, no conversation
 *  - a High-severity complaint for Sophie Smith (customer 3), open and escalated
 * Rows are found by their description, which is stable, rather than by reference.
 */
const supportTicket = /firmware update/;
const serviceIssue = /dropping out every evening/;
const complaint = /technician visit missed/;

function row(name: RegExp) {
    return screen.getByRole('row', { name });
}

function queryRow(name: RegExp) {
    return screen.queryByRole('row', { name });
}

async function openDetail(user: ReturnType<typeof userEvent.setup>, ticket: RegExp) {
    await user.click(within(row(ticket)).getByRole('button'));
    return screen.findByRole('group', { name: 'Change status' });
}

describe('TicketsPanel', () => {
    it('lists every kind of ticket in one queue, with the customer named', async () => {
        renderWithApi(<TicketsPanel />);

        const first = await screen.findByRole('row', { name: supportTicket });
        expect(within(first).getByText('Technical support')).toBeInTheDocument();
        expect(within(row(serviceIssue)).getByText('Service issue')).toBeInTheDocument();
        expect(within(row(complaint)).getByText('Complaint')).toBeInTheDocument();

        await waitFor(() => expect(within(first).getByText('John Doe')).toBeInTheDocument());
    });

    it('shows a complaint’s severity and escalation in the queue', async () => {
        renderWithApi(<TicketsPanel />);

        const complaintRow = await screen.findByRole('row', { name: complaint });
        expect(within(complaintRow).getByText('Open')).toBeInTheDocument();
        expect(within(complaintRow).getByText('High')).toBeInTheDocument();
        expect(within(complaintRow).getByText('Escalated')).toBeInTheDocument();
    });

    it('shows a skeleton rather than an empty box while loading', () => {
        renderWithApi(<TicketsPanel />);

        const skeleton = screen.getAllByRole('status').find((element) =>
            element.textContent?.includes('Loading tickets'),
        );
        expect(skeleton).toBeDefined();
    });

    it('summarises the queue', async () => {
        renderWithApi(<TicketsPanel />);
        const summary = screen.getByRole('region', { name: 'Queue summary' });

        await waitFor(() => expect(within(summary).getByText('Needs action').previousSibling).toHaveTextContent('3'));
        expect(within(summary).getByText('Open complaints').previousSibling).toHaveTextContent('1');
        expect(within(summary).getByText('Escalated').previousSibling).toHaveTextContent('1');
    });

    it('narrows to one type, and only then offers the severity filter', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: supportTicket });
        expect(screen.queryByLabelText('Severity')).not.toBeInTheDocument();

        await user.click(screen.getByRole('radio', { name: /Complaints/ }));

        await waitFor(() => expect(queryRow(supportTicket)).toBeNull());
        expect(row(complaint)).toBeInTheDocument();
        expect(queryRow(serviceIssue)).toBeNull();
        expect(screen.getByLabelText('Severity')).toBeInTheDocument();
    });

    it('moves between types with the arrow keys', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: supportTicket });

        screen.getByRole('radio', { name: /All tickets/ }).focus();
        await user.keyboard('{ArrowRight}');

        expect(screen.getByRole('radio', { name: /Technical support/ })).toHaveAttribute('aria-checked', 'true');
        await waitFor(() => expect(queryRow(serviceIssue)).toBeNull());
    });

    it('filters by status and can be cleared again', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: supportTicket });

        await user.selectOptions(screen.getByLabelText('Status'), String(TicketStatus.InProgress));

        await waitFor(() => expect(queryRow(supportTicket)).toBeNull());
        expect(row(serviceIssue)).toBeInTheDocument();

        await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

        expect(await screen.findByRole('row', { name: supportTicket })).toBeInTheDocument();
    });

    it('sends the chosen filters to the server', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'listTickets');
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: supportTicket });

        await user.click(screen.getByRole('radio', { name: /Complaints/ }));
        await user.selectOptions(screen.getByLabelText('Escalation'), 'true');
        await user.type(screen.getByLabelText('Customer ID'), '3');
        await user.tab();

        await waitFor(() =>
            expect(spy).toHaveBeenLastCalledWith(
                {
                    status: undefined,
                    type: RequestType.Complaint,
                    severity: undefined,
                    escalated: true,
                    customerId: 3,
                },
                expect.anything(),
            ),
        );
    });

    it('explains an empty result instead of showing a blank table', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: supportTicket });

        await user.selectOptions(screen.getByLabelText('Status'), String(TicketStatus.Closed));

        expect(await screen.findByText('No tickets match')).toBeInTheDocument();
        expect(screen.getByText('Nothing matches the current filters.')).toBeInTheDocument();
    });

    it('applies a status change to the list as well as the detail', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: supportTicket });

        const actions = await openDetail(user, supportTicket);
        await user.click(within(actions).getByRole('button', { name: 'Resolved' }));

        await waitFor(() =>
            expect(within(row(supportTicket)).getByText('Resolved')).toBeInTheDocument(),
        );
    });

    it('offers the statuses that fit the type of ticket', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: complaint });

        const actions = await openDetail(user, complaint);

        expect(within(actions).getByRole('button', { name: 'Open' })).toBeInTheDocument();
        expect(within(actions).queryByRole('button', { name: 'Awaiting technician' })).not.toBeInTheDocument();
    });

    it('rolls the list back when the server refuses the status change', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        vi.spyOn(api, 'updateTicketStatus').mockRejectedValue(
            new ApiError('Ticket is locked by another agent.', 409),
        );
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: supportTicket });

        const actions = await openDetail(user, supportTicket);
        expect(within(row(supportTicket)).getByText('Awaiting technician')).toBeInTheDocument();

        await user.click(within(actions).getByRole('button', { name: 'Resolved' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Ticket is locked by another agent.',
        );
        await waitFor(() =>
            expect(within(row(supportTicket)).getByText('Awaiting technician')).toBeInTheDocument(),
        );
    });

    it('closes a ticket and then refuses to reopen it', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: supportTicket });

        await openDetail(user, supportTicket);
        await user.click(screen.getByRole('button', { name: 'Close ticket' }));

        // Closed is terminal on the server, so the status buttons go away entirely.
        expect(
            await screen.findByText('This ticket is closed and cannot be reopened.'),
        ).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Change status' })).not.toBeInTheDocument();
        await waitFor(() => expect(within(row(supportTicket)).getByText('Closed')).toBeInTheDocument());
    });

    it('escalates a ticket to senior staff, once', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: supportTicket });

        await openDetail(user, supportTicket);
        await user.click(screen.getByRole('button', { name: 'Escalate to senior staff' }));

        await waitFor(() =>
            expect(within(row(supportTicket)).getByText('Escalated')).toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: 'Escalate to senior staff' })).not.toBeInTheDocument();
    });

    it('shows the conversation that raised the ticket', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: supportTicket });

        await openDetail(user, supportTicket);

        const transcript = await screen.findByLabelText(/Conversation \d+ transcript/);
        expect(within(transcript).getByText(/Your reference is TKT-/)).toBeInTheDocument();
    });

    it('adds a ticket raised in the chat as it happens, and marks it new', async () => {
        const api = instantMock();
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: supportTicket });

        await api.sendMessage({ customerId: 4, message: 'I need an engineer to install a new phone socket' });

        const added = await screen.findByRole('row', { name: /install a new phone socket/ });
        expect(within(added).getByText('New')).toBeInTheDocument();
        expect(screen.getByText(/New ticket TKT-[0-9A-F]{8} raised\./)).toBeInTheDocument();
    });

    it('leaves out a pushed ticket that does not match the current filter', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: supportTicket });
        await user.click(screen.getByRole('radio', { name: /Complaints/ }));
        await waitFor(() => expect(queryRow(supportTicket)).toBeNull());

        await api.sendMessage({ customerId: 4, message: 'I need an engineer to install a new phone socket' });
        await screen.findByText(/New ticket TKT-/);

        expect(queryRow(/install a new phone socket/)).toBeNull();
    });

    it('says the queue is live', async () => {
        renderWithApi(<TicketsPanel />);

        expect(await screen.findByText('Live')).toBeInTheDocument();
    });
});
