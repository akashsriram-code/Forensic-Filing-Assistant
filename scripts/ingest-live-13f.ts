import { createClient, type InValue } from '@libsql/client';
import * as dotenv from 'dotenv';
import {
    completePostgresIngestionRun,
    createPostgresPool,
    dropPostgres13FIndexes,
    ensurePostgres13FIndexes,
    ensurePostgres13FSchema,
    failPostgresIngestionRun,
    getPostgresConnectionString,
    queryPostgresExistingAccessions,
    replacePostgres13FHoldings,
    retainPostgres13FQuarters,
    startPostgresIngestionRun,
    upsertPostgres13FFilings,
    type Postgres13FFilingInput,
    type Postgres13FHoldingInput,
} from '../lib/thirteen-f-radar-postgres';
import {
    batchWithRetry,
    chunkRows,
    completeIngestionRun,
    ensure13FSchema,
    ensureRequired13FIndexes,
    executeWithArgsRetry,
    failIngestionRun,
    fetchTextWithRetry,
    filingIndexQuarterForReportQuarter,
    getArg,
    hasArg,
    isDirectRun,
    normalizeCikForStorage,
    parseLive13FSubmissionText,
    previousReportQuarter,
    quarterFromReportDate,
    resolveIngestionTargetProvider,
    startIngestionRun,
    dropHoldingSearchIndexes,
    type HoldingInput,
    type IngestionTargetProvider,
} from './13f-ingestion-utils';

dotenv.config();

interface IndexEntry {
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
    reportDate: string;
    holdings: HoldingInput[];
    skippedReason?: string;
    errorMessage?: string;
}

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_RATE_LIMIT_MS = 110;
const DEFAULT_WRITE_BATCH_SIZE = 5;
const DEFAULT_HOLDING_INSERT_CHUNK_SIZE = 100;
const MAX_HOLDING_INSERT_CHUNK_SIZE = 100;
const MAX_POSTGRES_HOLDING_INSERT_CHUNK_SIZE = 1000;
const HOLDING_INSERT_STATEMENTS_PER_BATCH = 25;

type LiveDbTarget =
    | { provider: 'turso'; client: ReturnType<typeof createClient> }
    | { provider: 'postgres'; pool: ReturnType<typeof createPostgresPool> };

