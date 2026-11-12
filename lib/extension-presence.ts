/**
 * Whether the SCOUT Live browser extension is running for this page. Its content script marks <html> with
 * data-scout-extension (version), data-scout-extension-state, -poll (epoch ms of its last EDGAR check) and -message.
 * Browser-only; components read it through useSyncExternalStore with the subscribe/snapshot pair below.
 */
import { useSyncExternalStore } from 'react';

export interface ExtensionPresence {
    version: string;
    /** live | offhours | paused | setup | idle | error */
    state: string;
    lastPollAt: number | null;
    message: string;
}

const ATTRIBUTES = ['data-scout-extension', 'data-scout-extension-state', 'data-scout-extension-poll', 'data-scout-extension-message'];

let cache: { key: string; value: ExtensionPresence | null } = { key: '', value: null };

export function getExtensionPresence(): ExtensionPresence | null {
    if (typeof document === 'undefined') return null;
    const data = document.documentElement.dataset;
    const key = [data.scoutExtension, data.scoutExtensionState, data.scoutExtensionPoll, data.scoutExtensionMessage].join('|');
    if (key !== cache.key) {
        const poll = Number(data.scoutExtensionPoll);
        cache = {
            key,
            value: data.scoutExtension
                ? {
                      version: data.scoutExtension,
                      state: data.scoutExtensionState ?? '',
                      lastPollAt: Number.isFinite(poll) && poll > 0 ? poll : null,
                      message: data.scoutExtensionMessage ?? '',
                  }
                : null,
        };
    }
    return cache.value;
}

/**
 * True when the extension has taken over alerts. Until the reader has added their email in its Options it can't check
 * EDGAR, so the in-app checker keeps going.
 */
export function extensionHandlesAlerts(presence: ExtensionPresence | null = getExtensionPresence()): boolean {
    return presence !== null && presence.state !== 'setup';
}

function subscribe(callback: () => void): () => void {
    const observer = new MutationObserver(callback);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ATTRIBUTES });
    return () => observer.disconnect();
}

export function useExtensionPresence(): ExtensionPresence | null {
    return useSyncExternalStore(subscribe, getExtensionPresence, () => null);
}

/** "Live alerts on: SCOUT Live, checked 1s ago." or the extension's own status line when it isn't live. */
export function extensionStatusLine(presence: ExtensionPresence, now = Date.now()): string {
    if (presence.state === 'live' || presence.state === 'offhours') {
        const checked = presence.lastPollAt ? `, checked ${Math.max(0, Math.round((now - presence.lastPollAt) / 1000))}s ago` : '';
        const hours = presence.state === 'offhours' ? ' EDGAR is closed right now, so checks slow to every 20 seconds.' : '';
        return `Live alerts on: SCOUT Live${checked}.${hours}`;
    }
    return presence.message || 'SCOUT Live is installed.';
}
