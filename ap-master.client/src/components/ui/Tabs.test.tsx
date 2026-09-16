import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs.tsx';

const tabs = [
    { id: 'one', label: 'One' },
    { id: 'two', label: 'Two' },
    { id: 'three', label: 'Three' },
];

function Harness() {
    const [active, setActive] = useState('one');
    return <Tabs tabs={tabs} active={active} onChange={setActive} label="Sections" />;
}

describe('Tabs', () => {
    it('exposes the selected tab to assistive technology', () => {
        render(<Harness />);

        const list = screen.getByRole('tablist', { name: 'Sections' });
        expect(list).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'false');
    });

    it('keeps only the selected tab in the tab order', () => {
        render(<Harness />);

        expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('tabindex', '-1');
    });

    it('moves between tabs with the arrow keys', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.tab();
        expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus();

        await user.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
        expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');

        await user.keyboard('{ArrowLeft}{ArrowLeft}');
        expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
    });

    it('jumps to the first and last tab with Home and End', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.tab();
        await user.keyboard('{End}');
        expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();

        await user.keyboard('{Home}');
        expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus();
    });
});
