import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@libsql/client';
import {
    DEFAULT_RADAR_WATCHLISTS,
    buildEventLensSummary,
    buildIssuerSqlPatterns,
    buildRadarComparison,
    compareQuartersAsc,
    matchIssuerToWatchlists,
    sortQuartersDesc,
    type EventLensSummary,
    type FilerSideMatch,
    type MovementBasis,
    type RadarComparison,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from '@/lib/thirteen-f-radar-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type TursoClient = ReturnType<typeof createClient>;
type DbRow = Record<string, unknown>;

interface RadarRequestBody {
    currentQuarter?: unknown;
    previousQuarter?: unknown;
    categories?: unknown;
    watchlists?: unknown;
    movementBasis?: unknown;
}

interface DbShape {
    holdingsColumns: string[];
    putCallColumn: string | null;
}

export async function POST(req: NextRequest) {
    try {
        const body = await readBody(req);
        const url = process.env.TURSO_DATABASE_URL;
        const authToken = process.env.TURSO_AUTH_TOKEN;

        if (!url || !authToken) {
            return NextResponse.json(
                { error: 'Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN. 13F Radar needs the Turso holdings database.' },
                { status: 500 }
            );
        }

        const turso = createClient({ url, authToken });
        const availableQuarters = await queryAvailableQuarters(turso);

        if (availableQuarters.length < 2) {
            return NextResponse.json(
                { error: 'Need at least two ingested 13F quarters to build the radar.' },
                { status: 404 }
            );
        }

        const currentQuarter = pickCurrentQuarter(body.currentQuarter, availableQuarters);
        const previousQuarter = pickPreviousQuarter(body.previousQuarter, currentQuarter, availableQuarters);

        if (!currentQuarter || !previousQuarter) {
            return NextResponse.json(
                { error: 'Could not resolve a comparable current and previous quarter.' },
                { status: 400 }
            );
        }

        const watchlists = normalizeWatchlists(body.watchlists);
        const selectedCategories = normalizeCategories(body.categories, watchlists);
        const movementBasis: MovementBasis = body.movementBasis === 'filer-count' ? 'filer-count' : 'filer-count';
        const dbShape = await inspectDbShape(turso);

        const mainComparison = await runComparison({
            turso,
            currentQuarter,
            previousQuarter,
            watchlists,
            selectedCategories,
            movementBasis,
            dbShape,
        });

        const eventLens = await buildEventLens({
            turso,
            availableQuarters,
            mainComparison,
            watchlists,
            selectedCategories,
            movementBasis,
            dbShape,
        });

        const filerSideMatches = await queryFilerSideMatches({
            turso,
            currentQuarter,
            previousQuarter,
            watchlists,
            selectedCategories,
        });

        const notes = [
            'Form 13F reports quarter-end long positions and does not reveal exact trade dates.',
            'Trend percentages use filer counts, not value-weighted flows.',
        ];

        if (!dbShape.putCallColumn) {
            notes.push('The holdings table has no put/call column, so option rows can only be excluded after the SEC dataset ingestion upgrade adds that field.');
        }

        return NextResponse.json({
            ...mainComparison,
            securityMovements: mainComparison.securityMovements.slice(0, 100),
            initiations: mainComparison.initiations.slice(0, 50),
            liquidations: mainComparison.liquidations.slice(0, 50),
            topFilerMoves: mainComparison.topFilerMoves.slice(0, 100),
            availableQuarters,
            watchlists,
            eventLens,
            filerSideMatches,
            notes,
        });
    } catch (error) {
        console.error('[13F Radar] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}

async function readBody(req: NextRequest): Promise<RadarRequestBody> {
    try {
        return (await req.json()) as RadarRequestBody;
    } catch {
        return {};
    }
}

async function runComparison(params: {
    turso: TursoClient;
    currentQuarter: string;
    previousQuarter: string;
    watchlists: RadarWatchlist[];
    selectedCategories: string[];
    movementBasis: MovementBasis;
    dbShape: DbShape;
}): Promise<RadarComparison> {
    const { turso, currentQuarter, previousQuarter, watchlists, selectedCategories, movementBasis, dbShape } = params;
    const quarters = [currentQuarter, previousQuarter];
    const filings = await queryFilings(turso, quarters);
    const patterns = buildIssuerSqlPatterns(watchlists, selectedCategories);
    const holdings = await queryWatchedHoldings(turso, quarters, patterns, dbShape.putCallColumn);

    return buildRadarComparison({
        currentQuarter,
        previousQuarter,
        filings,
        holdings,
        watchlists,
        selectedCategories,
        movementBasis,
    });
}

async function buildEventLens(params: {
    turso: TursoClient;
    availableQuarters: string[];
    mainComparison: RadarComparison;
    watchlists: RadarWatchlist[];
    selectedCategories: string[];
    movementBasis: MovementBasis;
    dbShape: DbShape;
}): Promise<EventLensSummary[]> {
    const { turso, availableQuarters, mainComparison, watchlists, selectedCategories, movementBasis, dbShape } = params;
    const eventPairs: Array<{ key: EventLensSummary['key']; currentQuarter: string; previousQuarter: string }> = [
        { key: 'pre-event', currentQuarter: '2025-Q4', previousQuarter: '2025-Q3' },
        { key: 'post-event', currentQuarter: '2026-Q1', previousQuarter: '2025-Q4' },
    ];

    const lenses: EventLensSummary[] = [];

    for (const eventPair of eventPairs) {
        const available =
            availableQuarters.includes(eventPair.currentQuarter) &&
            availableQuarters.includes(eventPair.previousQuarter);

        if (!available) {
            lenses.push(buildEventLensSummary(eventPair.key, availableQuarters, null));
            continue;
        }

        const comparison =
            mainComparison.coverage.currentQuarter === eventPair.currentQuarter &&
                mainComparison.coverage.previousQuarter === eventPair.previousQuarter
                ? mainComparison
                : await runComparison({
                    turso,
                    currentQuarter: eventPair.currentQuarter,
                    previousQuarter: eventPair.previousQuarter,
                    watchlists,
                    selectedCategories,
                    movementBasis,
                    dbShape,
                });

        lenses.push(buildEventLensSummary(eventPair.key, availableQuarters, comparison));
    }

    return lenses;
}

async function queryAvailableQuarters(turso: TursoClient): Promise<string[]> {
    const result = await turso.execute(`
        SELECT quarter
        FROM filings
        WHERE quarter IS NOT NULL AND quarter != ''
        GROUP BY quarter
    `);

    return sortQuartersDesc(result.rows.map((row) => toStringValue(row, 'quarter')).filter(Boolean));
}

async function queryFilings(turso: TursoClient, quarters: string[]): Promise<RadarFilingRow[]> {
    const placeholders = quarters.map(() => '?').join(', ');
    const result = await turso.execute({
        sql: `
            SELECT
                fil.cik AS cik,
                COALESCE(f.name, fil.cik) AS fundName,
                fil.accession_number AS accessionNumber,
                fil.filing_date AS filingDate,
                fil.quarter AS quarter
            FROM filings fil
            LEFT JOIN funds f ON fil.cik = f.cik
            WHERE fil.quarter IN (${placeholders})
        `,
        args: quarters,
    });

    return result.rows.map((row) => ({
        cik: toStringValue(row, 'cik'),
        fundName: toStringValue(row, 'fundName'),
        accessionNumber: toStringValue(row, 'accessionNumber'),
        filingDate: toStringValue(row, 'filingDate'),
        quarter: toStringValue(row, 'quarter'),
    }));
}

async function queryWatchedHoldings(
    turso: TursoClient,
    quarters: string[],
    patterns: string[],
    putCallColumn: string | null
): Promise<RadarHoldingRow[]> {
    if (patterns.length === 0) return [];

    const quarterPlaceholders = quarters.map(() => '?').join(', ');
    const patternClauses = patterns.map(() => "UPPER(h.issuer) LIKE ? ESCAPE '\\'").join(' OR ');
    const putCallFilter = putCallColumn
        ? `AND (${quoteIdentifier('h', putCallColumn)} IS NULL OR TRIM(${quoteIdentifier('h', putCallColumn)}) = '')`
        : '';

    const result = await turso.execute({
        sql: `
            SELECT
                fil.cik AS cik,
                COALESCE(f.name, fil.cik) AS fundName,
                h.accession_number AS accessionNumber,
                fil.filing_date AS filingDate,
                fil.quarter AS quarter,
                h.issuer AS issuer,
                h.cusip AS cusip,
                h.value AS value,
                h.shares AS shares
            FROM holdings h
            JOIN filings fil ON h.accession_number = fil.accession_number
            LEFT JOIN funds f ON fil.cik = f.cik
            WHERE fil.quarter IN (${quarterPlaceholders})
              AND (${patternClauses})
              ${putCallFilter}
        `,
        args: [...quarters, ...patterns],
    });

    return result.rows.map((row) => ({
        cik: toStringValue(row, 'cik'),
        fundName: toStringValue(row, 'fundName'),
        accessionNumber: toStringValue(row, 'accessionNumber'),
        filingDate: toStringValue(row, 'filingDate'),
        quarter: toStringValue(row, 'quarter'),
        issuer: toStringValue(row, 'issuer'),
        cusip: nullableStringValue(row, 'cusip'),
        value: toNumberValue(row, 'value'),
        shares: toNumberValue(row, 'shares'),
    }));
}

async function queryFilerSideMatches(params: {
    turso: TursoClient;
    currentQuarter: string;
    previousQuarter: string;
    watchlists: RadarWatchlist[];
    selectedCategories: string[];
}): Promise<FilerSideMatch[]> {
    const { turso, currentQuarter, previousQuarter, watchlists, selectedCategories } = params;
    const patterns = buildIssuerSqlPatterns(watchlists, selectedCategories);
    if (patterns.length === 0) return [];

    const patternClauses = patterns.map(() => "UPPER(f.name) LIKE ? ESCAPE '\\'").join(' OR ');
    const result = await turso.execute({
        sql: `
            SELECT
                f.cik AS cik,
                f.name AS fundName,
                MAX(fil.filing_date) AS latestFilingDate,
                SUM(CASE WHEN fil.quarter = ? THEN 1 ELSE 0 END) AS currentCount,
                SUM(CASE WHEN fil.quarter = ? THEN 1 ELSE 0 END) AS previousCount
            FROM funds f
            LEFT JOIN filings fil ON fil.cik = f.cik
            WHERE ${patternClauses}
            GROUP BY f.cik, f.name
            LIMIT 200
        `,
        args: [currentQuarter, previousQuarter, ...patterns],
    });

    return result.rows
        .map((row) => {
            const fundName = toStringValue(row, 'fundName');
            const matches = matchIssuerToWatchlists(fundName, watchlists, selectedCategories);
            if (matches.length === 0) return null;

            return {
                cik: toStringValue(row, 'cik'),
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

async function inspectDbShape(turso: TursoClient): Promise<DbShape> {
    const result = await turso.execute('PRAGMA table_info(holdings)');
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
