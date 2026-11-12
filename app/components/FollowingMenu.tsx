"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, X } from 'lucide-react';
import {
    getFollowsServerSnapshot,
    getFollowsSnapshot,
    getStatusServerSnapshot,
    getStatusSnapshot,
    removeFollow,
    subscribeFollows,
} from '@/lib/follows';
import { formatRelativeTime } from '@/lib/format';
import { extensionHandlesAlerts, extensionStatusLine, useExtensionPresence } from '@/lib/extension-presence';
import { Button, IconButton } from './ui';

type Permission = NotificationPermission | 'unsupported';

function readPermission(): Permission {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Header menu listing followed tickers, when alerts last checked, and whether the browser allows notifications. */
export function FollowingMenu() {
    const follows = useSyncExternalStore(subscribeFollows, getFollowsSnapshot, getFollowsServerSnapshot);
    const status = useSyncExternalStore(subscribeFollows, getStatusSnapshot, getStatusServerSnapshot);
    const extension = useExtensionPresence();
    const live = extensionHandlesAlerts(extension);
    const [open, setOpen] = useState(false);
    const [permission, setPermission] = useState<Permission>('default');
    const ref = useRef<HTMLDivElement>(null);
    const panelId = useId();

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', close);
        };
    }, [open]);

    const enable = async () => {
        if (typeof Notification === 'undefined') return;
        setPermission(await Notification.requestPermission());
    };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => {
                    if (!open) setPermission(readPermission());
                    setOpen(!open);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-base font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
                <Bell className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Following</span>
                {follows.length > 0 && (
                    <span className="tabular rounded-full bg-accent px-1.5 text-xs font-semibold leading-5 text-accent-ink">{follows.length}</span>
                )}
                <span className="sr-only sm:hidden">Following</span>
            </button>

            {open && (
                <div id={panelId} role="group" aria-label="Followed companies" className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-rule bg-surface p-4 shadow-lg">
                    <p className="text-base font-semibold">Filing alerts</p>
                    {follows.length === 0 ? (
                        <p className="mt-2 text-base text-ink-muted">
                            You aren&apos;t following anyone yet. Search for a company in the Downloader or Whale Tracker and choose <span className="font-medium text-ink">Follow</span> to get an alert when it files.
                        </p>
                    ) : (
                        <ul className="mt-3 divide-y divide-rule border-y border-rule">
                            {follows.map((follow) => (
                                <li key={follow.ticker} className="flex items-start justify-between gap-3 py-2.5">
                                    <div className="min-w-0">
                                        <p className="font-semibold">{follow.ticker}</p>
                                        <p className="text-sm text-ink-muted">{follow.types.join(', ')}</p>
                                    </div>
                                    <IconButton label={`Stop following ${follow.ticker}`} size="sm" onClick={() => removeFollow(follow.ticker)}>
                                        <X className="h-4 w-4" aria-hidden />
                                    </IconButton>
                                </li>
                            ))}
                        </ul>
                    )}

                    {extension && live ? (
                        <div className="mt-3 rounded-md border border-gain/40 bg-gain/10 p-3 text-sm">
                            <p className="font-medium text-gain">{extensionStatusLine(extension)}</p>
                            <p className="mt-1 text-ink-muted">A desktop alert pops up the moment EDGAR publishes a filing (typically under 30 seconds after the SEC accepts it), even when SCOUT isn&apos;t open. Click one to read the filing here.</p>
                        </div>
                    ) : (
                        <>
                            {follows.length > 0 && (
                                <p className="mt-3 text-sm text-ink-muted">
                                    {status.lastChecked ? `Last checked ${formatRelativeTime(status.lastChecked)}.` : 'First check runs a few seconds after the page opens.'} Checks repeat every 5 minutes.
                                </p>
                            )}
                            {status.error && <p className="mt-2 text-sm text-caution">{status.error}</p>}
                            {extension && <p className="mt-2 text-sm text-caution">{extensionStatusLine(extension)}</p>}
                        </>
                    )}

                    {!live && <div className="mt-3 rounded-md bg-surface-2 p-3 text-sm text-ink-muted">
                        {permission === 'granted' && <p>Browser notifications are on. Alerts arrive only while this app is open in a tab.</p>}
                        {permission === 'default' && (
                            <div className="space-y-2">
                                <p>Turn on browser notifications to see alerts. They arrive only while this app is open in a tab.</p>
                                <Button size="sm" variant="primary" onClick={enable}>Turn on notifications</Button>
                            </div>
                        )}
                        {permission === 'denied' && <p>Notifications are blocked for this site. Allow them in your browser&apos;s site settings to get alerts.</p>}
                        {permission === 'unsupported' && <p>This browser doesn&apos;t support notifications.</p>}
                    </div>}
                </div>
            )}
        </div>
    );
}
