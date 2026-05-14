import { DEFAULT_RADAR_WATCHLISTS } from '../lib/thirteen-f-radar-core';
import {
    buildRadarMatchedRowsCache,
    writeRadarMatchedRowsCache,
} from '../lib/thirteen-f-radar-cache';
import {
    createRadarClientFromEnv,
    loadRadarComparison,
    resolveRadarRequest,
    type RadarRequestBody,
} from '../lib/thirteen-f-radar-data';

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const categories = DEFAULT_RADAR_WATCHLISTS.map((watchlist) => watchlist.key);
    const body: RadarRequestBody = {
        currentQuarter: args.current,
        previousQuarter: args.previous,
        categories,
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        movementBasis: 'filer-count',
    };
    const db = createRadarClientFromEnv();

    try {
        const request = await resolveRadarRequest(db, body);
        const defaultWatchlistRequest = {
            ...request,
            watchlists: DEFAULT_RADAR_WATCHLISTS,
            selectedCategories: categories,
        };
        const loaded = await loadRadarComparison(db, defaultWatchlistRequest, { useCache: false });
        const cache = buildRadarMatchedRowsCache({
            request: defaultWatchlistRequest,
            filings: loaded.filings,
            holdings: loaded.holdings,
        });
        const cachePath = await writeRadarMatchedRowsCache(cache, { cacheRoot: args.cacheRoot });

        console.log([
            `[13F Radar Cache] Wrote ${cachePath}`,
            `[13F Radar Cache] ${cache.currentQuarter} vs ${cache.previousQuarter}`,
            `[13F Radar Cache] ${cache.filings.length} filing rows, ${cache.holdings.length} matched holding rows`,
            `[13F Radar Cache] Watchlist hash ${cache.watchlistHash}`,
        ].join('\n'));
    } finally {
        if (db.provider === 'postgres') {
            await db.pool.end();
        }
    }
}

function parseArgs(argv: string[]) {
    return {
        current: readArg(argv, 'current'),
        previous: readArg(argv, 'previous'),
        cacheRoot: readArg(argv, 'cache-root'),
    };
}

function readArg(argv: string[], name: string): string | undefined {
    const prefix = `--${name}=`;
    const value = argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim();
    return value || undefined;
}

main().catch((error) => {
    console.error('[13F Radar Cache] Failed:', error);
    process.exitCode = 1;
});
