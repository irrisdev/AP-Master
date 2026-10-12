import { useState } from 'react';
import { apiMode } from './api/index.ts';
import type { CustomerDto } from './api/index.ts';
import { ChatView } from './components/chat/ChatView.tsx';
import { CustomerSetup } from './components/customer/CustomerSetup.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { Badge } from './components/ui/Badge.tsx';
import { ThemeToggle } from './components/ui/ThemeToggle.tsx';
import './components/ui/ui.css';
import './App.css';

type View = 'chat' | 'dashboard';

const views: { id: View; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'dashboard', label: 'Dashboard' },
];

/**
 * Two views, switched by state. A router would add a dependency and a build step
 * for one decision; if deep links are ever needed, this is the place to add one.
 *
 * The chosen customer lives here, above both views, so it survives a trip to the
 * dashboard and the dashboard can open on that customer's conversations.
 */
function App() {
    const [view, setView] = useState<View>('chat');
    const [customer, setCustomer] = useState<CustomerDto | null>(null);

    return (
        <>
            <a className="skip-link" href="#main">
                Skip to main content
            </a>

            <header className="app-header">
                <div className={`app-header__inner ${view === 'dashboard' ? 'app-wide' : ''}`.trim()}>
                    <div className="brand">
                        <span className="brand__mark" aria-hidden="true">
                            T
                        </span>
                        <span className="brand__name">Telegroup</span>
                        <span className="brand__product">Customer support</span>
                    </div>

                    <nav className="app-nav" aria-label="Main">
                        {views.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={`app-nav__link ${
                                    view === item.id ? 'app-nav__link--active' : ''
                                }`.trim()}
                                aria-current={view === item.id ? 'page' : undefined}
                                onClick={() => setView(item.id)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    {apiMode === 'mock' ? (
                        <Badge tone="warning">Demo data — no backend connected</Badge>
                    ) : null}

                    <ThemeToggle />
                </div>
            </header>

            {/* The dashboard is a working screen full of tables, so it gets more width than the chat. */}
            <main className={`app-main ${view === 'dashboard' ? 'app-wide' : ''}`.trim()} id="main">
                {view === 'dashboard' ? (
                    <DashboardView customerId={customer?.id} />
                ) : customer ? (
                    // Keyed by customer, so switching customer starts a clean chat.
                    <ChatView
                        key={customer.id}
                        customer={customer}
                        onSwitchCustomer={() => setCustomer(null)}
                    />
                ) : (
                    <CustomerSetup onReady={setCustomer} />
                )}
            </main>
        </>
    );
}

export default App;
