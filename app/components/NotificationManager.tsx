"use client";

import { useEffect, useState } from 'react';

export function NotificationManager() {
    const [lastChecked, setLastChecked] = useState(Date.now());

    // Poll every 5 minutes (300,000 ms)
    const POLL_INTERVAL = 5 * 60 * 1000;

    useEffect(() => {
        // Request permission on mount if checking
        if (Notification.permission === 'default') {
            // Passive request
        }

        const checkFilings = async () => {
            const rawFollowed = JSON.parse(localStorage.getItem('follows') || '[]');
            if (rawFollowed.length === 0) return;

            // Normalize: Convert legacy details strings to objects
            const followed = rawFollowed.map((f: any) => typeof f === 'string' ? { ticker: f, types: ['10-K', '10-Q', '8-K', '4', 'S-1'] } : f);

            console.log("[NotificationManager] Checking filings for:", followed.map((f: any) => f.ticker));

            const today = new Date().toISOString().split('T')[0];

            for (const item of followed) {
                const { ticker, types } = item;

                try {
                    const res = await fetch('/api/search-filings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ticker,
                            startDate: today,
                            endDate: today,
                            filingType: 'ALL' // Fetch all for today, filter later
                        })
                    });

                    if (!res.ok) continue;
                    const data = await res.json();

                    const seen = JSON.parse(localStorage.getItem('seenFilings') || '[]');
                    let newSeen = [...seen];
                    let notified = false;

                    data.results?.forEach((filing: any) => {
                        // Check if we've seen this specific filing
                        if (!seen.includes(filing.accessionNumber)) {

                            // FILTER: Check if this filing type is in user's subscribed types
                            // (We do simple includes check or partial match)
                            const isSubscribedFrom = types?.some((t: string) => filing.form.includes(t));

                            if (isSubscribedFrom) {
                                new Notification(`New ${filing.form} for ${ticker}`, {
                                    body: `${filing.description || 'No description'}`,
                                    icon: '/icon.png'
                                });
                            }

                            // Mark as seen regardless to avoid re-notifying if they change settings later? 
                            // Or should we only mark seen if notified?
                            // Better: Mark seen so we don't process it again.
                            newSeen.push(filing.accessionNumber);
                            notified = true;
                        }
                    });

                    if (notified) {
                        localStorage.setItem('seenFilings', JSON.stringify(newSeen));
                    }

                } catch (e) {
                    console.error("Poll error for", ticker, e);
                }
            }
            setLastChecked(Date.now());
        };

        const interval = setInterval(checkFilings, POLL_INTERVAL);

        // Initial check on load (optional, maybe skip to avoid instant spam)
        // setTimeout(checkFilings, 5000); 

        return () => clearInterval(interval);
    }, []);

    return null; // Invisible component
}
