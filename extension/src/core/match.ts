/** Decides which filings deserve an alert. */
import { formMatches } from '../../../lib/sec-forms';
import { resolveCik } from './tickers';
import type { Follow } from './types';

const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD in Eastern time, the calendar EDGAR files by. */
export function etDate(epochMs: number): string {
    return ET_DATE.format(new Date(epochMs));
}

export interface Tracked {
    /** 10-digit CIK -> the follow that covers it. */
    byCik: Map<string, Follow>;
    /** Follows whose ticker isn't in the SEC's ticker list. */
    unresolved: string[];
}

export function buildTracked(follows: readonly Follow[], tickerMap: Record<string, string>): Tracked {
    const byCik = new Map<string, Follow>();
    const unresolved: string[] = [];
    for (const follow of follows) {
        const cik = resolveCik(follow.ticker, tickerMap);
        if (cik) byCik.set(cik, follow);
        else unresolved.push(follow.ticker);
    }
    return { byCik, unresolved };
}

/**
 * Alert when the form is one the reader picked, the filing is dated on or after the day they followed, and it was
 * accepted after the extension started watching this filer (`floor`), so nothing from before shows up as news.
 */
export function shouldNotify(follow: Follow, form: string, acceptedAt: number, floor: number): boolean {
    return acceptedAt > floor && etDate(acceptedAt) >= follow.since && formMatches(form, follow.types);
}

/** Older follow records may lack fields; mirror lib/follows.ts normalisation so both sides agree. */
export function normalizeFollows(raw: unknown, defaultTypes: readonly string[], today: string): Follow[] {
    if (!Array.isArray(raw)) return [];
    const follows: Follow[] = [];
    for (const entry of raw) {
        if (typeof entry === 'string') {
            follows.push({ ticker: entry.toUpperCase(), types: [...defaultTypes], since: today });
        } else if (entry && typeof entry === 'object' && typeof (entry as Follow).ticker === 'string') {
            const item = entry as Partial<Follow> & { ticker: string };
            follows.push({
                ticker: item.ticker.toUpperCase(),
                types: Array.isArray(item.types) && item.types.length > 0 ? item.types : [...defaultTypes],
                since: typeof item.since === 'string' ? item.since : today,
            });
        }
    }
    return follows;
}
