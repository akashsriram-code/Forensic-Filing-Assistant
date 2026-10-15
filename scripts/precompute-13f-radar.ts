/**
 * Precompute the default-watchlist 13F Radar response into data/13f-precomputed/<cur>-vs-<prev>/radar.json.
 *
 * Default: the pair currently held in the Postgres store.
 * --archive: also write every category's full holder list (holders/<key>.json). Done once per quarter, just before
 *            the pair leaves the store, so the panel keeps working for archived pairs without daily git churn.
 * --sec-datasets: build any pair in memory from SEC bulk data (no DB), e.g. to archive an older pair.
 *
 * Usage: npx tsx scripts/precompute-13f-radar.ts [--archive]
 *        npx tsx scripts/precompute-13f-radar.ts --current 2026-Q1 --previous 2025-Q4 --sec-datasets <dir1>,<dir2> [--archive]
 */
import 'dotenv/config';
import path from 'node:path';
import { DEFAULT_RADAR_WATCHLISTS, buildRadarComparison, compareHoldersForTable } from '../lib/thirteen-f-radar-core';
import { HOLDER_DETAIL_ROWS, toRadarApiResponse, type ResolvedRadarRequest } from '../lib/thirteen-f-radar-data';
import {
    getRadarWatchlistHash,
    listPrecomputedPairs,
    writePrecomputedHolders,
    writePrecomputedRadar,
} from '../lib/thirteen-f-precomputed';
import { createPostgresPool, type PostgresExecutor } from '../lib/thirteen-f-radar-postgres';
import {
    buildRadarRowsFromStore,
    createStoreDirectory,
    loadStoreDirectory,
    matchStoreSecurities,
    queryPositionsBySecurities,
    readStoreMeta,
    type StoreMeta,
} from '../lib/thirteen-f-store';
import { getArg, hasArg, isDirectRun, previousReportQuarter } from './13f-ingestion-utils';
import { buildStoreSnapshot } from './build-13f-store';

const ALL_CATEGORIES = DEFAULT_RADAR_WATCHLISTS.map((w) => w.key);

/** Precompute (and optionally archive holder lists for) the pair currently held in the Postgres store. */
export async function precomputeStorePair(db: PostgresExecutor, options: { archive?: boolean } = {}) {
    const meta = await readStoreMeta(db);
    if (!meta) throw new Error('The 13F store is empty. Run scripts/build-13f-store.ts first.');
    const directory = await loadStoreDirectory(db, meta);
    const ids = matchStoreSecurities(directory, DEFAULT_RADAR_WATCHLISTS, ALL_CATEGORIES);
    const rows = buildRadarRowsFromStore(meta, directory, await queryPositionsBySecurities(db, ids));
    return writePrecomputed(meta, rows, { archive: options.archive, fromStore: true });
}

async function writePrecomputed(
    meta: StoreMeta,
    rows: ReturnType<typeof buildRadarRowsFromStore>,
    options: { archive?: boolean; fromStore: boolean }
) {
    const pair = { currentQuarter: meta.currentQuarter, previousQuarter: meta.previousQuarter };
    const pairs = await listPrecomputedPairs();
    const request: ResolvedRadarRequest = {
        ...pair,
        availableQuarters: [...new Set([pair, ...pairs].flatMap((p) => [p.currentQuarter, p.previousQuarter]))].sort().reverse(),
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ALL_CATEGORIES,
        movementBasis: 'filer-count',
        isDefault: true,
        inStore: options.fromStore,
    };
    const comparison = buildRadarComparison({
        ...pair,
        filings: rows.filings,
        holdings: rows.holdings,
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ALL_CATEGORIES,
    });
    const filePath = await writePrecomputedRadar({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        watchlistHash: getRadarWatchlistHash(DEFAULT_RADAR_WATCHLISTS),
        storeUpdatedAt: options.fromStore ? meta.updatedAt : null,
        response: toRadarApiResponse(comparison, request),
    });
    console.log(
        `[13F Precompute] ${pair.currentQuarter} vs ${pair.previousQuarter}: ${comparison.coverage.comparableFilers} comparable filers, ` +
        `${rows.holdings.length} watched holding rows -> ${filePath}`
    );

    if (options.archive) {
        for (const [key, holders] of Object.entries(comparison.currentHoldersByCategory || {})) {
            const trimmed = [...holders]
                .sort(compareHoldersForTable)
                .map((holder, index) => (index < HOLDER_DETAIL_ROWS ? holder : { ...holder, details: [] }));
            await writePrecomputedHolders(pair.currentQuarter, pair.previousQuarter, key, trimmed);
        }
        console.log(`[13F Precompute] Archived holder lists for ${Object.keys(comparison.currentHoldersByCategory || {}).length} categories`);
    }
    return comparison.coverage;
}

async function main() {
    const datasets = getArg('--sec-datasets');
    const archive = hasArg('--archive');

    if (!datasets) {
        const pool = createPostgresPool();
        try {
            await precomputeStorePair(pool, { archive });
        } finally {
            await pool.end();
        }
        return;
    }

    const currentQuarter = getArg('--current');
    if (!currentQuarter) throw new Error('--current is required with --sec-datasets');
    const snapshot = await buildStoreSnapshot({
        currentQuarter,
        previousQuarter: getArg('--previous') || previousReportQuarter(currentQuarter),
        dirs: datasets.split(',').map((dir) => path.resolve(dir.trim())),
    });
    const meta: StoreMeta = { ...snapshot.meta, updatedAt: snapshot.meta.builtAt };
    const directory = createStoreDirectory(snapshot.securities, snapshot.filers, meta.updatedAt);
    const ids = new Set(matchStoreSecurities(directory, DEFAULT_RADAR_WATCHLISTS, ALL_CATEGORIES));
    const rows = buildRadarRowsFromStore(meta, directory, snapshot.positions.filter((p) => ids.has(p.securityId)));
    await writePrecomputed(meta, rows, { archive, fromStore: false });
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
