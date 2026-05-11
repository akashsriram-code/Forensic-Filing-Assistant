import { createClient, type InValue } from '@libsql/client';
import { parseStringPromise } from 'xml2js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type TursoClient = ReturnType<typeof createClient>;
export type IngestionSource = 'live-edgar' | 'sec-bulk';
export type TsvRow = Record<string, string>;

export interface HoldingInput {
    issuer: string;
    cusip: string | null;
    value: number;
    shares: number;
    putcall: string | null;
    sshPrnamtType: string | null;
}

export interface ParsedLive13FXml {
    reportDate: string | null;
    holdings: HoldingInput[];
}

export interface IngestionRunCounts {
    filingsSeen: number;
    filingsUpserted: number;
    holdingsInserted: number;
    reportQuarterMatches?: number;
    skippedExisting?: number;
    skippedWrongQuarter?: number;
    skippedNoHoldings?: number;
    skippedErrors?: number;
}

export interface IngestionRunStatus {
    done: boolean;
    hasRun: boolean;
    latestStatus: string;
    liveMode: 'full' | 'incremental' | 'refresh-existing';
    refreshExisting: boolean;
}

export interface IngestionSchedule {
    quarter: string;
    asOf: string;
    liveActive: boolean;
    bulkActive: boolean;
    liveWindowStart: string;
    liveWindowEnd: string;
    bulkWindowStart: string;
    bulkWindowEnd: string;
    filingIndexYear: number;
    filingIndexQuarter: number;
}

const SEC_DATASETS_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets';
const TURSO_REQUEST_TIMEOUT_MS = 45000;
const SEC_FETCH_TIMEOUT_MS = 30000;

export const SEC_USER_AGENT = process.env.SEC_USER_AGENT || 'ForensicAnalyzer contact@example.com';

export const REQUIRED_HOLDINGS_INDEXES = [
    'idx_holdings_accession',
    'idx_holdings_issuer',
    'idx_holdings_cusip',
] as const;

export function isDirectRun(importMetaUrl: string): boolean {
    const invokedPath = process.argv[1];
    if (!invokedPath) return false;
    return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(invokedPath);
}

export function getArg(name: string): string | null {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    return process.argv[index + 1] || null;
}

export function hasArg(name: string): boolean {
    return process.argv.includes(name);
}

export function parseQuarterKey(value: string): { year: number; quarter: number } {
    const match = value.match(/^(\d{4})-Q([1-4])$/);
    if (!match) throw new Error(`Invalid quarter "${value}". Expected YYYY-Q1..YYYY-Q4.`);
    return { year: Number(match[1]), quarter: Number(match[2]) };
}

export function quarterFromReportDate(value: string): string | null {
    const normalized = normalizeSecDate(value);
    if (!normalized) return null;
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    const month = date.getUTCMonth();
    const quarter = Math.floor(month / 3) + 1;
    return `${date.getUTCFullYear()}-Q${quarter}`;
}

export function quarterEndDateString(quarterKey: string): string {
    const { year, quarter } = parseQuarterKey(quarterKey);
    const monthDayByQuarter: Record<number, string> = {
        1: '03-31',
        2: '06-30',
        3: '09-30',
        4: '12-31',
    };
    return `${year}-${monthDayByQuarter[quarter]}`;
}

export function filingDeadlineDateString(quarterKey: string): string {
    return addDays(quarterEndDateString(quarterKey), 45);
}

export function filingIndexQuarterForReportQuarter(quarterKey: string): { year: number; quarter: number } {
    const { year, quarter } = parseQuarterKey(quarterKey);
    return quarter === 4 ? { year: year + 1, quarter: 1 } : { year, quarter: quarter + 1 };
}

export function mostRecentCompletedReportQuarter(asOf = new Date()): string {
    const year = asOf.getUTCFullYear();
    const month = asOf.getUTCMonth();
    const currentQuarter = Math.floor(month / 3) + 1;
    const currentQuarterEnd = new Date(Date.UTC(year, currentQuarter * 3, 0));
    if (asOf.getTime() > currentQuarterEnd.getTime()) {
        return `${year}-Q${currentQuarter}`;
    }
    return currentQuarter === 1 ? `${year - 1}-Q4` : `${year}-Q${currentQuarter - 1}`;
}

