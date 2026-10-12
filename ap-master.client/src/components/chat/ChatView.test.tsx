import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, RequestType, limits } from '../../api/index.ts';
import type { CustomerDto } from '../../api/index.ts';
import { instantMock, renderWithApi } from '../../test/render.tsx';
import { ChatView } from './ChatView.tsx';

/** The first seeded customer; the mock seeds one conversation (#101) for them. */
const johnDoe: CustomerDto = { id: 1, name: 'John Doe', email: 'johndoe@example.com' };

function noop() {}

/** The transcript itself, as opposed to the history list beside it, which repeats the badges. */
function transcript() {
    return within(screen.getByRole('log', { name: 'Conversation' }));
}

function composer() {
    return screen.getByRole('textbox', { name: 'Your message' });
}

async function send(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.type(composer(), text);
    await user.click(screen.getByRole('button', { name: 'Send' }));
}

describe('ChatView', () => {
    it('shows the assistant reply and how the message was triaged', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        await send(user, 'My broadband has been slow since Tuesday');

        expect(await screen.findByText(/checking the network status/i)).toBeInTheDocument();
        expect(transcript().getByText('Service issue')).toBeInTheDocument();
    });

    it('tells the customer when a ticket has been raised', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        await send(user, 'My router will not connect');

        expect(await screen.findByText(/Support ticket #\d+ raised/)).toBeInTheDocument();
    });

    it('does not call a ticket a complaint, even though the server flags it escalated', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        await send(user, 'My router will not connect');

        await screen.findByText(/Support ticket #\d+ raised/);
        expect(screen.queryByText('Complaint logged and escalated')).not.toBeInTheDocument();
    });

    it('records a complaint with its reference', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        await send(user, 'I want to make a complaint about my last engineer visit');

        expect(
            await screen.findByText(/complaint reference is CMP-[0-9A-F]+/),
        ).toBeInTheDocument();
        expect(transcript().getByText('Complaint')).toBeInTheDocument();
        // Low severity: recorded, not escalated.
        expect(await screen.findByText('Complaint logged')).toBeInTheDocument();
        expect(screen.queryByText('Complaint logged and escalated')).not.toBeInTheDocument();
        // A complaint is a ticket on the server, but it is not a support ticket.
        expect(screen.queryByText(/Support ticket #\d+ raised/)).not.toBeInTheDocument();
    });

    it('announces a ticket once, not on every follow-up about it', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        // The server returns the open ticket's id again on a follow-up.
        vi.spyOn(api, 'sendMessage').mockResolvedValue({
            conversationId: 101,
            requestType: RequestType.TechnicalSupport,
            message: 'Your engineer is booked.',
            escalated: true,
            ticketId: 42,
        });
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />, api);

        await send(user, 'My router will not connect');
        await screen.findByText('Support ticket #42 raised');

        await send(user, 'When will the engineer arrive?');
        await waitFor(() => expect(transcript().getAllByText('Your engineer is booked.')).toHaveLength(2));

        expect(screen.getAllByText('Support ticket #42 raised')).toHaveLength(1);
    });

    it('tells the customer when a serious complaint has been escalated', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        await send(user, 'I am unhappy and I am considering legal action over the missed visits');

        expect(await screen.findByText('Complaint logged and escalated')).toBeInTheDocument();
    });

    it('threads follow-up messages into the same conversation', async () => {
        const user = userEvent.setup();
        const { api } = renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        await send(user, 'My broadband is slow');
        await screen.findByText(/checking the network status/i);

        await send(user, 'It is still slow today');
        await waitFor(() => expect(screen.getAllByText(/Telegroup assistant/)).toHaveLength(2));

        // One conversation, not two: the id came back and was used on the next send.
        const conversations = await api.listConversations(johnDoe.id);
        expect(conversations).toHaveLength(2); // one seeded, one from this test

        const { messages } = await api.getConversation(conversations[0].id);
        expect(messages).toHaveLength(4);
    });

    it('blocks an over-long message before it reaches the server', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'sendMessage');
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />, api);

        await user.click(composer());
        await user.paste('x'.repeat(limits.chatMessageMax + 1));

        expect(
            screen.getByText(`Messages are limited to ${limits.chatMessageMax} characters.`),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
        expect(spy).not.toHaveBeenCalled();
    });

    it('sends on Enter and starts a new line on Shift+Enter', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        await user.type(composer(), 'first line{Shift>}{Enter}{/Shift}second line');
        expect(composer()).toHaveValue('first line\nsecond line');

        await user.type(composer(), '{Enter}');
        expect(await screen.findByText(/Thanks for getting in touch/i)).toBeInTheDocument();
    });

    it('keeps a failed message on screen and recovers on retry', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        vi.spyOn(api, 'sendMessage').mockRejectedValueOnce(
            new ApiError('The assistant is temporarily unavailable.', 503),
        );
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />, api);

        await send(user, 'Is my bill correct?');

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The assistant is temporarily unavailable.',
        );
        expect(screen.getByText('Not sent')).toBeInTheDocument();
        expect(screen.getByText('Is my bill correct?')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText(/Thanks for getting in touch/i)).toBeInTheDocument();
        expect(screen.queryByText('Not sent')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        // Retried in place rather than queued a second copy.
        expect(screen.getAllByText('Is my bill correct?')).toHaveLength(1);
    });

    it('does not offer a retry for a failure that will not succeed on retry', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        vi.spyOn(api, 'sendMessage').mockRejectedValue(new ApiError('That is not valid.', 400));
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />, api);

        await send(user, 'hello');

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
});

