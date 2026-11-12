/**
 * Followed tickers and the background alert checker's status, kept in localStorage so they survive reloads.
 * Browser-only. Components read these through useSyncExternalStore with the subscribe/snapshot pairs below.
 */

export interface Follow {
    ticker: string;
    /** Form types to alert on. A filing matches when its form contains one of these (e.g. "10-K" matches "10-K/A"). */
    types: string[];
    /** YYYY-MM-DD the user started following. Filings dated earlier never trigger an alert. */
    since: string;
}

export interface AlertStatus {
    /** Epoch ms of the last completed check, or null if it has never run. */
    lastChecked: number | null;
    /** Plain-language problem from the last check, if any. */
    error: string | null;
}

export const ALERT_FORM_TYPES = ['10-K', '10-Q', '8-K', '4', 'S-1', 'SC 13G', 'SC 13D', '13F'] as const;

const FOLLOWS_KEY = 'follows';
const STATUS_KEY = 'followsStatus';
const SEEN_KEY = 'seenFilings';
const CHANGE_EVENT = 'followschange';
const MAX_SEEN = 1000;

export function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function readRaw(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeRaw(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage full or blocked; follows simply won't persist.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Older versions stored plain ticker strings, or objects without `since`. */
function normalize(raw: string | null): Follow[] {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((entry): Follow | null => {
                if (typeof entry === 'string') return { ticker: entry.toUpperCase(), types: [...ALERT_FORM_TYPES], since: todayIso() };
                if (entry && typeof entry === 'object' && typeof (entry as Follow).ticker === 'string') {
                    const item = entry as Partial<Follow> & { ticker: string };
                    return {
                        ticker: item.ticker.toUpperCase(),
                        types: Array.isArray(item.types) && item.types.length > 0 ? item.types : [...ALERT_FORM_TYPES],
                        since: typeof item.since === 'string' ? item.since : todayIso(),
                    };
                }
                return null;
            })
            .filter((item): item is Follow => item !== null);
    } catch {
        return [];
    }
}

// Snapshots are cached by their raw string so useSyncExternalStore gets a stable reference between renders.
let followsCache: { raw: string | null; value: Follow[] } = { raw: null, value: [] };
let statusCache: { raw: string | null; value: AlertStatus } = { raw: null, value: { lastChecked: null, error: null } };
const EMPTY_FOLLOWS: Follow[] = [];
const EMPTY_STATUS: AlertStatus = { lastChecked: null, error: null };

export function getFollowsSnapshot(): Follow[] {
    const raw = readRaw(FOLLOWS_KEY);
    if (raw !== followsCache.raw) followsCache = { raw, value: normalize(raw) };
    return followsCache.value;
}

export function getFollowsServerSnapshot(): Follow[] {
    return EMPTY_FOLLOWS;
}

export function getStatusSnapshot(): AlertStatus {
    const raw = readRaw(STATUS_KEY);
    if (raw !== statusCache.raw) {
        let value: AlertStatus = EMPTY_STATUS;
        try {
            const parsed = raw ? (JSON.parse(raw) as Partial<AlertStatus>) : null;
            if (parsed) value = { lastChecked: typeof parsed.lastChecked === 'number' ? parsed.lastChecked : null, error: parsed.error ?? null };
        } catch {
            value = EMPTY_STATUS;
        }
        statusCache = { raw, value };
    }
    return statusCache.value;
}

export function getStatusServerSnapshot(): AlertStatus {
    return EMPTY_STATUS;
}

export function subscribeFollows(callback: () => void): () => void {
    const onStorage = (event: StorageEvent) => {
        if (event.key === FOLLOWS_KEY || event.key === STATUS_KEY) callback();
    };
    window.addEventListener(CHANGE_EVENT, callback);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(CHANGE_EVENT, callback);
        window.removeEventListener('storage', onStorage);
    };
}

/** Follow a ticker with the given form types, or stop following it when `types` is empty. */
export function saveFollow(ticker: string, types: string[]): void {
    const symbol = ticker.trim().toUpperCase();
    if (!symbol) return;
    const current = getFollowsSnapshot();
    const existing = current.find((item) => item.ticker === symbol);
    const rest = current.filter((item) => item.ticker !== symbol);
    const next = types.length > 0 ? [...rest, { ticker: symbol, types, since: existing?.since ?? todayIso() }] : rest;
    writeRaw(FOLLOWS_KEY, JSON.stringify(next));
}

export function removeFollow(ticker: string): void {
    saveFollow(ticker, []);
}

export function saveStatus(status: AlertStatus): void {
    writeRaw(STATUS_KEY, JSON.stringify(status));
}

export function readSeen(): Set<string> {
    try {
        const parsed: unknown = JSON.parse(readRaw(SEEN_KEY) || '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
    } catch {
        return new Set();
    }
}

export function writeSeen(seen: Set<string>): void {
    const list = Array.from(seen).slice(-MAX_SEEN);
    try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(list));
    } catch {
        // ignore
    }
}

// Lives in the pure sec-forms module so the browser extension can share it; re-exported here for existing imports.
export { formMatches } from './sec-forms';
