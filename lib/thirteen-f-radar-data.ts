import { createClient } from '@libsql/client';
import { type InValue } from '@libsql/client';
import { type Pool } from 'pg';
import {
    DEFAULT_RADAR_WATCHLISTS,
    buildIssuerSqlPatterns,
    buildRadarComparison,
    compareQuartersAsc,
    matchIssuerToWatchlists,
    normalizeCik,
    selectLatestFilings,
    sortQuartersDesc,
    type FilerSideMatch,
    type MovementBasis,
    type RadarComparison,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from './thirteen-f-radar-core';
import {
    createPostgresPool,
    getPostgresConnectionString,
    queryPostgresRows,
} from './thirteen-f-radar-postgres';

export const MISSING_TURSO_ERROR =
    'Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN. 13F Radar needs the Turso holdings database.';
export const MISSING_POSTGRES_ERROR =
    'Missing DATABASE_URL or POSTGRES_URL. 13F Radar is configured for Postgres.';

const HOLDING_QUERY_CHUNK_SIZE = 500;
const HOLDING_QUERY_CONCURRENCY = 12;

export type TursoClient = ReturnType<typeof createClient>;
export type RadarDbProvider = 'turso' | 'postgres';
export type RadarDbClient =
    | { provider: 'turso'; client: TursoClient }
    | { provider: 'postgres'; pool: Pool };
type DbRow = Record<string, unknown>;

let cachedPostgresPool: Pool | null = null;

export interface RadarRequestBody {
    currentQuarter?: unknown;
    previousQuarter?: unknown;
    categories?: unknown;
    watchlists?: unknown;
    movementBasis?: unknown;
}

export interface DbShape {
    holdingsColumns: string[];
    putCallColumn: string | null;
}

export interface ResolvedRadarRequest {
    currentQuarter: string;
    previousQuarter: string;
    availableQuarters: string[];
    watchlists: RadarWatchlist[];
    selectedCategories: string[];
    movementBasis: MovementBasis;
    dbShape: DbShape;
}

export interface LoadedRadarComparison {
    comparison: RadarComparison;
    filings: RadarFilingRow[];
    holdings: RadarHoldingRow[];
}

export class RadarDataError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'RadarDataError';
        this.status = status;
    }
}

export async function readRadarRequestBody(req: Request): Promise<RadarRequestBody> {
    try {
        return (await req.json()) as RadarRequestBody;
    } catch {
        return {};
    }
}

export function resolveRadarDbProviderFromEnv(): RadarDbProvider {
    const explicit = process.env.THIRTEEN_F_DB_PROVIDER?.trim().toLowerCase();
    if (explicit === 'postgres') return 'postgres';
    if (explicit === 'turso') return 'turso';
    if (getPostgresConnectionString() && (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN)) {
        return 'postgres';
    }
    return 'turso';
}

export function createRadarClientFromEnv(): RadarDbClient {
    const provider = resolveRadarDbProviderFromEnv();
    if (provider === 'postgres') {
        const connectionString = getPostgresConnectionString();
        if (!connectionString) {
            throw new RadarDataError(MISSING_POSTGRES_ERROR, 500);
        }
        cachedPostgresPool ||= createPostgresPool(connectionString);
        return { provider, pool: cachedPostgresPool };
    }

    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url || !authToken) {
        throw new RadarDataError(MISSING_TURSO_ERROR, 500);
    }

    return { provider, client: createClient({ url, authToken }) };
}

export async function resolveRadarRequest(
    db: RadarDbClient,
    body: RadarRequestBody
): Promise<ResolvedRadarRequest> {
    const availableQuarters = await queryAvailableQuarters(db);

    if (availableQuarters.length < 2) {
        throw new RadarDataError('Need at least two ingested 13F quarters to build the radar.', 404);
    }

    const currentQuarter = pickCurrentQuarter(body.currentQuarter, availableQuarters);
    const previousQuarter = pickPreviousQuarter(body.previousQuarter, currentQuarter, availableQuarters);

    if (!currentQuarter || !previousQuarter) {
        throw new RadarDataError('Could not resolve a comparable current and previous quarter.', 400);
    }

    const watchlists = normalizeWatchlists(body.watchlists);
    const selectedCategories = normalizeCategories(body.categories, watchlists);
    const movementBasis: MovementBasis = body.movementBasis === 'filer-count' ? 'filer-count' : 'filer-count';
    const dbShape = await inspectDbShape(db);

    return {
        currentQuarter,
        previousQuarter,
        availableQuarters,
        watchlists,
        selectedCategories,
        movementBasis,
        dbShape,
    };
}

