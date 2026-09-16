import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface TabDefinition {
    id: string;
    label: string;
}

export interface TabsProps {
    tabs: TabDefinition[];
    active: string;
    onChange: (id: string) => void;
    /** Names the group for screen readers, e.g. "Dashboard sections". */
    label: string;
}

/**
 * An ARIA tablist with the keyboard behaviour the pattern actually requires:
 * arrow keys move between tabs and only the selected tab is in the tab order,
 * so a keyboard user reaches the panel in one more press rather than four.
 */
export function Tabs({ tabs, active, onChange, label }: TabsProps) {
    const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const index = tabs.findIndex((tab) => tab.id === active);
        const target = targetIndex(event.key, index, tabs.length);
        if (target === null) return;

        event.preventDefault();
        const next = tabs[target];
        onChange(next.id);
        buttons.current[next.id]?.focus();
    }

    return (
        <div className="tabs" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`tab-${tab.id}`}
                    className={`tabs__tab ${tab.id === active ? 'tabs__tab--active' : ''}`.trim()}
                    aria-selected={tab.id === active}
                    aria-controls={`panel-${tab.id}`}
                    tabIndex={tab.id === active ? 0 : -1}
                    ref={(element) => {
                        buttons.current[tab.id] = element;
                    }}
                    onClick={() => onChange(tab.id)}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

/** Which tab the arrow, Home and End keys move to; null for any other key. */
function targetIndex(key: string, index: number, count: number): number | null {
    if (key === 'ArrowRight') return (index + 1) % count;
    if (key === 'ArrowLeft') return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return null;
}
