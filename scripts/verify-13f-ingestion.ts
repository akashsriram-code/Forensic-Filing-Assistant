import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import {
    getArg,
    hasArg,
    isDirectRun,
    listTableIndexes,
    missingRequiredHoldingIndexes,
} from './13f-ingestion-utils';

dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

async function main() {
    const quarter = getArg('--quarter');
    const githubSummary = hasArg('--github-summary');
    const requireIndexes = hasArg('--require-indexes');
    if (!quarter) {
        console.error('Usage: npm run verify:13f -- --quarter 2026-Q1');
        process.exit(1);
    }
    if (!TURSO_URL || !TURSO_TOKEN) {
        console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.');
        process.exit(1);
    }

    const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    console.log(`[13F Verify] Quarter: ${quarter}`);

    const filingCounts = await turso.execute({
        sql: `
            SELECT quarter, COALESCE(source, 'unknown') AS source, form, report_date, COUNT(*) AS filings
            FROM filings
            WHERE quarter = ?
            GROUP BY quarter, COALESCE(source, 'unknown'), form, report_date
            ORDER BY source, form, report_date
        `,
        args: [quarter],
    });
    console.log('\n[13F Verify] Filings by source/form/report_date');
    console.table(filingCounts.rows);

    const totals = await turso.execute({
        sql: `
            SELECT
                COUNT(DISTINCT f.accession_number) AS filings,
                COUNT(DISTINCT f.cik) AS filers,
                COUNT(h.accession_number) AS holdings
            FROM filings f
            LEFT JOIN holdings h ON h.accession_number = f.accession_number
            WHERE f.quarter = ?
        `,
        args: [quarter],
    });
    console.log('\n[13F Verify] Quarter totals');
    console.table(totals.rows);

    const optionalRunColumns = await existingColumns(turso, 'ingestion_runs');
    const skippedColumns = [
        'report_quarter_matches',
        'skipped_existing',
        'skipped_wrong_quarter',
        'skipped_no_holdings',
        'skipped_errors',
    ].filter((column) => optionalRunColumns.has(column));
    const runs = await turso.execute({
        sql: `
            SELECT source, status, started_at, completed_at, filings_seen, filings_upserted, holdings_inserted${skippedColumns.length > 0 ? `, ${skippedColumns.join(', ')}` : ''}, error_text
            FROM ingestion_runs
            WHERE quarter = ?
            ORDER BY started_at DESC
            LIMIT 10
        `,
        args: [quarter],
    });
    console.log('\n[13F Verify] Recent ingestion runs');
    console.table(runs.rows);

    const holdingsIndexes = await listTableIndexes(turso, 'holdings');
    const missingIndexes = missingRequiredHoldingIndexes(holdingsIndexes);
    console.log('\n[13F Verify] Holdings indexes');
    console.table(holdingsIndexes.map((name) => ({ name })));

    if (githubSummary) {
        appendGithubSummary({
            quarter,
            filingCounts: filingCounts.rows,
            totals: totals.rows,
            runs: runs.rows,
            holdingsIndexes,
            missingIndexes,
        });
    }
    if (requireIndexes && missingIndexes.length > 0) {
        throw new Error(`Missing required holdings indexes: ${missingIndexes.join(', ')}`);
    }
}

async function existingColumns(turso: ReturnType<typeof createClient>, table: string): Promise<Set<string>> {
    const result = await turso.execute(`PRAGMA table_info('${table.replace(/'/g, "''")}')`);
    return new Set(result.rows.map((row) => String(row.name)));
}

function appendGithubSummary(params: {
    quarter: string;
    filingCounts: unknown[];
    totals: unknown[];
    runs: unknown[];
    holdingsIndexes: string[];
    missingIndexes: string[];
}) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;
    const total = rowToRecord(params.totals[0]);
    const latestRun = rowToRecord(params.runs[0]);
    fs.appendFileSync(summaryPath, [
        `## 13F Ingestion Verification (${params.quarter})`,
        '',
        `- Filings: ${total.filings ?? 'n/a'}`,
        `- Filers: ${total.filers ?? 'n/a'}`,
        `- Holdings: ${total.holdings ?? 'n/a'}`,
        `- Latest run: ${latestRun.source ?? 'n/a'} / ${latestRun.status ?? 'n/a'}`,
        `- Filings seen/upserted: ${latestRun.filings_seen ?? 'n/a'} / ${latestRun.filings_upserted ?? 'n/a'}`,
        `- Holdings inserted: ${latestRun.holdings_inserted ?? 'n/a'}`,
        `- Skipped existing/wrong quarter/no holdings/errors: ${latestRun.skipped_existing ?? 'n/a'} / ${latestRun.skipped_wrong_quarter ?? 'n/a'} / ${latestRun.skipped_no_holdings ?? 'n/a'} / ${latestRun.skipped_errors ?? 'n/a'}`,
        `- Holdings indexes: ${params.holdingsIndexes.length > 0 ? params.holdingsIndexes.join(', ') : 'none'}`,
        `- Missing required indexes: ${params.missingIndexes.length > 0 ? params.missingIndexes.join(', ') : 'none'}`,
        '',
        '### Filings by source/form/report date',
        '',
        markdownTable(params.filingCounts),
        '',
        '### Recent ingestion runs',
        '',
        markdownTable(params.runs.slice(0, 5)),
        '',
    ].join('\n'));
}

function markdownTable(rows: unknown[]): string {
    if (rows.length === 0) return '_No rows._';
    const records = rows.map(rowToRecord);
    const headers = Object.keys(records[0]);
    return [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...records.map((record) => `| ${headers.map((header) => String(record[header] ?? '')).join(' | ')} |`),
    ].join('\n');
}

function rowToRecord(row: unknown): Record<string, unknown> {
    return row && typeof row === 'object' ? row as Record<string, unknown> : {};
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
