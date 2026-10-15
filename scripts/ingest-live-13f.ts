/**
 * Live EDGAR 13F ingestion into the compact store (lib/thirteen-f-store.ts).
 *
 * Scans the quarterly master index, recent daily indexes and the current feed for 13F-HR / 13F-HR/A filings, then folds
 * each new filing into its filer's side of the stored pair: report quarter == stored current -> cur, == stored previous
 * -> prev (late filers). If --quarter is the quarter after the stored current one, the store rolls over first (after
 * archiving the outgoing pair's precomputed view to data/13f-precomputed/).
 *
 * Usage: npm run ingest:13f-live -- --quarter 2026-Q3 [--dry-run] [--limit 250] [--max-new-filings 200]
 *        [--concurrency 6] [--rate-limit-ms 110] [--current-feed-pages 5] [--daily-index-lookback-days 7]
 */
import * as dotenv from 'dotenv';
import {
    POSTGRES_13F_SIZE_TARGET_BYTES,
    assertPostgresWritable,
    createPostgresPool,
    getPostgresConnectionString,
    queryPostgresDatabaseSize,
} from '../lib/thirteen-f-radar-postgres';
import { compareQuartersAsc } from '../lib/thirteen-f-radar-core';
import {
    applyFilingToStore,
    ensureStoreSchema,
    markFilingSeen,
    queryAppliedAccessions,
    queryFilerSideFilingDate,
    compactStore,
    readStoreMeta,
    rolloverStore,
    touchStoreMeta,
    type StoreSide,
} from '../lib/thirteen-f-store';
import {
    fetchTextWithRetry,
    filingIndexQuarterForReportQuarter,
    getArg,
    hasArg,
    isDirectRun,
    normalizeCikForStorage,
    parseLive13FSubmissionText,
    previousReportQuarter,
    quarterFromReportDate,
    type HoldingInput,
} from './13f-ingestion-utils';

dotenv.config();

export interface IndexEntry {
    cik: string;
    name: string;
    form: string;
    date: string;
    filename: string;
}

interface ProcessedLiveFiling {
    accessionNumber: string;
    cik: string;
    fundName: string;
    form: string;
    filingDate: string;
    reportQuarter: string | null;
    amendmentType: string | null;
    holdings: HoldingInput[];
    errorMessage?: string;
}

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_RATE_LIMIT_MS = 110;
const CURRENT_FEED_PAGE_SIZE = 100;
const CURRENT_FEED_FORMS = ['13F-HR', '13F-HR/A'] as const;
// Touch f13_meta (which invalidates app-side directory caches) at least this often during long runs.
const META_TOUCH_EVERY = 200;
// Compact (rewrite) the store when it grows past this, well below the 480 MB budget.
const COMPACT_ABOVE_BYTES = 400 * 1024 * 1024;

