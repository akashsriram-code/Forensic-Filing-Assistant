import { createClient, type InValue } from '@libsql/client';
import JSZip from 'jszip';
import * as dotenv from 'dotenv';
import { DEFAULT_RADAR_WATCHLISTS, compactIssuerName, normalizeIssuerName } from '../lib/thirteen-f-radar-core';
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
    normalizeSecDate,
    parseNumber,
    parseTsv,
    quarterEndDateString,
    resolveSecDatasetUrlForQuarter,
    selectSecDatasetSubmissionsForQuarter,
    startIngestionRun,
    type TsvRow,
} from './13f-ingestion-utils';

dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const HOLDING_INSERT_CHUNK_SIZE = 100;
const HOLDING_INSERT_STATEMENTS_PER_BATCH = 25;

async function main() {
    const quarter = getArg('--quarter');
    const requestedUrl = getArg('--url');
    const dryRun = hasArg('--dry-run');
    const rebuildSearchIndexes = hasArg('--rebuild-search-indexes');

    if (!quarter) {
        console.error('Usage: npm run ingest:13f-sec -- --quarter 2026-Q1 [--url <SEC_13F_ZIP_URL>] [--dry-run] [--rebuild-search-indexes]');
        process.exit(1);
    }

    const url = requestedUrl || (await resolveSecDatasetUrlForQuarter(quarter)).url;
    if (!url) {
        console.error(`[13F SEC Dataset] No SEC Form 13F Data Set ZIP found for ${quarter}.`);
        process.exit(2);
    }

    if (!dryRun && (!TURSO_URL || !TURSO_TOKEN)) {
        console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.');
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
    console.log(`[13F SEC Dataset] Report-date distribution in holdings-report submissions:`);
    console.table(buildReportQuarterDistribution(all13FSubmissions));
    console.log(`[13F SEC Dataset] ${eligibleSubmissions.length}/${all13FSubmissions.length} holdings-report submissions retained for ${quarter}`);
    console.log(`[13F SEC Dataset] ${holdingsToInsert.length}/${infoTables.length} information-table rows retained`);

    if (watchlistOnly) {
        console.warn('[13F SEC Dataset] --watchlist-only is enabled. Full-universe ingestion is the recommended production path.');
    }

    if (dryRun) {
        console.log('[13F SEC Dataset] Dry run complete; no Turso writes performed.');
        return;
    }

    const turso = createClient({ url: TURSO_URL!, authToken: TURSO_TOKEN! });
    if (hasArg('--skip-schema')) {
        console.log('[13F SEC Dataset] Skipping schema setup.');
    } else {
        await ensure13FSchema(turso);
    }
    if (rebuildSearchIndexes) {
        console.log('[13F SEC Dataset] Dropping holdings issuer/CUSIP indexes for bulk load...');
        await dropHoldingSearchIndexes(turso);
    }

    const runId = await startIngestionRun(turso, { quarter, source: 'sec-bulk', sourceUrl: url });
    try {
        const filingsUpserted = await upsertFilings({
            turso,
            quarter,
            submissions: eligibleSubmissions,
            managerByAccession,
            holdingsOnly: hasArg('--holdings-only'),
        });
        const holdingsInserted = await replaceHoldings({
            turso,
            accessions: Array.from(eligibleAccessions),
            infoTables: holdingsToInsert,
            submissionByAccession,
        });

        await completeIngestionRun(turso, runId, {
            filingsSeen: eligibleSubmissions.length,
            filingsUpserted,
            holdingsInserted,
            reportQuarterMatches: eligibleSubmissions.length,
            skippedWrongQuarter: Math.max(0, all13FSubmissions.length - eligibleSubmissions.length),
        });
        console.log('\n[13F SEC Dataset] Complete.');
    } catch (error) {
        await failIngestionRun(turso, runId, error);
        throw error;
    } finally {
        if (rebuildSearchIndexes) {
            console.log('[13F SEC Dataset] Rebuilding required 13F indexes...');
            await ensureRequired13FIndexes(turso);
        }
    }
}

async function upsertFilings(params: {
    turso: ReturnType<typeof createClient>;
    quarter: string;
    submissions: TsvRow[];
    managerByAccession: Map<string, string>;
    holdingsOnly: boolean;
}): Promise<number> {
    const { turso, quarter, submissions, managerByAccession, holdingsOnly } = params;
    if (holdingsOnly) {
        console.log('[13F SEC Dataset] --holdings-only enabled; filing upserts skipped.');
        return 0;
    }

    let processed = 0;
    const ingestedAt = new Date().toISOString();
    for (const chunk of chunkRows(submissions, 100)) {
        await batchWithRetry(turso, chunk.flatMap((row) => {
            const accession = row.ACCESSION_NUMBER;
            const cik = row.CIK;
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

async function replaceHoldings(params: {
    turso: ReturnType<typeof createClient>;
    accessions: string[];
    infoTables: TsvRow[];
    submissionByAccession: Map<string, TsvRow>;
}): Promise<number> {
    const { turso, accessions, infoTables, submissionByAccession } = params;
    await deleteExistingHoldings(turso, accessions);

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
        await batchStatementGroup(turso, group.map(({ sql, args }) => ({ sql, args })));
        inserted += group.reduce((sum, statement) => sum + statement.rowCount, 0);
        process.stdout.write(`\r[13F SEC Dataset] Inserted ${inserted}/${infoTables.length} holdings`);
    }
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

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
