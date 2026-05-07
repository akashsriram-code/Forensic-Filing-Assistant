import { createClient } from '@libsql/client';
import JSZip from 'jszip';
import * as dotenv from 'dotenv';

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
    await ensureSchema(turso);

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

    console.log(`[13F SEC Dataset] ${eligibleSubmissions.length} holdings-report submissions for ${quarter}`);
    console.log(`[13F SEC Dataset] ${infoTables.length} raw information-table rows`);

    for (const chunk of chunkRows(eligibleSubmissions, 200)) {
        await turso.batch(chunk.flatMap((row) => {
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
        }), 'write');
    }

    let inserted = 0;
    const holdingsToInsert = infoTables.filter((row) => eligibleAccessions.has(row.ACCESSION_NUMBER));

    for (const chunk of chunkRows(holdingsToInsert, 250)) {
        await turso.batch(chunk.map((row) => {
            if (!submissionByAccession.has(row.ACCESSION_NUMBER)) {
                throw new Error(`Missing submission metadata for ${row.ACCESSION_NUMBER}`);
            }
            return {
                sql: `
                    INSERT INTO holdings
                        (accession_number, issuer, cusip, value, shares, putcall, ssh_prnamt_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                args: [
                    row.ACCESSION_NUMBER,
                    (row.NAMEOFISSUER || 'Unknown').toUpperCase(),
                    row.CUSIP || null,
                    parseNumber(row.VALUE),
                    parseNumber(row.SSHPRNAMT),
                    row.PUTCALL || null,
                    row.SSHPRNAMTTYPE || null,
                ],
            };
        }), 'write');
        inserted += chunk.length;
        process.stdout.write(`\r[13F SEC Dataset] Inserted ${inserted}/${holdingsToInsert.length} holdings`);
    }

    console.log('\n[13F SEC Dataset] Complete.');
}

async function ensureSchema(turso: ReturnType<typeof createClient>) {
    await turso.batch([
        {
            sql: `
                CREATE TABLE IF NOT EXISTS funds (
                    cik TEXT PRIMARY KEY,
                    name TEXT,
                    ticker TEXT
                )
            `,
            args: [],
        },
        {
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
            args: [],
        },
        {
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
            args: [],
        },
        { sql: 'CREATE INDEX IF NOT EXISTS idx_holdings_issuer ON holdings(issuer)', args: [] },
        { sql: 'CREATE INDEX IF NOT EXISTS idx_holdings_cusip ON holdings(cusip)', args: [] },
        { sql: 'CREATE INDEX IF NOT EXISTS idx_filings_quarter_cik ON filings(quarter, cik)', args: [] },
    ], 'write');

    await ensureColumn(turso, 'filings', 'form', 'TEXT');
    await ensureColumn(turso, 'filings', 'report_date', 'TEXT');
    await ensureColumn(turso, 'holdings', 'putcall', 'TEXT');
    await ensureColumn(turso, 'holdings', 'ssh_prnamt_type', 'TEXT');
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

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
