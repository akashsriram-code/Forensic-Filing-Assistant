import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';

export const POSTGRES_13F_SIZE_TARGET_BYTES = 480 * 1024 * 1024;
export const REQUIRED_POSTGRES_13F_INDEXES = [
    'idx_pg_filings_quarter_cik',
    'idx_pg_holdings_accession',
    'idx_pg_holdings_security',
    'idx_pg_securities_issuer_search',
    'idx_pg_securities_cusip',
] as const;

export type PostgresExecutor = Pool | PoolClient;
export type PostgresIngestionSource = 'live-edgar' | 'sec-bulk' | 'turso-migration';

export interface Postgres13FFilingInput {
    accessionNumber: string;
    cik: string;
    fundName: string;
    filingDate: string;
    quarter: string;
    form: string | null;
    reportDate: string | null;
    source: PostgresIngestionSource | string;
    ingestedAt?: string | null;
}

export interface Postgres13FHoldingInput {
    accessionNumber: string;
    issuer: string;
    cusip: string | null;
    value: number;
    shares: number;
    putcall: string | null;
    sshPrnamtType: string | null;
}

export interface PostgresIngestionRunCounts {
    filingsSeen: number;
    filingsUpserted: number;
    holdingsInserted: number;
    reportQuarterMatches?: number;
    skippedExisting?: number;
    skippedWrongQuarter?: number;
    skippedNoHoldings?: number;
    skippedErrors?: number;
}

export interface PostgresIngestionRunStatus {
    done: boolean;
    hasRun: boolean;
    latestStatus: string;
    liveMode: 'full' | 'incremental' | 'refresh-existing';
    refreshExisting: boolean;
}

const FUND_INSERT_CHUNK_SIZE = 500;
const FILING_INSERT_CHUNK_SIZE = 500;
const SECURITY_INSERT_CHUNK_SIZE = 500;
const HOLDING_INSERT_CHUNK_SIZE = 1000;
const ACCESSION_DELETE_CHUNK_SIZE = 500;

