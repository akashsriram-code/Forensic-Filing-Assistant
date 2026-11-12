"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, BellRing, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
    ALERT_FORM_TYPES,
    getFollowsServerSnapshot,
    getFollowsSnapshot,
    saveFollow,
    subscribeFollows,
} from '@/lib/follows';
import { extensionHandlesAlerts, useExtensionPresence } from '@/lib/extension-presence';
import { Button } from './ui';

interface FollowButtonProps {
    ticker: string;
    className?: string;
}

/**
 * Follow a ticker to get a browser notification when it files. Always rendered (disabled without a ticker) so the
 * layout doesn't jump. When following, the chevron opens alert settings.
 */
export function FollowButton({ ticker, className }: FollowButtonProps) {
    const symbol = ticker.trim().toUpperCase();
    // A bare CIK means nothing to a reader, so funds followed by CIK just say "Follow" / "Following".
    const shown = /^\d+$/.test(symbol) ? '' : ` ${symbol}`;
    const follows = useSyncExternalStore(subscribeFollows, getFollowsSnapshot, getFollowsServerSnapshot);
    const follow = follows.find((item) => item.ticker === symbol);
    const live = extensionHandlesAlerts(useExtensionPresence());
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<string[]>([]);
    const ref = useRef<HTMLDivElement>(null);
    const popoverId = useId();

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

    const startFollowing = () => {
        if (!symbol) return;
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            void Notification.requestPermission();
        }
        saveFollow(symbol, [...ALERT_FORM_TYPES]);
    };

    const openSettings = () => {
        setDraft(follow?.types ?? [...ALERT_FORM_TYPES]);
        setOpen((value) => !value);
    };

    if (!follow) {
        return (
            <Button
                variant="secondary"
                className={className}
                onClick={startFollowing}
                disabled={!symbol}
                title={symbol ? `Get a browser alert when ${symbol} files` : 'Enter a company first'}
                icon={<Bell className="h-4 w-4" aria-hidden />}
            >
                {`Follow${shown}`}
            </Button>
        );
    }

    return (
        <div ref={ref} className={cn('relative inline-flex', className)}>
            <button
                type="button"
                onClick={openSettings}
                aria-expanded={open}
                aria-controls={popoverId}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-gain/50 bg-gain/10 px-4 text-base font-medium text-gain transition-colors hover:bg-gain/15"
            >
                <BellRing className="h-4 w-4" aria-hidden />
                {`Following${shown}`}
                <ChevronDown className="h-4 w-4" aria-hidden />
            </button>

            {open && (
                <div
                    id={popoverId}
                    role="group"
                    aria-label={`Alert settings for ${symbol}`}
                    className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-rule bg-surface p-4 shadow-lg"
                >
                    <p className="text-base font-semibold">Alert me when {symbol} files</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        {ALERT_FORM_TYPES.map((type) => (
                            <label key={type} className="flex items-center gap-2 text-base">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-[var(--accent)]"
                                    checked={draft.includes(type)}
                                    onChange={() => setDraft((current) => (current.includes(type) ? current.filter((t) => t !== type) : [...current, type]))}
                                />
                                {type}
                            </label>
                        ))}
                    </div>
                    <p className="mt-3 text-sm text-ink-muted">
                        {live
                            ? 'Live alerts on: the SCOUT Live extension sends a desktop alert the moment EDGAR publishes a filing, even when SCOUT isn’t open.'
                            : 'Alerts arrive only while this app is open in a browser tab.'}
                    </p>
                    <div className="mt-4 flex flex-wrap justify-between gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                saveFollow(symbol, []);
                                setOpen(false);
                            }}
                        >
                            Stop following
                        </Button>
                        <Button
                            size="sm"
                            variant="primary"
                            disabled={draft.length === 0}
                            onClick={() => {
                                saveFollow(symbol, draft);
                                setOpen(false);
                            }}
                        >
                            Save alerts
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
