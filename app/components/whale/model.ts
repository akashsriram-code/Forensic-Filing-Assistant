/**
 * Whale Tracker data model: the shapes the whale-* API routes return, plus the one place their value units are
 * converted to dollars for display. Every money figure leaving this file is in DOLLARS.
 *
 * Units, as returned by each route (checked against app/api/whale-* and lib/thirteen-f-store.ts, which stores whole dollars):
 *   /api/whale-tracker         holding.value                     $ thousands (route divides store dollars by 1000)
 *   /api/whale-cluster         valueA / valueB / combinedValue   $ thousands (same)
 *   /api/whale-reverse-lookup  currentValue / history[].value    dollars (store values, passed through)
 *   /api/whale-history         history[].value                   as reported in each 13F XML: dollars for filings made on
 *                                                                or after 2023-01-03 (SEC rule change), thousands before
 *   /api/whale-activist        no money figures
 */

import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import type { ChangeKind } from '@/app/components/ui';

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export interface ApiHolding {
    issuer: string;
    cusip: string | null;
    sharesCurr: number;
    sharesPrev: number;
    change: number;
    percentChange: number;
    /** $ thousands. */
    value: number;
    isNew?: boolean;
    isAddOn?: boolean;
}

export interface FundHoldingsResponse {
    ticker: string;
    filerName?: string | null;
    cik?: string;
    currentQuarter?: string | null;
    previousQuarter?: string | null;
    filingDateCurr: string;
    filingDatePrev: string | null;
    source?: string;
    note?: string | null;
    allChanges: ApiHolding[];
}

export interface ClusterFund {
    ticker: string;
    name?: string | null;
    quarter?: string | null;
    date: string;
    totalHoldings: number;
    uniqueCount: number;
    /** $ thousands. */
    overlapValue: number;
}

export interface ApiClusterHolding {
    issuer: string;
    cusip: string;
    /** $ thousands. */
    valueA: number;
    valueB: number;
    sharesA: number;
    sharesB: number;
    combinedValue: number;
}

export interface ClusterResponse {
    fundA: ClusterFund;
    fundB: ClusterFund;
    overlap: { count: number; holdings: ApiClusterHolding[] };
}

export type ReverseAction = 'initiated' | 'liquidated' | 'increased' | 'decreased' | 'unchanged' | 'no_prior';

export interface ReverseHistoryPoint {
    date: string;
    quarter?: string;
    shares: number;
    /** Dollars. */
    value: number;
}

export interface ReverseFund {
    fundName: string;
    cik: string;
    action: ReverseAction;
    currentShares: number;
    previousShares: number;
    shareDelta: number;
    percentChange: number | null;
    /** Dollars. */
    currentValue: number;
    previousValue: number;
    valueDelta: number;
    currentFilingDate: string;
    previousFilingDate: string | null;
    currentQuarter: string;
    previousQuarter: string | null;
    history: ReverseHistoryPoint[];
}

export interface ReverseResponse {
    ticker?: string;
    companyName: string;
    currentQuarter?: string | null;
    previousQuarter?: string | null;
    matchCount: number;
    returnedCount?: number;
    funds: ReverseFund[];
}

export interface ActivistFiling {
    form: string;
    accessionNumber?: string;
    filingDate: string;
    reportDate?: string;
    url: string;
    primaryDocument: string;
    description?: string;
    reportingPerson?: string;
    percentClass?: string;
    shares?: string;
    purpose?: string;
}

export interface ActivistResponse {
    ticker: string;
    cik?: string;
    companyName?: string;
    filings: ActivistFiling[];
}

interface HistoryApiPoint {
    date: string;
    shares: number;
    /** As reported in that filing; see the unit table at the top of this file. */
    value: number;
}

export interface HistoryResponse {
    history: HistoryApiPoint[];
    holding?: string;
}

// ---------------------------------------------------------------------------
// Display model (dollars)
// ---------------------------------------------------------------------------

export interface HistoryPoint {
    date: string;
    quarter: string | null;
    shares: number;
    valueUsd: number;
}

export interface FundHolding {
    id: string;
    issuer: string;
    cusip: string | null;
    sharesPrev: number;
    sharesCurr: number;
    change: number;
    /** Share change in percent; null when there was no prior position. */
    pctChange: number | null;
    valueUsd: number;
    kind: ChangeKind;
    /** Shares bought or sold × this quarter's implied price (value ÷ shares). Null when no current price exists (sold out). */
    tradeValueUsd: number | null;
}

/** /api/whale-tracker and /api/whale-cluster report $ thousands. */
export const thousandsToDollars = (thousands: number) => (Number.isFinite(thousands) ? thousands * 1000 : 0);

/** SEC 13F filings made on or after 2023-01-03 report VALUE in whole dollars; earlier ones in thousands. */
const DOLLAR_REPORTING_START = '2023-01-03';

/** Converts one /api/whale-history point, whose value is in the unit its own filing used. */
export function historyPointFromApi(point: HistoryApiPoint): HistoryPoint {
    const raw = Number.isFinite(point.value) ? point.value : 0;
    return {
        date: point.date,
        quarter: null,
        shares: Number.isFinite(point.shares) ? point.shares : 0,
        valueUsd: point.date >= DOLLAR_REPORTING_START ? raw : raw * 1000,
    };
}

