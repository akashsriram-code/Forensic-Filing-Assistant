/** Shared shapes for the SCOUT Live extension. Pure types; no browser or Node globals. */

/** A followed company or fund, exactly as SCOUT stores it in localStorage (see lib/follows.ts). */
export interface Follow {
    /** Ticker, or a bare CIK (all digits) for funds and companies without a ticker. */
    ticker: string;
    types: string[];
    /** YYYY-MM-DD the reader started following. */
    since: string;
}

/** One row of EDGAR's live "Latest Filings" Atom feed. A filing appears once per party (issuer, insider, filer...). */
export interface FeedEntry {
    accession: string;
    /** 10-digit, zero-padded. */
    cik: string;
    /** "Issuer", "Reporting", "Filed by", "Subject", "Filer"... or null when the title has none. */
    role: string | null;
    form: string;
    company: string;
    /** Epoch ms when EDGAR accepted the filing. */
    acceptedAt: number;
    indexUrl: string;
}

/** One filing from a filer's data.sec.gov submissions file. */
export interface FilingRow {
    accession: string;
    cik: string;
    company: string;
    form: string;
    acceptedAt: number;
    filingDate: string;
    primaryDocument: string;
}

/** An alert shown to the reader, kept so the popup can list it and a click can open it. */
export interface Alert {
    /** Accession number; also the notification id. */
    id: string;
    cik: string;
    /** The follow this alert belongs to (ticker or CIK). */
    follow: string;
    company: string;
    form: string;
    role: string | null;
    acceptedAt: number;
    caughtAt: number;
    /** Best sec.gov URL for the filing: the primary document once known, the filing index until then. */
    docUrl: string;
    source: 'feed' | 'backstop';
    /** live | released (EDGAR held it, e.g. overnight) | away (caught after the computer was off or asleep). */
    timing?: 'live' | 'released' | 'away';
    read: boolean;
}

export interface Settings {
    /** Where SCOUT runs, e.g. http://localhost:3000 or the production address. No trailing slash. */
    scoutUrl: string;
    /** Contact address sent in the User-Agent, which the SEC requires for automated requests. */
    email: string;
    /** How often to check the live feed during EDGAR hours. */
    pollMs: number;
}

export type LiveState = 'live' | 'offhours' | 'paused' | 'setup' | 'idle' | 'error';

/** Written every check; the popup, the SCOUT page and the service-worker keep-alive all use it. */
export interface LiveStatus {
    state: LiveState;
    /** Plain-language line for the popup and SCOUT. */
    message: string;
    lastPollAt: number | null;
    /** Round trip of the last feed request, in ms. */
    lastLatencyMs: number | null;
    followCount: number;
    /** Follows whose ticker couldn't be matched to an SEC ID. */
    unresolved: string[];
    blockedUntil: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
    scoutUrl: 'http://localhost:3000',
    email: '',
    pollMs: 1000,
};
