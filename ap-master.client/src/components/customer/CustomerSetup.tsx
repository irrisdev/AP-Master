import { useState } from 'react';
import type { FormEvent } from 'react';
import { isAbort, useApi } from '../../api/index.ts';
import type { ApiError, CustomerDto } from '../../api/index.ts';
import { useAbortSignal } from '../../hooks/useAbortSignal.ts';
import { toApiError } from '../../lib/errors.ts';
import { Button } from '../ui/Button.tsx';
import { ErrorBanner } from '../ui/ErrorBanner.tsx';
import { Tabs } from '../ui/Tabs.tsx';
import type { TabDefinition } from '../ui/Tabs.tsx';
import { TextField } from '../ui/TextField.tsx';
import { parseCustomerId, validateEmail, validateName } from './validation.ts';
import './customer.css';

type Mode = 'new-customer' | 'returning-customer';

const modes: TabDefinition[] = [
    { id: 'new-customer', label: 'New customer' },
    { id: 'returning-customer', label: 'Returning customer' },
];

export interface CustomerSetupProps {
    /** Called with the customer the chat should act as. */
    onReady: (customer: CustomerDto) => void;
}

/**
 * Who the chat is acting for. There is deliberately no password: authentication is out
 * of scope for this prototype, so a customer is identified by registering a name and
 * email, or by giving the customer number they were shown when they registered.
 */
export function CustomerSetup({ onReady }: CustomerSetupProps) {
    const [mode, setMode] = useState<Mode>('new-customer');

    return (
        <section className="customer-setup" aria-labelledby="customer-setup-title">
            <header>
                <h1 id="customer-setup-title">Welcome to Telegroup support</h1>
                <p className="customer-setup__subtitle">
                    Tell us who you are so we can keep your conversations together.
                </p>
            </header>

            <div className="customer-setup__card">
                <Tabs
                    tabs={modes}
                    active={mode}
                    onChange={(id) => setMode(id as Mode)}
                    label="How would you like to continue?"
                />
                <div role="tabpanel" id={`panel-${mode}`} aria-labelledby={`tab-${mode}`}>
                    {mode === 'new-customer' ? (
                        <RegisterForm onReady={onReady} />
                    ) : (
                        <ReturningForm onReady={onReady} />
                    )}
                </div>
            </div>
        </section>
    );
}

function RegisterForm({ onReady }: CustomerSetupProps) {
    const api = useApi();
    const signalFor = useAbortSignal();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);

    // Errors appear once the customer has tried to submit, not while they are still typing.
    const nameError = submitted ? validateName(name) : undefined;
    const emailError = submitted ? validateEmail(email) : undefined;
    const emailTaken = error?.status === 409;

    async function submit(event: FormEvent) {
        event.preventDefault();
        setSubmitted(true);
        if (validateName(name) || validateEmail(email)) return;

        setSaving(true);
        setError(null);
        try {
            onReady(await api.createCustomer({ name: name.trim(), email: email.trim() }, signalFor()));
        } catch (cause) {
            if (isAbort(cause)) return;
            setError(toApiError(cause));
            setSaving(false);
        }
    }

    return (
        <form className="customer-setup__form" onSubmit={submit} noValidate>
            <TextField
                label="Full name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                error={nameError}
            />
            <TextField
                label="Email address"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                    setEmail(event.target.value);
                    if (emailTaken) setError(null);
                }}
                error={
                    emailError ??
                    (emailTaken
                        ? 'That email is already registered. Use "Returning customer" with your customer number.'
                        : undefined)
                }
            />

            {error && !emailTaken ? <ErrorBanner error={error} /> : null}

            <Button type="submit" variant="primary" loading={saving}>
                Start chatting
            </Button>
            <p className="customer-setup__note">
                Demo only: no password is needed, and the details are stored in the demo database.
            </p>
        </form>
    );
}

function ReturningForm({ onReady }: CustomerSetupProps) {
    const api = useApi();
    const signalFor = useAbortSignal();
    const [value, setValue] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);

    const id = parseCustomerId(value);
    const notFound = error?.status === 404;
    const fieldError = submitted && id === undefined ? 'Enter your customer number, e.g. 1.' : undefined;

    async function submit(event: FormEvent) {
        event.preventDefault();
        setSubmitted(true);
        if (id === undefined) return;

        setLoading(true);
        setError(null);
        try {
            onReady(await api.getCustomer(id, signalFor()));
        } catch (cause) {
            if (isAbort(cause)) return;
            setError(toApiError(cause));
            setLoading(false);
        }
    }

    return (
        <form className="customer-setup__form" onSubmit={submit} noValidate>
            <TextField
                label="Customer number"
                inputMode="numeric"
                autoComplete="off"
                value={value}
                onChange={(event) => {
                    setValue(event.target.value);
                    if (notFound) setError(null);
                }}
                error={fieldError ?? (notFound ? `There is no customer number ${id}.` : undefined)}
                hint="You were shown this when you registered. Demo customers are 1 to 5."
            />

            {error && !notFound ? <ErrorBanner error={error} /> : null}

            <Button type="submit" variant="primary" loading={loading}>
                Continue
            </Button>
        </form>
    );
}