export async function loadRadarComparison(
    db: RadarDbClient,
    request: ResolvedRadarRequest
): Promise<LoadedRadarComparison> {
    const {
        currentQuarter,
        previousQuarter,
        watchlists,
        selectedCategories,
        movementBasis,
        dbShape,
    } = request;
    const quarters = [currentQuarter, previousQuarter];
    const filings = await queryFilings(db, quarters);
    const currentFilings = selectLatestFilings(filings, currentQuarter);
    const previousFilings = selectLatestFilings(filings, previousQuarter);
    const previousByCik = new Map(previousFilings.map((filing) => [filing.cik, filing]));
    const comparableFilings = currentFilings.flatMap((currentFiling) => {
        const previousFiling = previousByCik.get(currentFiling.cik);
        return previousFiling ? [currentFiling, previousFiling] : [];
    });
    const holdings = selectedCategories.length > 0
        ? await queryWatchedHoldings(db, comparableFilings, dbShape.putCallColumn)
        : [];

    return {
        filings,
        holdings,
        comparison: buildRadarComparison({
            currentQuarter,
            previousQuarter,
            filings,
            holdings,
            watchlists,
            selectedCategories,
            movementBasis,
        }),
    };
}

export async function queryFilerSideMatches(params: {
    db: RadarDbClient;
    currentQuarter: string;
    previousQuarter: string;
    watchlists: RadarWatchlist[];
    selectedCategories: string[];
}): Promise<FilerSideMatch[]> {
    const { db, currentQuarter, previousQuarter, watchlists, selectedCategories } = params;
    const patterns = buildIssuerSqlPatterns(watchlists, selectedCategories);
    if (patterns.length === 0) return [];

    const rowsByCik = new Map<string, DbRow>();
    for (const patternChunk of chunkArray(patterns, 40)) {
        const patternClauses = patternChunk.map(() => "UPPER(f.name) LIKE ? ESCAPE '\\'").join(' OR ');
        const result = await executeRadarQuery(
            db,
            `
                SELECT
                    f.cik AS cik,
                    f.name AS "fundName",
                    MAX(fil.filing_date) AS "latestFilingDate",
                    SUM(CASE WHEN fil.quarter = ? THEN 1 ELSE 0 END) AS "currentCount",
                    SUM(CASE WHEN fil.quarter = ? THEN 1 ELSE 0 END) AS "previousCount"
                FROM funds f
                LEFT JOIN filings fil ON fil.cik = f.cik
                WHERE ${patternClauses}
                GROUP BY f.cik, f.name
                LIMIT 200
            `,
            [currentQuarter, previousQuarter, ...patternChunk]
        );

        for (const row of result.rows) {
            rowsByCik.set(toStringValue(row, 'cik'), row);
        }
    }

    return Array.from(rowsByCik.values())
        .map((row) => {
            const fundName = toStringValue(row, 'fundName');
            const matches = matchIssuerToWatchlists(fundName, watchlists, selectedCategories);
            if (matches.length === 0) return null;

            return {
                cik: normalizeCik(toStringValue(row, 'cik')),
                fundName,
                matchedCategories: matches.map((match) => match.category.label),
                matchedItems: matches.flatMap((match) => match.items.map((item) => item.label)),
                latestFilingDate: nullableStringValue(row, 'latestFilingDate'),
                hasCurrentQuarter: toNumberValue(row, 'currentCount') > 0,
                hasPreviousQuarter: toNumberValue(row, 'previousCount') > 0,
            };
        })
        .filter((match): match is FilerSideMatch => match !== null)
        .slice(0, 30);
}

