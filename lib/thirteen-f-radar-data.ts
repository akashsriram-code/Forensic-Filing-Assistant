import { type Pool } from 'pg';
import {
    DEFAULT_RADAR_WATCHLISTS,
    buildCategoryConcentration,
    buildRadarComparison,
    compareHoldersForTable,
    compareQuartersAsc,
    quarterFilingDeadline,
    sortQuartersDesc,
    type FilerMove,
    type MovementBasis,
    type RadarApiResponse,
    type RadarComparison,
    type RadarFilingProgress,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from './thirteen-f-radar-core';
import { createPostgresPool, getPostgresConnectionString } from './thirteen-f-radar-postgres';
import {
    getRadarWatchlistHash,
    listPrecomputedPairs,
    readPrecomputedComparableFilers,
    readPrecomputedHolders,
    readPrecomputedRadar,
    type PrecomputedPair,
} from './thirteen-f-precomputed';
import {
    buildRadarRowsFromStore,
    loadStoreDirectory,
    matchStoreSecurities,
    queryPositionsBySecurities,
    readStoreMeta,
    type StoreMeta,
} from './thirteen-f-store';

export const MISSING_POSTGRES_ERROR = 'Missing DATABASE_URL or POSTGRES_URL. 13F Radar is configured for Postgres.';

// App-facing queries must fail fast instead of leaving the UI spinning.
const APP_CONNECTION_TIMEOUT_MS = 10000;
const APP_QUERY_TIMEOUT_MS = 25000;

let appPool: Pool | null = null;

export interface RadarRequestBody {
    currentQuarter?: unknown;
    previousQuarter?: unknown;
    categories?: unknown;
    watchlists?: unknown;
    movementBasis?: unknown;
    /** Holders endpoint only. */
    category?: unknown;
}

export interface ResolvedRadarRequest {
    currentQuarter: string;
    previousQuarter: string;
    availableQuarters: string[];
    watchlists: RadarWatchlist[];
    selectedCategories: string[];
    movementBasis: MovementBasis;
    /** True when the request uses the built-in watchlists and every category, so a precomputed file can serve it. */
    isDefault: boolean;
    /** True when the requested pair is the one held in the Postgres store (custom watchlists and exports need this). */
    inStore: boolean;
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

/** Shared Postgres pool for API routes, with connection and statement timeouts. */
export function getAppPostgresPool(): Pool {
    const connectionString = getPostgresConnectionString();
    if (!connectionString) throw new RadarDataError(MISSING_POSTGRES_ERROR, 500);
    // Client-side query_timeout rather than statement_timeout: the connection pooler rejects it as a startup parameter.
    appPool ||= createPostgresPool(connectionString, {
        connectionTimeoutMillis: APP_CONNECTION_TIMEOUT_MS,
        query_timeout: APP_QUERY_TIMEOUT_MS,
    });
    return appPool;
}

/** Store metadata, or null when Postgres is not configured / not built yet (precomputed files still work). */
export async function readAppStoreMeta(): Promise<StoreMeta | null> {
    if (!getPostgresConnectionString()) return null;
    return readStoreMeta(getAppPostgresPool());
}

export async function resolveRadarRequest(
    body: RadarRequestBody,
    meta: StoreMeta | null,
    precomputedPairs?: PrecomputedPair[]
): Promise<ResolvedRadarRequest> {
    const pairs = [...(precomputedPairs || await listPrecomputedPairs())];
    if (meta && !pairs.some((p) => p.currentQuarter === meta.currentQuarter && p.previousQuarter === meta.previousQuarter)) {
        pairs.unshift({ currentQuarter: meta.currentQuarter, previousQuarter: meta.previousQuarter });
    }
    if (pairs.length === 0) {
        throw new RadarDataError('No 13F quarter pair is available yet. Run scripts/build-13f-store.ts and scripts/precompute-13f-radar.ts.', 503);
    }

    const availableQuarters = sortQuartersDesc(pairs.flatMap((p) => [p.currentQuarter, p.previousQuarter]));
    const requestedCurrent = typeof body.currentQuarter === 'string' ? body.currentQuarter : '';
    const requestedPrevious = typeof body.previousQuarter === 'string' ? body.previousQuarter : '';
    const pair = requestedCurrent || requestedPrevious
        ? pairs.find((p) =>
            (!requestedCurrent || p.currentQuarter === requestedCurrent) &&
            (!requestedPrevious || p.previousQuarter === requestedPrevious)
        )
        : pickDefaultPair(pairs);
    if (!pair) {
        const listed = pairs.map((p) => `${p.currentQuarter} vs ${p.previousQuarter}`).join(', ');
        throw new RadarDataError(`No stored comparison for ${requestedCurrent || '?'} vs ${requestedPrevious || '?'}. Available: ${listed}.`, 404);
    }

    const watchlists = normalizeWatchlists(body.watchlists);
    const selectedCategories = normalizeCategories(body.categories, watchlists);
    const defaultKeys = DEFAULT_RADAR_WATCHLISTS.map((w) => w.key);
    const isDefault =
        getRadarWatchlistHash(watchlists) === getRadarWatchlistHash(DEFAULT_RADAR_WATCHLISTS) &&
        defaultKeys.every((key) => selectedCategories.includes(key));

    return {
        ...pair,
        availableQuarters,
        watchlists,
        selectedCategories,
        movementBasis: 'filer-count',
        isDefault,
        inStore: Boolean(meta && meta.currentQuarter === pair.currentQuarter && meta.previousQuarter === pair.previousQuarter),
    };
}

/**
 * Always the newest pair, even while its quarter is still filing in: the UI shows filing progress against the
 * pair one quarter back (see buildFilingProgress), and older pairs stay selectable.
 */
function pickDefaultPair(pairs: PrecomputedPair[]): PrecomputedPair {
    return [...pairs].sort((a, b) => compareQuartersAsc(b.currentQuarter, a.currentQuarter))[0];
}

/** Deadline and the "fully filed" reference count (the pair one quarter back) for the filing-progress banner. */
export async function buildFilingProgress(request: ResolvedRadarRequest): Promise<RadarFilingProgress> {
    const pairs = await listPrecomputedPairs();
    const baseline = pairs.find((p) => p.currentQuarter === request.previousQuarter);
    const counts = baseline ? await readPrecomputedComparableFilers([baseline]) : new Map<string, number>();
    return {
        deadline: quarterFilingDeadline(request.currentQuarter),
        baselineQuarter: baseline ? baseline.currentQuarter : null,
        baselineComparableFilers: baseline ? counts.get(`${baseline.currentQuarter}|${baseline.previousQuarter}`) ?? null : null,
    };
}

/** Serve a default request from its precomputed file, if one exists for the pair. */
export async function loadPrecomputedRadarResponse(request: ResolvedRadarRequest): Promise<RadarApiResponse | null> {
    if (!request.isDefault) return null;
    const file = await readPrecomputedRadar(request.currentQuarter, request.previousQuarter);
    if (!file) return null;
    return { ...file.response, availableQuarters: request.availableQuarters };
}

/** Build the comparison from the Postgres store: only positions in watchlist-matched securities are fetched. */
export async function loadRadarComparisonFromStore(
    request: ResolvedRadarRequest,
    meta: StoreMeta,
    db: Pool = getAppPostgresPool()
): Promise<LoadedRadarComparison> {
    if (!request.inStore) {
        throw new RadarDataError(
            `Custom watchlists and exports are only available for the latest stored pair (${meta.currentQuarter} vs ${meta.previousQuarter}). ` +
            `${request.currentQuarter} vs ${request.previousQuarter} is only kept with the built-in watchlists.`,
            400
        );
    }
    const directory = await loadStoreDirectory(db, meta);
    const securityIds = matchStoreSecurities(directory, request.watchlists, request.selectedCategories);
    const positions = await queryPositionsBySecurities(db, securityIds);
    const { filings, holdings } = buildRadarRowsFromStore(meta, directory, positions);

    return {
        filings,
        holdings,
        comparison: buildRadarComparison({
            currentQuarter: request.currentQuarter,
            previousQuarter: request.previousQuarter,
            filings,
            holdings,
            watchlists: request.watchlists,
            selectedCategories: request.selectedCategories,
            movementBasis: request.movementBasis,
        }),
    };
}

/**
 * The API response shape. Shared by the route and the precompute script so both produce identical output.
 * Full holder lists (tens of MB) are replaced by per-category concentration; the UI loads holders on demand.
 */
export function toRadarApiResponse(comparison: RadarComparison, request: ResolvedRadarRequest): RadarApiResponse {
    return {
        ...comparison,
        securityMovements: comparison.securityMovements.slice(0, 100),
        initiations: comparison.initiations.slice(0, 50),
        liquidations: comparison.liquidations.slice(0, 50),
        topFilerMoves: comparison.topFilerMoves.slice(0, 100),
        currentHoldersByCategory: {},
        recentFilers: comparison.recentFilers || [],
        recentFilerCount: comparison.recentFilerCount ?? 0,
        categoryConcentration: buildCategoryConcentration(comparison.currentHoldersByCategory || {}, request.watchlists),
        availableQuarters: request.availableQuarters,
        watchlists: request.watchlists,
        notes: buildRadarNotes(),
    };
}

/** Rows of the holder table that render per-security details; the rest ship without them to keep payloads small. */
export const HOLDER_DETAIL_ROWS = 100;

/**
 * Every current holder in one category (for the category panel and its CSV download).
 * Served from the store for the live pair, or from the archive written when an older pair left the store.
 */
export async function loadCategoryHolders(
    request: ResolvedRadarRequest,
    meta: StoreMeta | null,
    categoryKey: string
): Promise<FilerMove[]> {
    if (!request.watchlists.some((w) => w.key === categoryKey)) {
        throw new RadarDataError(`Unknown category "${categoryKey}".`, 400);
    }
    if (!request.inStore || !meta) {
        const archived = request.isDefault
            ? await readPrecomputedHolders(request.currentQuarter, request.previousQuarter, categoryKey)
            : null;
        if (archived) return archived;
        if (!meta) throw new RadarDataError('The 13F database is unavailable. Try again shortly.', 503);
    }
    const { comparison } = await loadRadarComparisonFromStore({ ...request, selectedCategories: [categoryKey] }, meta);
    const holders = [...(comparison.currentHoldersByCategory?.[categoryKey] || [])].sort(compareHoldersForTable);
    return holders.map((holder, index) => (index < HOLDER_DETAIL_ROWS ? holder : { ...holder, details: [] }));
}

export function buildRadarNotes(): string[] {
    return [
        'Form 13F reports quarter-end long positions and does not reveal exact trade dates.',
        'Trend percentages use filer counts, not value-weighted flows.',
        'Option (put/call) rows and bond principal (PRN) rows are excluded; values are reported dollars.',
    ];
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
