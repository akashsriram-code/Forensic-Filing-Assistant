/**
 * Live EDGAR fallback for the Whale Tracker: when a filer's newest 13F-HR hasn't reached the store yet (the store
 * is refreshed by the daily 13F Ingestion workflow), fetch that one filing straight from SEC.
 */
import { compareQuartersAsc } from './thirteen-f-radar-core';
import { fetchWithTimeout } from './fetch-with-timeout';
import { parseLive13FSubmissionText, quarterFromReportDate, type HoldingInput } from './thirteen-f-parse';

const SEC_USER_AGENT = process.env.SEC_USER_AGENT || 'ForensicAnalyzer contact@example.com';

export interface Live13FFiling {
    filerName: string;
    accessionNumber: string;
    filingDate: string;
    reportQuarter: string;
    /** Equity rows only (options excluded), matching what the store keeps. */
    holdings: HoldingInput[];
}

interface SubmissionsRecent {
    accessionNumber: string[];
    form: string[];
    filingDate: string[];
    reportDate: string[];
}

/**
 * The filer's newest original 13F-HR on EDGAR, if it reports a quarter later than `newerThan`; otherwise null.
 * Amendments are left to the daily ingestion. Throws on SEC/network errors so callers can fall back to the store.
 */
export async function fetchNewerLive13F(cik: string, newerThan: string | null, timeoutMs: number): Promise<Live13FFiling | null> {
    const deadline = Date.now() + timeoutMs;
    const cikInt = String(Number.parseInt(cik, 10));
    const submissions = await fetchSec(`https://data.sec.gov/submissions/CIK${cikInt.padStart(10, '0')}.json`, deadline);
    const body = (await submissions.json()) as { name?: string; filings?: { recent?: SubmissionsRecent } };
    const recent = body.filings?.recent;
    if (!recent) return null;

    const index = recent.form.findIndex((form) => form === '13F-HR');
    if (index === -1) return null;
    const listedQuarter = quarterFromReportDate(recent.reportDate[index] || '');
    if (!listedQuarter || (newerThan && compareQuartersAsc(listedQuarter, newerThan) <= 0)) return null;

    const accessionNumber = recent.accessionNumber[index];
    const response = await fetchSec(`https://www.sec.gov/Archives/edgar/data/${cikInt}/${accessionNumber}.txt`, deadline);
    const parsed = await parseLive13FSubmissionText(await response.text());
    const reportQuarter = (parsed.reportDate && quarterFromReportDate(parsed.reportDate)) || listedQuarter;
    const holdings = parsed.holdings.filter((h) => !h.putcall);
    const totalValue = holdings.reduce((sum, h) => sum + (Number.isFinite(h.value) ? h.value : 0), 0);
    // Same guard as live ingestion: placeholder filings with no holdings or no value aren't a real quarter.
    if (holdings.length === 0 || totalValue <= 0) return null;

    return { filerName: body.name || `CIK ${cikInt}`, accessionNumber, filingDate: recent.filingDate[index], reportQuarter, holdings };
}

async function fetchSec(url: string, deadline: number): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Live EDGAR lookup ran out of time before ${url}`);
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': SEC_USER_AGENT }, cache: 'no-store' }, remaining);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    return response;
}
