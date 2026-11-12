/** When and how fast to poll, staying well inside the SEC's fair-access limit of 10 requests a second. */

/** Ceiling on requests to sec.gov in any one second, across the feed, the backstop and lookups. */
export const MAX_REQUESTS_PER_SECOND = 4;
/** The SEC blocks for 10 minutes after the limit is exceeded; wait a little longer before trying again. */
export const BLOCK_BACKOFF_MS = 11 * 60 * 1000;
/** Outside EDGAR hours nothing new is published, so check slowly (still often enough to keep the worker alive). */
export const OFF_HOURS_FEED_MS = 20 * 1000;
export const OFF_HOURS_BACKSTOP_MS = 5 * 1000;
/** A filing caught later than this after acceptance is labelled as caught "while you were away". */
export const LATE_AFTER_MS = 10 * 60 * 1000;

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
});

/** EDGAR publishes filings 6:00 a.m. to 10:00 p.m. Eastern, Monday to Friday. */
export function edgarOpen(now: number): boolean {
    const parts = Object.fromEntries(ET_PARTS.formatToParts(new Date(now)).map((part) => [part.type, part.value]));
    if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return minutes >= 6 * 60 && minutes < 22 * 60;
}

export function feedIntervalMs(now: number, pollMs: number): number {
    return edgarOpen(now) ? pollMs : Math.max(OFF_HOURS_FEED_MS, pollMs);
}

/** The backstop checks one followed filer per step, at twice the feed's pace during EDGAR hours. */
export function backstopIntervalMs(now: number, pollMs: number): number {
    return edgarOpen(now) ? Math.max(250, Math.round(pollMs / 2)) : OFF_HOURS_BACKSTOP_MS;
}

/** Sliding-window limiter: at most `max` requests in any `windowMs`. */
export class RateLimiter {
    private stamps: number[] = [];

    constructor(
        private readonly max = MAX_REQUESTS_PER_SECOND,
        private readonly windowMs = 1000,
    ) {}

    /** How long to wait before a request may go out; 0 means now. */
    waitMs(now: number): number {
        this.stamps = this.stamps.filter((stamp) => now - stamp < this.windowMs);
        return this.stamps.length < this.max ? 0 : this.windowMs - (now - this.stamps[0]);
    }

    /** Records a request if one is allowed now. */
    tryAcquire(now: number): boolean {
        if (this.waitMs(now) > 0) return false;
        this.stamps.push(now);
        return true;
    }
}

/**
 * The feed holds only the newest 100 entries. If none of the filings from the previous check are still in it, more
 * than a page arrived in between (a filing surge, or the worker was asleep), so older pages must be read too.
 */
export function needsBackfill(previous: ReadonlySet<string> | null, accessions: readonly string[]): boolean {
    if (!previous || previous.size === 0 || accessions.length === 0) return false;
    return !accessions.some((accession) => previous.has(accession));
}

/** Retry delay after a network error or bad response: 2s, 4s, 8s ... up to a minute. */
export function errorBackoffMs(consecutiveErrors: number): number {
    return Math.min(60_000, 1000 * 2 ** Math.max(1, consecutiveErrors));
}