async function main() {
    const quarter = getArg('--quarter');
    const targetProvider = resolveIngestionTargetProvider();
    const dryRun = hasArg('--dry-run');
    const refreshExisting = hasArg('--refresh-existing');
    const rebuildSearchIndexes = hasArg('--rebuild-search-indexes');
    const limit = Number.parseInt(getArg('--limit') || '', 10);
    const concurrency = positiveIntArg('--concurrency', DEFAULT_CONCURRENCY);
    const rateLimitMs = positiveIntArg('--rate-limit-ms', DEFAULT_RATE_LIMIT_MS);
    const writeBatchSize = positiveIntArg('--write-batch-size', DEFAULT_WRITE_BATCH_SIZE);
    const requestedHoldingInsertChunkSize = positiveIntArg('--holding-insert-chunk-size', DEFAULT_HOLDING_INSERT_CHUNK_SIZE);
    const holdingInsertChunkSize = Math.min(
        requestedHoldingInsertChunkSize,
        maxHoldingInsertChunkSizeFor(targetProvider)
    );
    const maxNewFilings = positiveOptionalIntArg('--max-new-filings');

    if (!quarter) {
        console.error('Usage: npm run ingest:13f-live -- --quarter 2026-Q1 [--target turso|postgres] [--dry-run] [--refresh-existing] [--rebuild-search-indexes] [--limit 250] [--max-new-filings 200] [--concurrency 6] [--rate-limit-ms 110] [--write-batch-size 5] [--holding-insert-chunk-size 100]');
        process.exit(1);
    }
    if (!dryRun && targetProvider === 'turso' && (!TURSO_URL || !TURSO_TOKEN)) {
        console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.');
        process.exit(1);
    }
    if (!dryRun && targetProvider === 'postgres' && !getPostgresConnectionString()) {
        console.error('Missing DATABASE_URL or POSTGRES_URL for Postgres ingestion.');
        process.exit(1);
    }

    const filingIndex = filingIndexQuarterForReportQuarter(quarter);
    const masterIndexUrl = masterIndexUrlFor(filingIndex.year, filingIndex.quarter);
    const entries = await downloadMasterIndex(masterIndexUrl);
    const limitedEntries = Number.isFinite(limit) && limit > 0 ? entries.slice(0, limit) : entries;

    console.log(`[13F Live EDGAR] Target report quarter: ${quarter}`);
    console.log(`[13F Live EDGAR] Target database: ${targetProvider}`);
    console.log(`[13F Live EDGAR] Scanning ${masterIndexUrl}`);
    console.log(`[13F Live EDGAR] Found ${entries.length} 13F-HR/13F-HR-A filings; processing ${limitedEntries.length}`);
    console.log(`[13F Live EDGAR] Fast mode: fetch submission .txt once per filing.`);
    console.log(`[13F Live EDGAR] Concurrency ${concurrency}, global SEC request spacing ${rateLimitMs}ms, write batch ${writeBatchSize}, holding chunk ${holdingInsertChunkSize}`);
    if (requestedHoldingInsertChunkSize !== holdingInsertChunkSize) {
        console.log(`[13F Live EDGAR] Holding chunk capped at ${holdingInsertChunkSize} to stay below SQLite bind limits.`);
    }
    if (maxNewFilings) console.log(`[13F Live EDGAR] Stop after roughly ${maxNewFilings} new matching filings.`);

    let target: LiveDbTarget | null = null;
    let existingAccessions = new Set<string>();
    let runId: string | null = null;
    if (!dryRun) {
        target = await createLiveTarget(targetProvider);
        if (hasArg('--skip-schema')) {
            console.log('[13F Live EDGAR] Skipping schema setup.');
        } else {
            await ensureLiveTargetSchema(target);
        }
        if (rebuildSearchIndexes) await dropLiveTargetIndexes(target);
        else await ensureLiveTargetIndexes(target);
        if (!refreshExisting) {
            existingAccessions = await queryExistingAccessions(target, quarter);
            console.log(`[13F Live EDGAR] ${existingAccessions.size} existing accessions for ${quarter}; use --refresh-existing to replace them.`);
        }
        runId = await startLiveIngestionRun(target, quarter, masterIndexUrl);
    }

    const stats = {
        filingsSeen: limitedEntries.length,
        reportQuarterMatches: 0,
        skippedExisting: 0,
        skippedWrongQuarter: 0,
        skippedNoHoldings: 0,
        skippedErrors: 0,
        filingsUpserted: 0,
        holdingsInserted: 0,
    };

    try {
        const limiter = createRateLimiter(rateLimitMs);
        const writeBuffer: ProcessedLiveFiling[] = [];
        let writeChain = Promise.resolve();
        let nextIndex = 0;
        let completed = 0;

        const flushBufferedWrites = async (force = false) => {
            if (dryRun || !target) return;
            if (writeBuffer.length === 0) return;
            if (!force && writeBuffer.length < writeBatchSize) return;
            const batch = writeBuffer.splice(0, writeBuffer.length);
            writeChain = writeChain.then(async () => {
                const holdingCount = batch.reduce((sum, filing) => sum + filing.holdings.length, 0);
                console.log(`\n[13F Live EDGAR] Writing ${batch.length} filing(s), ${holdingCount} holding row(s)...`);
                const result = await replaceLiveFilings(target!, batch, holdingInsertChunkSize);
                stats.filingsUpserted += result.filings;
                stats.holdingsInserted += result.holdings;
                console.log(`[13F Live EDGAR] Wrote ${result.filings} filing(s), ${result.holdings} holding row(s).`);
            });
            await writeChain;
        };

        const worker = async () => {
            while (true) {
                if (maxNewFilings && stats.reportQuarterMatches >= maxNewFilings) return;
                const index = nextIndex++;
                if (index >= limitedEntries.length) return;
                const entry = limitedEntries[index];
                const accessionNumber = accessionFromFilename(entry.filename);
                if (!refreshExisting && existingAccessions.has(accessionNumber)) {
                    stats.skippedExisting++;
                } else {
                    const processed = await processLiveFiling(entry, quarter, limiter);
                    if (processed.skippedReason === 'wrong-quarter') {
                        stats.skippedWrongQuarter++;
                    } else if (processed.skippedReason === 'no-holdings') {
                        stats.skippedNoHoldings++;
                    } else if (processed.skippedReason === 'error') {
                        stats.skippedErrors++;
                        console.warn(`\n[13F Live EDGAR] Skipped ${processed.accessionNumber}: ${processed.errorMessage || 'unknown error'}`);
                    } else if (processed.holdings.length > 0) {
                        stats.reportQuarterMatches++;
                        if (!dryRun && target) {
                            writeBuffer.push(processed);
                            await flushBufferedWrites(false);
                        } else {
                            stats.holdingsInserted += processed.holdings.length;
                        }
                    }
                }

                completed++;
                if (completed % 25 === 0 || completed === limitedEntries.length) {
                    process.stdout.write(`\r[13F Live EDGAR] Processed ${completed}/${limitedEntries.length}`);
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(concurrency, limitedEntries.length) }, () => worker()));
        await flushBufferedWrites(true);
        console.log('');
        console.table(stats);

        if (!dryRun && target && runId) {
            await completeLiveIngestionRun(target, runId, {
                filingsSeen: stats.filingsSeen,
                filingsUpserted: stats.filingsUpserted,
                holdingsInserted: stats.holdingsInserted,
                reportQuarterMatches: stats.reportQuarterMatches,
                skippedExisting: stats.skippedExisting,
                skippedWrongQuarter: stats.skippedWrongQuarter,
                skippedNoHoldings: stats.skippedNoHoldings,
                skippedErrors: stats.skippedErrors,
            });
            await retainLiveTargetQuarters(target, quarter);
        }

        console.log(dryRun ? `[13F Live EDGAR] Dry run complete; no ${targetProvider} writes performed.` : '[13F Live EDGAR] Complete.');
    } catch (error) {
        if (!dryRun && target && runId) await failLiveIngestionRun(target, runId, error);
        throw error;
    } finally {
        if (!dryRun && target && rebuildSearchIndexes) {
            console.log('[13F Live EDGAR] Rebuilding required 13F indexes...');
            await ensureLiveTargetIndexes(target);
        }
        if (target?.provider === 'postgres') await target.pool.end();
    }
}

