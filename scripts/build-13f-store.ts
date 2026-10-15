/**
 * Rebuild the compact 13F store (lib/thirteen-f-store.ts) from SEC Form 13F bulk data sets.
 *
 * Pass every extracted data-set folder that holds filings for any of the quarters (late filers land in later windows).
 * --prior adds the quarter before --previous for filers that haven't filed --current yet (needed mid filing season,
 * e.g. --current 2026-Q3 --previous 2026-Q2 --prior 2026-Q1 while Q3 is still coming in; live ingest fills Q3).
 *
 * Usage: npx tsx scripts/build-13f-store.ts --current 2026-Q2 --previous 2026-Q1 [--prior 2025-Q4]
 *        --datasets <dir1>,<dir2>[,...] [--dry-run] [--drop-legacy] [--skip-if-current]
 */
import 'dotenv/config';
import path from 'node:path';
import { getArg, hasArg, isDirectRun, previousReportQuarter } from './13f-ingestion-utils';
import {
    readDatasetFilingTotals,
    readDatasetFilings,
    readDatasetHoldings,
    selectDatasetFilings,
} from './sec-13f-dataset-reader';
import {
    buildStoreSecurityKey,
    dropLegacy13FTables,
    normalizeStoreIssuer,
    readStoreMeta,
    writeStoreSnapshot,
    type StoreFiler,
    type StorePosition,
    type StoreSecurity,
    type StoreSide,
    type StoreSnapshot,
} from '../lib/thirteen-f-store';
import {
    POSTGRES_13F_SIZE_TARGET_BYTES,
    assertPostgresWritable,
    createPostgresPool,
    queryPostgresDatabaseSize,
} from '../lib/thirteen-f-radar-postgres';

const FILER_KEY_SPACE = 1 << 17;
// Measured on Q1/Q2 2026: ~120 B per position row including both indexes, plus 16 B for the prior slot.
const ESTIMATED_BYTES_PER_POSITION = 136;

export async function buildStoreSnapshot(params: {
    currentQuarter: string;
    previousQuarter: string;
    priorQuarter?: string | null;
    dirs: string[];
    log?: (message: string) => void;
}): Promise<StoreSnapshot & { stats: Record<string, number> }> {
    const { currentQuarter, previousQuarter, dirs } = params;
    const priorQuarter = params.priorQuarter || null;
    const log = params.log || console.log;
    const sideOf = (quarter: string): StoreSide => (quarter === currentQuarter ? 'cur' : quarter === previousQuarter ? 'prev' : 'prior');

    const candidates = await readDatasetFilings(dirs, [currentQuarter, previousQuarter, ...(priorQuarter ? [priorQuarter] : [])]);
    log(`[13F Store] ${candidates.length} candidate 13F-HR filings`);
    const totals = await readDatasetFilingTotals(dirs, new Set(candidates.map((f) => f.accessionNumber)));
    const selected = selectDatasetFilings(candidates, totals);
    log(`[13F Store] ${selected.baseByFilerQuarter.size} filer-quarters, ${selected.newHoldingsAmendments} new-holdings amendments, ${selected.zeroValueFilings.length} zero-value stubs dropped`);

    const filersByCik = new Map<string, StoreFiler>();
    for (const base of selected.baseByFilerQuarter.values()) {
        const filer = filersByCik.get(base.cik) || {
            id: filersByCik.size + 1,
            cik: base.cik,
            name: base.filerName,
            curAccession: null,
            curFilingDate: null,
            prevAccession: null,
            prevFilingDate: null,
            priorAccession: null,
            priorFilingDate: null,
        };
        const side = sideOf(base.quarter);
        if (side === 'cur') {
            filer.curAccession = base.accessionNumber;
            filer.curFilingDate = base.filingDate;
            filer.name = base.filerName;
        } else if (side === 'prev') {
            filer.prevAccession = base.accessionNumber;
            filer.prevFilingDate = base.filingDate;
            if (!filer.curAccession) filer.name = base.filerName;
        } else {
            filer.priorAccession = base.accessionNumber;
            filer.priorFilingDate = base.filingDate;
            if (!filer.curAccession && !filer.prevAccession) filer.name = base.filerName;
        }
        filersByCik.set(base.cik, filer);
    }
    // The prior quarter is only kept for filers that haven't filed the current one.
    for (const filer of filersByCik.values()) {
        if (filer.curAccession) {
            filer.priorAccession = null;
            filer.priorFilingDate = null;
        }
    }
    if (filersByCik.size >= FILER_KEY_SPACE) throw new Error(`Too many filers (${filersByCik.size}) for position keys.`);

    const securitiesByKey = new Map<string, StoreSecurity>();
    const positions = new Map<number, StorePosition>();
    let optionRows = 0;
    await readDatasetHoldings(dirs, new Set(selected.byAccession.keys()), (row) => {
        if (row.putCall) {
            optionRows++;
            return;
        }
        const filing = selected.byAccession.get(row.accessionNumber)!;
        const filer = filersByCik.get(filing.cik)!;
        const side = sideOf(filing.quarter);
        if (side === 'prior' && filer.curAccession) return;
        const issuer = normalizeStoreIssuer(row.issuer);
        const securityKey = buildStoreSecurityKey(row.cusip, issuer);
        let security = securitiesByKey.get(securityKey);
        if (!security) {
            security = { id: securitiesByKey.size + 1, securityKey, cusip: row.cusip ? row.cusip.toUpperCase() : null, issuer };
            securitiesByKey.set(securityKey, security);
        }

        const key = security.id * FILER_KEY_SPACE + filer.id;
        const position = positions.get(key) || {
            securityId: security.id,
            filerId: filer.id,
            priorShares: 0,
            priorValue: 0,
            prevShares: 0,
            prevValue: 0,
            curShares: 0,
            curValue: 0,
            isPrn: false,
        };
        if (side === 'cur') {
            position.curShares += row.shares;
            position.curValue += row.value;
        } else if (side === 'prev') {
            position.prevShares += row.shares;
            position.prevValue += row.value;
        } else {
            position.priorShares += row.shares;
            position.priorValue += row.value;
        }
        position.isPrn ||= row.isPrn;
        positions.set(key, position);
    });

    const stats = {
        filers: filersByCik.size,
        comparableFilers: Array.from(filersByCik.values()).filter((f) => f.curAccession && f.prevAccession).length,
        securities: securitiesByKey.size,
        positions: positions.size,
        optionRowsExcluded: optionRows,
        zeroValueStubs: selected.zeroValueFilings.length,
        estimatedBytes: positions.size * ESTIMATED_BYTES_PER_POSITION,
    };
    return {
        meta: {
            currentQuarter,
            previousQuarter,
            priorQuarter,
            builtAt: new Date().toISOString(),
            source: datasetSource(dirs),
        },
        securities: Array.from(securitiesByKey.values()),
        filers: Array.from(filersByCik.values()),
        positions: Array.from(positions.values()),
        // Every filing in the data sets is accounted for (including superseded originals and zero-value stubs),
        // so live ingest never folds one back in.
        appliedFilings: candidates.map((f) => ({
            accessionNumber: f.accessionNumber,
            quarter: f.quarter,
        })),
        stats,
    };
}

