import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import {
    buildPostgresSecurityKey,
    clearPostgres13FData,
    createPostgresPool,
    dropPostgres13FIndexes,
    ensurePostgres13FIndexes,
    ensurePostgres13FSchema,
    getPostgresConnectionString,
    normalizePostgresIssuer,
    postgresValuePlaceholders,
    queryPostgresDatabaseSize,
    POSTGRES_13F_SIZE_TARGET_BYTES,
} from '../lib/thirteen-f-radar-postgres';
import { normalizeCik, type RadarFilingRow } from '../lib/thirteen-f-radar-core';
import {
    chunkRows,
    getArg,
    hasArg,
    isDirectRun,
    normalizeCikForStorage,
    parseQuarterKey,
} from './13f-ingestion-utils';

dotenv.config();

interface MigrationFiling extends RadarFilingRow {
    form: string | null;
    reportDate: string | null;
    source: string | null;
    ingestedAt: string | null;
}

interface TursoHoldingRow {
    accessionNumber: string;
    issuer: string;
    cusip: string | null;
    value: number;
    shares: number;
    putcall: string | null;
    sshPrnamtType: string | null;
}

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const DEFAULT_QUARTERS = ['2026-Q1', '2025-Q4'];
const ACCESSION_CHUNK_SIZE = 250;
const FUND_INSERT_CHUNK_SIZE = 500;
const FILING_INSERT_CHUNK_SIZE = 500;
const SECURITY_INSERT_CHUNK_SIZE = 500;
const HOLDING_INSERT_CHUNK_SIZE = 1000;

async function main() {
    const quarters = parseQuarters(getArg('--quarters'));
    const dryRun = hasArg('--dry-run');
    const keepExisting = hasArg('--keep-existing');

    if (quarters.length !== 2 && !hasArg('--allow-more-quarters')) {
        throw new Error('Free Neon migration is capped at exactly two quarters. Use --allow-more-quarters only after confirming storage headroom.');
    }
    for (const quarter of quarters) parseQuarterKey(quarter);
    if (!TURSO_URL || !TURSO_TOKEN) throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN for read-only source migration.');
    const postgresUrl = getPostgresConnectionString();
    if (!dryRun && !postgresUrl) throw new Error('Missing DATABASE_URL or POSTGRES_URL for Neon/Postgres target.');

    console.log(`[13F Neon Migration] Source: Turso read-only`);
    console.log(`[13F Neon Migration] Target quarters: ${quarters.join(', ')}`);
    console.log(`[13F Neon Migration] Mode: ${dryRun ? 'dry-run' : keepExisting ? 'append/update target' : 'replace target 13F tables'}`);

    const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    const sourceFilings = await queryTursoFilings(turso, quarters);
    const latestFilings = quarters.flatMap((quarter) => selectLatestMigrationFilings(sourceFilings, quarter));
    const latestAccessions = latestFilings.map((filing) => filing.accessionNumber);
    const sourceHoldingCount = await countTursoHoldings(turso, latestAccessions);

    console.table({
        sourceFilings: sourceFilings.length,
        latestFilings: latestFilings.length,
        latestAccessions: latestAccessions.length,
        sourceHoldingRows: sourceHoldingCount,
    });

    if (dryRun) {
        console.log('[13F Neon Migration] Dry run complete; no Postgres writes performed.');
        return;
    }

    const pool = createPostgresPool(postgresUrl);
    try {
        await ensurePostgres13FSchema(pool);
        await dropPostgres13FIndexes(pool);
        if (!keepExisting) {
            console.log('[13F Neon Migration] Clearing target 13F tables...');
            await clearPostgres13FData(pool);
        }

        const startedAt = new Date().toISOString();
        await insertFunds(pool, latestFilings);
        await insertFilings(pool, latestFilings);
        await deletePostgresHoldingsForAccessions(pool, latestAccessions);
        const holdingsInserted = await migrateHoldings(turso, pool, latestFilings);

        await insertIngestionRun(pool, {
            quarters,
            startedAt,
            filingsSeen: sourceFilings.length,
            filingsUpserted: latestFilings.length,
            holdingsInserted,
        });

        console.log('[13F Neon Migration] Rebuilding Postgres indexes...');
        await ensurePostgres13FIndexes(pool);
        const databaseSize = await queryPostgresDatabaseSize(pool);
        console.log(`[13F Neon Migration] Postgres database size: ${formatBytes(databaseSize)} / target ${formatBytes(POSTGRES_13F_SIZE_TARGET_BYTES)}`);
        if (databaseSize > POSTGRES_13F_SIZE_TARGET_BYTES) {
            console.warn('[13F Neon Migration] Size is above the 480 MB safety target. Do not switch production until storage is reduced.');
        }
        console.log('[13F Neon Migration] Complete.');
    } finally {
        await pool.end();
    }
}

