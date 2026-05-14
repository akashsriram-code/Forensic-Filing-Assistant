import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
    DEFAULT_RADAR_WATCHLISTS,
    matchIssuerToWatchlists,
    normalizeIssuerName,
    type MovementBasis,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from './thirteen-f-radar-core';

export const RADAR_MATCHED_ROWS_CACHE_VERSION = 1;

export interface RadarCacheRequest {
    currentQuarter: string;
    previousQuarter: string;
    availableQuarters: string[];
    watchlists: RadarWatchlist[];
    selectedCategories: string[];
    movementBasis: MovementBasis;
}

export interface RadarMatchedRowsCache {
    schemaVersion: typeof RADAR_MATCHED_ROWS_CACHE_VERSION;
    generatedAt: string;
    currentQuarter: string;
    previousQuarter: string;
    availableQuarters: string[];
    watchlistHash: string;
    matchedCategoryKeys: string[];
    watchlists: RadarWatchlist[];
    filings: RadarFilingRow[];
    holdings: RadarHoldingRow[];
}

export interface RadarCacheOptions {
    cacheRoot?: string;
}

export interface BuildRadarMatchedRowsCacheInput {
    request: RadarCacheRequest;
    filings: RadarFilingRow[];
    holdings: RadarHoldingRow[];
    generatedAt?: Date;
}

const DEFAULT_CACHE_ROOT = path.join(process.cwd(), 'data', '13f-radar-cache');

export function getRadarCacheRoot(options?: RadarCacheOptions): string {
    return options?.cacheRoot || process.env.THIRTEEN_F_RADAR_CACHE_DIR || DEFAULT_CACHE_ROOT;
}

export function getRadarMatchedRowsCachePath(
    currentQuarter: string,
    previousQuarter: string,
    options?: RadarCacheOptions
): string {
    const pair = `${safePathSegment(currentQuarter)}-vs-${safePathSegment(previousQuarter)}`;
    return path.join(getRadarCacheRoot(options), pair, 'matched-holdings.json');
}

export function getRadarWatchlistHash(watchlists: RadarWatchlist[]): string {
    return createHash('sha256')
        .update(JSON.stringify(canonicalizeWatchlists(watchlists)))
        .digest('hex')
        .slice(0, 16);
}

export function getDefaultRadarWatchlistHash(): string {
    return getRadarWatchlistHash(DEFAULT_RADAR_WATCHLISTS);
}

export function buildRadarMatchedRowsCache(input: BuildRadarMatchedRowsCacheInput): RadarMatchedRowsCache {
    const { request, filings, holdings, generatedAt = new Date() } = input;
    const matchedCategoryKeys = getRequestedCategoryKeys(request);
    const matchedHoldings = dedupeRadarHoldings(
        holdings.filter((holding) =>
            matchIssuerToWatchlists(holding.issuer, request.watchlists, matchedCategoryKeys).length > 0
        )
    );

    return {
        schemaVersion: RADAR_MATCHED_ROWS_CACHE_VERSION,
        generatedAt: generatedAt.toISOString(),
        currentQuarter: request.currentQuarter,
        previousQuarter: request.previousQuarter,
        availableQuarters: [...request.availableQuarters],
        watchlistHash: getRadarWatchlistHash(request.watchlists),
        matchedCategoryKeys,
        watchlists: request.watchlists,
        filings: dedupeRadarFilings(filings),
        holdings: matchedHoldings,
    };
}

export async function readRadarMatchedRowsCache(
    request: RadarCacheRequest,
    options?: RadarCacheOptions
): Promise<RadarMatchedRowsCache | null> {
    const cachePath = getRadarMatchedRowsCachePath(request.currentQuarter, request.previousQuarter, options);
    let parsed: unknown;

    try {
        parsed = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    } catch {
        return null;
    }

    if (!isRadarMatchedRowsCache(parsed)) return null;
    if (parsed.currentQuarter !== request.currentQuarter || parsed.previousQuarter !== request.previousQuarter) return null;
    if (parsed.watchlistHash !== getRadarWatchlistHash(request.watchlists)) return null;

    const cachedCategories = new Set(parsed.matchedCategoryKeys);
    if (!getRequestedCategoryKeys(request).every((category) => cachedCategories.has(category))) return null;

    return parsed;
}

