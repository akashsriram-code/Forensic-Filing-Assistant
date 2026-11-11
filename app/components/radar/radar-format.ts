import { formatSignedPct } from '@/lib/format';

/** Plain word for a 13F movement, for use inside sentences and lists ("NVIDIA (added)"). */
export function actionWord(action: string): string {
    switch (action) {
        case 'initiated':
            return 'new';
        case 'increased':
            return 'added';
        case 'decreased':
            return 'cut';
        case 'liquidated':
            return 'sold out';
        default:
            return 'no change';
    }
}

/** Order used by every holder list: new positions, sold out, added, cut, no change. */
export function actionOrder(action: string): number {
    if (action === 'initiated') return 0;
    if (action === 'liquidated') return 1;
    if (action === 'increased') return 2;
    if (action === 'decreased') return 3;
    return 4;
}

/** Percent change in shares; null when there were no shares last quarter (a new position has no % change). */
export function sharePctChange(previousShares: number, currentShares: number): number | null {
    if (previousShares > 0) return ((currentShares - previousShares) / previousShares) * 100;
    return currentShares > 0 ? null : 0;
}

export function formatShareChange(pct: number | null): string {
    return pct === null ? '—' : formatSignedPct(pct);
}

/** Herfindahl-Hirschman Index bands (the US antitrust thresholds), in plain words. */
export function concentrationLevel(hhi: number): string {
    if (hhi >= 2500) return 'High';
    if (hhi >= 1500) return 'Moderate';
    return 'Low';
}

export function secFilingsUrl(cik: string): string {
    return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F-HR&dateb=&owner=include&count=40`;
}
