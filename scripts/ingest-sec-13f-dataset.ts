import { createClient, type InValue } from '@libsql/client';
import JSZip from 'jszip';
import * as dotenv from 'dotenv';
import { DEFAULT_RADAR_WATCHLISTS, compactIssuerName, normalizeIssuerName } from '../lib/thirteen-f-radar-core';

dotenv.config();

type TsvRow = Record<string, string>;

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

async function main() {
    const url = getArg('--url');
    const quarter = getArg('--quarter');

    if (!url || !quarter) {
        console.error('Usage: npm run ingest:13f-sec -- --url <SEC_13F_ZIP_URL> --quarter 2025-Q4');
        process.exit(1);
    }

    if (!TURSO_URL || !TURSO_TOKEN) {
        console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.');
        process.exit(1);
    }

    const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    if (hasArg('--skip-schema')) {
        console.log('[13F SEC Dataset] Skipping schema setup.');
    } else {
        await ensureSchema(turso);
    }

    console.log(`[13F SEC Dataset] Downloading ${url}`);
    const response = await fetch(url, { headers: { 'User-Agent': 'ForensicAnalyzer contact@example.com' } });
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
    const managerByAccession = new Map(
        coverPages.map((row) => [row.ACCESSION_NUMBER, row.FILINGMANAGER_NAME || row.FILING_MANAGER_NAME || ''])
    );
    const submissionByAccession = new Map(submissions.map((row) => [row.ACCESSION_NUMBER, row]));
    const eligibleSubmissions = submissions.filter((row) =>
        ['13F-HR', '13F-HR/A'].includes((row.SUBMISSIONTYPE || '').toUpperCase())
    );
    const eligibleAccessions = new Set(eligibleSubmissions.map((row) => row.ACCESSION_NUMBER));
    const holdingsOnly = hasArg('--holdings-only');

    console.log(`[13F SEC Dataset] ${eligibleSubmissions.length} holdings-report submissions for ${quarter}`);
    console.log(`[13F SEC Dataset] ${infoTables.length} raw information-table rows`);

    if (holdingsOnly) {
        await deleteExistingHoldings(turso, Array.from(eligibleAccessions));
    } else {
        let processedSubmissions = 0;
        for (const chunk of chunkRows(eligibleSubmissions, 100)) {
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
                                (accession_number, cik, filing_date, quarter, form, report_date)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `,
                        args: [
                            accession,
                            cik,
                            normalizeSecDate(row.FILING_DATE),
                            quarter,
                            row.SUBMISSIONTYPE,
                            normalizeSecDate(row.PERIODOFREPORT),
                        ],
                    },
                    {
                        sql: 'DELETE FROM holdings WHERE accession_number = ?',
                        args: [accession],
                    },
                ];
            }));
            processedSubmissions += chunk.length;
            process.stdout.write(`\r[13F SEC Dataset] Upserted ${processedSubmissions}/${eligibleSubmissions.length} filings`);
        }
        console.log('');
    }

    let inserted = 0;
    const watchlistOnly = hasArg('--watchlist-only');
    const watchlistAliases = buildWatchlistAliases();
    const holdingsToInsert = infoTables.filter((row) => {
        if (!eligibleAccessions.has(row.ACCESSION_NUMBER)) return false;
        if (!watchlistOnly) return true;
        return issuerMatchesWatchlist(row.NAMEOFISSUER || '', watchlistAliases);
    });

    if (watchlistOnly) {
        console.log(`[13F SEC Dataset] Watchlist-only mode retained ${holdingsToInsert.length}/${infoTables.length} raw holding rows`);
    }

    for (const chunk of chunkRows(holdingsToInsert, 3000)) {
        const placeholders: string[] = [];
        const args: Array<string | number | null> = [];

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

        await executeWithArgsRetry(
            turso,
            `
                INSERT INTO holdings
                    (accession_number, issuer, cusip, value, shares, putcall, ssh_prnamt_type)
                VALUES ${placeholders.join(', ')}
            `,
            args
        );
        inserted += chunk.length;
        process.stdout.write(`\r[13F SEC Dataset] Inserted ${inserted}/${holdingsToInsert.length} holdings`);
    }

    console.log('\n[13F SEC Dataset] Complete.');
}

async function ensureSchema(turso: ReturnType<typeof createClient>) {
    const schemaStatements = [
        {
            label: 'funds table',
            sql: `
                CREATE TABLE IF NOT EXISTS funds (
                    cik TEXT PRIMARY KEY,
                    name TEXT,
                    ticker TEXT
                )
            `,
        },
        {
            label: 'filings table',
            sql: `
                CREATE TABLE IF NOT EXISTS filings (
                    accession_number TEXT PRIMARY KEY,
                    cik TEXT,
                    filing_date TEXT,
                    quarter TEXT,
                    form TEXT,
                    report_date TEXT
                )
            `,
        },
        {
            label: 'holdings table',
            sql: `
                CREATE TABLE IF NOT EXISTS holdings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    accession_number TEXT,
                    issuer TEXT,
                    cusip TEXT,
                    value REAL,
                    shares REAL,
                    putcall TEXT,
                    ssh_prnamt_type TEXT
                )
            `,
        },
        { label: 'holdings issuer index', sql: 'CREATE INDEX IF NOT EXISTS idx_holdings_issuer ON holdings(issuer)' },
        { label: 'holdings cusip index', sql: 'CREATE INDEX IF NOT EXISTS idx_holdings_cusip ON holdings(cusip)' },
        { label: 'holdings accession index', sql: 'CREATE INDEX IF NOT EXISTS idx_holdings_accession ON holdings(accession_number)' },
        { label: 'filings quarter/cik index', sql: 'CREATE INDEX IF NOT EXISTS idx_filings_quarter_cik ON filings(quarter, cik)' },
    ];

    for (const statement of schemaStatements) {
        console.log(`[13F SEC Dataset] Ensuring ${statement.label}...`);
        await executeWithRetry(turso, statement.sql);
    }

    await ensureColumn(turso, 'filings', 'form', 'TEXT');
    await ensureColumn(turso, 'filings', 'report_date', 'TEXT');
    await ensureColumn(turso, 'holdings', 'putcall', 'TEXT');
    await ensureColumn(turso, 'holdings', 'ssh_prnamt_type', 'TEXT');
}

async function executeWithRetry(turso: ReturnType<typeof createClient>, sql: string, attempts = 5) {
    await executeWithArgsRetry(turso, sql, [], attempts);
}

async function executeWithArgsRetry(
    turso: ReturnType<typeof createClient>,
    sql: string,
    args: InValue[],
    attempts = 5
) {
    let delayMs = 1000;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await turso.execute({ sql, args });
            return;
        } catch (error) {
            if (attempt === attempts) throw error;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`\n[13F SEC Dataset] Statement failed (${message}). Retry ${attempt}/${attempts - 1} in ${delayMs}ms.`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs = Math.min(delayMs * 2, 15000);
        }
    }
}

async function batchWithRetry(
    turso: ReturnType<typeof createClient>,
    statements: Array<{ sql: string; args: InValue[] }>,
    attempts = 5
) {
    let delayMs = 1000;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await turso.batch(statements, 'write');
            return;
        } catch (error) {
            if (attempt === attempts) throw error;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`\n[13F SEC Dataset] Batch failed (${message}). Retry ${attempt}/${attempts - 1} in ${delayMs}ms.`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs = Math.min(delayMs * 2, 15000);
        }
    }
}

async function deleteExistingHoldings(turso: ReturnType<typeof createClient>, accessions: string[]) {
    let deletedBatches = 0;
    const chunks = chunkRows(accessions, 500);
    for (const chunk of chunks) {
        const placeholders = chunk.map(() => '?').join(', ');
        await executeWithArgsRetry(
            turso,
            `DELETE FROM holdings WHERE accession_number IN (${placeholders})`,
            chunk
        );
        deletedBatches++;
        process.stdout.write(`\r[13F SEC Dataset] Cleared existing holdings batches ${deletedBatches}/${chunks.length}`);
    }
    console.log('');
}

async function ensureColumn(turso: ReturnType<typeof createClient>, table: string, column: string, type: string) {
    const result = await turso.execute(`PRAGMA table_info(${table})`);
    const columns = new Set(result.rows.map((row) => String(row.name)));
    if (columns.has(column)) return;
    await turso.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function findZipEntry(zip: JSZip, token: string) {
    return Object.values(zip.files).find((file) =>
        !file.dir && file.name.toUpperCase().includes(token) && /\.(TSV|TXT|CSV)$/i.test(file.name)
    ) || null;
}

function parseTsv(text: string): TsvRow[] {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return [];

    const headers = lines[0].split('\t').map((header) => normalizeHeader(header));
    return lines.slice(1).map((line) => {
        const cells = line.split('\t');
        const row: TsvRow = {};
        headers.forEach((header, index) => {
            row[header] = cells[index] || '';
        });
        return row;
    });
}

function normalizeHeader(value: string): string {
    return value.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function normalizeSecDate(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return trimmed;
}

function parseNumber(value: string): number {
    const parsed = Number.parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
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

function chunkRows<T>(rows: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < rows.length; i += size) {
        chunks.push(rows.slice(i, i + size));
    }
    return chunks;
}

function getArg(name: string): string | null {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    return process.argv[index + 1] || null;
}

function hasArg(name: string): boolean {
    return process.argv.includes(name);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