describe('ChatView customer history', () => {
    function history() {
        return screen.getByRole('navigation', { name: 'Your conversations' });
    }

    it('says who the chat is acting for', () => {
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Customer #1 · johndoe@example.com')).toBeInTheDocument();
        expect(screen.getByText('JD')).toBeInTheDocument();
    });

    it('lists the conversations already stored for this customer', async () => {
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        expect(
            await within(history()).findByRole('button', { name: /Conversation #101/ }),
        ).toBeInTheDocument();
    });

    it('adds a new conversation to the history once it has been saved', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);
        await within(history()).findByRole('button', { name: /Conversation #101/ });

        await send(user, 'What are your opening hours?');
        await screen.findByText(/Thanks for getting in touch/i);

        await waitFor(() =>
            expect(within(history()).getAllByRole('button', { name: /^Conversation #/ })).toHaveLength(2),
        );
        // The conversation on screen is the one marked as current.
        const current = within(history()).getByRole('button', { current: true });
        expect(current).not.toHaveAccessibleName(/Conversation #101/);
    });

    it('reopens a past conversation and carries it on', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'sendMessage');
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />, api);

        await user.click(await within(history()).findByRole('button', { name: /Conversation #101/ }));

        expect(
            await screen.findByText('My router will not connect since the firmware update last night.'),
        ).toBeInTheDocument();

        await send(user, 'Any update on this?');
        await waitFor(() => expect(spy).toHaveBeenCalled());
        expect(spy.mock.calls[0][0]).toMatchObject({ customerId: 1, conversationId: 101 });
    });

    it('does not re-announce a ticket the reopened conversation already had', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        // The seeded conversation #101 already has ticket #102.
        vi.spyOn(api, 'sendMessage').mockResolvedValue({
            conversationId: 101,
            requestType: RequestType.TechnicalSupport,
            message: 'Your ticket is still with our engineers.',
            escalated: true,
            ticketId: 102,
        });
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />, api);

        await user.click(await within(history()).findByRole('button', { name: /Conversation #101/ }));
        await screen.findByText('My router will not connect since the firmware update last night.');

        await send(user, 'Any update on this?');
        await screen.findByText('Your ticket is still with our engineers.');

        expect(screen.queryByText(/Support ticket #\d+ raised/)).not.toBeInTheDocument();
    });

    it('does not show one customer the conversations of another', async () => {
        const emily: CustomerDto = { id: 5, name: 'Emily Davis', email: 'emilydavis@example.com' };
        renderWithApi(<ChatView customer={emily} onSwitchCustomer={noop} />);

        expect(await within(history()).findByText(/Nothing yet/)).toBeInTheDocument();
        expect(within(history()).queryByRole('button', { name: /Conversation #101/ })).not.toBeInTheDocument();
    });

    it('hands back to the caller to switch customer', async () => {
        const user = userEvent.setup();
        const onSwitchCustomer = vi.fn();
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={onSwitchCustomer} />);

        await user.click(screen.getByRole('button', { name: 'Switch customer' }));

        expect(onSwitchCustomer).toHaveBeenCalledOnce();
    });
});

describe('ChatView accessibility', () => {
    it('announces replies through a live region', () => {
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        const log = screen.getByRole('log', { name: 'Conversation' });
        expect(log).toHaveAttribute('aria-live', 'polite');
    });

    it('labels the composer and its send button', () => {
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />);

        expect(composer()).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    });

    it('reports a failure as an alert rather than as text nobody hears', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        vi.spyOn(api, 'sendMessage').mockRejectedValue(new ApiError('Server fell over.', 500));
        renderWithApi(<ChatView customer={johnDoe} onSwitchCustomer={noop} />, api);

        await send(user, 'hello');

        expect(await screen.findByRole('alert')).toHaveTextContent('Server fell over.');
    });
});