export function resolveIngestionSchedule(quarter = mostRecentCompletedReportQuarter(), asOf = new Date()): IngestionSchedule {
    const quarterEnd = quarterEndDateString(quarter);
    const liveWindowStart = quarterEnd;
    const liveWindowEnd = addDays(quarterEnd, 60);
    const bulkWindowStart = filingDeadlineDateString(quarter);
    const bulkWindowEnd = addDays(bulkWindowStart, 30);
    const filingIndex = filingIndexQuarterForReportQuarter(quarter);
    const asOfDay = isoDate(asOf);

    return {
        quarter,
        asOf: asOfDay,
        liveActive: asOfDay >= liveWindowStart && asOfDay <= liveWindowEnd,
        bulkActive: asOfDay >= bulkWindowStart && asOfDay <= bulkWindowEnd,
        liveWindowStart,
        liveWindowEnd,
        bulkWindowStart,
        bulkWindowEnd,
        filingIndexYear: filingIndex.year,
        filingIndexQuarter: filingIndex.quarter,
    };
}

export function expectedSecDatasetLabelForQuarter(quarterKey: string): string {
    const { year, quarter } = parseQuarterKey(quarterKey);
    if (quarter === 1) return `${year} March April May 13F`;
    if (quarter === 2) return `${year} June July August 13F`;
    if (quarter === 3) return `${year} September October November 13F`;
    return `${year} December ${year + 1} January February 13F`;
}

export async function resolveSecDatasetUrlForQuarter(quarterKey: string): Promise<{ url: string | null; label: string }> {
    const label = expectedSecDatasetLabelForQuarter(quarterKey);
    const html = await fetchTextWithRetry(SEC_DATASETS_PAGE);
    const normalizedExpected = normalizeHtmlText(label);
    const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorPattern.exec(html)) !== null) {
        const href = match[1];
        const text = normalizeHtmlText(match[2]);
        if (text.includes(normalizedExpected)) {
            return { url: new URL(href, SEC_DATASETS_PAGE).toString(), label };
        }
    }
    return { url: null, label };
}

export function selectSecDatasetSubmissionsForQuarter(rows: TsvRow[], quarterKey: string): TsvRow[] {
    const quarterEnd = quarterEndDateString(quarterKey);
    return rows.filter((row) => {
        const form = (row.SUBMISSIONTYPE || '').toUpperCase();
        return ['13F-HR', '13F-HR/A'].includes(form) && normalizeSecDate(row.PERIODOFREPORT || '') === quarterEnd;
    });
}

export function buildReportQuarterDistribution(rows: TsvRow[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const row of rows) {
        const quarter = quarterFromReportDate(row.PERIODOFREPORT || '') || 'missing';
        distribution[quarter] = (distribution[quarter] || 0) + 1;
    }
    return distribution;
}

export async function ensure13FSchema(turso: TursoClient) {
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
                    report_date TEXT,
                    source TEXT,
                    ingested_at TEXT
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
        {
            label: 'ingestion runs table',
            sql: `
                CREATE TABLE IF NOT EXISTS ingestion_runs (
                    id TEXT PRIMARY KEY,
                    quarter TEXT,
                    source TEXT,
                    source_url TEXT,
                    started_at TEXT,
                    completed_at TEXT,
                    status TEXT,
                    filings_seen INTEGER,
                    filings_upserted INTEGER,
                    holdings_inserted INTEGER,
                    error_text TEXT
                )
            `,
        },
        { label: 'holdings issuer index', sql: 'CREATE INDEX IF NOT EXISTS idx_holdings_issuer ON holdings(issuer)' },
        { label: 'holdings cusip index', sql: 'CREATE INDEX IF NOT EXISTS idx_holdings_cusip ON holdings(cusip)' },
        { label: 'holdings accession index', sql: 'CREATE INDEX IF NOT EXISTS idx_holdings_accession ON holdings(accession_number)' },
        { label: 'filings quarter/cik index', sql: 'CREATE INDEX IF NOT EXISTS idx_filings_quarter_cik ON filings(quarter, cik)' },
        { label: 'ingestion runs status index', sql: 'CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(quarter, source, status)' },
    ];

    for (const statement of schemaStatements) {
        console.log(`[13F Ingestion] Ensuring ${statement.label}...`);
        await executeWithRetry(turso, statement.sql);
    }

    await ensureColumn(turso, 'filings', 'form', 'TEXT');
    await ensureColumn(turso, 'filings', 'report_date', 'TEXT');
    await ensureColumn(turso, 'filings', 'source', 'TEXT');
    await ensureColumn(turso, 'filings', 'ingested_at', 'TEXT');
    await ensureColumn(turso, 'holdings', 'putcall', 'TEXT');
    await ensureColumn(turso, 'holdings', 'ssh_prnamt_type', 'TEXT');
    await ensureColumn(turso, 'ingestion_runs', 'report_quarter_matches', 'INTEGER');
    await ensureColumn(turso, 'ingestion_runs', 'skipped_existing', 'INTEGER');
    await ensureColumn(turso, 'ingestion_runs', 'skipped_wrong_quarter', 'INTEGER');
    await ensureColumn(turso, 'ingestion_runs', 'skipped_no_holdings', 'INTEGER');
    await ensureColumn(turso, 'ingestion_runs', 'skipped_errors', 'INTEGER');
    await executeWithRetry(turso, 'CREATE INDEX IF NOT EXISTS idx_filings_source ON filings(source)');
}

