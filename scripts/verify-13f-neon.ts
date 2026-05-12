import * as dotenv from 'dotenv';
import {
    createPostgresPool,
    ensurePostgres13FSchema,
    getPostgresConnectionString,
    POSTGRES_13F_SIZE_TARGET_BYTES,
    queryPostgresDatabaseSize,
} from '../lib/thirteen-f-radar-postgres';
import {
    loadRadarComparison,
    resolveRadarRequest,
    type RadarDbClient,
    type RadarRequestBody,
} from '../lib/thirteen-f-radar-data';
import { getArg, hasArg, isDirectRun, parseQuarterKey } from './13f-ingestion-utils';

dotenv.config();

async function main() {
    const quarters = parseQuarters(getArg('--quarters'));
    const requireUnderTarget = hasArg('--require-under-target');
    if (quarters.length < 2) throw new Error('Expected at least two quarters, e.g. --quarters 2026-Q1,2025-Q4.');
    for (const quarter of quarters) parseQuarterKey(quarter);

    const postgresUrl = getPostgresConnectionString();
    if (!postgresUrl) throw new Error('Missing DATABASE_URL or POSTGRES_URL for Neon/Postgres verification.');

    const pool = createPostgresPool(postgresUrl);
    try {
        await ensurePostgres13FSchema(pool);
        const available = await pool.query(`
            SELECT quarter, COUNT(*) AS filings, COUNT(DISTINCT cik) AS filers
            FROM filings
            GROUP BY quarter
            ORDER BY quarter DESC
        `);
        console.log('[13F Neon Verify] Filings by quarter');
        console.table(available.rows);

        const holdings = await pool.query(`
            SELECT f.quarter, COUNT(*) AS holdings
            FROM holdings h
            JOIN filings f ON f.accession_number = h.accession_number
            GROUP BY f.quarter
            ORDER BY f.quarter DESC
        `);
        console.log('[13F Neon Verify] Holdings by quarter');
        console.table(holdings.rows);

        const requestBody: RadarRequestBody = {
            currentQuarter: quarters[0],
            previousQuarter: quarters[1],
        };
        const db: RadarDbClient = { provider: 'postgres', pool };
        const request = await resolveRadarRequest(db, requestBody);
        const { comparison } = await loadRadarComparison(db, request);
        console.log('[13F Neon Verify] Radar coverage');
        console.table([comparison.coverage]);

        const size = await queryPostgresDatabaseSize(pool);
        console.log(`[13F Neon Verify] Database size: ${formatBytes(size)} / target ${formatBytes(POSTGRES_13F_SIZE_TARGET_BYTES)}`);
        if (requireUnderTarget && size > POSTGRES_13F_SIZE_TARGET_BYTES) {
            throw new Error(`Postgres database is above the ${formatBytes(POSTGRES_13F_SIZE_TARGET_BYTES)} safety target.`);
        }
    } finally {
        await pool.end();
    }
}

function parseQuarters(value: string | null): string[] {
    return (value || '2026-Q1,2025-Q4')
        .split(',')
        .map((quarter) => quarter.trim())
        .filter(Boolean);
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
