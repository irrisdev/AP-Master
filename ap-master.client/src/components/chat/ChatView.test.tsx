import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, limits } from '../../api/index.ts';
import { currentCustomerId } from '../../config.ts';
import { instantMock, renderWithApi } from '../../test/render.tsx';
import { ChatView } from './ChatView.tsx';

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
        renderWithApi(<ChatView />);

        await send(user, 'My broadband has been slow since Tuesday');

        expect(await screen.findByText(/checking the network status/i)).toBeInTheDocument();
        expect(screen.getByText('Service issue')).toBeInTheDocument();
    });

    it('tells the customer when a ticket has been raised', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView />);

        await send(user, 'My router will not connect');

        expect(await screen.findByText(/Support ticket #\d+ raised/)).toBeInTheDocument();
    });

    it('does not call a ticket a complaint, even though the server flags it escalated', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView />);

        await send(user, 'My router will not connect');

        await screen.findByText(/Support ticket #\d+ raised/);
        expect(screen.queryByText('Complaint logged and escalated')).not.toBeInTheDocument();
    });

    it('records a complaint with its reference', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView />);

        await send(user, 'I want to make a complaint about my last engineer visit');

        expect(await screen.findByText(/complaint reference is C-\d+/)).toBeInTheDocument();
        expect(screen.getByText('Complaint')).toBeInTheDocument();
        // Low severity: recorded, not escalated.
        expect(screen.queryByText('Complaint logged and escalated')).not.toBeInTheDocument();
    });

    it('tells the customer when a serious complaint has been escalated', async () => {
        const user = userEvent.setup();
        renderWithApi(<ChatView />);

        await send(user, 'I am unhappy and I am considering legal action over the missed visits');

        expect(await screen.findByText('Complaint logged and escalated')).toBeInTheDocument();
    });

    it('threads follow-up messages into the same conversation', async () => {
        const user = userEvent.setup();
        const { api } = renderWithApi(<ChatView />);

        await send(user, 'My broadband is slow');
        await screen.findByText(/checking the network status/i);

        await send(user, 'It is still slow today');
        await waitFor(() => expect(screen.getAllByText(/Telegroup assistant/)).toHaveLength(2));

        // One conversation, not two: the id came back and was used on the next send.
        const conversations = await api.listConversations(currentCustomerId);
        expect(conversations).toHaveLength(2); // one seeded, one from this test

        const { messages } = await api.getConversation(conversations[0].id);
        expect(messages).toHaveLength(4);
    });

    it('blocks an over-long message before it reaches the server', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'sendMessage');
        renderWithApi(<ChatView />, api);

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
        renderWithApi(<ChatView />);

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
        renderWithApi(<ChatView />, api);

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
        renderWithApi(<ChatView />, api);

        await send(user, 'hello');

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
});

describe('ChatView accessibility', () => {
    it('announces replies through a live region', () => {
        renderWithApi(<ChatView />);

        const log = screen.getByRole('log', { name: 'Conversation' });
        expect(log).toHaveAttribute('aria-live', 'polite');
    });

    it('labels the composer and its send button', () => {
        renderWithApi(<ChatView />);

        expect(composer()).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    });

    it('reports a failure as an alert rather than as text nobody hears', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        vi.spyOn(api, 'sendMessage').mockRejectedValue(new ApiError('Server fell over.', 500));
        renderWithApi(<ChatView />, api);

        await send(user, 'hello');

        expect(await screen.findByRole('alert')).toHaveTextContent('Server fell over.');
    });
});
