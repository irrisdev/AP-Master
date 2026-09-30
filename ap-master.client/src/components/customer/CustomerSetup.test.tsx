import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { instantMock, renderWithApi } from '../../test/render.tsx';
import { CustomerSetup } from './CustomerSetup.tsx';

function field(name: string) {
    return screen.getByRole('textbox', { name });
}

describe('CustomerSetup — new customer', () => {
    it('registers the customer and hands them to the chat', async () => {
        const user = userEvent.setup();
        const onReady = vi.fn();
        renderWithApi(<CustomerSetup onReady={onReady} />);

        await user.type(field('Full name'), '  Jane Doe ');
        await user.type(field('Email address'), 'Jane@Example.com');
        await user.click(screen.getByRole('button', { name: 'Start chatting' }));

        await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
        const customer = onReady.mock.calls[0][0];
        expect(customer).toMatchObject({ name: 'Jane Doe', email: 'jane@example.com' });
        expect(customer.id).toBeGreaterThan(5);
    });

    it('checks the details before sending anything', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'createCustomer');
        renderWithApi(<CustomerSetup onReady={vi.fn()} />, api);

        await user.type(field('Email address'), 'not-an-email');
        await user.click(screen.getByRole('button', { name: 'Start chatting' }));

        expect(screen.getByText('Enter your name.')).toBeInTheDocument();
        expect(screen.getByText('Enter an email address like name@example.com.')).toBeInTheDocument();
        expect(field('Full name')).toHaveAttribute('aria-invalid', 'true');
        expect(spy).not.toHaveBeenCalled();
    });

    it('explains what to do when the email is already registered', async () => {
        const user = userEvent.setup();
        const onReady = vi.fn();
        renderWithApi(<CustomerSetup onReady={onReady} />);

        await user.type(field('Full name'), 'Someone Else');
        await user.type(field('Email address'), 'johndoe@example.com');
        await user.click(screen.getByRole('button', { name: 'Start chatting' }));

        expect(await screen.findByText(/That email is already registered/)).toBeInTheDocument();
        expect(onReady).not.toHaveBeenCalled();
    });
});

describe('CustomerSetup — returning customer', () => {
    async function openReturning(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByRole('tab', { name: 'Returning customer' }));
    }

    it('continues as an existing customer by their number', async () => {
        const user = userEvent.setup();
        const onReady = vi.fn();
        renderWithApi(<CustomerSetup onReady={onReady} />);
        await openReturning(user);

        await user.type(field('Customer number'), '5');
        await user.click(screen.getByRole('button', { name: 'Continue' }));

        await vi.waitFor(() =>
            expect(onReady).toHaveBeenCalledWith({
                id: 5,
                name: 'Emily Davis',
                email: 'emilydavis@example.com',
            }),
        );
    });

    it('says so when there is no such customer', async () => {
        const user = userEvent.setup();
        const onReady = vi.fn();
        renderWithApi(<CustomerSetup onReady={onReady} />);
        await openReturning(user);

        await user.type(field('Customer number'), '999');
        await user.click(screen.getByRole('button', { name: 'Continue' }));

        expect(await screen.findByText('There is no customer number 999.')).toBeInTheDocument();
        expect(onReady).not.toHaveBeenCalled();
    });

    it('rejects something that is not a customer number', async () => {
        const user = userEvent.setup();
        const api = instantMock();
        const spy = vi.spyOn(api, 'getCustomer');
        renderWithApi(<CustomerSetup onReady={vi.fn()} />, api);
        await openReturning(user);

        await user.type(field('Customer number'), 'abc');
        await user.click(screen.getByRole('button', { name: 'Continue' }));

        expect(screen.getByText('Enter your customer number, e.g. 1.')).toBeInTheDocument();
        expect(spy).not.toHaveBeenCalled();
    });
});
