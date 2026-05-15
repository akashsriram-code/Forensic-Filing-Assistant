import { createClient, type InValue } from '@libsql/client';
import JSZip from 'jszip';
import * as dotenv from 'dotenv';
import { DEFAULT_RADAR_WATCHLISTS, compactIssuerName, normalizeIssuerName } from '../lib/thirteen-f-radar-core';
import {
    assertPostgresWritable,
    completePostgresIngestionRun,
    createPostgresPool,
    dropPostgres13FIndexes,
    ensurePostgres13FIndexes,
    ensurePostgres13FSchema,
    failPostgresIngestionRun,
    getPostgresConnectionString,
    replacePostgres13FHoldings,
    retainPostgres13FQuarters,
    startPostgresIngestionRun,
    upsertPostgres13FFilings,
    type Postgres13FFilingInput,
    type Postgres13FHoldingInput,
} from '../lib/thirteen-f-radar-postgres';
import {
    batchWithRetry,
    buildReportQuarterDistribution,
    chunkRows,
    completeIngestionRun,
    ensure13FSchema,
    ensureRequired13FIndexes,
    dropHoldingSearchIndexes,
    executeWithArgsRetry,
    failIngestionRun,
    getArg,
    hasArg,
    isDirectRun,
    normalizeCikForStorage,
    normalizeSecDate,
    parseNumber,
    parseTsv,
    previousReportQuarter,
    quarterEndDateString,
    resolveIngestionTargetProvider,
    resolveSecDatasetUrlForQuarter,
    selectSecDatasetSubmissionsForQuarter,
    startIngestionRun,
    type TsvRow,
    type IngestionTargetProvider,
} from './13f-ingestion-utils';

dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const HOLDING_INSERT_CHUNK_SIZE = 100;
const POSTGRES_HOLDING_INSERT_CHUNK_SIZE = 1000;
const HOLDING_INSERT_STATEMENTS_PER_BATCH = 25;

type SecDbTarget =
    | { provider: 'turso'; client: ReturnType<typeof createClient> }
    | { provider: 'postgres'; pool: ReturnType<typeof createPostgresPool> };

