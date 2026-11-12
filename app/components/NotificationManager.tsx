"use client";

import { useEffect } from 'react';
import {
    formMatches,
    getFollowsSnapshot,
    getStatusSnapshot,
    readSeen,
    saveStatus,
    todayIso,
    writeSeen,
} from '@/lib/follows';
import { extensionHandlesAlerts } from '@/lib/extension-presence';

/** Check soon after the page opens, then every 5 minutes, while any page of the app is open. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Skip the on-load check if another page view checked this recently (e.g. moving between Reader and the main app). */
const MIN_GAP_MS = 4 * 60 * 1000;

interface FilingHit {
    accessionNumber: string;
    filingDate: string;
    form: string;
    description?: string;
    companyName?: string;
}

/**
 * Looks for new filings from followed tickers and shows a browser notification for each one.
 * Renders nothing; the header's Following menu shows its status. Steps aside when the SCOUT Live extension is
 * running, since it checks EDGAR every second and would otherwise send the same alerts again.
 */
export function NotificationManager() {
    useEffect(() => {
        let cancelled = false;
        let running = false;

        const check = async () => {
            if (running || cancelled || extensionHandlesAlerts()) return;
            const follows = getFollowsSnapshot();
            const status = getStatusSnapshot();
            if (follows.length === 0) return;

            running = true;
            const today = todayIso();
            // Look back to the last check (at least a day, so filings posted late yesterday aren't missed).
            const lastCheckedDay = status.lastChecked ? new Date(status.lastChecked - 86_400_000).toISOString().slice(0, 10) : today;
            const seen = readSeen();
            const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
            const failed: string[] = [];

            for (const follow of follows) {
                if (cancelled) break;
                const startDate = lastCheckedDay > follow.since ? lastCheckedDay : follow.since;
                try {
                    const response = await fetch('/api/search-filings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ticker: follow.ticker, startDate, endDate: today, filingType: 'ALL' }),
                    });
                    if (!response.ok) {
                        failed.push(follow.ticker);
                        continue;
                    }
                    const data = (await response.json()) as { results?: FilingHit[] };
                    for (const filing of data.results ?? []) {
                        if (seen.has(filing.accessionNumber)) continue;
                        seen.add(filing.accessionNumber);
                        if (filing.filingDate < follow.since || !formMatches(filing.form, follow.types)) continue;
                        if (canNotify) {
                            new Notification(`New ${filing.form} from ${filing.companyName || follow.ticker}`, {
                                body: filing.description || `Filed ${filing.filingDate}`,
                                icon: '/apple-icon.png',
                                tag: filing.accessionNumber,
                            });
                        }
                    }
                } catch {
                    failed.push(follow.ticker);
                }
            }

            writeSeen(seen);
            if (!cancelled) {
                saveStatus({
                    lastChecked: Date.now(),
                    error: failed.length > 0 ? `Couldn't reach the SEC for ${failed.join(', ')}. The next check will try again.` : null,
                });
            }
            running = false;
        };

        const lastChecked = getStatusSnapshot().lastChecked;
        const firstDelay = lastChecked && Date.now() - lastChecked < MIN_GAP_MS ? POLL_INTERVAL_MS - (Date.now() - lastChecked) : 3000;
        const first = window.setTimeout(check, Math.max(firstDelay, 3000));
        const interval = window.setInterval(check, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(first);
            window.clearInterval(interval);
        };
    }, []);

    return null;
}
