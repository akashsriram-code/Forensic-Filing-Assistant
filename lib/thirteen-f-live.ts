/**
 * Live EDGAR fallback for the Whale Tracker: when a filer's newest 13F-HR hasn't reached the store yet (the store
 * is refreshed by the daily 13F Ingestion workflow), fetch that one filing straight from SEC.
 */
import { compareQuartersAsc } from './thirteen-f-radar-core';
import { fetchWithTimeout } from './fetch-with-timeout';
import { parseLive13FSubmissionText, quarterFromReportDate, type HoldingInput } from './thirteen-f-parse';
import { SEC_USER_AGENT } from './sec-http';
import { findPeriodOverride, loadPeriodOverrides } from './thirteen-f-period-overrides';

export interface Live13FFiling {
    filerName: string;
    accessionNumber: string;
    filingDate: string;
    reportQuarter: string;
    /** Equity rows only (options excluded), matching what the store keeps. */
    holdings: HoldingInput[];
    /** "13F-HR", or "13F-HR/A" when the original was an empty stub and an amendment for the same quarter was used. */
    form?: string;
}

interface SubmissionsRecent {
    accessionNumber: string[];
    form: string[];
    filingDate: string[];
    reportDate: string[];
}

/** How many same-quarter filings to try after an empty original before giving up. */
const MAX_FALLBACK_ATTEMPTS = 3;

/**
 * The filer's newest original 13F-HR on EDGAR, if it reports a quarter later than `newerThan`; otherwise null.
 * When that original is a stub (no holdings or zero total value, e.g. a confidential-treatment placeholder), the newest
 * non-stub 13F-HR or 13F-HR/A for the same report quarter is used instead; if there is none, null.
 * Throws on SEC/network errors so callers can fall back to the store.
 */
export async function fetchNewerLive13F(cik: string, newerThan: string | null, timeoutMs: number): Promise<Live13FFiling | null> {
    const deadline = Date.now() + timeoutMs;
    const cikInt = String(Number.parseInt(cik, 10));
    const submissions = await fetchSec(`https://data.sec.gov/submissions/CIK${cikInt.padStart(10, '0')}.json`, deadline);
    const body = (await submissions.json()) as { name?: string; filings?: { recent?: SubmissionsRecent } };
    const recent = body.filings?.recent;
    if (!recent) return null;

    const overrides = loadPeriodOverrides();
    // The quarter a filing counts toward: a hand-checked override, else its stated period.
    const listedQuarterOf = (i: number) =>
        findPeriodOverride(overrides, recent.accessionNumber[i], cikInt)?.quarter ?? quarterFromReportDate(recent.reportDate[i] || '');

    const index = recent.form.findIndex((form) => form === '13F-HR');
    if (index === -1) return null;
    const listedQuarter = listedQuarterOf(index);
    if (!listedQuarter || (newerThan && compareQuartersAsc(listedQuarter, newerThan) <= 0)) return null;

    const original = await readFiling(cikInt, recent, index, listedQuarter, deadline);
    if (original) return { ...original, filerName: body.name || `CIK ${cikInt}` };

    // The original was a stub: try other 13F-HR / 13F-HR/A filings for the same quarter, newest first (recent is
    // already newest first).
    let attempts = 0;
    for (let i = 0; i < recent.form.length && attempts < MAX_FALLBACK_ATTEMPTS; i++) {
        if (i === index || (recent.form[i] !== '13F-HR' && recent.form[i] !== '13F-HR/A')) continue;
        if (listedQuarterOf(i) !== listedQuarter) continue;
        attempts++;
        const candidate = await readFiling(cikInt, recent, i, listedQuarter, deadline);
        if (candidate && candidate.reportQuarter === listedQuarter) return { ...candidate, filerName: body.name || `CIK ${cikInt}` };
    }
    return null;
}

/** Reads one filing; null when it is a stub (same guard as live ingestion: no holdings or no value isn't a real quarter). */
async function readFiling(
    cikInt: string,
    recent: SubmissionsRecent,
    i: number,
    listedQuarter: string,
    deadline: number
): Promise<Omit<Live13FFiling, 'filerName'> | null> {
    const accessionNumber = recent.accessionNumber[i];
    const response = await fetchSec(`https://www.sec.gov/Archives/edgar/data/${cikInt}/${accessionNumber}.txt`, deadline);
    const parsed = await parseLive13FSubmissionText(await response.text());
    const override = findPeriodOverride(loadPeriodOverrides(), accessionNumber, cikInt);
    const reportQuarter = override?.quarter ?? ((parsed.reportDate && quarterFromReportDate(parsed.reportDate)) || listedQuarter);
    const holdings = parsed.holdings.filter((h) => !h.putcall);
    const totalValue = holdings.reduce((sum, h) => sum + (Number.isFinite(h.value) ? h.value : 0), 0);
    if (holdings.length === 0 || totalValue <= 0) return null;
    return { accessionNumber, filingDate: recent.filingDate[i], reportQuarter, holdings, form: recent.form[i] };
}

async function fetchSec(url: string, deadline: number): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Live EDGAR lookup ran out of time before ${url}`);
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': SEC_USER_AGENT }, cache: 'no-store' }, remaining);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    return response;
}