async function queryTursoFilings(
    turso: ReturnType<typeof createClient>,
    quarters: string[]
): Promise<MigrationFiling[]> {
    const placeholders = quarters.map(() => '?').join(', ');
    const result = await turso.execute({
        sql: `
            SELECT
                fil.cik AS cik,
                COALESCE(f.name, fil.cik) AS "fundName",
                fil.accession_number AS "accessionNumber",
                fil.filing_date AS "filingDate",
                fil.quarter AS quarter,
                fil.form AS form,
                fil.report_date AS "reportDate",
                fil.source AS source,
                fil.ingested_at AS "ingestedAt"
            FROM filings fil
            LEFT JOIN funds f ON f.cik = fil.cik
            WHERE fil.quarter IN (${placeholders})
        `,
        args: quarters,
    });

    return result.rows.map((row) => ({
        cik: normalizeCikForStorage(String(row.cik || '')),
        fundName: String(row.fundName || row.cik || ''),
        accessionNumber: String(row.accessionNumber || ''),
        filingDate: String(row.filingDate || ''),
        quarter: String(row.quarter || ''),
        form: nullableString(row.form),
        reportDate: nullableString(row.reportDate),
        source: nullableString(row.source),
        ingestedAt: nullableString(row.ingestedAt),
    })).filter((filing) => filing.cik && filing.accessionNumber && filing.quarter);
}

function selectLatestMigrationFilings(filings: MigrationFiling[], quarter: string): MigrationFiling[] {
    const latestByCik = new Map<string, MigrationFiling>();
    for (const filing of filings) {
        if (filing.quarter !== quarter) continue;
        const normalized = { ...filing, cik: normalizeCik(filing.cik) };
        const existing = latestByCik.get(normalized.cik);
        if (!existing || compareFilingRecency(normalized, existing) > 0) {
            latestByCik.set(normalized.cik, normalized);
        }
    }
    return Array.from(latestByCik.values());
}

function compareFilingRecency(a: MigrationFiling, b: MigrationFiling): number {
    const filingDateCompare = a.filingDate.localeCompare(b.filingDate);
    if (filingDateCompare !== 0) return filingDateCompare;
    return a.accessionNumber.localeCompare(b.accessionNumber);
}

async function countTursoHoldings(turso: ReturnType<typeof createClient>, accessions: string[]): Promise<number> {
    let count = 0;
    for (const chunk of chunkRows(accessions, ACCESSION_CHUNK_SIZE)) {
        const placeholders = chunk.map(() => '?').join(', ');
        const result = await turso.execute({
            sql: `SELECT COUNT(*) AS count FROM holdings WHERE accession_number IN (${placeholders})`,
            args: chunk,
        });
        count += Number(result.rows[0]?.count || 0);
    }
    return count;
}