async function processLiveFiling(
    entry: IndexEntry,
    targetQuarter: string,
    waitForRequestSlot: () => Promise<void>
): Promise<ProcessedLiveFiling> {
    const accessionNumber = accessionFromFilename(entry.filename);
    const submissionUrl = `https://www.sec.gov/Archives/${entry.filename}`;
    let parsed;
    try {
        await waitForRequestSlot();
        const submissionText = await fetchTextWithRetry(submissionUrl, 3);
        parsed = await parseLive13FSubmissionText(submissionText);
    } catch (error) {
        return {
            accessionNumber,
            cik: normalizeCikForStorage(entry.cik),
            fundName: entry.name,
            form: entry.form,
            filingDate: entry.date,
            reportDate: '',
            holdings: [],
            skippedReason: 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
        };
    }
    const reportDate = parsed.reportDate;
    const holdings = parsed.holdings;

    const reportQuarter = reportDate ? quarterFromReportDate(reportDate) : null;
    const skippedReason =
        reportQuarter !== targetQuarter
            ? 'wrong-quarter'
            : holdings.length === 0
                ? 'no-holdings'
                : undefined;

    return {
        accessionNumber,
        cik: normalizeCikForStorage(entry.cik),
        fundName: entry.name,
        form: entry.form,
        filingDate: entry.date,
        reportDate: reportDate || '',
        holdings,
        skippedReason,
    };
}

async function createLiveTarget(provider: IngestionTargetProvider): Promise<LiveDbTarget> {
    if (provider === 'postgres') {
        return { provider, pool: createPostgresPool() };
    }
    return { provider, client: createClient({ url: TURSO_URL!, authToken: TURSO_TOKEN! }) };
}

