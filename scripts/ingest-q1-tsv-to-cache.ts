/**
 * Ingest Q1 2026 13-F data from SEC EDGAR TSV files directly into the cache.
 * This bypasses the database and merges TSV data into matched-holdings.json.
 *
 * Usage: npx tsx scripts/ingest-q1-tsv-to-cache.ts
 */
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import path from 'node:path';
import {
    getRadarMatchedRowsCachePath,
    getRadarWatchlistHash,
    type RadarMatchedRowsCache,
} from '../lib/thirteen-f-radar-cache';
import {
    DEFAULT_RADAR_WATCHLISTS,
    matchIssuerToWatchlists,
    normalizeCik,
    type RadarFilingRow,
    type RadarHoldingRow,
} from '../lib/thirteen-f-radar-core';
import { hasArg, isDirectRun } from './13f-ingestion-utils';

const CACHE_ROOT = path.join(process.cwd(), 'data', '13f-radar-cache');
const TSV_ROOT = path.join(process.cwd(), 'data', 'q1-2026');

interface SubmissionRow {
    accessionNumber: string;
    filingDate: string;
    submissionType: string;
    cik: string;
    periodOfReport: string;
}

interface InfoTableRow {
    accessionNumber: string;
    issuer: string;
    cusip: string;
    value: number;
    shares: number;
    putCall: string | null;
}

async function main() {
    const dryRun = hasArg('--dry-run');
    const currentQuarter = '2026-Q2';
    const previousQuarter = '2026-Q1';

    console.log('[TSV Ingest] Reading SEC EDGAR TSV files from data/q1-2026/...');

    // 1. Read and parse SUBMISSION.tsv
    const submissionPath = path.join(TSV_ROOT, 'SUBMISSION.tsv');
    const submissionContent = await fs.readFile(submissionPath, 'utf8');
    const submissionRows = parseTsv<SubmissionRow>(submissionContent, (cols, headers) => {
        const idx = makeHeaderIndex(headers);
        return {
            accessionNumber: cols[idx['ACCESSION_NUMBER']] || '',
            filingDate: cols[idx['FILING_DATE']] || '',
            submissionType: cols[idx['SUBMISSIONTYPE']] || '',
            cik: cols[idx['CIK']] || '',
            periodOfReport: cols[idx['PERIODOFREPORT']] || '',
        };
    });

    // Filter to 13F-HR filings only (skip 13F-NT notices which have no holdings)
    const hrFilings = submissionRows.filter(row => row.submissionType === '13F-HR');
    console.log(`[TSV Ingest] Found ${submissionRows.length} total submissions, ${hrFilings.length} are 13F-HR`);

    // 2. Read and parse INFOTABLE.tsv
    const infoTablePath = path.join(TSV_ROOT, 'INFOTABLE.tsv');
    const infoTableContent = await fs.readFile(infoTablePath, 'utf8');
    const infoTableRows = parseTsv<InfoTableRow>(infoTableContent, (cols, headers) => {
        const idx = makeHeaderIndex(headers);
        return {
            accessionNumber: cols[idx['ACCESSION_NUMBER']] || '',
            issuer: cols[idx['NAMEOFISSUER']] || '',
            cusip: cols[idx['CUSIP']] || '',
            value: parseFloat(cols[idx['VALUE']] || '0') || 0,
            shares: parseFloat(cols[idx['SSHPRNAMT']] || '0') || 0,
            putCall: cols[idx['PUTCALL']]?.trim() || null,
        };
    });

    console.log(`[TSV Ingest] Found ${infoTableRows.length} holding rows in INFOTABLE.tsv`);

    // 3. Build maps for efficient lookup
    const filingByAccession = new Map<string, SubmissionRow>();
    for (const filing of hrFilings) {
        filingByAccession.set(filing.accessionNumber, filing);
    }

    // 4. Filter holdings to watched issuers and exclude options
    const categoryKeys = DEFAULT_RADAR_WATCHLISTS.map(w => w.key);
    const matchedHoldings: InfoTableRow[] = [];

    for (const holding of infoTableRows) {
        // Skip if not in our 13F-HR filings
        if (!filingByAccession.has(holding.accessionNumber)) continue;

        // Skip options (PUT/CALL)
        if (holding.putCall && holding.putCall.length > 0) continue;

        // Check if issuer matches any watchlist
        const matches = matchIssuerToWatchlists(holding.issuer, DEFAULT_RADAR_WATCHLISTS, categoryKeys);
        if (matches.length > 0) {
            matchedHoldings.push(holding);
        }
    }

    console.log(`[TSV Ingest] ${matchedHoldings.length} holdings matched watchlists`);

    // 5. Build RadarFilingRow and RadarHoldingRow arrays
    const filingRows: RadarFilingRow[] = [];
    const holdingRows: RadarHoldingRow[] = [];
    const seenAccessions = new Set<string>();

    for (const holding of matchedHoldings) {
        const sub = filingByAccession.get(holding.accessionNumber)!;
        const quarter = parseQuarter(sub.periodOfReport);

        if (!seenAccessions.has(sub.accessionNumber)) {
            seenAccessions.add(sub.accessionNumber);
            filingRows.push({
                accessionNumber: sub.accessionNumber,
                cik: normalizeCik(sub.cik),
                fundName: sub.cik, // Will be updated with fund names later if available
                filingDate: parseFilingDate(sub.filingDate),
                quarter,
            });
        }

        holdingRows.push({
            accessionNumber: sub.accessionNumber,
            cik: normalizeCik(sub.cik),
            fundName: sub.cik,
            filingDate: parseFilingDate(sub.filingDate),
            quarter,
            issuer: holding.issuer,
            cusip: holding.cusip || null,
            value: holding.value * 1000, // SEC reports value in thousands
            shares: holding.shares,
        });
    }

    console.log(`[TSV Ingest] Built ${filingRows.length} unique filings, ${holdingRows.length} holdings`);

    // 6. Read existing cache and merge
    const cachePath = getRadarMatchedRowsCachePath(currentQuarter, previousQuarter, { cacheRoot: CACHE_ROOT });

    let existingCache: RadarMatchedRowsCache;
    try {
        const cacheContent = await fs.readFile(cachePath, 'utf8');
        existingCache = JSON.parse(cacheContent) as RadarMatchedRowsCache;
    } catch {
        console.error(`[TSV Ingest] No existing cache found at ${cachePath}. Cannot merge.`);
        process.exit(1);
    }

    console.log(`[TSV Ingest] Existing cache: ${existingCache.filings.length} filings, ${existingCache.holdings.length} holdings`);

    // Filter to only Q1 data (the existing cache may have Q2 we want to keep)
    const q1Filings = filingRows.filter(f => f.quarter === '2026-Q1');
    const q1Holdings = holdingRows.filter(h => h.quarter === '2026-Q1');

    console.log(`[TSV Ingest] Q1 data to add: ${q1Filings.length} filings, ${q1Holdings.length} holdings`);

    // Dedupe by accession number
    const existingFilingAccessions = new Set(existingCache.filings.map(f => f.accessionNumber));
    const existingHoldingKeys = new Set(existingCache.holdings.map(h => `${h.accessionNumber}|${h.issuer}|${h.cusip}`));

    const newFilings = q1Filings.filter(f => !existingFilingAccessions.has(f.accessionNumber));
    const newHoldings = q1Holdings.filter(h => !existingHoldingKeys.has(`${h.accessionNumber}|${h.issuer}|${h.cusip}`));

    console.log(`[TSV Ingest] After deduplication: ${newFilings.length} new filings, ${newHoldings.length} new holdings`);

    // Merge
    const mergedFilings = [...existingCache.filings, ...newFilings];
    const mergedHoldings = [...existingCache.holdings, ...newHoldings];

    // Update availableQuarters to include Q1 if not present
    const availableQuarters = Array.from(new Set([...existingCache.availableQuarters, '2026-Q1']))
        .sort((a, b) => b.localeCompare(a));

    const mergedCache: RadarMatchedRowsCache = {
        ...existingCache,
        generatedAt: new Date().toISOString(),
        availableQuarters,
        filings: mergedFilings,
        holdings: mergedHoldings,
    };

    console.log(`[TSV Ingest] Merged cache: ${mergedFilings.length} filings, ${mergedHoldings.length} holdings`);

    if (dryRun) {
        console.log('[TSV Ingest] Dry run - not writing cache');

        // Show some sample Q1 holdings for verification
        const q1HoldingSample = newHoldings.slice(0, 10);
        console.log('\n[TSV Ingest] Sample Q1 holdings:');
        for (const h of q1HoldingSample) {
            console.log(`  ${h.issuer}: ${h.shares.toLocaleString()} shares, CIK ${h.cik}`);
        }
    } else {
        // Write atomically
        const tempPath = `${cachePath}.tmp`;
        fsSync.writeFileSync(tempPath, JSON.stringify(mergedCache, null, 2));
        fsSync.renameSync(tempPath, cachePath);
        console.log(`[TSV Ingest] Wrote merged cache to ${cachePath}`);
    }
}