async function main() {
    const quarter = getArg('--quarter');
    const requestedUrl = getArg('--url');
    const targetProvider = resolveIngestionTargetProvider();
    const dryRun = hasArg('--dry-run');
    const rebuildSearchIndexes = hasArg('--rebuild-search-indexes');

    if (!quarter) {
        console.error('Usage: npm run ingest:13f-sec -- --quarter 2026-Q1 [--target turso|postgres] [--url <SEC_13F_ZIP_URL>] [--dry-run] [--rebuild-search-indexes]');
        process.exit(1);
    }

    const url = requestedUrl || (await resolveSecDatasetUrlForQuarter(quarter)).url;
    if (!url) {
        console.error(`[13F SEC Dataset] No SEC Form 13F Data Set ZIP found for ${quarter}.`);
        process.exit(2);
    }

    if (!dryRun && targetProvider === 'turso' && (!TURSO_URL || !TURSO_TOKEN)) {
        console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.');
        process.exit(1);
    }
    if (!dryRun && targetProvider === 'postgres' && !getPostgresConnectionString()) {
        console.error('Missing DATABASE_URL or POSTGRES_URL for Postgres ingestion.');
        process.exit(1);
    }

    console.log(`[13F SEC Dataset] Downloading ${url}`);
    const response = await fetch(url, {
        headers: { 'User-Agent': process.env.SEC_USER_AGENT || 'ForensicAnalyzer contact@example.com' },
    });
    if (!response.ok) throw new Error(`SEC dataset download failed: HTTP ${response.status}`);
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    const submissionFile = findZipEntry(zip, 'SUBMISSION');
    const coverPageFile = findZipEntry(zip, 'COVERPAGE');
    const infoTableFile = findZipEntry(zip, 'INFOTABLE');

    if (!submissionFile || !infoTableFile) {
        throw new Error('SEC ZIP did not contain SUBMISSION and INFOTABLE files.');
    }

    const submissions = parseTsv(await submissionFile.async('string'));
    const coverPages = coverPageFile ? parseTsv(await coverPageFile.async('string')) : [];
    const infoTables = parseTsv(await infoTableFile.async('string'));
    const all13FSubmissions = submissions.filter((row) =>
        ['13F-HR', '13F-HR/A'].includes((row.SUBMISSIONTYPE || '').toUpperCase())
    );
    const eligibleSubmissions = selectSecDatasetSubmissionsForQuarter(submissions, quarter);
    const eligibleAccessions = new Set(eligibleSubmissions.map((row) => row.ACCESSION_NUMBER));
    const managerByAccession = new Map(
        coverPages.map((row) => [row.ACCESSION_NUMBER, row.FILINGMANAGER_NAME || row.FILING_MANAGER_NAME || ''])
    );
    const submissionByAccession = new Map(eligibleSubmissions.map((row) => [row.ACCESSION_NUMBER, row]));
    const watchlistOnly = hasArg('--watchlist-only');
    const watchlistAliases = buildWatchlistAliases();
    const holdingsToInsert = infoTables.filter((row) => {
        if (!eligibleAccessions.has(row.ACCESSION_NUMBER)) return false;
        if (!watchlistOnly) return true;
        return issuerMatchesWatchlist(row.NAMEOFISSUER || '', watchlistAliases);
    });

    console.log(`[13F SEC Dataset] Report quarter target: ${quarter} (${quarterEndDateString(quarter)})`);
    console.log(`[13F SEC Dataset] Target database: ${targetProvider}`);
    console.log(`[13F SEC Dataset] Report-date distribution in holdings-report submissions:`);
    console.table(buildReportQuarterDistribution(all13FSubmissions));
    console.log(`[13F SEC Dataset] ${eligibleSubmissions.length}/${all13FSubmissions.length} holdings-report submissions retained for ${quarter}`);
    console.log(`[13F SEC Dataset] ${holdingsToInsert.length}/${infoTables.length} information-table rows retained`);

    if (watchlistOnly) {
        console.warn('[13F SEC Dataset] --watchlist-only is enabled. Full-universe ingestion is the recommended production path.');
    }

    if (dryRun) {
        console.log(`[13F SEC Dataset] Dry run complete; no ${targetProvider} writes performed.`);
        return;
    }

    const target = await createSecTarget(targetProvider);
    if (hasArg('--skip-schema')) {
        console.log('[13F SEC Dataset] Skipping schema setup.');
    } else {
        await ensureSecTargetSchema(target);
    }
    if (rebuildSearchIndexes) {
        console.log('[13F SEC Dataset] Dropping holdings search indexes for bulk load...');
        await dropSecTargetIndexes(target);
    } else {
        await ensureSecTargetIndexes(target);
    }

    const runId = await startSecIngestionRun(target, quarter, url);
    try {
        const filingsUpserted = await upsertFilings({
            target,
            quarter,
            submissions: eligibleSubmissions,
            managerByAccession,
            holdingsOnly: hasArg('--holdings-only'),
        });
        const holdingsInserted = await replaceHoldings({
            target,
            accessions: Array.from(eligibleAccessions),
            infoTables: holdingsToInsert,
            submissionByAccession,
        });

        await completeSecIngestionRun(target, runId, {
            filingsSeen: eligibleSubmissions.length,
            filingsUpserted,
            holdingsInserted,
            reportQuarterMatches: eligibleSubmissions.length,
            skippedWrongQuarter: Math.max(0, all13FSubmissions.length - eligibleSubmissions.length),
        });
        await retainSecTargetQuarters(target, quarter);
        console.log('\n[13F SEC Dataset] Complete.');
    } catch (error) {
        try {
            await failSecIngestionRun(target, runId, error);
        } catch (failError) {
            console.warn(`[13F SEC Dataset] Could not mark ingestion run as failed: ${errorMessage(failError)}`);
        }
        throw error;
    } finally {
        if (rebuildSearchIndexes) {
            console.log('[13F SEC Dataset] Rebuilding required 13F indexes...');
            await ensureSecTargetIndexes(target);
        }
        if (target.provider === 'postgres') await target.pool.end();
    }
}

async function createSecTarget(provider: IngestionTargetProvider): Promise<SecDbTarget> {
    if (provider === 'postgres') {
        const pool = createPostgresPool();
        try {
            await assertPostgresWritable(pool, '13F SEC dataset ingestion target');
        } catch (error) {
            await pool.end();
            throw error;
        }
        return { provider, pool };
    }
    return { provider, client: createClient({ url: TURSO_URL!, authToken: TURSO_TOKEN! }) };
}

async function ensureSecTargetSchema(target: SecDbTarget) {
    if (target.provider === 'postgres') await ensurePostgres13FSchema(target.pool);
    else await ensure13FSchema(target.client);
}

async function ensureSecTargetIndexes(target: SecDbTarget) {
    if (target.provider === 'postgres') await ensurePostgres13FIndexes(target.pool);
    else await ensureRequired13FIndexes(target.client);
}

async function dropSecTargetIndexes(target: SecDbTarget) {
    if (target.provider === 'postgres') await dropPostgres13FIndexes(target.pool);
    else await dropHoldingSearchIndexes(target.client);
}

