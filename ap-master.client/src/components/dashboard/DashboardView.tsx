import { useState } from 'react';
import { Tabs } from '../ui/Tabs.tsx';
import type { TabDefinition } from '../ui/Tabs.tsx';
import { ConversationsPanel } from './ConversationsPanel.tsx';
import { TicketsPanel } from './TicketsPanel.tsx';
import './dashboard.css';

const sections: TabDefinition[] = [
    { id: 'tickets', label: 'Tickets' },
    { id: 'conversations', label: 'Conversations' },
];

export interface DashboardViewProps {
    /** The customer the chat is acting for, if any: the conversations lookup starts there. */
    customerId?: number;
}

/** The agent's side of the product: what the chatbot's triage decisions produced. */
export function DashboardView({ customerId }: DashboardViewProps) {
    const [active, setActive] = useState(sections[0].id);

    return (
        <section className="dashboard" aria-label="Agent dashboard">
            <header className="dashboard__header">
                <h1>Agent dashboard</h1>
                <p className="dashboard__subtitle">
                    Tickets raised by the assistant — support requests and complaints alike — and
                    the conversations behind them.
                </p>
            </header>

            <Tabs tabs={sections} active={active} onChange={setActive} label="Dashboard sections" />

            <div
                className="dashboard__panel"
                role="tabpanel"
                id={`panel-${active}`}
                aria-labelledby={`tab-${active}`}
                tabIndex={0}
            >
                {active === 'tickets' ? <TicketsPanel /> : null}
                {active === 'conversations' ? (
                    <ConversationsPanel initialCustomerId={customerId} />
                ) : null}
            </div>
        </section>
    );
}
