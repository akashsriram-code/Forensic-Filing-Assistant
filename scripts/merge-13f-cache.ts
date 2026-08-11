/**
 * Merge new Q2 filings from DB into existing cache JSON.
 * This preserves Q1 data intact while adding/updating Q2 filers.
 * 
 * Usage: npx tsx scripts/merge-13f-cache.ts
 */
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import path from 'node:path';
import {
    createPostgresPool,
    getPostgresConnectionString,
} from '../lib/thirteen-f-radar-postgres';
import {
    getRadarMatchedRowsCachePath,
    type RadarMatchedRowsCache,
} from '../lib/thirteen-f-radar-cache';
import {
    DEFAULT_RADAR_WATCHLISTS,
    matchIssuerToWatchlists,
    normalizeCik,
    type RadarFilingRow,
    type RadarHoldingRow,
} from '../lib/thirteen-f-radar-core';
import { getArg, hasArg, isDirectRun } from './13f-ingestion-utils';

const CACHE_ROOT = path.join(process.cwd(), 'data', '13f-radar-cache');

interface MergeStats {
    existingFilings: number;
    existingHoldings: number;
    newFilingsFromDb: number;
    newHoldingsFromDb: number;
    mergedFilings: number;
    mergedHoldings: number;
}

async function main() {
    const dryRun = hasArg('--dry-run');
    const quarter = getArg('--quarter') || '2026-Q2';
    const previousQuarter = getArg('--previous-quarter') || '2026-Q1';
    
    console.log(`[Cache Merge] Merging Q2 data from DB into cache...`);
    console.log(`[Cache Merge] Current quarter: ${quarter}, Previous: ${previousQuarter}`);
    
    // 1. Read existing cache directly from file
    const cachePath = getRadarMatchedRowsCachePath(quarter, previousQuarter, { cacheRoot: CACHE_ROOT });
    
    let existingCache: RadarMatchedRowsCache;
    try {
        const cacheContent = await fs.readFile(cachePath, 'utf8');
        existingCache = JSON.parse(cacheContent) as RadarMatchedRowsCache;
    } catch {
        console.error(`[Cache Merge] No existing cache found at ${cachePath}. Run generate-13f-radar-cache.ts first.`);
        process.exit(1);
    }
    
    console.log(`[Cache Merge] Existing cache: ${existingCache.filings.length} filings, ${existingCache.holdings.length} holdings`);
    
    // Build sets of existing accession numbers
    const existingAccessions = new Set(existingCache.filings.map(f => f.accessionNumber));
    
    // 2. Connect to DB and get new Q2 filings
    const connectionString = getPostgresConnectionString();
    if (!connectionString) {
        console.error('[Cache Merge] Missing DATABASE_URL or POSTGRES_URL');
        process.exit(1);
    }
    
    const pool = createPostgresPool(connectionString);
    
    try {
        // Get filings from DB that aren't in cache
        const filingsResult = await pool.query(`
            SELECT 
                f.accession_number,
                f.cik,
                fn.name as fund_name,
                f.filing_date,
                f.report_date,
                f.quarter
            FROM filings f
            JOIN funds fn ON f.cik = fn.cik
            WHERE f.quarter = $1
        `, [quarter]);
        
        const dbFilings = filingsResult.rows;
        const newFilings = dbFilings.filter(f => !existingAccessions.has(f.accession_number));
        
        console.log(`[Cache Merge] Found ${dbFilings.length} Q2 filings in DB, ${newFilings.length} are new`);
        
        if (newFilings.length === 0) {
            console.log('[Cache Merge] No new filings to merge. Cache is up to date.');
            await pool.end();
            return;
        }
        
        // Get holdings for new filings
        const newAccessions = newFilings.map(f => f.accession_number);
        const holdingsResult = await pool.query(`
            SELECT 
                h.accession_number,
                s.issuer,
                s.cusip,
                h.value,
                h.shares
            FROM holdings h
            JOIN securities s ON h.security_key = s.security_key
            WHERE h.accession_number = ANY($1)
        `, [newAccessions]);
        
        console.log(`[Cache Merge] Found ${holdingsResult.rows.length} holdings for new filings`);
        
        // Build a map of accession -> filing info
        const filingMap = new Map<string, { cik: string; fundName: string; filingDate: string; quarter: string }>();
        for (const f of newFilings) {
            filingMap.set(f.accession_number, {
                cik: normalizeCik(f.cik),
                fundName: f.fund_name || f.cik,
                filingDate: f.filing_date,
                quarter: f.quarter,
            });
        }
        
        // Convert to RadarFilingRow format (camelCase)
        const newFilingRows: RadarFilingRow[] = newFilings.map(f => ({
            accessionNumber: f.accession_number,
            cik: normalizeCik(f.cik),
            fundName: f.fund_name || f.cik,
            filingDate: f.filing_date,
            quarter: f.quarter,
        }));
        
        // Convert holdings and filter for watchlist matches
        const categoryKeys = existingCache.matchedCategoryKeys;
        const newHoldingRows: RadarHoldingRow[] = [];
        
        for (const h of holdingsResult.rows) {
            const matches = matchIssuerToWatchlists(
                h.issuer,
                DEFAULT_RADAR_WATCHLISTS,
                categoryKeys
            );
            if (matches.length === 0) continue;
            
            const filing = filingMap.get(h.accession_number);
            if (!filing) continue;
            
            // RadarHoldingRow extends RadarFilingRow with issuer, cusip, value, shares
            newHoldingRows.push({
                accessionNumber: h.accession_number,
                cik: filing.cik,
                fundName: filing.fundName,
                filingDate: filing.filingDate,
                quarter: filing.quarter,
                issuer: h.issuer,
                cusip: h.cusip,
                value: Number(h.value),
                shares: Number(h.shares),
            });
        }
        
        console.log(`[Cache Merge] ${newHoldingRows.length} holdings matched watchlists`);
        
        // 3. Merge into existing cache
        const mergedFilings = [...existingCache.filings, ...newFilingRows];
        const mergedHoldings = [...existingCache.holdings, ...newHoldingRows];
        
        const mergedCache: RadarMatchedRowsCache = {
            ...existingCache,
            generatedAt: new Date().toISOString(),
            filings: mergedFilings,
            holdings: mergedHoldings,
        };
        
        const stats: MergeStats = {
            existingFilings: existingCache.filings.length,
            existingHoldings: existingCache.holdings.length,
            newFilingsFromDb: newFilingRows.length,
            newHoldingsFromDb: newHoldingRows.length,
            mergedFilings: mergedFilings.length,
            mergedHoldings: mergedHoldings.length,
        };
        
        console.log('[Cache Merge] Merge stats:', stats);
        
        if (dryRun) {
            console.log('[Cache Merge] Dry run - not writing cache');
        } else {
            // Write atomically: temp file then rename
            const tempPath = `${cachePath}.tmp`;
            fsSync.writeFileSync(tempPath, JSON.stringify(mergedCache, null, 2));
            fsSync.renameSync(tempPath, cachePath);
            
            console.log(`[Cache Merge] Wrote merged cache to ${cachePath}`);
        }
        
    } finally {
        await pool.end();
    }
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error('[Cache Merge] Failed:', error);
        process.exit(1);
    });
}