/** "sec-bulk:01mar2026-31may2026_form13f,01jun2026-31aug2026_form13f" - names the data-set windows, sorted. */
function datasetSource(dirs: string[]): string {
    const names = dirs.map((dir) => (path.basename(dir) === 'extracted' ? path.basename(path.dirname(dir)) : path.basename(dir)));
    return `sec-bulk:${names.sort().join(',')}`;
}

async function main() {
    const currentQuarter = getArg('--current');
    const datasets = getArg('--datasets');
    if (!currentQuarter || !datasets) {
        console.error('Usage: npx tsx scripts/build-13f-store.ts --current 2026-Q2 [--previous 2026-Q1] --datasets <dir1>,<dir2> [--dry-run] [--drop-legacy]');
        process.exit(1);
    }
    const previousQuarter = getArg('--previous') || previousReportQuarter(currentQuarter);
    const priorQuarter = getArg('--prior');
    const dirs = datasets.split(',').map((dir) => path.resolve(dir.trim()));

    if (hasArg('--skip-if-current')) {
        const pool = createPostgresPool();
        const existing = await readStoreMeta(pool).catch(() => null).finally(() => pool.end());
        if (existing && existing.currentQuarter === currentQuarter && existing.previousQuarter === previousQuarter &&
            existing.source.split('+')[0] === datasetSource(dirs)) {
            console.log(`[13F Store] Store already built from ${existing.source}; skipping (--skip-if-current).`);
            return;
        }
    }

    const snapshot = await buildStoreSnapshot({ currentQuarter, previousQuarter, priorQuarter, dirs });
    console.log('[13F Store] Snapshot', snapshot.stats);
    if (snapshot.stats.estimatedBytes > POSTGRES_13F_SIZE_TARGET_BYTES) {
        throw new Error(`Estimated store size ${(snapshot.stats.estimatedBytes / 1048576).toFixed(0)} MB exceeds the ${POSTGRES_13F_SIZE_TARGET_BYTES / 1048576} MB target.`);
    }
    if (hasArg('--dry-run')) return;

    const pool = createPostgresPool();
    try {
        await assertPostgresWritable(pool, 'Postgres 13F store');
        if (hasArg('--drop-legacy')) {
            console.log('[13F Store] Dropping legacy holdings/securities/filings/funds tables');
            await dropLegacy13FTables(pool);
        }
        const existing = await readStoreMeta(pool).catch(() => null);
        if (existing && (existing.currentQuarter !== currentQuarter || existing.previousQuarter !== previousQuarter)) {
            // Keep the outgoing pair browsable (default view + holder lists) once it leaves the store.
            console.log(`[13F Store] Archiving outgoing pair ${existing.currentQuarter} vs ${existing.previousQuarter}`);
            const { precomputeStorePair } = await import('./precompute-13f-radar');
            await precomputeStorePair(pool, { archive: true });
        }
        await writeStoreSnapshot(pool, snapshot);
        await pool.query('VACUUM f13_positions');
        const size = await queryPostgresDatabaseSize(pool);
        console.log(`[13F Store] Done. Database size ${(size / 1048576).toFixed(1)} MB / target ${(POSTGRES_13F_SIZE_TARGET_BYTES / 1048576).toFixed(0)} MB`);
    } finally {
        await pool.end();
    }
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