async function main() {
    const quarter = getArg('--quarter');
    const dryRun = hasArg('--dry-run');
    const limit = Number.parseInt(getArg('--limit') || '', 10);
    const concurrency = positiveIntArg('--concurrency', DEFAULT_CONCURRENCY);
    const rateLimitMs = positiveIntArg('--rate-limit-ms', DEFAULT_RATE_LIMIT_MS);
    const dailyIndexLookbackDays = nonNegativeIntArg('--daily-index-lookback-days', 7);
    const currentFeedPages = nonNegativeIntArg('--current-feed-pages', 5);
    const maxNewFilings = positiveOptionalIntArg('--max-new-filings');

    if (!quarter) {
        console.error('Usage: npm run ingest:13f-live -- --quarter 2026-Q3 [--dry-run] [--limit 250] [--max-new-filings 200] [--concurrency 6] [--rate-limit-ms 110] [--current-feed-pages 5] [--daily-index-lookback-days 7]');
        process.exit(1);
    }
    if (!getPostgresConnectionString()) {
        console.error('Missing DATABASE_URL or POSTGRES_URL.');
        process.exit(1);
    }

    const pool = createPostgresPool();
    try {
        if (!dryRun) await assertPostgresWritable(pool, '13F Live EDGAR ingestion target');
        await ensureStoreSchema(pool);
        let meta = await readStoreMeta(pool);
        if (!meta) throw new Error('The 13F store is empty. Seed it with scripts/build-13f-store.ts from SEC bulk data first.');

        if (quarter !== meta.currentQuarter && previousReportQuarter(quarter) === meta.currentQuarter) {
            console.log(`[13F Live EDGAR] Rolling store forward: ${meta.currentQuarter} vs ${meta.previousQuarter} -> ${quarter} vs ${meta.currentQuarter}`);
            if (!dryRun) {
                // Archive the outgoing pair (default view + holder lists) before its previous quarter is dropped.
                const { precomputeStorePair } = await import('./precompute-13f-radar');
                await precomputeStorePair(pool, { archive: true });
                await rolloverStore(pool, quarter);
                meta = (await readStoreMeta(pool))!;
            }
        } else if (quarter !== meta.currentQuarter && quarter !== meta.previousQuarter) {
            throw new Error(`Store holds ${meta.currentQuarter} vs ${meta.previousQuarter}; --quarter ${quarter} is neither side nor the next quarter.`);
        }
        const sideForQuarter = (reportQuarter: string | null): StoreSide | null =>
            reportQuarter === (dryRun ? quarter : meta!.currentQuarter) ? 'cur'
                : reportQuarter === (dryRun ? previousReportQuarter(quarter) : meta!.previousQuarter) ? 'prev'
                    : null;

        // Scan the filing indexes for both stored quarters so late filers for the previous quarter are picked up.
        const indexQuarters = [quarter, previousReportQuarter(quarter)].map(filingIndexQuarterForReportQuarter);
        const indexUrls = [...new Set(indexQuarters.map((q) => masterIndexUrlFor(q.year, q.quarter)))];
        const indexSource = await loadLiveIndexEntries(indexUrls, { currentFeedPages, dailyIndexLookbackDays });
        const applied = await queryAppliedAccessions(pool);
        const pending = indexSource.entries.filter((entry) => !applied.has(accessionFromFilename(entry.filename)));
        const limitedEntries = Number.isFinite(limit) && limit > 0 ? pending.slice(0, limit) : pending;

        console.log(`[13F Live EDGAR] Store pair: ${meta.currentQuarter} vs ${meta.previousQuarter}`);
        console.log(`[13F Live EDGAR] Index entries: ${indexSource.masterCount} quarterly, ${indexSource.currentFeedCount} current feed, ${indexSource.dailyIndexCount} recent daily`);
        console.log(`[13F Live EDGAR] ${indexSource.entries.length} unique 13F-HR/13F-HR-A filings, ${applied.size} already applied, processing ${limitedEntries.length}`);

        const stats = {
            filingsSeen: limitedEntries.length,
            applied: 0,
            amendmentsAdded: 0,
            skippedFutureQuarter: 0,
            skippedWrongQuarter: 0,
            skippedNoHoldings: 0,
            skippedZeroValue: 0,
            skippedSuperseded: 0,
            skippedNoBase: 0,
            skippedErrors: 0,
            positionsWritten: 0,
        };

        // One worker handles all of a filer's filings, oldest first, so an amendment is never applied before its base.
        const byCik = new Map<string, IndexEntry[]>();
        for (const entry of limitedEntries) {
            const list = byCik.get(entry.cik) || [];
            list.push(entry);
            byCik.set(entry.cik, list);
        }
        const groups = Array.from(byCik.values()).map((list) =>
            list.sort((a, b) => a.date.localeCompare(b.date) || a.filename.localeCompare(b.filename))
        );

        const limiter = createRateLimiter(rateLimitMs);
        let nextGroup = 0;
        let completed = 0;
        let sinceTouch = 0;
        let writeChain = Promise.resolve();

        const skip = async (filing: ProcessedLiveFiling, reason: Exclude<keyof typeof stats, 'filingsSeen' | 'applied' | 'amendmentsAdded' | 'positionsWritten' | 'skippedErrors' | 'skippedFutureQuarter'>) => {
            stats[reason]++;
            if (!dryRun) await markFilingSeen(pool, filing.accessionNumber, filing.reportQuarter);
        };

        const applyProcessed = async (filing: ProcessedLiveFiling) => {
            const side = sideForQuarter(filing.reportQuarter);
            if (!side) {
                // Reports for a quarter newer than the stored pair are needed after the next rollover: don't mark them seen.
                const storedCurrent = dryRun ? quarter : meta!.currentQuarter;
                if (filing.reportQuarter && compareQuartersAsc(filing.reportQuarter, storedCurrent) > 0) {
                    stats.skippedFutureQuarter++;
                    return;
                }
                return skip(filing, 'skippedWrongQuarter');
            }
            const equityHoldings = filing.holdings.filter((h) => !h.putcall);
            const totalValue = filing.holdings.reduce((sum, h) => sum + (Number.isFinite(h.value) ? h.value : 0), 0);
            if (filing.holdings.length === 0) return skip(filing, 'skippedNoHoldings');
            // Placeholder filings with no reported value would otherwise wipe the filer's real holdings.
            if (totalValue <= 0) return skip(filing, 'skippedZeroValue');
            const mode = filing.amendmentType === 'NEW HOLDINGS' ? 'add' : 'replace';
            if (dryRun) {
                stats.applied++;
                return;
            }
            const sideDate = await queryFilerSideFilingDate(pool, filing.cik, side);
            if (mode === 'replace' && sideDate && filing.filingDate < sideDate) return skip(filing, 'skippedSuperseded');
            if (mode === 'add' && !sideDate) return skip(filing, 'skippedNoBase');
            const result = await applyFilingToStore(pool, {
                side,
                quarter: filing.reportQuarter!,
                cik: filing.cik,
                filerName: filing.fundName,
                accessionNumber: filing.accessionNumber,
                filingDate: filing.filingDate,
                mode,
                positions: equityHoldings.map((h) => ({
                    cusip: h.cusip,
                    issuer: h.issuer,
                    shares: h.shares,
                    value: h.value,
                    isPrn: (h.sshPrnamtType || '').toUpperCase() === 'PRN',
                })),
            });
            stats.positionsWritten += result.positions;
            if (mode === 'add') stats.amendmentsAdded++;
            else stats.applied++;
            if (++sinceTouch >= META_TOUCH_EVERY) {
                sinceTouch = 0;
                await touchStoreMeta(pool);
            }
        };

        const worker = async () => {
            while (true) {
                if (maxNewFilings && stats.applied + stats.amendmentsAdded >= maxNewFilings) return;
                const groupIndex = nextGroup++;
                if (groupIndex >= groups.length) return;
                for (const entry of groups[groupIndex]) {
                    const processed = await processLiveFiling(entry, limiter);
                    if (processed.errorMessage) {
                        stats.skippedErrors++;
                        console.warn(`\n[13F Live EDGAR] Skipped ${processed.accessionNumber}: ${processed.errorMessage}`);
                    } else {
                        // Writes are serialised; within a filer they run in filing-date order.
                        writeChain = writeChain.then(() => applyProcessed(processed));
                        await writeChain;
                    }
                    completed++;
                    if (completed % 25 === 0 || completed === limitedEntries.length) {
                        process.stdout.write(`\r[13F Live EDGAR] Processed ${completed}/${limitedEntries.length}`);
                    }
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, () => worker()));
        await writeChain;
        if (!dryRun) {
            await touchStoreMeta(pool);
            await pool.query('VACUUM ANALYZE f13_positions');
        }
        console.log('');
        console.table(stats);

        let size = await queryPostgresDatabaseSize(pool);
        console.log(`[13F Live EDGAR] Database size ${(size / 1048576).toFixed(1)} MB / target ${(POSTGRES_13F_SIZE_TARGET_BYTES / 1048576).toFixed(0)} MB`);
        if (!dryRun && size > COMPACT_ABOVE_BYTES) {
            // Upserts leave reusable-but-unreturned space; rewriting the store gives it back.
            console.log('[13F Live EDGAR] Compacting store...');
            await compactStore(pool);
            size = await queryPostgresDatabaseSize(pool);
            console.log(`[13F Live EDGAR] Database size after compaction ${(size / 1048576).toFixed(1)} MB`);
        }
        if (size > POSTGRES_13F_SIZE_TARGET_BYTES) {
            console.warn('[13F Live EDGAR] WARNING: database is over the size target.');
            process.exitCode = 2;
        }
        console.log(dryRun ? '[13F Live EDGAR] Dry run complete; no writes performed.' : '[13F Live EDGAR] Complete.');
    } finally {
        await pool.end();
    }
}

async function processLiveFiling(entry: IndexEntry, waitForRequestSlot: () => Promise<void>): Promise<ProcessedLiveFiling> {
    const accessionNumber = accessionFromFilename(entry.filename);
    const base = {
        accessionNumber,
        cik: normalizeCikForStorage(entry.cik),
        fundName: entry.name,
        form: entry.form,
        filingDate: entry.date,
    };
    try {
        await waitForRequestSlot();
        const submissionText = await fetchTextWithRetry(`https://www.sec.gov/Archives/${entry.filename}`, 3);
        const parsed = await parseLive13FSubmissionText(submissionText);
        return {
            ...base,
            reportQuarter: parsed.reportDate ? quarterFromReportDate(parsed.reportDate) : null,
            amendmentType: parsed.amendmentType,
            holdings: parsed.holdings,
        };
    } catch (error) {
        return { ...base, reportQuarter: null, amendmentType: null, holdings: [], errorMessage: errorMessage(error) };
    }
}

async function loadLiveIndexEntries(
    masterIndexUrls: string[],
    options: { currentFeedPages: number; dailyIndexLookbackDays: number }
): Promise<{
    entries: IndexEntry[];
    masterCount: number;
    currentFeedCount: number;
    dailyIndexCount: number;
}> {
    const masterEntries: IndexEntry[] = [];
    for (const url of masterIndexUrls) {
        try {
            masterEntries.push(...await downloadMasterIndex(url));
        } catch (error) {
            // The newest filing quarter's full index may not exist yet on its first day.
            console.warn(`[13F Live EDGAR] Quarterly index unavailable (${url}): ${errorMessage(error)}`);
        }
    }
    const currentFeedEntries = await downloadCurrentFeedEntries(options.currentFeedPages);
    const dailyEntries = await downloadRecentDailyIndexEntries(options.dailyIndexLookbackDays);
    return {
        entries: mergeIndexEntries([...currentFeedEntries, ...dailyEntries, ...masterEntries]),
        masterCount: masterEntries.length,
        currentFeedCount: currentFeedEntries.length,
        dailyIndexCount: dailyEntries.length,
    };
}

async function downloadMasterIndex(url: string): Promise<IndexEntry[]> {
    const content = await fetchTextWithRetry(url);
    return parseIndexContent(content);
}

function parseIndexContent(content: string): IndexEntry[] {
    const entries: IndexEntry[] = [];
    let processing = false;
    for (const line of content.split('\n')) {
        if (line.startsWith('-----------')) {
            processing = true;
            continue;
        }
        if (!processing) continue;
        const parts = line.split('|');
        if (parts.length < 5) continue;
        const form = parts[2].trim().toUpperCase();
        if (!['13F-HR', '13F-HR/A'].includes(form)) continue;
        entries.push({
            cik: normalizeCikForStorage(parts[0].trim()),
            name: parts[1].trim(),
            form,
            date: parts[3].trim(),
            filename: parts[4].trim(),
        });
    }
    return entries;
}

async function downloadCurrentFeedEntries(pageCount: number): Promise<IndexEntry[]> {
    if (pageCount <= 0) return [];
    const entries: IndexEntry[] = [];
    for (const form of CURRENT_FEED_FORMS) {
        for (let page = 0; page < pageCount; page += 1) {
            const url = currentFeedUrlFor(form, page * CURRENT_FEED_PAGE_SIZE);
            try {
                const xml = await fetchTextWithRetry(url, 3);
                const pageEntries = parseCurrentFeedEntries(xml);
                if (pageEntries.length === 0) break;
                entries.push(...pageEntries);
            } catch (error) {
                console.warn(`[13F Live EDGAR] Current feed unavailable for ${form} page ${page + 1}: ${errorMessage(error)}`);
                break;
            }
        }
    }
    return mergeIndexEntries(entries);
}

async function downloadRecentDailyIndexEntries(lookbackDays: number): Promise<IndexEntry[]> {
    if (lookbackDays <= 0) return [];
    const entries: IndexEntry[] = [];
    for (const url of dailyMasterIndexUrlsForRecentDays(lookbackDays)) {
        try {
            entries.push(...await downloadMasterIndex(url));
        } catch {
            // Weekends and holidays have no daily index.
        }
    }
    return mergeIndexEntries(entries);
}

export function parseCurrentFeedEntries(xml: string): IndexEntry[] {
    const entries: IndexEntry[] = [];
    const entryPattern = /<entry>([\s\S]*?)<\/entry>/gi;
    let match: RegExpExecArray | null;
    while ((match = entryPattern.exec(xml)) !== null) {
        const entryXml = match[1];
        const title = decodeXmlEntities(extractXmlText(entryXml, 'title'));
        const href = extractHref(entryXml);
        const date = extractFiledDate(entryXml);
        const titleMatch = title.match(/^(13F-HR\/A|13F-HR)\s+-\s+(.+)\s+\((\d{10})\)\s+\(Filer\)/i);
        const filename = href ? filenameFromCurrentFeedIndexLink(href) : null;
        if (!titleMatch || !filename || !date) continue;
        entries.push({
            cik: normalizeCikForStorage(titleMatch[3]),
            name: titleMatch[2].trim(),
            form: titleMatch[1].toUpperCase(),
            date,
            filename,
        });
    }
    return entries;
}

export function mergeIndexEntries(entries: IndexEntry[]): IndexEntry[] {
    const byAccession = new Map<string, IndexEntry>();
    for (const entry of entries) {
        const accession = accessionFromFilename(entry.filename);
        if (!accession || byAccession.has(accession)) continue;
        byAccession.set(accession, entry);
    }
    return Array.from(byAccession.values());
}

export function dailyMasterIndexUrlsForRecentDays(days: number, asOf = new Date()): string[] {
    const urls: string[] = [];
    for (let offset = 0; offset < days; offset += 1) {
        const date = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate() - offset));
        const year = date.getUTCFullYear();
        const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
        const dateKey = [
            String(year),
            String(date.getUTCMonth() + 1).padStart(2, '0'),
            String(date.getUTCDate()).padStart(2, '0'),
        ].join('');
        urls.push(`https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${quarter}/master.${dateKey}.idx`);
    }
    return urls;
}