async function insertFunds(pool: ReturnType<typeof createPostgresPool>, filings: MigrationFiling[]) {
    const funds = new Map<string, { cik: string; name: string }>();
    for (const filing of filings) {
        funds.set(filing.cik, { cik: filing.cik, name: filing.fundName || filing.cik });
    }

    let inserted = 0;
    for (const chunk of chunkRows(Array.from(funds.values()), FUND_INSERT_CHUNK_SIZE)) {
        const args = chunk.flatMap((fund) => [fund.cik, fund.name, null]);
        await pool.query(
            `
                INSERT INTO funds (cik, name, ticker)
                VALUES ${postgresValuePlaceholders(chunk.length, 3)}
                ON CONFLICT (cik) DO UPDATE SET
                    name = EXCLUDED.name,
                    ticker = COALESCE(funds.ticker, EXCLUDED.ticker)
            `,
            args
        );
        inserted += chunk.length;
        process.stdout.write(`\r[13F Neon Migration] Upserted funds ${inserted}/${funds.size}`);
    }
    console.log('');
}

async function insertFilings(pool: ReturnType<typeof createPostgresPool>, filings: MigrationFiling[]) {
    let inserted = 0;
    for (const chunk of chunkRows(filings, FILING_INSERT_CHUNK_SIZE)) {
        const args = chunk.flatMap((filing) => [
            filing.accessionNumber,
            filing.cik,
            filing.filingDate,
            filing.quarter,
            filing.form,
            filing.reportDate,
            filing.source || 'turso-migration',
            filing.ingestedAt || new Date().toISOString(),
        ]);
        await pool.query(
            `
                INSERT INTO filings
                    (accession_number, cik, filing_date, quarter, form, report_date, source, ingested_at)
                VALUES ${postgresValuePlaceholders(chunk.length, 8)}
                ON CONFLICT (accession_number) DO UPDATE SET
                    cik = EXCLUDED.cik,
                    filing_date = EXCLUDED.filing_date,
                    quarter = EXCLUDED.quarter,
                    form = EXCLUDED.form,
                    report_date = EXCLUDED.report_date,
                    source = EXCLUDED.source,
                    ingested_at = EXCLUDED.ingested_at
            `,
            args
        );
        inserted += chunk.length;
        process.stdout.write(`\r[13F Neon Migration] Upserted filings ${inserted}/${filings.length}`);
    }
    console.log('');
}

async function deletePostgresHoldingsForAccessions(pool: ReturnType<typeof createPostgresPool>, accessions: string[]) {
    let deletedChunks = 0;
    for (const chunk of chunkRows(accessions, ACCESSION_CHUNK_SIZE)) {
        const placeholders = chunk.map((_, index) => `$${index + 1}`).join(', ');
        await pool.query(
            `DELETE FROM holdings WHERE accession_number IN (${placeholders})`,
            chunk
        );
        deletedChunks++;
        process.stdout.write(`\r[13F Neon Migration] Cleared existing holding chunks ${deletedChunks}/${Math.ceil(accessions.length / ACCESSION_CHUNK_SIZE)}`);
    }
    console.log('');
}

async function migrateHoldings(
    turso: ReturnType<typeof createClient>,
    pool: ReturnType<typeof createPostgresPool>,
    filings: MigrationFiling[]
): Promise<number> {
    const accessions = filings.map((filing) => filing.accessionNumber);
    let inserted = 0;
    let processedAccessions = 0;

    for (const accessionChunk of chunkRows(accessions, ACCESSION_CHUNK_SIZE)) {
        const holdings = await queryTursoHoldings(turso, accessionChunk);
        await insertSecurities(pool, holdings);
        await insertHoldings(pool, holdings);
        inserted += holdings.length;
        processedAccessions += accessionChunk.length;
        process.stdout.write(`\r[13F Neon Migration] Migrated holdings ${inserted} rows from ${processedAccessions}/${accessions.length} accessions`);
    }
    console.log('');
    return inserted;
}

async function queryTursoHoldings(
    turso: ReturnType<typeof createClient>,
    accessions: string[]
): Promise<TursoHoldingRow[]> {
    const placeholders = accessions.map(() => '?').join(', ');
    const result = await turso.execute({
        sql: `
            SELECT
                accession_number AS "accessionNumber",
                issuer,
                cusip,
                value,
                shares,
                putcall,
                ssh_prnamt_type AS "sshPrnamtType"
            FROM holdings
            WHERE accession_number IN (${placeholders})
        `,
        args: accessions,
    });

    return result.rows.map((row) => ({
        accessionNumber: String(row.accessionNumber || ''),
        issuer: normalizePostgresIssuer(String(row.issuer || 'Unknown')),
        cusip: nullableString(row.cusip),
        value: numericValue(row.value),
        shares: numericValue(row.shares),
        putcall: nullableString(row.putcall),
        sshPrnamtType: nullableString(row.sshPrnamtType),
    })).filter((row) => row.accessionNumber);
}

