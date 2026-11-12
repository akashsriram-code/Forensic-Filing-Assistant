/** Options page: contact email (required by the SEC), SCOUT address and poll speed. */
import { DEFAULT_SETTINGS, type Settings } from './core/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const email = $<HTMLInputElement>('email');
const scoutUrl = $<HTMLInputElement>('scoutUrl');
const poll = $<HTMLSelectElement>('poll');
const saved = $('saved');

async function load(): Promise<void> {
    const stored = await chrome.storage.local.get('settings');
    const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
    email.value = settings.email;
    scoutUrl.value = settings.scoutUrl;
    poll.value = String(settings.pollMs);
}

$('form').addEventListener('submit', (event) => {
    event.preventDefault();
    let origin: string;
    try {
        const url = new URL(scoutUrl.value.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
        origin = url.origin;
    } catch {
        saved.textContent = 'Enter the full SCOUT address, starting with http:// or https://.';
        return;
    }
    const settings: Settings = { email: email.value.trim(), scoutUrl: origin, pollMs: Number(poll.value) || DEFAULT_SETTINGS.pollMs };

    // Reading follows from a SCOUT address other than the built-in localhost needs the reader's permission. Ask
    // straight away, while this click still counts as the reader's own action.
    const needsPermission = origin !== 'http://localhost:3000';
    const permission = needsPermission ? chrome.permissions.request({ origins: [`${origin}/*`] }) : Promise.resolve(true);
    void permission.then(async (granted) => {
        await chrome.storage.local.set({ settings });
        await chrome.runtime.sendMessage({ type: 'settingsSaved' });
        saved.textContent = granted
            ? 'Saved. Open SCOUT once so the extension can read who you follow.'
            : `Saved, but without permission to read ${origin} the extension can't see who you follow there.`;
    });
});

$('test').addEventListener('click', () => {
    void chrome.notifications.create('scout-live-test', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Test company filed an 8-K (major event)',
        message: 'This is how SCOUT Live alerts look. If you can see this, notifications are working.',
        contextMessage: 'SCOUT Live',
        priority: 2,
    });
    saved.textContent = "Test alert sent. If nothing appeared, check that Windows notifications (and Focus Assist / Do Not Disturb) allow your browser.";
});

void load();
