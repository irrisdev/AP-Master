import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App.tsx';
import { renderWithApi } from './test/render.tsx';

async function register(user: ReturnType<typeof userEvent.setup>, name: string, email: string) {
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), name);
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), email);
    await user.click(screen.getByRole('button', { name: 'Start chatting' }));
    await screen.findByRole('heading', { name: 'Chat with Telegroup' });
}

describe('App shell', () => {
    it('opens by asking who the customer is, on the chat page', () => {
        renderWithApi(<App />);

        expect(
            screen.getByRole('heading', { name: 'Welcome to Telegroup support' }),
        ).toBeInTheDocument();
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

    it('tracks a newly registered customer through the chat to the dashboard', async () => {
        const user = userEvent.setup();
        renderWithApi(<App />);

        await register(user, 'Jane Doe', 'jane@example.com');
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();

        await user.type(
            screen.getByRole('textbox', { name: 'Your message' }),
            'My broadband keeps dropping out and is very slow',
        );
        await user.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText(/checking the network status/i);

        await user.click(screen.getByRole('button', { name: 'Dashboard' }));
        await user.click(screen.getByRole('tab', { name: 'Conversations' }));

        // The lookup opens on the customer the chat was acting for.
        const lookup = screen.getByRole('spinbutton', { name: 'Customer ID' });
        const cards = await screen.findAllByRole('button', { name: /^Conversation #\d+$/ });
        expect(cards).toHaveLength(1);
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
        expect(Number((lookup as HTMLInputElement).value)).toBeGreaterThan(5);
        await user.click(cards[0]);

        const thread = await screen.findByRole('region', { name: /^Conversation \d+$/ });
        expect(
            within(thread).getByText('My broadband keeps dropping out and is very slow'),
        ).toBeInTheDocument();
    });

    it('keeps the customer when moving between the chat and the dashboard', async () => {
        const user = userEvent.setup();
        renderWithApi(<App />);
        await register(user, 'Jane Doe', 'jane@example.com');

        await user.click(screen.getByRole('button', { name: 'Dashboard' }));
        await user.click(screen.getByRole('button', { name: 'Chat' }));

        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    it('goes back to the customer choice on "Switch customer"', async () => {
        const user = userEvent.setup();
        renderWithApi(<App />);
        await register(user, 'Jane Doe', 'jane@example.com');

        await user.click(screen.getByRole('button', { name: 'Switch customer' }));

        expect(
            screen.getByRole('heading', { name: 'Welcome to Telegroup support' }),
        ).toBeInTheDocument();
    });
});