function masterIndexUrlFor(year: number, quarter: number): string {
    return `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${quarter}/master.idx`;
}

function accessionFromFilename(filename: string): string {
    return filename.split('/').pop()?.replace(/\.txt$/i, '') || filename;
}

function currentFeedUrlFor(form: string, start: number): string {
    const params = new URLSearchParams({
        action: 'getcurrent',
        type: form,
        owner: 'include',
        count: String(CURRENT_FEED_PAGE_SIZE),
        start: String(start),
        output: 'atom',
    });
    return `https://www.sec.gov/cgi-bin/browse-edgar?${params.toString()}`;
}

function filenameFromCurrentFeedIndexLink(href: string): string | null {
    const url = new URL(href, 'https://www.sec.gov');
    const archivePrefix = '/Archives/';
    if (!url.pathname.startsWith(archivePrefix)) return null;
    const archivePath = url.pathname.slice(archivePrefix.length);
    if (!/-index\.htm$/i.test(archivePath)) return null;
    return archivePath.replace(/-index\.htm$/i, '.txt');
}

function extractXmlText(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match?.[1]?.trim() || '';
}

function extractHref(xml: string): string | null {
    return xml.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || null;
}

function extractFiledDate(xml: string): string | null {
    return decodeXmlEntities(xml).match(/Filed:<\/b>\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || null;
}

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function positiveIntArg(name: string, fallback: number): number {
    const value = Number.parseInt(getArg(name) || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveOptionalIntArg(name: string): number | null {
    const value = Number.parseInt(getArg(name) || '', 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeIntArg(name: string, fallback: number): number {
    const value = Number.parseInt(getArg(name) || '', 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createRateLimiter(delayMs: number) {
    let nextAllowedAt = 0;
    return async () => {
        const now = Date.now();
        const waitMs = Math.max(0, nextAllowedAt - now);
        nextAllowedAt = Math.max(now, nextAllowedAt) + delayMs;
        if (waitMs > 0) await sleep(waitMs);
    };
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