async function insertSecurities(pool: ReturnType<typeof createPostgresPool>, holdings: TursoHoldingRow[]) {
    const securities = new Map<string, { securityKey: string; issuer: string; issuerSearch: string; cusip: string | null }>();
    for (const holding of holdings) {
        const securityKey = buildPostgresSecurityKey(holding.issuer, holding.cusip);
        securities.set(securityKey, {
            securityKey,
            issuer: holding.issuer,
            issuerSearch: holding.issuer,
            cusip: holding.cusip,
        });
    }

    for (const chunk of chunkRows(Array.from(securities.values()), SECURITY_INSERT_CHUNK_SIZE)) {
        const args = chunk.flatMap((security) => [
            security.securityKey,
            security.issuer,
            security.issuerSearch,
            security.cusip,
        ]);
        await pool.query(
            `
                INSERT INTO securities (security_key, issuer, issuer_search, cusip)
                VALUES ${postgresValuePlaceholders(chunk.length, 4)}
                ON CONFLICT (security_key) DO UPDATE SET
                    issuer = EXCLUDED.issuer,
                    issuer_search = EXCLUDED.issuer_search,
                    cusip = EXCLUDED.cusip
            `,
            args
        );
    }
}

async function insertHoldings(pool: ReturnType<typeof createPostgresPool>, holdings: TursoHoldingRow[]) {
    for (const chunk of chunkRows(holdings, HOLDING_INSERT_CHUNK_SIZE)) {
        const args: unknown[] = chunk.flatMap((holding) => [
            holding.accessionNumber,
            buildPostgresSecurityKey(holding.issuer, holding.cusip),
            holding.value,
            holding.shares,
            holding.putcall,
            holding.sshPrnamtType,
        ]);
        await pool.query(
            `
                INSERT INTO holdings
                    (accession_number, security_key, value, shares, putcall, ssh_prnamt_type)
                VALUES ${postgresValuePlaceholders(chunk.length, 6)}
            `,
            args
        );
    }
}

async function insertIngestionRun(
    pool: ReturnType<typeof createPostgresPool>,
    params: {
        quarters: string[];
        startedAt: string;
        filingsSeen: number;
        filingsUpserted: number;
        holdingsInserted: number;
    }
) {
    const id = `turso-migration-${params.quarters.join('-')}-${Date.now()}`;
    await pool.query(
        `
            INSERT INTO ingestion_runs
                (id, quarter, source, source_url, started_at, completed_at, status, filings_seen, filings_upserted, holdings_inserted, report_quarter_matches, skipped_existing, skipped_wrong_quarter, skipped_no_holdings, skipped_errors, error_text)
            VALUES
                ($1, $2, 'turso-migration', 'turso-readonly', $3, $4, 'success', $5, $6, $7, $6, 0, 0, 0, 0, NULL)
        `,
        [
            id,
            params.quarters.join(','),
            params.startedAt,
            new Date().toISOString(),
            params.filingsSeen,
            params.filingsUpserted,
            params.holdingsInserted,
        ]
    );
}

function parseQuarters(value: string | null): string[] {
    return (value || DEFAULT_QUARTERS.join(','))
        .split(',')
        .map((quarter) => quarter.trim())
        .filter(Boolean);
}

function nullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
}

function numericValue(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'bigint') return Number(value);
    const parsed = Number.parseFloat(String(value || '0'));
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    for (const unit of units) {
        if (value < 1024) return `${value.toFixed(1)} ${unit}`;
        value /= 1024;
    }
    return `${value.toFixed(1)} TB`;
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