export async function startIngestionRun(
    turso: TursoClient,
    params: { quarter: string; source: IngestionSource; sourceUrl: string }
): Promise<string> {
    const id = `${params.source}-${params.quarter}-${Date.now()}`;
    await executeWithArgsRetry(
        turso,
        `
            UPDATE ingestion_runs
            SET completed_at = ?, status = 'interrupted', error_text = 'Superseded by a later ingestion run.'
            WHERE quarter = ? AND source = ? AND status = 'running'
        `,
        [new Date().toISOString(), params.quarter, params.source]
    );
    await executeWithArgsRetry(
        turso,
        `
            INSERT INTO ingestion_runs
                (id, quarter, source, source_url, started_at, completed_at, status, filings_seen, filings_upserted, holdings_inserted, error_text)
            VALUES (?, ?, ?, ?, ?, NULL, 'running', 0, 0, 0, NULL)
        `,
        [id, params.quarter, params.source, params.sourceUrl, new Date().toISOString()]
    );
    return id;
}

export async function completeIngestionRun(turso: TursoClient, id: string, counts: IngestionRunCounts) {
    await executeWithArgsRetry(
        turso,
        `
            UPDATE ingestion_runs
            SET
                completed_at = ?,
                status = 'success',
                filings_seen = ?,
                filings_upserted = ?,
                holdings_inserted = ?,
                report_quarter_matches = ?,
                skipped_existing = ?,
                skipped_wrong_quarter = ?,
                skipped_no_holdings = ?,
                skipped_errors = ?,
                error_text = NULL
            WHERE id = ?
        `,
        [
            new Date().toISOString(),
            counts.filingsSeen,
            counts.filingsUpserted,
            counts.holdingsInserted,
            counts.reportQuarterMatches || 0,
            counts.skippedExisting || 0,
            counts.skippedWrongQuarter || 0,
            counts.skippedNoHoldings || 0,
            counts.skippedErrors || 0,
            id,
        ]
    );
}

export async function failIngestionRun(turso: TursoClient, id: string, error: unknown) {
    await executeWithArgsRetry(
        turso,
        `
            UPDATE ingestion_runs
            SET completed_at = ?, status = 'failed', error_text = ?
            WHERE id = ?
        `,
        [new Date().toISOString(), error instanceof Error ? error.message : String(error), id]
    );
}

export async function hasSuccessfulIngestionRun(
    turso: TursoClient,
    params: { quarter: string; source: IngestionSource }
): Promise<boolean> {
    try {
        const result = await turso.execute({
            sql: `
                SELECT 1
                FROM ingestion_runs
                WHERE quarter = ? AND source = ? AND status = 'success'
                LIMIT 1
            `,
            args: [params.quarter, params.source],
        });
        return result.rows.length > 0;
    } catch {
        return false;
    }
}

export async function getIngestionRunStatus(
    turso: TursoClient,
    params: { quarter: string; source: IngestionSource }
): Promise<IngestionRunStatus> {
    const latest = await turso.execute({
        sql: `
            SELECT status
            FROM ingestion_runs
            WHERE quarter = ? AND source = ?
            ORDER BY started_at DESC
            LIMIT 1
        `,
        args: [params.quarter, params.source],
    });
    const latestStatus = latest.rows.length > 0 ? String(latest.rows[0].status || '') : '';
    const done = await hasSuccessfulIngestionRun(turso, params);
    const liveMode = liveRefreshModeForLatestStatus(latestStatus);
    return {
        done,
        hasRun: latest.rows.length > 0,
        latestStatus,
        liveMode,
        refreshExisting: liveMode === 'refresh-existing',
    };
}

export function liveRefreshModeForLatestStatus(status: string | null | undefined): 'full' | 'incremental' | 'refresh-existing' {
    if (status === 'success') return 'incremental';
    if (status === 'failed' || status === 'interrupted' || status === 'running') return 'refresh-existing';
    return 'full';
}