export function buildRadarNotes(dbShape: DbShape): string[] {
    const notes = [
        'Form 13F reports quarter-end long positions and does not reveal exact trade dates.',
        'Trend percentages use filer counts, not value-weighted flows.',
    ];

    if (!dbShape.putCallColumn) {
        notes.push('The holdings table has no put/call column, so option rows can only be excluded after the SEC dataset ingestion upgrade adds that field.');
    }

    return notes;
}

async function queryAvailableQuarters(db: RadarDbClient): Promise<string[]> {
    const result = await executeRadarQuery(db, `
        SELECT quarter
        FROM filings
        WHERE quarter IS NOT NULL AND quarter != ''
        GROUP BY quarter
    `);

    return sortQuartersDesc(result.rows.map((row) => toStringValue(row, 'quarter')).filter(Boolean));
}

async function queryFilings(db: RadarDbClient, quarters: string[]): Promise<RadarFilingRow[]> {
    const placeholders = quarters.map(() => '?').join(', ');
    const result = await executeRadarQuery(
        db,
        `
            SELECT
                fil.cik AS cik,
                COALESCE(f.name, fil.cik) AS "fundName",
                fil.accession_number AS "accessionNumber",
                fil.filing_date AS "filingDate",
                fil.quarter AS quarter
            FROM filings fil
            LEFT JOIN funds f ON fil.cik = f.cik
            WHERE fil.quarter IN (${placeholders})
        `,
        quarters
    );

    return result.rows.map((row) => ({
        cik: normalizeCik(toStringValue(row, 'cik')),
        fundName: toStringValue(row, 'fundName'),
        accessionNumber: toStringValue(row, 'accessionNumber'),
        filingDate: toStringValue(row, 'filingDate'),
        quarter: toStringValue(row, 'quarter'),
    }));
}

async function queryWatchedHoldings(
    db: RadarDbClient,
    filings: RadarFilingRow[],
    putCallColumn: string | null
): Promise<RadarHoldingRow[]> {
    if (filings.length === 0) return [];

    const filingByAccession = new Map(filings.map((filing) => [filing.accessionNumber, filing]));
    const putCallFilter = putCallColumn
        ? `AND (${quoteIdentifier('h', putCallColumn)} IS NULL OR TRIM(${quoteIdentifier('h', putCallColumn)}) = '')`
        : '';
    const holdings: RadarHoldingRow[] = [];
    const filingChunks = chunkArray(filings, HOLDING_QUERY_CHUNK_SIZE);
    let nextChunkIndex = 0;

    const worker = async () => {
        while (true) {
            const chunkIndex = nextChunkIndex++;
            if (chunkIndex >= filingChunks.length) return;

            const filingChunk = filingChunks[chunkIndex];
            const placeholders = filingChunk.map(() => '?').join(', ');
            const result = await executeRadarQuery(
                db,
                buildHoldingsSql(db, placeholders, putCallFilter),
                filingChunk.map((filing) => filing.accessionNumber)
            );

            for (const row of result.rows) {
                const accessionNumber = toStringValue(row, 'accessionNumber');
                const filing = filingByAccession.get(accessionNumber);
                if (!filing) continue;

                holdings.push({
                    cik: filing.cik,
                    fundName: filing.fundName,
                    accessionNumber,
                    filingDate: filing.filingDate,
                    quarter: filing.quarter,
                    issuer: toStringValue(row, 'issuer'),
                    cusip: nullableStringValue(row, 'cusip'),
                    value: toNumberValue(row, 'value'),
                    shares: toNumberValue(row, 'shares'),
                });
            }
        }
    };

    await Promise.all(Array.from(
        { length: Math.min(HOLDING_QUERY_CONCURRENCY, filingChunks.length) },
        () => worker()
    ));

    return holdings;
}

async function inspectDbShape(db: RadarDbClient): Promise<DbShape> {
    const result = db.provider === 'postgres'
        ? await executeRadarQuery(db, `
            SELECT column_name AS name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'holdings'
        `)
        : await executeRadarQuery(db, 'PRAGMA table_info(holdings)');
    const holdingsColumns = result.rows.map((row) => toStringValue(row, 'name')).filter(Boolean);
    const putCallColumn =
        holdingsColumns.find((column) => column.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === 'putcall') || null;

    return { holdingsColumns, putCallColumn };
}

