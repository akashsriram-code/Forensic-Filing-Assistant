/**
 * Theme preference. 'system' follows the OS; 'light' / 'dark' are explicit and stored in localStorage under "theme".
 * The no-flash script in app/layout.tsx applies the same rules before React loads; keep the two in sync.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const CHANGE_EVENT = 'themechange';

export function readThemePreference(): ThemePreference {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
        return 'system';
    }
}

function systemPrefersDark(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyThemePreference(preference: ThemePreference): void {
    const dark = preference === 'dark' || (preference === 'system' && systemPrefersDark());
    document.documentElement.classList.toggle('dark', dark);
}

export function setThemePreference(preference: ThemePreference): void {
    try {
        if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
        // Storage blocked (private mode): the choice still applies for this page view.
    }
    applyThemePreference(preference);
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Calls back when the preference changes (in this tab) or, under 'system', when the OS theme flips. */
export function subscribeToTheme(callback: () => void): () => void {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
        if (readThemePreference() === 'system') applyThemePreference('system');
        callback();
    };
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) {
            applyThemePreference(readThemePreference());
            callback();
        }
    };
    media.addEventListener('change', onSystemChange);
    window.addEventListener(CHANGE_EVENT, callback);
    window.addEventListener('storage', onStorage);
    return () => {
        media.removeEventListener('change', onSystemChange);
        window.removeEventListener(CHANGE_EVENT, callback);
        window.removeEventListener('storage', onStorage);
    };
}

/** True when the page is currently rendering dark (for chart libraries that need concrete colors). */
export function isDarkActive(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}
