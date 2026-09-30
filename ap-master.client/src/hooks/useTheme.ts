import { useCallback, useEffect, useState } from 'react';
import {
    applyTheme,
    getStoredTheme,
    onSystemThemeChange,
    resolveTheme,
    storeTheme,
    type Theme,
} from '../lib/theme.ts';

/**
 * The current theme and a toggle for it.
 *
 * While the user has not chosen, the page tracks the operating system live. Toggling
 * records an explicit choice, after which system changes are ignored.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
    const [theme, setTheme] = useState<Theme>(resolveTheme);
    const [chosen, setChosen] = useState(() => getStoredTheme() !== null);

    useEffect(() => applyTheme(theme), [theme]);

    useEffect(() => (chosen ? undefined : onSystemThemeChange(setTheme)), [chosen]);

    const toggleTheme = useCallback(() => {
        setTheme((current) => {
            const next = current === 'dark' ? 'light' : 'dark';
            storeTheme(next);
            return next;
        });
        setChosen(true);
    }, []);

    return { theme, toggleTheme };
}
