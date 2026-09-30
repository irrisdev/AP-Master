import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { themeStorageKey } from '../../lib/theme.ts';
import { ThemeToggle } from './ThemeToggle.tsx';

afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
});

describe('ThemeToggle', () => {
    it('starts from the system theme when nothing is saved', () => {
        // jsdom has no matchMedia, which reads as a light system theme.
        render(<ThemeToggle />);

        expect(screen.getByRole('switch', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'false');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('starts from a saved choice', () => {
        window.localStorage.setItem(themeStorageKey, 'dark');

        render(<ThemeToggle />);

        expect(screen.getByRole('switch', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'true');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('switches the page theme and remembers the choice', async () => {
        const user = userEvent.setup();
        render(<ThemeToggle />);
        const toggle = screen.getByRole('switch', { name: 'Dark theme' });

        await user.click(toggle);

        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(window.localStorage.getItem(themeStorageKey)).toBe('dark');

        await user.click(toggle);

        expect(document.documentElement.dataset.theme).toBe('light');
        expect(window.localStorage.getItem(themeStorageKey)).toBe('light');
    });

    it('ignores a saved value that is not a theme', () => {
        window.localStorage.setItem(themeStorageKey, 'purple');

        render(<ThemeToggle />);

        expect(document.documentElement.dataset.theme).toBe('light');
    });
});