async function startSecIngestionRun(target: SecDbTarget, quarter: string, sourceUrl: string): Promise<string> {
    if (target.provider === 'postgres') {
        return startPostgresIngestionRun(target.pool, { quarter, source: 'sec-bulk', sourceUrl });
    }
    return startIngestionRun(target.client, { quarter, source: 'sec-bulk', sourceUrl });
}

async function completeSecIngestionRun(
    target: SecDbTarget,
    runId: string,
    counts: Parameters<typeof completeIngestionRun>[2]
) {
    if (target.provider === 'postgres') await completePostgresIngestionRun(target.pool, runId, counts);
    else await completeIngestionRun(target.client, runId, counts);
}

async function failSecIngestionRun(target: SecDbTarget, runId: string, error: unknown) {
    if (target.provider === 'postgres') await failPostgresIngestionRun(target.pool, runId, error);
    else await failIngestionRun(target.client, runId, error);
}

async function retainSecTargetQuarters(target: SecDbTarget, quarter: string) {
    if (target.provider !== 'postgres' || hasArg('--keep-all-quarters')) return;
    await retainPostgres13FQuarters(target.pool, [quarter, previousReportQuarter(quarter)]);
}

async function upsertFilings(params: {
    target: SecDbTarget;
    quarter: string;
    submissions: TsvRow[];
    managerByAccession: Map<string, string>;
    holdingsOnly: boolean;
}): Promise<number> {
    const { target, quarter, submissions, managerByAccession, holdingsOnly } = params;
    if (holdingsOnly) {
        console.log('[13F SEC Dataset] --holdings-only enabled; filing upserts skipped.');
        return 0;
    }
    if (target.provider === 'postgres') {
        return upsertPostgresSecFilings({ target, quarter, submissions, managerByAccession });
    }

    let processed = 0;
    const ingestedAt = new Date().toISOString();
    for (const chunk of chunkRows(submissions, 100)) {
        await batchWithRetry(target.client, chunk.flatMap((row) => {
            const accession = row.ACCESSION_NUMBER;
            const cik = normalizeCikForStorage(row.CIK);
            const managerName = managerByAccession.get(accession) || cik;
            return [
                {
                    sql: 'INSERT OR IGNORE INTO funds (cik, name, ticker) VALUES (?, ?, ?)',
                    args: [cik, managerName, null],
                },
                {
                    sql: `
                        INSERT OR REPLACE INTO filings
                            (accession_number, cik, filing_date, quarter, form, report_date, source, ingested_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    args: [
                        accession,
                        cik,
                        normalizeSecDate(row.FILING_DATE),
                        quarter,
                        row.SUBMISSIONTYPE,
                        normalizeSecDate(row.PERIODOFREPORT),
                        'sec-bulk',
                        ingestedAt,
                    ],
                },
            ];
        }));
        processed += chunk.length;
        process.stdout.write(`\r[13F SEC Dataset] Upserted ${processed}/${submissions.length} filings`);
    }
    console.log('');
    return processed;
}

async function upsertPostgresSecFilings(params: {
    target: Extract<SecDbTarget, { provider: 'postgres' }>;
    quarter: string;
    submissions: TsvRow[];
    managerByAccession: Map<string, string>;
}): Promise<number> {
    const { target, quarter, submissions, managerByAccession } = params;
    const filings: Postgres13FFilingInput[] = submissions.map((row) => {
        const accession = row.ACCESSION_NUMBER;
        const cik = normalizeCikForStorage(row.CIK);
        return {
            accessionNumber: accession,
            cik,
            fundName: managerByAccession.get(accession) || cik,
            filingDate: normalizeSecDate(row.FILING_DATE),
            quarter,
            form: row.SUBMISSIONTYPE || null,
            reportDate: normalizeSecDate(row.PERIODOFREPORT),
            source: 'sec-bulk',
        };
    });
    const processed = await upsertPostgres13FFilings(target.pool, filings);
    console.log(`[13F SEC Dataset] Upserted ${processed}/${submissions.length} filings`);
    return processed;
}

async function replaceHoldings(params: {
    target: SecDbTarget;
    accessions: string[];
    infoTables: TsvRow[];
    submissionByAccession: Map<string, TsvRow>;
}): Promise<number> {
    const { target, accessions, infoTables, submissionByAccession } = params;
    if (target.provider === 'postgres') {
        return replacePostgresSecHoldings({ target, accessions, infoTables, submissionByAccession });
    }

    await deleteExistingHoldings(target.client, accessions);

    let inserted = 0;
    const insertStatements: Array<{ sql: string; args: InValue[]; rowCount: number }> = [];
    for (const chunk of chunkRows(infoTables, HOLDING_INSERT_CHUNK_SIZE)) {
        const placeholders: string[] = [];
        const args: InValue[] = [];

        for (const row of chunk) {
            if (!submissionByAccession.has(row.ACCESSION_NUMBER)) {
                throw new Error(`Missing submission metadata for ${row.ACCESSION_NUMBER}`);
            }
            placeholders.push('(?, ?, ?, ?, ?, ?, ?)');
            args.push(
                row.ACCESSION_NUMBER,
                (row.NAMEOFISSUER || 'Unknown').toUpperCase(),
                row.CUSIP || null,
                parseNumber(row.VALUE),
                parseNumber(row.SSHPRNAMT),
                row.PUTCALL || null,
                row.SSHPRNAMTTYPE || null
            );
        }

        insertStatements.push({
            sql: `
                INSERT INTO holdings
                    (accession_number, issuer, cusip, value, shares, putcall, ssh_prnamt_type)
                VALUES ${placeholders.join(', ')}
            `,
            args,
            rowCount: chunk.length,
        });
    }

    for (const group of chunkRows(insertStatements, HOLDING_INSERT_STATEMENTS_PER_BATCH)) {
        await batchStatementGroup(target.client, group.map(({ sql, args }) => ({ sql, args })));
        inserted += group.reduce((sum, statement) => sum + statement.rowCount, 0);
        process.stdout.write(`\r[13F SEC Dataset] Inserted ${inserted}/${infoTables.length} holdings`);
    }
    return inserted;
}

async function replacePostgresSecHoldings(params: {
    target: Extract<SecDbTarget, { provider: 'postgres' }>;
    accessions: string[];
    infoTables: TsvRow[];
    submissionByAccession: Map<string, TsvRow>;
}): Promise<number> {
    const { target, accessions, infoTables, submissionByAccession } = params;
    const holdings: Postgres13FHoldingInput[] = infoTables.map((row) => {
        if (!submissionByAccession.has(row.ACCESSION_NUMBER)) {
            throw new Error(`Missing submission metadata for ${row.ACCESSION_NUMBER}`);
        }
        return {
            accessionNumber: row.ACCESSION_NUMBER,
            issuer: row.NAMEOFISSUER || 'Unknown',
            cusip: row.CUSIP || null,
            value: parseNumber(row.VALUE),
            shares: parseNumber(row.SSHPRNAMT),
            putcall: row.PUTCALL || null,
            sshPrnamtType: row.SSHPRNAMTTYPE || null,
        };
    });
    const inserted = await replacePostgres13FHoldings(target.pool, {
        accessions,
        holdings,
        holdingInsertChunkSize: POSTGRES_HOLDING_INSERT_CHUNK_SIZE,
    });
    console.log(`[13F SEC Dataset] Inserted ${inserted}/${infoTables.length} holdings`);
    return inserted;
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
        console.warn(`[13F SEC Dataset] Insert batch of ${statements.length} statements failed (${message}); splitting.`);
        const midpoint = Math.ceil(statements.length / 2);
        await batchStatementGroup(turso, statements.slice(0, midpoint));
        await batchStatementGroup(turso, statements.slice(midpoint));
    }
}

async function deleteExistingHoldings(turso: ReturnType<typeof createClient>, accessions: string[]) {
    let deletedBatches = 0;
    for (const chunk of chunkRows(accessions, 500)) {
        const placeholders = chunk.map(() => '?').join(', ');
        await executeWithArgsRetry(
            turso,
            `DELETE FROM holdings WHERE accession_number IN (${placeholders})`,
            chunk
        );
        deletedBatches++;
        process.stdout.write(`\r[13F SEC Dataset] Cleared existing holdings batches ${deletedBatches}/${Math.ceil(accessions.length / 500)}`);
    }
    console.log('');
}

function findZipEntry(zip: JSZip, token: string) {
    return Object.values(zip.files).find((file) =>
        !file.dir && file.name.toUpperCase().includes(token) && /\.(TSV|TXT|CSV)$/i.test(file.name)
    ) || null;
}

function buildWatchlistAliases() {
    const aliases = new Map<string, { normalized: string; compact: string }>();
    for (const watchlist of DEFAULT_RADAR_WATCHLISTS) {
        for (const item of watchlist.items) {
            for (const alias of item.aliases) {
                const compact = compactIssuerName(alias);
                if (compact.length < 4) continue;
                aliases.set(compact, { normalized: normalizeIssuerName(alias), compact });
            }
        }
    }
    return Array.from(aliases.values());
}

function issuerMatchesWatchlist(issuer: string, aliases: Array<{ normalized: string; compact: string }>): boolean {
    const normalizedIssuer = normalizeIssuerName(issuer);
    const compactIssuer = normalizedIssuer.replace(/\s+/g, '');
    return aliases.some((alias) => normalizedIssuer.includes(alias.normalized) || compactIssuer.includes(alias.compact));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
