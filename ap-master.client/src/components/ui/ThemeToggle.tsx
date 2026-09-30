import { useTheme } from '../../hooks/useTheme.ts';

/**
 * A switch for the dark theme. The icon shows what a click will change to, and the
 * accessible state says what is on now.
 */
export function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const dark = theme === 'dark';

    return (
        <button
            type="button"
            role="switch"
            aria-checked={dark}
            aria-label="Dark theme"
            title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="theme-toggle"
            onClick={toggleTheme}
        >
            {dark ? <SunIcon /> : <MoonIcon />}
        </button>
    );
}

function SunIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="4.5" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5" />
                <path d="M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
            </g>
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z"
            />
        </svg>
    );
}
