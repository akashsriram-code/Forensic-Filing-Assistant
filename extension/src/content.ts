/**
 * Runs on SCOUT pages. Copies the reader's follows from SCOUT's localStorage into the extension whenever they change,
 * and tells the page the extension is on (attributes on <html>), so SCOUT can show "Live alerts on" and switch off its
 * own slower in-tab checker. Only acts on the SCOUT address set in Options.
 */
import { DEFAULT_SETTINGS, type LiveStatus, type Settings } from './core/types';

const FOLLOWS_KEY = 'follows';
let lastRaw: string | null | undefined;

function alive(): boolean {
    // After the extension is reloaded or removed, this old copy of the script loses its connection to it.
    return Boolean(chrome.runtime?.id);
}

function syncFollows(): void {
    if (!alive()) return;
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(FOLLOWS_KEY);
    } catch {
        return;
    }
    if (raw === lastRaw) return;
    lastRaw = raw;
    let follows: unknown = [];
    try {
        follows = JSON.parse(raw ?? '[]');
    } catch {
        follows = [];
    }
    void chrome.storage.local.set({ follows });
}

function applyStatus(status: LiveStatus | undefined): void {
    const root = document.documentElement;
    if (!status) return;
    root.dataset.scoutExtensionState = status.state;
    root.dataset.scoutExtensionPoll = status.lastPollAt ? String(status.lastPollAt) : '';
    root.dataset.scoutExtensionMessage = status.message;
}

async function main(): Promise<void> {
    const stored = await chrome.storage.local.get('settings');
    const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
    let origin: string;
    try {
        origin = new URL(settings.scoutUrl).origin;
    } catch {
        return;
    }
    if (location.origin !== origin) return;

    document.documentElement.dataset.scoutExtension = chrome.runtime.getManifest().version;
    syncFollows();
    window.addEventListener('followschange', syncFollows);
    window.addEventListener('storage', (event) => {
        if (event.key === FOLLOWS_KEY) syncFollows();
    });

    try {
        const session = await chrome.storage.session.get('status');
        applyStatus(session.status as LiveStatus | undefined);
    } catch {
        // Session storage opens to content scripts once the background worker has started; status follows shortly.
    }
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && changes.status) applyStatus(changes.status.newValue as LiveStatus | undefined);
    });
}

void main();