export function getPostgresConnectionString(): string | null {
    return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

export function createPostgresPool(connectionString = getPostgresConnectionString()): Pool {
    if (!connectionString) {
        throw new Error('Missing DATABASE_URL or POSTGRES_URL for Postgres 13F Radar.');
    }

    const normalizedConnectionString = normalizePostgresConnectionStringForNode(connectionString);
    const isLocal = /localhost|127\.0\.0\.1/i.test(normalizedConnectionString);
    const hasSslMode = /[?&]sslmode=/i.test(normalizedConnectionString);
    const config: PoolConfig & { enableChannelBinding?: boolean } = {
        connectionString: normalizedConnectionString,
        max: 4,
        ssl: isLocal || hasSslMode ? undefined : { rejectUnauthorized: false },
    };
    if (/[?&]channel_binding=require/i.test(normalizedConnectionString)) {
        config.enableChannelBinding = true;
    }

    return new Pool(config);
}

function normalizePostgresConnectionStringForNode(connectionString: string): string {
    const needsLibpqCompat = /[?&]sslmode=(require|prefer)(?:&|$)/i.test(connectionString) &&
        !/[?&]uselibpqcompat=/i.test(connectionString);
    if (!needsLibpqCompat) return connectionString;

    return `${connectionString}${connectionString.includes('?') ? '&' : '?'}uselibpqcompat=true`;
}

export async function ensurePostgres13FSchema(db: PostgresExecutor) {
    await db.query(`
        CREATE TABLE IF NOT EXISTS funds (
            cik TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            ticker TEXT
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS filings (
            accession_number TEXT PRIMARY KEY,
            cik TEXT NOT NULL REFERENCES funds(cik) ON DELETE CASCADE,
            filing_date TEXT NOT NULL,
            quarter TEXT NOT NULL,
            form TEXT,
            report_date TEXT,
            source TEXT,
            ingested_at TEXT
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS securities (
            security_key TEXT PRIMARY KEY,
            issuer TEXT NOT NULL,
            issuer_search TEXT NOT NULL,
            cusip TEXT
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS holdings (
            accession_number TEXT NOT NULL REFERENCES filings(accession_number) ON DELETE CASCADE,
            security_key TEXT NOT NULL REFERENCES securities(security_key) ON DELETE RESTRICT,
            value DOUBLE PRECISION NOT NULL DEFAULT 0,
            shares DOUBLE PRECISION NOT NULL DEFAULT 0,
            putcall TEXT,
            ssh_prnamt_type TEXT
        )
    `);
    await db.query(`
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
            report_quarter_matches INTEGER,
            skipped_existing INTEGER,
            skipped_wrong_quarter INTEGER,
            skipped_no_holdings INTEGER,
            skipped_errors INTEGER,
            error_text TEXT
        )
    `);
}

export async function ensurePostgres13FIndexes(db: PostgresExecutor) {
    await db.query('CREATE INDEX IF NOT EXISTS idx_pg_filings_quarter_cik ON filings(quarter, cik)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_pg_filings_source ON filings(source)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_pg_holdings_accession ON holdings(accession_number)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_pg_holdings_security ON holdings(security_key)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_pg_securities_issuer_search ON securities(issuer_search)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_pg_securities_cusip ON securities(cusip)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_pg_ingestion_runs_status ON ingestion_runs(quarter, source, status)');
}

export async function listPostgres13FIndexes(db: PostgresExecutor): Promise<string[]> {
    const result = await db.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY indexname
    `);
    return result.rows.map((row) => String(row.indexname)).filter(Boolean);
}

export function missingRequiredPostgres13FIndexes(indexes: string[]): string[] {
    const present = new Set(indexes);
    return REQUIRED_POSTGRES_13F_INDEXES.filter((name) => !present.has(name));
}

export async function dropPostgres13FIndexes(db: PostgresExecutor) {
    await db.query('DROP INDEX IF EXISTS idx_pg_filings_quarter_cik');
    await db.query('DROP INDEX IF EXISTS idx_pg_filings_source');
    await db.query('DROP INDEX IF EXISTS idx_pg_holdings_accession');
    await db.query('DROP INDEX IF EXISTS idx_pg_holdings_security');
    await db.query('DROP INDEX IF EXISTS idx_pg_securities_issuer_search');
    await db.query('DROP INDEX IF EXISTS idx_pg_securities_cusip');
    await db.query('DROP INDEX IF EXISTS idx_pg_ingestion_runs_status');
}

export async function clearPostgres13FData(db: PostgresExecutor) {
    await db.query('TRUNCATE TABLE holdings, filings, securities, funds, ingestion_runs');
}

export async function startPostgresIngestionRun(
    db: PostgresExecutor,
    params: { quarter: string; source: PostgresIngestionSource; sourceUrl: string }
): Promise<string> {
    const id = `${params.source}-${params.quarter}-${Date.now()}`;
    await db.query(
        `
            UPDATE ingestion_runs
            SET completed_at = $1, status = 'interrupted', error_text = 'Superseded by a later ingestion run.'
            WHERE quarter = $2 AND source = $3 AND status = 'running'
        `,
        [new Date().toISOString(), params.quarter, params.source]
    );
    await db.query(
        `
            INSERT INTO ingestion_runs
                (id, quarter, source, source_url, started_at, completed_at, status, filings_seen, filings_upserted, holdings_inserted, error_text)
            VALUES ($1, $2, $3, $4, $5, NULL, 'running', 0, 0, 0, NULL)
        `,
        [id, params.quarter, params.source, params.sourceUrl, new Date().toISOString()]
    );
    return id;
}

export async function completePostgresIngestionRun(
    db: PostgresExecutor,
    id: string,
    counts: PostgresIngestionRunCounts
) {
    await db.query(
        `
            UPDATE ingestion_runs
            SET
                completed_at = $1,
                status = 'success',
                filings_seen = $2,
                filings_upserted = $3,
                holdings_inserted = $4,
                report_quarter_matches = $5,
                skipped_existing = $6,
                skipped_wrong_quarter = $7,
                skipped_no_holdings = $8,
                skipped_errors = $9,
                error_text = NULL
            WHERE id = $10
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

export async function failPostgresIngestionRun(db: PostgresExecutor, id: string, error: unknown) {
    await db.query(
        `
            UPDATE ingestion_runs
            SET completed_at = $1, status = 'failed', error_text = $2
            WHERE id = $3
        `,
        [new Date().toISOString(), error instanceof Error ? error.message : String(error), id]
    );
}

export async function getPostgresIngestionRunStatus(
    db: PostgresExecutor,
    params: { quarter: string; source: PostgresIngestionSource }
): Promise<PostgresIngestionRunStatus> {
    const latest = await db.query(
        `
            SELECT status
            FROM ingestion_runs
            WHERE quarter = $1 AND source = $2
            ORDER BY started_at DESC
            LIMIT 1
        `,
        [params.quarter, params.source]
    );
    const doneResult = await db.query(
        `
            SELECT 1
            FROM ingestion_runs
            WHERE quarter = $1 AND source = $2 AND status = 'success'
            LIMIT 1
        `,
        [params.quarter, params.source]
    );
    const latestStatus = latest.rows.length > 0 ? String(latest.rows[0].status || '') : '';
    const liveMode = liveRefreshModeForStatus(latestStatus);
    return {
        done: doneResult.rows.length > 0,
        hasRun: latest.rows.length > 0,
        latestStatus,
        liveMode,
        refreshExisting: liveMode === 'refresh-existing',
    };
}

export async function queryPostgresExistingAccessions(db: PostgresExecutor, quarter: string): Promise<Set<string>> {
    const result = await db.query('SELECT accession_number FROM filings WHERE quarter = $1', [quarter]);
    return new Set(result.rows.map((row) => String(row.accession_number)));
}

export async function upsertPostgres13FFilings(
    db: PostgresExecutor,
    filings: Postgres13FFilingInput[]
): Promise<number> {
    if (filings.length === 0) return 0;
    const ingestedAt = new Date().toISOString();
    const funds = new Map<string, { cik: string; name: string }>();
    for (const filing of filings) {
        funds.set(filing.cik, { cik: filing.cik, name: filing.fundName || filing.cik });
    }

    for (const chunk of chunkArray(Array.from(funds.values()), FUND_INSERT_CHUNK_SIZE)) {
        const args = chunk.flatMap((fund) => [fund.cik, fund.name, null]);
        await db.query(
            `
                INSERT INTO funds (cik, name, ticker)
                VALUES ${postgresValuePlaceholders(chunk.length, 3)}
                ON CONFLICT (cik) DO UPDATE SET
                    name = EXCLUDED.name,
                    ticker = COALESCE(funds.ticker, EXCLUDED.ticker)
            `,
            args
        );
    }

    let processed = 0;
    for (const chunk of chunkArray(filings, FILING_INSERT_CHUNK_SIZE)) {
        const args = chunk.flatMap((filing) => [
            filing.accessionNumber,
            filing.cik,
            filing.filingDate,
            filing.quarter,
            filing.form,
            filing.reportDate,
            filing.source,
            filing.ingestedAt || ingestedAt,
        ]);
        await db.query(
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
        processed += chunk.length;
    }
    return processed;
}

export async function replacePostgres13FHoldings(
    db: PostgresExecutor,
    params: {
        accessions: string[];
        holdings: Postgres13FHoldingInput[];
        holdingInsertChunkSize?: number;
    }
): Promise<number> {
    const accessions = Array.from(new Set(params.accessions.filter(Boolean)));
    for (const chunk of chunkArray(accessions, ACCESSION_DELETE_CHUNK_SIZE)) {
        const placeholders = chunk.map((_, index) => `$${index + 1}`).join(', ');
        await db.query(`DELETE FROM holdings WHERE accession_number IN (${placeholders})`, chunk);
    }

    await upsertPostgresSecurities(db, params.holdings);
    const insertChunkSize = params.holdingInsertChunkSize || HOLDING_INSERT_CHUNK_SIZE;
    let inserted = 0;
    for (const chunk of chunkArray(params.holdings, insertChunkSize)) {
        const args = chunk.flatMap((holding) => {
            const issuer = normalizePostgresIssuer(holding.issuer);
            return [
                holding.accessionNumber,
                buildPostgresSecurityKey(issuer, holding.cusip),
                normalizeFiniteNumber(holding.value),
                normalizeFiniteNumber(holding.shares),
                normalizeNullableString(holding.putcall),
                normalizeNullableString(holding.sshPrnamtType),
            ];
        });
        await db.query(
            `
                INSERT INTO holdings
                    (accession_number, security_key, value, shares, putcall, ssh_prnamt_type)
                VALUES ${postgresValuePlaceholders(chunk.length, 6)}
            `,
            args
        );
        inserted += chunk.length;
    }

    return inserted;
}

export async function retainPostgres13FQuarters(db: PostgresExecutor, quartersToKeep: string[]) {
    const keep = Array.from(new Set(quartersToKeep.filter(Boolean)));
    if (keep.length === 0) return;
    const placeholders = keep.map((_, index) => `$${index + 1}`).join(', ');
    await db.query(`DELETE FROM filings WHERE quarter NOT IN (${placeholders})`, keep);
    await db.query(`
        DELETE FROM securities s
        WHERE NOT EXISTS (
            SELECT 1
            FROM holdings h
            WHERE h.security_key = s.security_key
        )
    `);
}

export async function queryPostgresDatabaseSize(db: PostgresExecutor): Promise<number> {
    const result = await db.query('SELECT pg_database_size(current_database()) AS size_bytes');
    return Number(result.rows[0]?.size_bytes || 0);
}

export async function queryPostgresTableSizes(db: PostgresExecutor): Promise<Array<{ tableName: string; sizeBytes: number }>> {
    const result = await db.query(`
        SELECT
            relname AS table_name,
            pg_total_relation_size(c.oid) AS size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND relkind IN ('r', 'i')
          AND relname IN (
              'funds',
              'filings',
              'securities',
              'holdings',
              'ingestion_runs',
              'idx_pg_filings_quarter_cik',
              'idx_pg_holdings_accession',
              'idx_pg_holdings_security',
              'idx_pg_securities_issuer_search',
              'idx_pg_securities_cusip'
          )
        ORDER BY size_bytes DESC
    `);
    return result.rows.map((row) => ({
        tableName: String(row.table_name),
        sizeBytes: Number(row.size_bytes || 0),
    }));
}

export function buildPostgresSecurityKey(issuer: string, cusip: string | null | undefined): string {
    const normalizedIssuer = normalizePostgresIssuer(issuer);
    const normalizedCusip = String(cusip || '').trim().toUpperCase();
    return `${normalizedCusip || 'NO_CUSIP'}|${normalizedIssuer}`;
}

export function normalizePostgresIssuer(issuer: string): string {
    const normalized = String(issuer || '').trim().replace(/\s+/g, ' ').toUpperCase();
    return normalized || 'UNKNOWN';
}

async function upsertPostgresSecurities(db: PostgresExecutor, holdings: Postgres13FHoldingInput[]) {
    const securities = new Map<string, { securityKey: string; issuer: string; issuerSearch: string; cusip: string | null }>();
    for (const holding of holdings) {
        const issuer = normalizePostgresIssuer(holding.issuer);
        const cusip = normalizeNullableString(holding.cusip);
        const securityKey = buildPostgresSecurityKey(issuer, cusip);
        securities.set(securityKey, {
            securityKey,
            issuer,
            issuerSearch: issuer,
            cusip,
        });
    }

    for (const chunk of chunkArray(Array.from(securities.values()), SECURITY_INSERT_CHUNK_SIZE)) {
        const args = chunk.flatMap((security) => [
            security.securityKey,
            security.issuer,
            security.issuerSearch,
            security.cusip,
        ]);
        await db.query(
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

function liveRefreshModeForStatus(status: string | null | undefined): 'full' | 'incremental' | 'refresh-existing' {
    if (status === 'success') return 'incremental';
    if (status === 'failed' || status === 'interrupted' || status === 'running') return 'refresh-existing';
    return 'full';
}

function normalizeNullableString(value: string | null | undefined): string | null {
    const text = String(value || '').trim();
    return text || null;
}

function normalizeFiniteNumber(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

export function toPostgresSql(sql: string): string {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
}

export function postgresValuePlaceholders(rowCount: number, columnCount: number, startIndex = 1): string {
    const rows: string[] = [];
    let argIndex = startIndex;
    for (let row = 0; row < rowCount; row++) {
        const placeholders: string[] = [];
        for (let column = 0; column < columnCount; column++) {
            placeholders.push(`$${argIndex++}`);
        }
        rows.push(`(${placeholders.join(', ')})`);
    }
    return rows.join(', ');
}

export async function queryPostgresRows<T extends QueryResultRow = QueryResultRow>(
    db: PostgresExecutor,
    sql: string,
    args: unknown[] = []
): Promise<QueryResult<T>> {
    return db.query<T>(toPostgresSql(sql), args);
}
