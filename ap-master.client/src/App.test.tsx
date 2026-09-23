import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App.tsx';
import { renderWithApi } from './test/render.tsx';

describe('App shell', () => {
    it('opens on the chat view and marks it as the current page', () => {
        renderWithApi(<App />);

        expect(screen.getByRole('heading', { name: 'Chat with Telegroup' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute(
            'aria-current',
            'page',
        );
    });

    it('switches to the dashboard', async () => {
        const user = userEvent.setup();
        renderWithApi(<App />);

        await user.click(screen.getByRole('button', { name: 'Dashboard' }));

        expect(screen.getByRole('heading', { name: 'Agent dashboard' })).toBeInTheDocument();
    });

    it('says plainly when it is running on demo data', () => {
        renderWithApi(<App />);

        expect(screen.getByText('Demo data — no backend connected')).toBeInTheDocument();
    });

    it('shows a chat conversation in the dashboard history afterwards', async () => {
        const user = userEvent.setup();
        renderWithApi(<App />);

        await user.type(
            screen.getByRole('textbox', { name: 'Your message' }),
            'My broadband keeps dropping out and is very slow',
        );
        await user.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText(/checking the network status/i);

        await user.click(screen.getByRole('button', { name: 'Dashboard' }));
        await user.click(screen.getByRole('tab', { name: 'Conversations' }));

        // Newest first, so the conversation just held is the first card.
        const cards = await screen.findAllByRole('button', { name: /^Conversation #\d+$/ });
        await user.click(cards[0]);

        const thread = await screen.findByRole('region', { name: /^Conversation \d+$/ });
        expect(
            within(thread).getByText('My broadband keeps dropping out and is very slow'),
        ).toBeInTheDocument();
    });
});
