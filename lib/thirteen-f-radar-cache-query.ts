/**
 * Cache-based query layer for Whale Tracker features.
 * Enables querying the 13F radar cache files instead of a live database.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
    getRadarCacheRoot,
    type RadarMatchedRowsCache,
} from './thirteen-f-radar-cache';
import {
    type RadarFilingRow,
    type RadarHoldingRow,
} from './thirteen-f-radar-core';

export interface CacheQueryResult {
    filings: RadarFilingRow[];
    holdings: RadarHoldingRow[];
    quarters: string[];
}

let loadedCache: RadarMatchedRowsCache | null = null;
let loadedCachePath: string | null = null;

/**
 * Load all cache files and merge them into a single dataset.
 */
export async function loadMergedCache(): Promise<CacheQueryResult> {
    const cacheRoot = getRadarCacheRoot();
    const allFilings: RadarFilingRow[] = [];
    const allHoldings: RadarHoldingRow[] = [];
    const quarters = new Set<string>();

    try {
        const entries = await fs.readdir(cacheRoot, { withFileTypes: true });
        
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const cachePath = path.join(cacheRoot, entry.name, 'matched-holdings.json');
            
            try {
                const content = await fs.readFile(cachePath, 'utf8');
                const cache = JSON.parse(content) as RadarMatchedRowsCache;
                
                if (cache.filings) allFilings.push(...cache.filings);
                if (cache.holdings) allHoldings.push(...cache.holdings);
                if (cache.currentQuarter) quarters.add(cache.currentQuarter);
                if (cache.previousQuarter) quarters.add(cache.previousQuarter);
            } catch {
                continue;
            }
        }
    } catch {
        // Cache directory doesn't exist
    }

    // Dedupe filings by accession number
    const filingMap = new Map(allFilings.map(f => [f.accessionNumber, f]));
    const uniqueFilings = Array.from(filingMap.values());

    // Dedupe holdings by unique key
    const holdingMap = new Map(
        allHoldings.map(h => [`${h.accessionNumber}|${h.cusip}|${h.issuer}`, h])
    );
    const uniqueHoldings = Array.from(holdingMap.values());

    return {
        filings: uniqueFilings,
        holdings: uniqueHoldings,
        quarters: Array.from(quarters).sort().reverse(),
    };
}

/**
 * Search holdings by issuer name pattern (case-insensitive prefix match).
 */
export async function searchHoldingsByIssuer(
    issuerPrefix: string
): Promise<{ holdings: RadarHoldingRow[]; filings: RadarFilingRow[] }> {
    const { filings, holdings } = await loadMergedCache();
    const upperPrefix = issuerPrefix.toUpperCase();

    const matchedHoldings = holdings.filter(h =>
        h.issuer.toUpperCase().startsWith(upperPrefix)
    );

    const matchedAccessions = new Set(matchedHoldings.map(h => h.accessionNumber));
    const matchedCiks = new Set(matchedHoldings.map(h => h.cik));

    // Get all filings for matched CIKs (needed for history)
    const matchedFilings = filings.filter(f => matchedCiks.has(f.cik));

    return { holdings: matchedHoldings, filings: matchedFilings };
}

/**
 * Get all holdings for a specific fund (by CIK).
 */
export async function getHoldingsForFund(
    cik: string
): Promise<{ holdings: RadarHoldingRow[]; filings: RadarFilingRow[] }> {
    const { filings, holdings } = await loadMergedCache();
    const normalizedCik = cik.replace(/^0+/, '');

    const matchedHoldings = holdings.filter(h =>
        h.cik.replace(/^0+/, '') === normalizedCik
    );

    const matchedFilings = filings.filter(f =>
        f.cik.replace(/^0+/, '') === normalizedCik
    );

    return { holdings: matchedHoldings, filings: matchedFilings };
}

/**
 * Get unique issuers in the cache (for autocomplete).
 */
export async function getUniqueIssuers(): Promise<string[]> {
    const { holdings } = await loadMergedCache();
    return Array.from(new Set(holdings.map(h => h.issuer))).sort();
}