async function ensureLiveTargetSchema(target: LiveDbTarget) {
    if (target.provider === 'postgres') await ensurePostgres13FSchema(target.pool);
    else await ensure13FSchema(target.client);
}

async function ensureLiveTargetIndexes(target: LiveDbTarget) {
    if (target.provider === 'postgres') await ensurePostgres13FIndexes(target.pool);
    else await ensureRequired13FIndexes(target.client);
}

async function dropLiveTargetIndexes(target: LiveDbTarget) {
    if (target.provider === 'postgres') await dropPostgres13FIndexes(target.pool);
    else await dropHoldingSearchIndexes(target.client);
}

async function startLiveIngestionRun(target: LiveDbTarget, quarter: string, sourceUrl: string): Promise<string> {
    if (target.provider === 'postgres') {
        return startPostgresIngestionRun(target.pool, { quarter, source: 'live-edgar', sourceUrl });
    }
    return startIngestionRun(target.client, { quarter, source: 'live-edgar', sourceUrl });
}

async function completeLiveIngestionRun(
    target: LiveDbTarget,
    runId: string,
    counts: Parameters<typeof completeIngestionRun>[2]
) {
    if (target.provider === 'postgres') await completePostgresIngestionRun(target.pool, runId, counts);
    else await completeIngestionRun(target.client, runId, counts);
}

async function failLiveIngestionRun(target: LiveDbTarget, runId: string, error: unknown) {
    if (target.provider === 'postgres') await failPostgresIngestionRun(target.pool, runId, error);
    else await failIngestionRun(target.client, runId, error);
}

async function retainLiveTargetQuarters(target: LiveDbTarget, quarter: string) {
    if (target.provider !== 'postgres' || hasArg('--keep-all-quarters')) return;
    await retainPostgres13FQuarters(target.pool, [quarter, previousReportQuarter(quarter)]);
}

async function replaceLiveFilings(
    target: LiveDbTarget,
    filings: ProcessedLiveFiling[],
    holdingInsertChunkSize: number
): Promise<{ filings: number; holdings: number }> {
    if (target.provider === 'postgres') {
        return replacePostgresLiveFilings(target.pool, filings, holdingInsertChunkSize);
    }
    return replaceTursoLiveFilings(target.client, filings, holdingInsertChunkSize);
}