export async function listTableIndexes(turso: TursoClient, table: string): Promise<string[]> {
    const result = await turso.execute(`PRAGMA index_list('${table.replace(/'/g, "''")}')`);
    return result.rows.map((row) => String(row.name)).filter(Boolean);
}

export function missingRequiredHoldingIndexes(indexes: string[]): string[] {
    const present = new Set(indexes);
    return REQUIRED_HOLDINGS_INDEXES.filter((name) => !present.has(name));
}

export async function ensureRequired13FIndexes(turso: TursoClient) {
    await executeWithRetry(turso, 'CREATE INDEX IF NOT EXISTS idx_holdings_accession ON holdings(accession_number)');
    await executeWithRetry(turso, 'CREATE INDEX IF NOT EXISTS idx_holdings_issuer ON holdings(issuer)');
    await executeWithRetry(turso, 'CREATE INDEX IF NOT EXISTS idx_holdings_cusip ON holdings(cusip)');
    await executeWithRetry(turso, 'CREATE INDEX IF NOT EXISTS idx_filings_quarter_cik ON filings(quarter, cik)');
    await executeWithRetry(turso, 'CREATE INDEX IF NOT EXISTS idx_filings_source ON filings(source)');
    await executeWithRetry(turso, 'CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(quarter, source, status)');
}

export async function dropHoldingSearchIndexes(turso: TursoClient) {
    await executeWithRetry(turso, 'DROP INDEX IF EXISTS idx_holdings_issuer');
    await executeWithRetry(turso, 'DROP INDEX IF EXISTS idx_holdings_cusip');
}

export async function executeWithRetry(turso: TursoClient, sql: string, attempts = 5) {
    await executeWithArgsRetry(turso, sql, [], attempts);
}

export async function executeWithArgsRetry(
    turso: TursoClient,
    sql: string,
    args: InValue[],
    attempts = 9
) {
    let delayMs = 1000;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await withTimeout(
                turso.execute({ sql, args }),
                TURSO_REQUEST_TIMEOUT_MS,
                `Turso statement timed out after ${TURSO_REQUEST_TIMEOUT_MS}ms`
            );
            return;
        } catch (error) {
            if (attempt === attempts) throw error;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[13F Ingestion] Statement failed (${message}). Retry ${attempt}/${attempts - 1} in ${delayMs}ms.`);
            await sleep(delayMs);
            delayMs = Math.min(delayMs * 2, 60000);
        }
    }
}

export async function batchWithRetry(
    turso: TursoClient,
    statements: Array<{ sql: string; args: InValue[] }>,
    attempts = 9
) {
    if (statements.length === 0) return;
    let delayMs = 1000;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await withTimeout(
                turso.batch(statements, 'write'),
                TURSO_REQUEST_TIMEOUT_MS,
                `Turso batch timed out after ${TURSO_REQUEST_TIMEOUT_MS}ms`
            );
            return;
        } catch (error) {
            if (attempt === attempts) throw error;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[13F Ingestion] Batch failed (${message}). Retry ${attempt}/${attempts - 1} in ${delayMs}ms.`);
            await sleep(delayMs);
            delayMs = Math.min(delayMs * 2, 60000);
        }
    }
}

export async function ensureColumn(turso: TursoClient, table: string, column: string, type: string) {
    const result = await turso.execute(`PRAGMA table_info(${table})`);
    const columns = new Set(result.rows.map((row) => String(row.name)));
    if (columns.has(column)) return;
    await turso.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export async function fetchTextWithRetry(url: string, attempts = 5): Promise<string> {
    let delayMs = 1000;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetchWithTimeout(url);
            if (response.ok) {
                return await withTimeout(
                    response.text(),
                    SEC_FETCH_TIMEOUT_MS,
                    `SEC response body timed out after ${SEC_FETCH_TIMEOUT_MS}ms fetching ${url}`
                );
            }
            if (attempt === attempts) throw new Error(`HTTP ${response.status} fetching ${url}`);
        } catch (error) {
            if (attempt === attempts) throw error;
        }
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 15000);
    }
    throw new Error(`Failed to fetch ${url}`);
}

export async function fetchJsonWithRetry<T>(url: string, attempts = 5): Promise<T | null> {
    let delayMs = 1000;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetchWithTimeout(url);
            if (response.ok) return response.json() as Promise<T>;
            if (response.status === 404) return null;
            if (attempt === attempts) throw new Error(`HTTP ${response.status} fetching ${url}`);
        } catch (error) {
            if (attempt === attempts) throw error;
        }
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 15000);
    }
    return null;
}