export async function writeRadarMatchedRowsCache(
    cache: RadarMatchedRowsCache,
    options?: RadarCacheOptions
): Promise<string> {
    const cachePath = getRadarMatchedRowsCachePath(cache.currentQuarter, cache.previousQuarter, options);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    return cachePath;
}

function getRequestedCategoryKeys(request: RadarCacheRequest): string[] {
    const validKeys = new Set(request.watchlists.map((watchlist) => watchlist.key));
    const requested = request.selectedCategories.filter((category) => validKeys.has(category));
    return requested.length > 0 ? requested : Array.from(validKeys);
}

function dedupeRadarFilings(filings: RadarFilingRow[]): RadarFilingRow[] {
    return Array.from(
        new Map(filings.map((filing) => [`${filing.cik}|${filing.accessionNumber}`, { ...filing }])).values()
    ).sort((a, b) =>
        a.quarter.localeCompare(b.quarter) ||
        a.cik.localeCompare(b.cik) ||
        a.filingDate.localeCompare(b.filingDate) ||
        a.accessionNumber.localeCompare(b.accessionNumber)
    );
}

function dedupeRadarHoldings(holdings: RadarHoldingRow[]): RadarHoldingRow[] {
    const bySecurity = new Map<string, RadarHoldingRow>();

    for (const holding of holdings) {
        const key = [
            holding.accessionNumber,
            holding.cusip || 'NO_CUSIP',
            normalizeIssuerName(holding.issuer),
        ].join('|');
        const existing = bySecurity.get(key);

        if (existing) {
            existing.value += holding.value;
            existing.shares += holding.shares;
            continue;
        }

        bySecurity.set(key, { ...holding });
    }

    return Array.from(bySecurity.values()).sort((a, b) =>
        a.quarter.localeCompare(b.quarter) ||
        a.cik.localeCompare(b.cik) ||
        a.accessionNumber.localeCompare(b.accessionNumber) ||
        normalizeIssuerName(a.issuer).localeCompare(normalizeIssuerName(b.issuer)) ||
        String(a.cusip || '').localeCompare(String(b.cusip || ''))
    );
}

function canonicalizeWatchlists(watchlists: RadarWatchlist[]) {
    return watchlists.map((watchlist) => ({
        key: watchlist.key,
        label: watchlist.label,
        description: watchlist.description,
        items: watchlist.items.map((item) => ({
            ticker: item.ticker,
            label: item.label,
            aliases: [...item.aliases],
        })),
    }));
}

function isRadarMatchedRowsCache(value: unknown): value is RadarMatchedRowsCache {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<RadarMatchedRowsCache>;

    return record.schemaVersion === RADAR_MATCHED_ROWS_CACHE_VERSION &&
        typeof record.generatedAt === 'string' &&
        typeof record.currentQuarter === 'string' &&
        typeof record.previousQuarter === 'string' &&
        Array.isArray(record.availableQuarters) &&
        record.availableQuarters.every((quarter) => typeof quarter === 'string') &&
        typeof record.watchlistHash === 'string' &&
        Array.isArray(record.matchedCategoryKeys) &&
        record.matchedCategoryKeys.every((category) => typeof category === 'string') &&
        Array.isArray(record.watchlists) &&
        Array.isArray(record.filings) &&
        record.filings.every(isRadarFilingRow) &&
        Array.isArray(record.holdings) &&
        record.holdings.every(isRadarHoldingRow);
}

function isRadarFilingRow(value: unknown): value is RadarFilingRow {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<RadarFilingRow>;

    return typeof record.cik === 'string' &&
        typeof record.fundName === 'string' &&
        typeof record.accessionNumber === 'string' &&
        typeof record.filingDate === 'string' &&
        typeof record.quarter === 'string';
}

function isRadarHoldingRow(value: unknown): value is RadarHoldingRow {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<RadarHoldingRow>;

    return isRadarFilingRow(value) &&
        typeof record.issuer === 'string' &&
        (typeof record.cusip === 'string' || record.cusip === null) &&
        typeof record.value === 'number' &&
        Number.isFinite(record.value) &&
        typeof record.shares === 'number' &&
        Number.isFinite(record.shares);
}

function safePathSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}
