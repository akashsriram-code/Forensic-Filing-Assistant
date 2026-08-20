/**
 * Cache-based query layer for Whale Tracker features.
 * Queries the Postgres DB when POSTGRES_URL is set, otherwise falls back to local cache files.
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
import { createPostgresPool, getPostgresConnectionString, type PostgresExecutor } from './thirteen-f-radar-postgres';
import type { Pool } from 'pg';

let cachedPool: Pool | null = null;

function getDbPool(): Pool | null {
    if (cachedPool) return cachedPool;
    const connectionString = getPostgresConnectionString();
    if (!connectionString) return null;
    cachedPool = createPostgresPool(connectionString);
    return cachedPool;
}

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
 * Queries Postgres DB if POSTGRES_URL is set, otherwise falls back to local cache.
 */
export async function searchHoldingsByIssuer(
    issuerPrefix: string
): Promise<{ holdings: RadarHoldingRow[]; filings: RadarFilingRow[] }> {
    const pool = getDbPool();
    
    if (pool) {
        // Use DB query
        return searchHoldingsByIssuerFromDb(pool, issuerPrefix);
    }
    
    // Fall back to cache
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

async function searchHoldingsByIssuerFromDb(
    pool: Pool,
    issuerPrefix: string
): Promise<{ holdings: RadarHoldingRow[]; filings: RadarFilingRow[] }> {
    const upperPrefix = issuerPrefix.toUpperCase() + '%';
    
    // Query holdings matching the issuer prefix
    const holdingsResult = await pool.query<{
        accession_number: string;
        cik: string;
        fund_name: string;
        filing_date: string;
        quarter: string;
        issuer: string;
        cusip: string | null;
        value: string;
        shares: string;
    }>(`
        SELECT 
            h.accession_number,
            f.cik,
            f.fund_name,
            f.filing_date,
            f.quarter,
            h.issuer,
            h.cusip,
            h.value,
            h.shares
        FROM pg_13f_holdings h
        JOIN pg_13f_filings f ON h.accession_number = f.accession_number
        WHERE UPPER(h.issuer) LIKE $1
        ORDER BY f.filing_date DESC
        LIMIT 10000
    `, [upperPrefix]);

    const holdings: RadarHoldingRow[] = holdingsResult.rows.map(row => ({
        accessionNumber: row.accession_number,
        cik: row.cik,
        fundName: row.fund_name,
        filingDate: row.filing_date,
        quarter: row.quarter,
        issuer: row.issuer,
        cusip: row.cusip,
        value: Number(row.value),
        shares: Number(row.shares),
    }));

    // Get unique CIKs from matched holdings
    const matchedCiks = [...new Set(holdings.map(h => h.cik))];
    
    if (matchedCiks.length === 0) {
        return { holdings: [], filings: [] };
    }

    // Get all filings for those CIKs (needed for history/comparison)
    const filingsResult = await pool.query<{
        accession_number: string;
        cik: string;
        fund_name: string;
        filing_date: string;
        quarter: string;
    }>(`
        SELECT DISTINCT
            accession_number,
            cik,
            fund_name,
            filing_date,
            quarter
        FROM pg_13f_filings
        WHERE cik = ANY($1)
        ORDER BY filing_date DESC
    `, [matchedCiks]);

    const filings: RadarFilingRow[] = filingsResult.rows.map(row => ({
        accessionNumber: row.accession_number,
        cik: row.cik,
        fundName: row.fund_name,
        filingDate: row.filing_date,
        quarter: row.quarter,
    }));

    return { holdings, filings };
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