function parseTsv<T>(content: string, rowMapper: (cols: string[], headers: string[]) => T): T[] {
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].split('\t');
    const rows: T[] = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        rows.push(rowMapper(cols, headers));
    }

    return rows;
}

function makeHeaderIndex(headers: string[]): Record<string, number> {
    const index: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
        index[headers[i].trim()] = i;
    }
    return index;
}

function parseQuarter(periodOfReport: string): string {
    // Format: "31-MAR-2026" -> "2026-Q1"
    const match = periodOfReport.match(/(\d{2})-([A-Z]{3})-(\d{4})/);
    if (!match) return '';

    const month = match[2];
    const year = match[3];

    const monthToQuarter: Record<string, string> = {
        'MAR': 'Q1',
        'JUN': 'Q2',
        'SEP': 'Q3',
        'DEC': 'Q4',
    };

    const quarter = monthToQuarter[month];
    return quarter ? `${year}-${quarter}` : '';
}

function parseFilingDate(filingDate: string): string {
    // Format: "31-MAR-2026" -> "2026-03-31"
    const match = filingDate.match(/(\d{2})-([A-Z]{3})-(\d{4})/);
    if (!match) return filingDate;

    const day = match[1];
    const month = match[2];
    const year = match[3];

    const monthToNum: Record<string, string> = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
        'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
        'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12',
    };

    const monthNum = monthToNum[month];
    return monthNum ? `${year}-${monthNum}-${day}` : filingDate;
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error('[TSV Ingest] Failed:', error);
        process.exit(1);
    });
}