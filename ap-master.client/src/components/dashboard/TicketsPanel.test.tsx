import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, RequestType, TicketSeverity, TicketStatus } from '../../api/index.ts';
import { instantMock, renderWithApi } from '../../test/render.tsx';
import { TicketsPanel } from './TicketsPanel.tsx';

/**
 * Rows are identified by reference. The mock's references count up from a fixed seed, so
 * these are stable: a technical-support ticket, a service-issue ticket and a High-severity
 * complaint.
 */
const firstTicket = /TKT-00009DDD/;
const secondTicket = /TKT-00009DDE/;
const complaint = /CMP-00009DDF/;

function row(name: RegExp) {
    return screen.getByRole('row', { name });
}

async function openDetail(user: ReturnType<typeof userEvent.setup>, ticket: RegExp) {
    await user.click(within(row(ticket)).getByRole('button'));
    return screen.findByRole('group', { name: 'Change status' });
}

describe('TicketsPanel', () => {
    it('lists tickets once they have loaded', async () => {
        renderWithApi(<TicketsPanel />);

        expect(await screen.findByRole('row', { name: firstTicket })).toBeInTheDocument();
        expect(row(secondTicket)).toBeInTheDocument();
        expect(row(complaint)).toBeInTheDocument();
    });

    it('shows each ticket type, and complaint details only on complaints', async () => {
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: firstTicket });

        expect(within(row(firstTicket)).getByText('Technical support')).toBeInTheDocument();
        expect(within(row(secondTicket)).getByText('Service issue')).toBeInTheDocument();
        expect(within(row(complaint)).getByText('Complaint')).toBeInTheDocument();

        expect(within(row(complaint)).getByText('High')).toBeInTheDocument();
        expect(within(row(complaint)).getByText('Escalated')).toBeInTheDocument();
        expect(within(row(firstTicket)).queryByText('Escalated')).toBeNull();
    });

    it('filters down to complaints by type', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: firstTicket });

        await user.selectOptions(screen.getByLabelText('Type'), String(RequestType.Complaint));

        await waitFor(() => expect(screen.queryByRole('row', { name: firstTicket })).toBeNull());
        expect(row(complaint)).toBeInTheDocument();
        expect(screen.queryByRole('row', { name: secondTicket })).toBeNull();
    });

    it('sends the severity and escalation filters to the API', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'listTickets');
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: firstTicket });

        await user.selectOptions(screen.getByLabelText('Severity'), String(TicketSeverity.Low));
        await user.selectOptions(screen.getByLabelText('Escalation'), 'false');

        await waitFor(() =>
            expect(spy).toHaveBeenLastCalledWith(
                expect.objectContaining({ severity: TicketSeverity.Low, escalated: false }),
                expect.anything(),
            ),
        );
    });

    it('shows a skeleton rather than an empty box while loading', () => {
        renderWithApi(<TicketsPanel />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading tickets');
    });

    it('filters by status and can be cleared again', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: firstTicket });

        await user.selectOptions(screen.getByLabelText('Status'), String(TicketStatus.InProgress));

        await waitFor(() => expect(screen.queryByRole('row', { name: firstTicket })).toBeNull());
        expect(row(secondTicket)).toBeInTheDocument();

        await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

        expect(await screen.findByRole('row', { name: firstTicket })).toBeInTheDocument();
    });

    it('composes the status and customer filters', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'listTickets');
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: firstTicket });

        await user.selectOptions(screen.getByLabelText('Status'), String(TicketStatus.InProgress));
        await user.type(screen.getByLabelText('Customer ID'), '2');
        await user.tab();

        await waitFor(() =>
            expect(spy).toHaveBeenLastCalledWith(
                { status: TicketStatus.InProgress, customerId: 2 },
                expect.anything(),
            ),
        );
    });

    it('explains an empty result instead of showing a blank table', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: firstTicket });

        await user.selectOptions(screen.getByLabelText('Status'), String(TicketStatus.Closed));

        expect(await screen.findByText('No tickets match')).toBeInTheDocument();
        expect(screen.getByText('Nothing matches the current filters.')).toBeInTheDocument();
    });

    it('applies a status change to the list as well as the detail', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: firstTicket });

        const actions = await openDetail(user, firstTicket);
        await user.click(within(actions).getByRole('button', { name: 'Resolved' }));

        await waitFor(() =>
            expect(within(row(firstTicket)).getByText('Resolved')).toBeInTheDocument(),
        );
    });

    it('rolls the list back when the server refuses the status change', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        vi.spyOn(api, 'updateTicketStatus').mockRejectedValue(
            new ApiError('Ticket is locked by another agent.', 409),
        );
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: firstTicket });

        const actions = await openDetail(user, firstTicket);
        expect(within(row(firstTicket)).getByText('Awaiting technician')).toBeInTheDocument();

        await user.click(within(actions).getByRole('button', { name: 'Resolved' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Ticket is locked by another agent.',
        );
        await waitFor(() =>
            expect(within(row(firstTicket)).getByText('Awaiting technician')).toBeInTheDocument(),
        );
    });

    it('closes a ticket and then refuses to reopen it', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: firstTicket });

        const actions = await openDetail(user, firstTicket);
        await user.click(within(actions).getByRole('button', { name: 'Close ticket' }));

        // Closed is terminal on the server, so the status buttons go away entirely.
        expect(
            await screen.findByText('This ticket is closed and cannot be reopened.'),
        ).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Change status' })).not.toBeInTheDocument();
        await waitFor(() => expect(within(row(firstTicket)).getByText('Closed')).toBeInTheDocument());
    });

    it('shows a complaint its category and severity, and offers Open rather than Awaiting technician', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: complaint });

        const actions = await openDetail(user, complaint);
        const detail = screen.getByRole('region', { name: /^Ticket \d+$/ });

        expect(within(detail).getByText('Technical Support')).toBeInTheDocument();
        expect(within(detail).getByText('Category')).toBeInTheDocument();
        expect(within(actions).getByRole('button', { name: 'Open' })).toBeInTheDocument();
        expect(
            within(actions).queryByRole('button', { name: 'Awaiting technician' }),
        ).not.toBeInTheDocument();
        // Already escalated by severity, so there is nothing to escalate.
        expect(within(detail).queryByRole('button', { name: /Escalate/ })).not.toBeInTheDocument();
    });

    it('escalates a support ticket and reflects it in the list', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: firstTicket });

        await openDetail(user, firstTicket);
        const detail = screen.getByRole('region', { name: /^Ticket \d+$/ });
        expect(within(detail).queryByText('Category')).not.toBeInTheDocument();

        await user.click(within(detail).getByRole('button', { name: 'Escalate to senior staff' }));

        await waitFor(() =>
            expect(within(row(firstTicket)).getByText('Escalated')).toBeInTheDocument(),
        );
        expect(
            within(detail).queryByRole('button', { name: 'Escalate to senior staff' }),
        ).not.toBeInTheDocument();
    });

    it('explains a refused escalation', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        vi.spyOn(api, 'escalateTicket').mockRejectedValue(
            new ApiError('Conflict', 409, 'Ticket TKT-00009DDD has already been escalated.'),
        );
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: firstTicket });

        await openDetail(user, firstTicket);
        await user.click(screen.getByRole('button', { name: 'Escalate to senior staff' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('already been escalated');
        expect(within(row(firstTicket)).queryByText('Escalated')).toBeNull();
    });
});