export async function parseLive13FXmlText(xmlContent: string): Promise<ParsedLive13FXml> {
    const cleanXml = xmlContent.replace(/<([a-zA-Z0-9]+):/g, '<').replace(/<\/([a-zA-Z0-9]+):/g, '</');
    const parsed = await parseStringPromise(cleanXml, {
        explicitArray: true,
        ignoreAttrs: false,
        tagNameProcessors: [(name: string) => name.toLowerCase()],
    });
    const reportDate = normalizeSecDate(findFirstTextByKeys(parsed, ['periodofreport', 'reportcalendarorquarter']) || '');
    const infoTableRows = collectInfoTableRows(parsed);
    const holdings = infoTableRows
        .map(parseInfoTableHolding)
        .filter((holding): holding is HoldingInput => holding !== null);
    return { reportDate: reportDate || null, holdings };
}

export async function parseLive13FSubmissionText(submissionText: string): Promise<ParsedLive13FXml> {
    const xmlSegments = Array.from(submissionText.matchAll(/<XML>([\s\S]*?)<\/XML>/gi)).map((match) => match[1]);
    const candidates = xmlSegments.length > 0 ? xmlSegments : [submissionText];
    let reportDate: string | null = null;
    let holdings: HoldingInput[] = [];

    for (const candidate of candidates) {
        try {
            const parsed = await parseLive13FXmlText(candidate);
            if (!reportDate && parsed.reportDate) reportDate = parsed.reportDate;
            if (parsed.holdings.length > holdings.length) holdings = parsed.holdings;
        } catch {
            // Filing submission wrappers often contain non-XML documents; ignore those blocks.
        }
    }

    return { reportDate, holdings };
}

export function parseTsv(text: string): TsvRow[] {
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

export function normalizeSecDate(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const yyyymmdd = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (yyyymmdd) return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return trimmed;
}

export function parseNumber(value: string | undefined): number {
    const parsed = Number.parseFloat((value || '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

export function chunkRows<T>(rows: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < rows.length; i += size) {
        chunks.push(rows.slice(i, i + size));
    }
    return chunks;
}

function parseInfoTableHolding(row: unknown): HoldingInput | null {
    const issuer = (findFirstTextByKeys(row, ['nameofissuer']) || 'Unknown').toUpperCase();
    const cusip = findFirstTextByKeys(row, ['cusip']) || null;
    const value = parseNumber(findFirstTextByKeys(row, ['value']) || '0');
    const shares = parseNumber(findFirstTextByKeys(row, ['sshprnamt']) || '0');
    if (!issuer && !cusip) return null;
    return {
        issuer,
        cusip,
        value,
        shares,
        putcall: findFirstTextByKeys(row, ['putcall']) || null,
        sshPrnamtType: findFirstTextByKeys(row, ['sshprnamttype']) || null,
    };
}

function collectInfoTableRows(node: unknown, rows: unknown[] = []): unknown[] {
    if (Array.isArray(node)) {
        for (const item of node) collectInfoTableRows(item, rows);
        return rows;
    }
    if (!node || typeof node !== 'object') return rows;

    for (const [key, value] of Object.entries(node)) {
        if (key.toLowerCase() === 'infotable') {
            if (Array.isArray(value)) rows.push(...value);
            else rows.push(value);
            continue;
        }
        collectInfoTableRows(value, rows);
    }
    return rows;
}

function findFirstTextByKeys(node: unknown, keys: string[]): string | null {
    if (node === null || node === undefined) return null;
    if (typeof node === 'string' || typeof node === 'number') return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findFirstTextByKeys(item, keys);
            if (found) return found;
        }
        return null;
    }
    if (typeof node !== 'object') return null;

    for (const [key, value] of Object.entries(node)) {
        if (keys.includes(key.toLowerCase())) {
            const text = firstText(value);
            if (text) return text;
        }
    }
    for (const value of Object.values(node)) {
        const found = findFirstTextByKeys(value, keys);
        if (found) return found;
    }
    return null;
}

function firstText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = firstText(item);
            if (text) return text;
        }
        return null;
    }
    if (typeof value === 'object') {
        if ('_' in value) return firstText((value as { _: unknown })._);
        for (const nested of Object.values(value)) {
            const text = firstText(nested);
            if (text) return text;
        }
    }
    return null;
}

function normalizeHeader(value: string): string {
    return value.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function normalizeHtmlText(value: string): string {
    return value
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function addDays(dateString: string, days: number): string {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return isoDate(date);
}

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEC_FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, {
            headers: { 'User-Agent': SEC_USER_AGENT },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