/** /api/whale-reverse-lookup history values are already dollars. */
export function historyPointFromReverse(point: ReverseHistoryPoint): HistoryPoint {
    return { date: point.date, quarter: point.quarter ?? null, shares: point.shares || 0, valueUsd: point.value || 0 };
}

export function holdingKind(h: ApiHolding, snapshotOnly: boolean): ChangeKind {
    if (snapshotOnly) return 'unchanged';
    if (h.sharesCurr === 0 && h.sharesPrev > 0) return 'exited';
    if (h.isNew || (h.sharesPrev === 0 && h.sharesCurr > 0)) return 'new';
    if (h.change > 0) return 'added';
    if (h.change < 0) return 'cut';
    return 'unchanged';
}

export function toFundHoldings(response: FundHoldingsResponse, snapshotOnly: boolean): FundHolding[] {
    return response.allChanges.map((h, index) => {
        const valueUsd = thousandsToDollars(h.value);
        const kind = holdingKind(h, snapshotOnly);
        const price = h.sharesCurr > 0 ? valueUsd / h.sharesCurr : null;
        return {
            // CUSIP is unique within one filer's holdings; fall back to the issuer name for the rare row without one.
            id: h.cusip || `${h.issuer}-${index}`,
            issuer: h.issuer,
            cusip: h.cusip,
            sharesPrev: h.sharesPrev,
            sharesCurr: h.sharesCurr,
            change: snapshotOnly ? 0 : h.change,
            pctChange: kind === 'added' || kind === 'cut' ? h.percentChange : null,
            valueUsd,
            kind,
            tradeValueUsd: snapshotOnly || price === null ? null : h.change * price,
        };
    });
}

export function reverseKind(action: ReverseAction): ChangeKind | 'no_prior' {
    switch (action) {
        case 'initiated':
            return 'new';
        case 'increased':
            return 'added';
        case 'decreased':
            return 'cut';
        case 'liquidated':
            return 'exited';
        case 'no_prior':
            return 'no_prior';
        default:
            return 'unchanged';
    }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** "2026-Q3" -> "Q3 2026". */
export function formatQuarter(quarter: string | null | undefined): string {
    if (!quarter) return '';
    const match = /^(\d{4})-?Q([1-4])$/i.exec(quarter.trim());
    return match ? `Q${match[2]} ${match[1]}` : quarter;
}

/** "2026-Q3" -> "2026-09-30" (the date 13F holdings are reported as of). */
export function quarterEndDate(quarter: string | null | undefined): string | null {
    if (!quarter) return null;
    const match = /^(\d{4})-?Q([1-4])$/i.exec(quarter.trim());
    if (!match) return null;
    const ends = ['03-31', '06-30', '09-30', '12-31'];
    return `${match[1]}-${ends[Number(match[2]) - 1]}`;
}

const TRAILING_WORDS = new Set([
    'INC', 'INC.', 'LLC', 'L.L.C.', 'LP', 'L.P.', 'LTD', 'LTD.', 'CORP', 'CORP.', 'CO', 'CO.', 'PLC', 'MANAGEMENT', 'CAPITAL',
    'ADVISORS', 'ADVISERS', 'PARTNERS', 'GROUP', 'HOLDINGS', 'ASSOCIATES', 'INVESTMENT', 'INVESTMENTS', '&',
]);

/** A short label for column headers and legends: "PERSHING SQUARE CAPITAL MANAGEMENT, L.P." -> "PERSHING SQUARE". */
export function shortFundName(name: string): string {
    const words = name.split(',')[0].trim().split(/\s+/).filter(Boolean);
    while (words.length > 1 && TRAILING_WORDS.has(words[words.length - 1].toUpperCase())) words.pop();
    return words.slice(0, 3).join(' ') || name;
}

export function slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
}

type CsvValue = string | number | null | undefined;

/** Downloads rows as a CSV file. Values are written as-is (dollars, whole share counts). */
export function downloadCsv(rows: Record<string, CsvValue>[], filename: string): void {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const cell = (value: CsvValue) => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [headers.map(cell).join(','), ...rows.map((row) => headers.map((h) => cell(row[h])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** POST JSON and return the parsed body, or throw an Error carrying the route's own message. */
export async function postJson<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
    const response = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        timeoutMs
    );
    let payload: unknown = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error: unknown }).error || '') : '';
        throw new Error(message || `The server answered with an error (${response.status}).`);
    }
    return payload as T;
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return 'Something went wrong while loading the data.';
}

/** Values the 13D route uses when it did not read a filing ("Loading...", "N/A", "See filing..."). */
export function readActivistField(value: string | undefined | null): string | null {
    const text = (value || '').trim();
    if (!text) return null;
    if (/^(loading\.*|unknown|n\/a|see filing.*)$/i.test(text)) return null;
    return text;
}

/** 13D forms read as plain words. */
export function activistFormLabel(form: string): string {
    return /\/A$/i.test(form.trim()) ? 'Amendment' : 'Initial filing';
}
