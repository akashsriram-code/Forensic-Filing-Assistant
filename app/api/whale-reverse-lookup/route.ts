import { NextRequest, NextResponse } from 'next/server';
import {
    classifyMovement,
    compareQuartersAsc,
    estimateActualValue,
    normalizeCik,
    type MovementAction,
} from '@/lib/thirteen-f-radar-core';
import {
    createRadarClientFromEnv,
    type RadarDbClient,
    type RadarDbProvider,
} from '@/lib/thirteen-f-radar-data';
import { queryPostgresRows } from '@/lib/thirteen-f-radar-postgres';

const CACHE_REVALIDATE = 3600;
const MAX_RESULT_LIMIT = 1000;
type ReverseMovementAction = Exclude<MovementAction, 'absent'> | 'no_prior';
const ACTION_RANK: Record<ReverseMovementAction, number> = {
    initiated: 0,
    liquidated: 1,
    increased: 2,
    decreased: 3,
    unchanged: 4,
    no_prior: 5,
};

interface SecCompanyTickerEntry {
    ticker: string;
    title: string;
}

type DbRow = Record<string, unknown>;

export interface ReverseHoldingRow {
    fundName: string;
    cik: string;
    accessionNumber: string;
    filingDate: string;
    quarter: string;
    issuer: string;
    cusip: string | null;
    value: number;
    shares: number;
}

export interface ReverseFilingRow {
    fundName: string;
    cik: string;
    accessionNumber: string;
    filingDate: string;
    quarter: string;
}

export interface ReverseHistoryPoint {
    date: string;
    quarter: string;
    shares: number;
    value: number;
}

export interface ReverseFund {
    fundName: string;
    cik: string;
    action: ReverseMovementAction;
    shares: number;
    value: number;
    filing_date: string;
    currentShares: number;
    previousShares: number;
    shareDelta: number;
    percentChange: number | null;
    currentValue: number;
    previousValue: number;
    valueDelta: number;
    currentFilingDate: string;
    previousFilingDate: string | null;
    currentQuarter: string;
    previousQuarter: string | null;
    issuerSamples: string[];
    cusips: string[];
    history: ReverseHistoryPoint[];
}

export interface ReverseLookupBuildResult {
    funds: ReverseFund[];
    matchCount: number;
    returnedCount: number;
}