function pickCurrentQuarter(value: unknown, availableQuarters: string[]): string {
    const requested = typeof value === 'string' ? value : null;
    if (requested && availableQuarters.includes(requested)) return requested;
    return availableQuarters[0];
}

function pickPreviousQuarter(value: unknown, currentQuarter: string, availableQuarters: string[]): string | null {
    const requested = typeof value === 'string' ? value : null;
    if (requested && requested !== currentQuarter && availableQuarters.includes(requested)) return requested;

    return availableQuarters.find((quarter) => compareQuartersAsc(quarter, currentQuarter) < 0) || null;
}

function normalizeCategories(value: unknown, watchlists: RadarWatchlist[]): string[] {
    const validKeys = new Set(watchlists.map((watchlist) => watchlist.key));
    if (!Array.isArray(value)) return Array.from(validKeys);

    const categories = value.filter((item): item is string => typeof item === 'string' && validKeys.has(item));
    return categories.length > 0 ? categories : Array.from(validKeys);
}

function normalizeWatchlists(value: unknown): RadarWatchlist[] {
    if (!Array.isArray(value)) return DEFAULT_RADAR_WATCHLISTS;

    const parsed = value
        .map((item) => parseWatchlist(item))
        .filter((watchlist): watchlist is RadarWatchlist => watchlist !== null);

    return parsed.length > 0 ? parsed : DEFAULT_RADAR_WATCHLISTS;
}

function parseWatchlist(value: unknown): RadarWatchlist | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key : null;
    const label = typeof record.label === 'string' ? record.label : null;
    const description = typeof record.description === 'string' ? record.description : '';
    const rawItems = Array.isArray(record.items) ? record.items : [];

    if (!key || !label) return null;

    const items = rawItems
        .map((rawItem) => {
            if (!rawItem || typeof rawItem !== 'object') return null;
            const item = rawItem as Record<string, unknown>;
            const ticker = typeof item.ticker === 'string' ? item.ticker : null;
            const itemLabel = typeof item.label === 'string' ? item.label : ticker;
            const aliases = Array.isArray(item.aliases)
                ? item.aliases.filter((alias): alias is string => typeof alias === 'string')
                : [];

            if (!ticker || !itemLabel) return null;
            return { ticker, label: itemLabel, aliases };
        })
        .filter((item): item is RadarWatchlist['items'][number] => item !== null);

    return { key, label, description, items };
}

function toStringValue(row: DbRow, key: string): string {
    const value = row[key];
    if (value === null || value === undefined) return '';
    return String(value);
}

function nullableStringValue(row: DbRow, key: string): string | null {
    const value = toStringValue(row, key);
    return value || null;
}

function buildHoldingsSql(db: RadarDbClient, placeholders: string, putCallFilter: string): string {
    if (db.provider === 'postgres') {
        return `
            SELECT
                h.accession_number AS "accessionNumber",
                s.issuer AS issuer,
                s.cusip AS cusip,
                h.value AS value,
                h.shares AS shares
            FROM holdings h
            JOIN securities s ON s.security_key = h.security_key
            WHERE h.accession_number IN (${placeholders})
              ${putCallFilter}
        `;
    }

    return `
        SELECT
            h.accession_number AS "accessionNumber",
            h.issuer AS issuer,
            h.cusip AS cusip,
            h.value AS value,
            h.shares AS shares
        FROM holdings h
        WHERE h.accession_number IN (${placeholders})
          ${putCallFilter}
    `;
}

async function executeRadarQuery(
    db: RadarDbClient,
    sql: string,
    args: unknown[] = []
): Promise<{ rows: DbRow[] }> {
    if (db.provider === 'postgres') {
        const result = await queryPostgresRows(db.pool, sql, args);
        return { rows: result.rows as DbRow[] };
    }

    const result = await db.client.execute({ sql, args: args as InValue[] });
    return { rows: result.rows as DbRow[] };
}

function toNumberValue(row: DbRow, key: string): number {
    const value = row[key];
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function quoteIdentifier(prefix: string, identifier: string): string {
    const safePrefix = prefix.replace(/"/g, '""');
    const safeIdentifier = identifier.replace(/"/g, '""');
    return `"${safePrefix}"."${safeIdentifier}"`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
