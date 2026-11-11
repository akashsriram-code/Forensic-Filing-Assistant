/**
 * One SEC filer (company or fund) as the company and fund pages need it, built from EDGAR's submissions JSON
 * (data.sec.gov/submissions/CIK##########.json). Pure functions, safe on client and server; the network calls live in
 * app/api/entity/route.ts.
 */
import type { SecSubmission } from './sec-client';
import { edgarFilerUrl, filingIndexUrl, formatAccession, primaryDocUrl } from './sec-urls';

/** How many of the newest filings the profile lists. */
export const RECENT_FILINGS_LIMIT = 40;

/** Forms that mark a filer as an operating company that reports to shareholders. */
const COMPANY_FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '40-F', '40-F/A']);
const HOLDINGS_FORMS = new Set(['13F-HR', '13F-HR/A']);
/** Forms we pair up (newest two of each) so the page can offer "compare with the previous one". */
export const PAIR_FORMS = ['10-K', '10-Q', '20-F'] as const;
export type PairForm = (typeof PAIR_FORMS)[number];

export interface RecentFiling {
    accessionNumber: string;
    /** YYYY-MM-DD. */
    filingDate: string;
    /** Period the filing covers (YYYY-MM-DD), when EDGAR gives one. */
    reportDate: string | null;
    form: string;
    primaryDocument: string;
    description: string | null;
    /** Bytes. */
    size: number;
    /** The primary document, or the filing index when there is no primary document. */
    url: string;
    /** The filing index page: the best link to cite. */
    indexUrl: string;
}

export interface FilingPair {
    form: PairForm;
    current: RecentFiling;
    previous: RecentFiling;
}

export interface HoldingsFilingRef {
    accessionNumber: string;
    filingDate: string;
    reportDate: string | null;
    form: string;
}

export interface EntityProfile {
    /** 10-digit, zero-padded. */
    cik: string;
    name: string;
    tickers: string[];
    exchanges: string[];
    sicDescription: string | null;
    stateOfIncorporation: string | null;
    /** MMDD, e.g. "0126" for a year ending January 26. */
    fiscalYearEnd: string | null;
    entityType: string | null;
    /** Files 13F holdings reports (any 13F-HR or 13F-HR/A among recent filings). */
    filesHoldings: boolean;
    /** Has a ticker, or files 10-K / 10-Q / 20-F / 40-F reports. */
    isCompany: boolean;
    /** Newest 13F-HR or 13F-HR/A, or null when the filer doesn't file them. */
    latestHoldingsFiling: HoldingsFilingRef | null;
    /** Newest first, at most RECENT_FILINGS_LIMIT. */
    recentFilings: RecentFiling[];
    /** Newest two of each of 10-K, 10-Q and 20-F, searched across all recent filings; only forms filed at least twice. */
    latestPairs: FilingPair[];
    edgarUrl: string;
}

/** "1045810" -> "0001045810". */
export function padCik(cik: string | number): string {
    const digits = String(cik ?? '').replace(/\D/g, '');
    return digits.padStart(10, '0');
}

function text(value: unknown): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean) : [];
}

/** Every filing in `filings.recent`, newest first (EDGAR already orders them, but don't rely on it). */
export function listRecentFilings(submission: Pick<SecSubmission, 'cik' | 'filings'>): RecentFiling[] {
    const recent = submission.filings?.recent;
    const accessions = recent?.accessionNumber;
    if (!recent || !Array.isArray(accessions)) return [];
    const cik = padCik(submission.cik);
    const fallbackUrl = edgarFilerUrl(cik) ?? '';

    const rows = accessions.map((rawAccession, index) => {
        const accessionNumber = formatAccession(rawAccession);
        const primaryDocument = text(recent.primaryDocument?.[index]) ?? '';
        const indexUrl = filingIndexUrl(cik, accessionNumber) ?? fallbackUrl;
        const filing: RecentFiling = {
            accessionNumber,
            filingDate: text(recent.filingDate?.[index]) ?? '',
            reportDate: text(recent.reportDate?.[index]),
            form: text(recent.form?.[index]) ?? '',
            primaryDocument,
            description: text(recent.primaryDocDescription?.[index]),
            size: Number(recent.size?.[index]) || 0,
            url: primaryDocUrl(cik, accessionNumber, primaryDocument) ?? indexUrl,
            indexUrl,
        };
        return { filing, acceptance: text(recent.acceptanceDateTime?.[index]) ?? '', index };
    });

    rows.sort(
        (a, b) =>
            b.filing.filingDate.localeCompare(a.filing.filingDate) ||
            b.acceptance.localeCompare(a.acceptance) ||
            a.index - b.index
    );
    return rows.map((row) => row.filing);
}

/** Newest two filings of each pair form that have a primary document (exact form, so amendments are skipped). */
export function findLatestPairs(filings: RecentFiling[]): FilingPair[] {
    const pairs: FilingPair[] = [];
    for (const form of PAIR_FORMS) {
        const matches = filings.filter((filing) => filing.form === form && filing.primaryDocument);
        if (matches.length >= 2) pairs.push({ form, current: matches[0], previous: matches[1] });
    }
    return pairs;
}

export function buildEntityProfile(submission: SecSubmission): EntityProfile {
    const cik = padCik(submission.cik);
    const filings = listRecentFilings(submission);
    const tickers = strings(submission.tickers);
    const holdings = filings.find((filing) => HOLDINGS_FORMS.has(filing.form)) ?? null;

    return {
        cik,
        name: text(submission.name) ?? `CIK ${cik}`,
        tickers,
        exchanges: strings(submission.exchanges),
        sicDescription: text(submission.sicDescription),
        stateOfIncorporation: text(submission.stateOfIncorporation),
        fiscalYearEnd: text(submission.fiscalYearEnd),
        entityType: text(submission.entityType),
        filesHoldings: holdings !== null,
        isCompany: tickers.length > 0 || filings.some((filing) => COMPANY_FORMS.has(filing.form)),
        latestHoldingsFiling: holdings
            ? { accessionNumber: holdings.accessionNumber, filingDate: holdings.filingDate, reportDate: holdings.reportDate, form: holdings.form }
            : null,
        recentFilings: filings.slice(0, RECENT_FILINGS_LIMIT),
        latestPairs: findLatestPairs(filings),
        edgarUrl: edgarFilerUrl(cik) ?? 'https://www.sec.gov/edgar/search/',
    };
}

/**
 * Cleans the `id` a page or link passes in: trims it, drops a leading "CIK" from "CIK0001045810", and maps BRK.A to
 * BRK-A (EDGAR's ticker spelling). Returns null when nothing usable is left.
 */
export function normalizeEntityId(raw: unknown): string | null {
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    let id = String(raw).trim().replace(/\s+/g, ' ');
    if (!id || id.length > 120) return null;
    const cikMatch = id.match(/^cik\s*0*(\d{1,10})$/i);
    if (cikMatch) return cikMatch[1];
    if (/^\d{1,10}$/.test(id)) return id;
    // Tickers: letters, digits and a class suffix such as BRK.A / BRK-A / BRK/A.
    if (/^[a-z0-9]{1,6}([.\-/][a-z0-9]{1,2})?$/i.test(id)) id = id.toUpperCase().replace(/[./]/g, '-');
    return id;
}