async function getCompanyName(ticker: string): Promise<string | null> {
    try {
        const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
            headers: { 'User-Agent': 'ForensicAnalyzer contact@example.com' },
            next: { revalidate: CACHE_REVALIDATE },
        });
        if (!response.ok) return null;

        const data = await response.json() as Record<string, SecCompanyTickerEntry>;
        const normalizedTicker = ticker.toUpperCase();
        const match = Object.values(data).find((entry) => entry.ticker === normalizedTicker);
        return match?.title || null;
    } catch (error) {
        console.error('Error fetching company name', error);
        return null;
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await readRequestBody(req);
        const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
        const limit = resolveLimit(body.limit);

        if (!ticker) {
            return NextResponse.json({ error: 'Ticker required' }, { status: 400 });
        }

        const companyName = await getCompanyName(ticker);
        if (!companyName) {
            return NextResponse.json({ error: 'Could not resolve ticker to specific company name' }, { status: 404 });
        }

        console.log(`[ReverseLookup] Searching for holders of: ${ticker} (${companyName})`);

        const db = createRadarClientFromEnv(resolveReverseLookupDbProviderFromEnv());
        const searchPattern = `${buildIssuerSearchPrefix(companyName)}%`;
        const matchedHoldings = await queryMatchedHoldings(db, searchPattern);
        const matchedCiks = uniqueStrings(matchedHoldings.map((row) => row.cik));
        const filings = matchedCiks.length > 0 ? await queryFilingsForCiks(db, matchedCiks) : [];
        const result = buildReverseLookupFunds({ matchedHoldings, filings, limit });

        return NextResponse.json({
            ticker,
            companyName,
            matchCount: result.matchCount,
            returnedCount: result.returnedCount,
            funds: result.funds,
        });
    } catch (error) {
        console.error('[ReverseLookup] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}

export function resolveReverseLookupDbProviderFromEnv(): RadarDbProvider {
    const explicit = process.env.THIRTEEN_F_DB_PROVIDER?.trim().toLowerCase();
    if (explicit === 'turso') return 'turso';
    return 'postgres';
}

export function buildReverseLookupFunds(params: {
    matchedHoldings: ReverseHoldingRow[];
    filings: ReverseFilingRow[];
    limit?: number;
}): ReverseLookupBuildResult {
    const { matchedHoldings, filings, limit } = params;
    const holdingsByAccession = aggregateHoldingsByAccession(matchedHoldings);
    const filingsByCik = groupFilingsByCik(filings);
    const funds: ReverseFund[] = [];

    for (const [cik, cikFilings] of filingsByCik.entries()) {
        const quarterFilings = selectLatestFilingPerQuarter(cikFilings);
        const positionSeries = quarterFilings.map((filing) => {
            const aggregate = holdingsByAccession.get(filing.accessionNumber);
            return {
                date: filing.filingDate,
                quarter: filing.quarter,
                shares: aggregate?.shares || 0,
                value: aggregate?.value || 0,
            };
        });
        const firstPositiveIndex = positionSeries.findIndex((point) => point.shares > 0);
        if (firstPositiveIndex === -1) continue;

        const historyStartIndex = firstPositiveIndex > 0 ? firstPositiveIndex - 1 : firstPositiveIndex;
        const history = positionSeries.slice(historyStartIndex);
        if (history.length === 0) continue;

        const current = positionSeries[positionSeries.length - 1];
        const previous = positionSeries.length > 1 ? positionSeries[positionSeries.length - 2] : null;
        const action = classifyReverseMovement(previous, current);
        if (action === 'absent') continue;

        const currentFiling = quarterFilings[quarterFilings.length - 1];
        const latestAggregate = findLatestHoldingAggregate(quarterFilings, holdingsByAccession);
        const shareDelta = current.shares - (previous?.shares || 0);
        const valueDelta = current.value - (previous?.value || 0);

        funds.push({
            fundName: currentFiling.fundName,
            cik,
            action,
            shares: current.shares,
            value: current.value,
            filing_date: current.date,
            currentShares: current.shares,
            previousShares: previous?.shares || 0,
            shareDelta,
            percentChange: previous && previous.shares > 0 ? (shareDelta / previous.shares) * 100 : null,
            currentValue: current.value,
            previousValue: previous?.value || 0,
            valueDelta,
            currentFilingDate: current.date,
            previousFilingDate: previous?.date || null,
            currentQuarter: current.quarter,
            previousQuarter: previous?.quarter || null,
            issuerSamples: latestAggregate?.issuerSamples || [],
            cusips: latestAggregate?.cusips || [],
            history,
        });
    }

    const sortedFunds = funds.sort(compareReverseFunds);
    const cappedFunds = typeof limit === 'number' ? sortedFunds.slice(0, limit) : sortedFunds;

    return {
        funds: cappedFunds,
        matchCount: funds.length,
        returnedCount: cappedFunds.length,
    };
}

function classifyReverseMovement(
    previous: ReverseHistoryPoint | null,
    current: ReverseHistoryPoint
): ReverseMovementAction | 'absent' {
    if (!previous) {
        return current.shares > 0 ? 'no_prior' : 'absent';
    }
    return classifyMovement(previous.shares, current.shares);
}

async function queryMatchedHoldings(db: RadarDbClient, searchPattern: string): Promise<ReverseHoldingRow[]> {
    if (db.provider === 'postgres') {
        const result = await queryPostgresRows<DbRow>(
            db.pool,
            `
                SELECT
                    COALESCE(f.name, fil.cik) AS "fundName",
                    fil.cik AS cik,
                    fil.accession_number AS "accessionNumber",
                    fil.filing_date AS "filingDate",
                    fil.quarter AS quarter,
                    s.issuer AS issuer,
                    s.cusip AS cusip,
                    h.value AS value,
                    h.shares AS shares
                FROM holdings h
                JOIN filings fil ON h.accession_number = fil.accession_number
                LEFT JOIN funds f ON fil.cik = f.cik
                JOIN securities s ON h.security_key = s.security_key
                WHERE s.issuer_search LIKE ?
                ORDER BY fil.cik ASC, fil.filing_date ASC, fil.accession_number ASC
            `,
            [searchPattern]
        );
        return result.rows.map(normalizeHoldingRow);
    }

    const result = await db.client.execute({
        sql: `
            SELECT
                COALESCE(f.name, fil.cik) AS fundName,
                fil.cik AS cik,
                fil.accession_number AS accessionNumber,
                fil.filing_date AS filingDate,
                fil.quarter AS quarter,
                h.issuer AS issuer,
                h.cusip AS cusip,
                h.value AS value,
                h.shares AS shares
            FROM holdings h
            JOIN filings fil ON h.accession_number = fil.accession_number
            LEFT JOIN funds f ON fil.cik = f.cik
            WHERE UPPER(h.issuer) LIKE ?
            ORDER BY fil.cik ASC, fil.filing_date ASC, fil.accession_number ASC
        `,
        args: [searchPattern],
    });

    return result.rows.map((row) => normalizeHoldingRow(row as DbRow));
}

async function queryFilingsForCiks(db: RadarDbClient, ciks: string[]): Promise<ReverseFilingRow[]> {
    const rows: ReverseFilingRow[] = [];
    for (const chunk of chunkArray(ciks, 500)) {
        const placeholders = chunk.map(() => '?').join(', ');
        if (db.provider === 'postgres') {
            const result = await queryPostgresRows<DbRow>(
                db.pool,
                `
                    SELECT
                        COALESCE(f.name, fil.cik) AS "fundName",
                        fil.cik AS cik,
                        fil.accession_number AS "accessionNumber",
                        fil.filing_date AS "filingDate",
                        fil.quarter AS quarter
                    FROM filings fil
                    LEFT JOIN funds f ON fil.cik = f.cik
                    WHERE fil.cik IN (${placeholders})
                    ORDER BY fil.cik ASC, fil.filing_date ASC, fil.accession_number ASC
                `,
                chunk
            );
            rows.push(...result.rows.map(normalizeFilingRow));
        } else {
            const result = await db.client.execute({
                sql: `
                    SELECT
                        COALESCE(f.name, fil.cik) AS fundName,
                        fil.cik AS cik,
                        fil.accession_number AS accessionNumber,
                        fil.filing_date AS filingDate,
                        fil.quarter AS quarter
                    FROM filings fil
                    LEFT JOIN funds f ON fil.cik = f.cik
                    WHERE fil.cik IN (${placeholders})
                    ORDER BY fil.cik ASC, fil.filing_date ASC, fil.accession_number ASC
                `,
                args: chunk,
            });
            rows.push(...result.rows.map((row) => normalizeFilingRow(row as DbRow)));
        }
    }

    return rows;
}

function aggregateHoldingsByAccession(rows: ReverseHoldingRow[]) {
    const holdings = new Map<string, { shares: number; value: number; issuerSamples: string[]; cusips: string[] }>();

    for (const row of rows) {
        const existing = holdings.get(row.accessionNumber) || {
            shares: 0,
            value: 0,
            issuerSamples: [],
            cusips: [],
        };
        existing.shares += row.shares;
        existing.value += estimateActualValue(row.value, row.shares);
        pushUnique(existing.issuerSamples, row.issuer, 3);
        if (row.cusip) pushUnique(existing.cusips, row.cusip, 5);
        holdings.set(row.accessionNumber, existing);
    }

    return holdings;
}

function findLatestHoldingAggregate(
    filings: ReverseFilingRow[],
    holdingsByAccession: Map<string, { shares: number; value: number; issuerSamples: string[]; cusips: string[] }>
) {
    for (let index = filings.length - 1; index >= 0; index -= 1) {
        const aggregate = holdingsByAccession.get(filings[index].accessionNumber);
        if (aggregate) return aggregate;
    }
    return null;
}

function groupFilingsByCik(filings: ReverseFilingRow[]) {
    const grouped = new Map<string, ReverseFilingRow[]>();
    for (const filing of filings) {
        const cik = normalizeCik(filing.cik);
        const rows = grouped.get(cik) || [];
        rows.push({ ...filing, cik });
        grouped.set(cik, rows);
    }
    return grouped;
}

function selectLatestFilingPerQuarter(filings: ReverseFilingRow[]): ReverseFilingRow[] {
    const byQuarter = new Map<string, ReverseFilingRow>();

    for (const filing of filings) {
        const existing = byQuarter.get(filing.quarter);
        if (!existing || compareFilingsAsc(existing, filing) < 0) {
            byQuarter.set(filing.quarter, filing);
        }
    }

    return Array.from(byQuarter.values()).sort(compareFilingsAsc);
}

function compareReverseFunds(a: ReverseFund, b: ReverseFund): number {
    const dateDiff = b.currentFilingDate.localeCompare(a.currentFilingDate);
    if (dateDiff !== 0) return dateDiff;

    const actionDiff = ACTION_RANK[a.action] - ACTION_RANK[b.action];
    if (actionDiff !== 0) return actionDiff;

    const shareDeltaDiff = Math.abs(b.shareDelta) - Math.abs(a.shareDelta);
    if (shareDeltaDiff !== 0) return shareDeltaDiff;

    return a.fundName.localeCompare(b.fundName);
}

function compareFilingsAsc(a: ReverseFilingRow, b: ReverseFilingRow): number {
    const quarterDiff = compareQuartersAsc(a.quarter, b.quarter);
    if (quarterDiff !== 0) return quarterDiff;

    const dateDiff = a.filingDate.localeCompare(b.filingDate);
    if (dateDiff !== 0) return dateDiff;

    return a.accessionNumber.localeCompare(b.accessionNumber);
}

function normalizeHoldingRow(row: DbRow): ReverseHoldingRow {
    return {
        fundName: stringValue(row.fundName),
        cik: normalizeCik(stringValue(row.cik)),
        accessionNumber: stringValue(row.accessionNumber),
        filingDate: stringValue(row.filingDate),
        quarter: stringValue(row.quarter),
        issuer: stringValue(row.issuer),
        cusip: nullableStringValue(row.cusip),
        value: numberValue(row.value),
        shares: numberValue(row.shares),
    };
}

function normalizeFilingRow(row: DbRow): ReverseFilingRow {
    return {
        fundName: stringValue(row.fundName),
        cik: normalizeCik(stringValue(row.cik)),
        accessionNumber: stringValue(row.accessionNumber),
        filingDate: stringValue(row.filingDate),
        quarter: stringValue(row.quarter),
    };
}

function buildIssuerSearchPrefix(companyName: string): string {
    return companyName.toUpperCase().split(' ')[0].replace(/[^A-Z0-9]/g, '');
}

async function readRequestBody(req: NextRequest): Promise<Record<string, unknown>> {
    try {
        const parsed = await req.json();
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function resolveLimit(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(parsed, MAX_RESULT_LIMIT);
}

function stringValue(value: unknown): string {
    return String(value || '');
}

function nullableStringValue(value: unknown): string | null {
    const text = String(value || '').trim();
    return text || null;
}

function numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).sort();
}

function pushUnique(values: string[], value: string, limit: number) {
    if (!value || values.includes(value) || values.length >= limit) return;
    values.push(value);
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}
