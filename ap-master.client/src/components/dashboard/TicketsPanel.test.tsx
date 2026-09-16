import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, TicketStatus } from '../../api/index.ts';
import { instantMock, renderWithApi } from '../../test/render.tsx';
import { TicketsPanel } from './TicketsPanel.tsx';

function row(name: RegExp) {
    return screen.getByRole('row', { name });
}

async function openDetail(user: ReturnType<typeof userEvent.setup>, customer: RegExp) {
    await user.click(within(row(customer)).getByRole('button'));
    return screen.findByRole('group', { name: 'Change status' });
}

describe('TicketsPanel', () => {
    it('lists tickets once they have loaded', async () => {
        renderWithApi(<TicketsPanel />);

        expect(await screen.findByRole('row', { name: /John Doe/ })).toBeInTheDocument();
        expect(row(/Sarah Jones/)).toBeInTheDocument();
    });

    it('shows a skeleton rather than an empty box while loading', () => {
        renderWithApi(<TicketsPanel />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading tickets');
    });

    it('filters by status and can be cleared again', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: /John Doe/ });

        await user.selectOptions(screen.getByLabelText('Status'), String(TicketStatus.InProgress));

        await waitFor(() => expect(screen.queryByRole('row', { name: /John Doe/ })).toBeNull());
        expect(row(/Sarah Jones/)).toBeInTheDocument();

        await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

        expect(await screen.findByRole('row', { name: /John Doe/ })).toBeInTheDocument();
    });

    it('composes the status and priority filters', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'listTickets');
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: /John Doe/ });

        await user.selectOptions(screen.getByLabelText('Status'), String(TicketStatus.InProgress));
        await user.selectOptions(screen.getByLabelText('Priority'), '1');

        await waitFor(() =>
            expect(spy).toHaveBeenLastCalledWith(
                { status: TicketStatus.InProgress, priority: 1 },
                expect.anything(),
            ),
        );
    });

    it('explains an empty result instead of showing a blank table', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: /John Doe/ });

        await user.selectOptions(screen.getByLabelText('Status'), String(TicketStatus.Closed));

        expect(await screen.findByText('No tickets match')).toBeInTheDocument();
        expect(screen.getByText('Nothing matches the current filters.')).toBeInTheDocument();
    });

    it('applies a status change to the list as well as the detail', async () => {
        const user = userEvent.setup();
        renderWithApi(<TicketsPanel />);
        await screen.findByRole('row', { name: /John Doe/ });

        const actions = await openDetail(user, /John Doe/);
        await user.click(within(actions).getByRole('button', { name: 'Resolved' }));

        await waitFor(() =>
            expect(within(row(/John Doe/)).getByText('Resolved')).toBeInTheDocument(),
        );
    });

    it('rolls the list back when the server refuses the status change', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        vi.spyOn(api, 'updateTicketStatus').mockRejectedValue(
            new ApiError('Ticket is locked by another agent.', 409),
        );
        renderWithApi(<TicketsPanel />, api);
        await screen.findByRole('row', { name: /John Doe/ });

        const actions = await openDetail(user, /John Doe/);
        expect(within(row(/John Doe/)).getByText('Awaiting technician')).toBeInTheDocument();

        await user.click(within(actions).getByRole('button', { name: 'Resolved' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Ticket is locked by another agent.',
        );
        await waitFor(() =>
            expect(within(row(/John Doe/)).getByText('Awaiting technician')).toBeInTheDocument(),
        );
    });
});
