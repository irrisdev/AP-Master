/**
 * Light and dark themes.
 *
 * The theme is a `data-theme` attribute on <html>, which index.css keys its dark tokens
 * off. Until the user picks one, it follows the operating system; once they do, the
 * choice is remembered in this browser.
 *
 * index.html runs the same resolution in an inline script before the first paint, so a
 * dark-theme user never sees a flash of the light page. Keep the two in step.
 */

export type Theme = 'light' | 'dark';

export const themeStorageKey = 'telegroup-theme';

const darkQuery = '(prefers-color-scheme: dark)';

function isTheme(value: unknown): value is Theme {
    return value === 'light' || value === 'dark';
}

/** The user's saved choice, or null if they have not made one (or storage is blocked). */
export function getStoredTheme(): Theme | null {
    try {
        const value = window.localStorage.getItem(themeStorageKey);
        return isTheme(value) ? value : null;
    } catch {
        return null;
    }
}

/** Remembering the choice is a convenience; if storage is unavailable the toggle still works. */
export function storeTheme(theme: Theme): void {
    try {
        window.localStorage.setItem(themeStorageKey, theme);
    } catch {
        // Private browsing or blocked site data: the theme lasts for this page only.
    }
}

export function getSystemTheme(): Theme {
    return typeof window.matchMedia === 'function' && window.matchMedia(darkQuery).matches
        ? 'dark'
        : 'light';
}

export function resolveTheme(): Theme {
    return getStoredTheme() ?? getSystemTheme();
}

export function applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
}

/** Calls back when the operating system switches theme. Returns the unsubscribe. */
export function onSystemThemeChange(callback: (theme: Theme) => void): () => void {
    if (typeof window.matchMedia !== 'function') return () => {};

    const query = window.matchMedia(darkQuery);
    const listener = (event: MediaQueryListEvent) => callback(event.matches ? 'dark' : 'light');
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
}