async function replaceTursoLiveFilings(
    turso: ReturnType<typeof createClient>,
    filings: ProcessedLiveFiling[],
    holdingInsertChunkSize: number
): Promise<{ filings: number; holdings: number }> {
    if (filings.length === 0) return { filings: 0, holdings: 0 };
    const ingestedAt = new Date().toISOString();
    await batchWithRetry(turso, filings.flatMap((filing) => [
            {
                sql: 'INSERT OR IGNORE INTO funds (cik, name, ticker) VALUES (?, ?, ?)',
                args: [filing.cik, filing.fundName, null],
            },
            {
                sql: `
                    INSERT OR REPLACE INTO filings
                        (accession_number, cik, filing_date, quarter, form, report_date, source, ingested_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
                args: [
                    filing.accessionNumber,
                    filing.cik,
                    filing.filingDate,
                    quarterFromReportDate(filing.reportDate) || '',
                    filing.form,
                    filing.reportDate,
                    'live-edgar',
                    ingestedAt,
                ],
            },
        ]));

    for (const chunk of chunkRows(filings.map((filing) => filing.accessionNumber), 300)) {
        const placeholders = chunk.map(() => '?').join(', ');
        await executeWithArgsRetry(turso, `DELETE FROM holdings WHERE accession_number IN (${placeholders})`, chunk);
    }

    const holdings = filings.flatMap((filing) =>
        filing.holdings.map((holding) => ({ filing, holding }))
    );
    const insertStatements: Array<{ sql: string; args: InValue[] }> = [];
    for (const chunk of chunkRows(holdings, holdingInsertChunkSize)) {
        const placeholders: string[] = [];
        const args: InValue[] = [];
        for (const { filing, holding } of chunk) {
            placeholders.push('(?, ?, ?, ?, ?, ?, ?)');
            args.push(
                filing.accessionNumber,
                holding.issuer,
                holding.cusip,
                holding.value,
                holding.shares,
                holding.putcall,
                holding.sshPrnamtType
            );
        }
        insertStatements.push({
            sql: `
                INSERT INTO holdings
                    (accession_number, issuer, cusip, value, shares, putcall, ssh_prnamt_type)
                VALUES ${placeholders.join(', ')}
            `,
            args,
        });
    }
    for (const group of chunkRows(insertStatements, HOLDING_INSERT_STATEMENTS_PER_BATCH)) {
        await batchStatementGroup(turso, group);
    }

    return { filings: filings.length, holdings: holdings.length };
}

async function replacePostgresLiveFilings(
    pool: ReturnType<typeof createPostgresPool>,
    filings: ProcessedLiveFiling[],
    holdingInsertChunkSize: number
): Promise<{ filings: number; holdings: number }> {
    if (filings.length === 0) return { filings: 0, holdings: 0 };
    const pgFilings: Postgres13FFilingInput[] = filings.map((filing) => ({
        accessionNumber: filing.accessionNumber,
        cik: filing.cik,
        fundName: filing.fundName,
        filingDate: filing.filingDate,
        quarter: quarterFromReportDate(filing.reportDate) || '',
        form: filing.form,
        reportDate: filing.reportDate,
        source: 'live-edgar',
    }));
    await upsertPostgres13FFilings(pool, pgFilings);

    const holdings: Postgres13FHoldingInput[] = filings.flatMap((filing) =>
        filing.holdings.map((holding) => ({
            accessionNumber: filing.accessionNumber,
            issuer: holding.issuer,
            cusip: holding.cusip,
            value: holding.value,
            shares: holding.shares,
            putcall: holding.putcall,
            sshPrnamtType: holding.sshPrnamtType,
        }))
    );
    const inserted = await replacePostgres13FHoldings(pool, {
        accessions: filings.map((filing) => filing.accessionNumber),
        holdings,
        holdingInsertChunkSize,
    });

    return { filings: pgFilings.length, holdings: inserted };
}

async function batchStatementGroup(
    turso: ReturnType<typeof createClient>,
    statements: Array<{ sql: string; args: InValue[] }>
) {
    if (statements.length === 0) return;
    try {
        await batchWithRetry(turso, statements, 3);
    } catch (error) {
        if (statements.length === 1) throw error;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[13F Live EDGAR] Insert batch of ${statements.length} statements failed (${message}); splitting.`);
        const midpoint = Math.ceil(statements.length / 2);
        await batchStatementGroup(turso, statements.slice(0, midpoint));
        await batchStatementGroup(turso, statements.slice(midpoint));
    }
}

async function queryExistingAccessions(target: LiveDbTarget, quarter: string): Promise<Set<string>> {
    if (target.provider === 'postgres') return queryPostgresExistingAccessions(target.pool, quarter);

    const result = await target.client.execute({
        sql: 'SELECT accession_number FROM filings WHERE quarter = ?',
        args: [quarter],
    });
    return new Set(result.rows.map((row) => String(row.accession_number)));
}

async function downloadMasterIndex(url: string): Promise<IndexEntry[]> {
    const content = await fetchTextWithRetry(url);
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

function masterIndexUrlFor(year: number, quarter: number): string {
    return `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${quarter}/master.idx`;
}

function accessionFromFilename(filename: string): string {
    return filename.split('/').pop()?.replace(/\.txt$/i, '') || filename;
}

function positiveIntArg(name: string, fallback: number): number {
    const value = Number.parseInt(getArg(name) || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveOptionalIntArg(name: string): number | null {
    const value = Number.parseInt(getArg(name) || '', 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function maxHoldingInsertChunkSizeFor(provider: IngestionTargetProvider): number {
    return provider === 'postgres' ? MAX_POSTGRES_HOLDING_INSERT_CHUNK_SIZE : MAX_HOLDING_INSERT_CHUNK_SIZE;
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
