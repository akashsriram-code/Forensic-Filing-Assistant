/**
 * Compact 13F store: one row per (security, filer) holding BOTH stored quarters side by side.
 * Two quarters of all-filer positions fit in ~300 MB, versus ~1 GB for raw per-quarter holdings rows.
 *
 * Tables: f13_meta (which quarter pair is stored), f13_securities, f13_filers (latest accession per side),
 * f13_positions (prev_* / cur_* shares and values). Option rows are never stored; values are whole dollars.
 */
import {
    matchIssuerToWatchlists,
    normalizeCik,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from './thirteen-f-radar-core';
import { type Pool } from 'pg';
import { type PostgresExecutor } from './thirteen-f-radar-postgres';

export type StoreSide = 'cur' | 'prev';

export interface StoreMeta {
    currentQuarter: string;
    previousQuarter: string;
    builtAt: string;
    source: string;
    updatedAt: string;
}

export interface StoreSecurity {
    id: number;
    securityKey: string;
    cusip: string | null;
    issuer: string;
}

export interface StoreFiler {
    id: number;
    cik: string;
    name: string;
    curAccession: string | null;
    curFilingDate: string | null;
    prevAccession: string | null;
    prevFilingDate: string | null;
}

export interface StorePosition {
    securityId: number;
    filerId: number;
    prevShares: number;
    prevValue: number;
    curShares: number;
    curValue: number;
    isPrn: boolean;
}

/** A filing's positions before ids are assigned (used by the bulk builder and live ingest). */
export interface StoreFilingPositionInput {
    cusip: string | null;
    issuer: string;
    shares: number;
    value: number;
    isPrn: boolean;
}

export interface StoreAppliedFiling {
    accessionNumber: string;
    quarter: string;
}

export interface StoreSnapshot {
    meta: Omit<StoreMeta, 'updatedAt'>;
    securities: StoreSecurity[];
    filers: StoreFiler[];
    positions: StorePosition[];
    /** Every filing folded into the snapshot (base reports and new-holdings amendments), so live ingest skips them. */
    appliedFilings: StoreAppliedFiling[];
}

export const STORE_TABLES = ['f13_meta', 'f13_securities', 'f13_filers', 'f13_positions', 'f13_applied_filings'] as const;
export const LEGACY_13F_TABLES = ['holdings', 'securities', 'filings', 'funds'] as const;

const INSERT_BATCH_SIZE = 10000;

export async function ensureStoreSchema(db: PostgresExecutor) {
    await db.query(`
        CREATE TABLE IF NOT EXISTS f13_meta (
            id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            current_quarter TEXT NOT NULL,
            previous_quarter TEXT NOT NULL,
            built_at TEXT NOT NULL,
            source TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS f13_securities (
            id SERIAL PRIMARY KEY,
            security_key TEXT NOT NULL UNIQUE,
            cusip TEXT,
            issuer TEXT NOT NULL
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS f13_filers (
            id SERIAL PRIMARY KEY,
            cik TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            cur_accession TEXT,
            cur_filing_date TEXT,
            prev_accession TEXT,
            prev_filing_date TEXT
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS f13_positions (
            security_id INTEGER NOT NULL,
            filer_id INTEGER NOT NULL,
            prev_shares BIGINT NOT NULL DEFAULT 0,
            prev_value BIGINT NOT NULL DEFAULT 0,
            cur_shares BIGINT NOT NULL DEFAULT 0,
            cur_value BIGINT NOT NULL DEFAULT 0,
            is_prn BOOLEAN NOT NULL DEFAULT FALSE,
            CONSTRAINT f13_positions_pkey PRIMARY KEY (security_id, filer_id)
        )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_f13_positions_filer ON f13_positions(filer_id)');
    await db.query(`
        CREATE TABLE IF NOT EXISTS f13_applied_filings (
            accession_number TEXT PRIMARY KEY,
            quarter TEXT NOT NULL
        )
    `);
}

/** Record a filing that was looked at but deliberately not applied, so later runs don't re-download it. */
export async function markFilingSeen(db: PostgresExecutor, accessionNumber: string, quarter: string | null) {
    await db.query(
        'INSERT INTO f13_applied_filings (accession_number, quarter) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [accessionNumber, quarter || 'unknown']
    );
}

export async function queryAppliedAccessions(db: PostgresExecutor): Promise<Set<string>> {
    const { rows } = await db.query('SELECT accession_number FROM f13_applied_filings');
    return new Set(rows.map((row) => String(row.accession_number)));
}

/** Drops the old raw-holdings tables. Their data is reproducible from SEC bulk datasets. */
export async function dropLegacy13FTables(db: PostgresExecutor) {
    await db.query(`DROP TABLE IF EXISTS ${LEGACY_13F_TABLES.join(', ')} CASCADE`);
}

export function buildStoreSecurityKey(cusip: string | null | undefined, issuer: string): string {
    const normalizedCusip = String(cusip || '').trim().toUpperCase();
    if (normalizedCusip && !/^0+$/.test(normalizedCusip)) return normalizedCusip;
    return `NO_CUSIP|${normalizeStoreIssuer(issuer)}`;
}

export function normalizeStoreIssuer(issuer: string): string {
    return String(issuer || '').trim().replace(/\s+/g, ' ').toUpperCase() || 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Replace the whole store with a snapshot (full rebuild from SEC bulk data).
 * Not transactional on purpose: keeping old and new rows alive together would double peak storage.
 */
export async function writeStoreSnapshot(db: PostgresExecutor, snapshot: StoreSnapshot, log = console.log) {
    await ensureStoreSchema(db);
    await db.query('TRUNCATE TABLE f13_positions, f13_filers, f13_securities, f13_meta, f13_applied_filings RESTART IDENTITY');
    await db.query('ALTER TABLE f13_positions DROP CONSTRAINT IF EXISTS f13_positions_pkey');
    await db.query('DROP INDEX IF EXISTS idx_f13_positions_filer');

    for (const batch of chunk(snapshot.securities, INSERT_BATCH_SIZE)) {
        await db.query(
            `INSERT INTO f13_securities (id, security_key, cusip, issuer)
             SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])`,
            [batch.map((s) => s.id), batch.map((s) => s.securityKey), batch.map((s) => s.cusip), batch.map((s) => s.issuer)]
        );
    }
    for (const batch of chunk(snapshot.filers, INSERT_BATCH_SIZE)) {
        await db.query(
            `INSERT INTO f13_filers (id, cik, name, cur_accession, cur_filing_date, prev_accession, prev_filing_date)
             SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])`,
            [
                batch.map((f) => f.id),
                batch.map((f) => f.cik),
                batch.map((f) => f.name),
                batch.map((f) => f.curAccession),
                batch.map((f) => f.curFilingDate),
                batch.map((f) => f.prevAccession),
                batch.map((f) => f.prevFilingDate),
            ]
        );
    }
    for (const batch of chunk(snapshot.appliedFilings, INSERT_BATCH_SIZE)) {
        await db.query(
            `INSERT INTO f13_applied_filings (accession_number, quarter)
             SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT DO NOTHING`,
            [batch.map((f) => f.accessionNumber), batch.map((f) => f.quarter)]
        );
    }
    await resetSerial(db, 'f13_securities');
    await resetSerial(db, 'f13_filers');

    let written = 0;
    for (const batch of chunk(snapshot.positions, INSERT_BATCH_SIZE)) {
        await insertPositions(db, batch, 'insert');
        written += batch.length;
        if (written % 500000 < INSERT_BATCH_SIZE) log(`[13F Store] ${written}/${snapshot.positions.length} positions written`);
    }

    // Build indexes after the load: sorted builds are faster and denser than incremental inserts.
    await db.query('ALTER TABLE f13_positions ADD CONSTRAINT f13_positions_pkey PRIMARY KEY (security_id, filer_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_f13_positions_filer ON f13_positions(filer_id)');
    await writeStoreMeta(db, snapshot.meta);
    await db.query('ANALYZE f13_positions');
}

export async function writeStoreMeta(db: PostgresExecutor, meta: Omit<StoreMeta, 'updatedAt'>) {
    await db.query(
        `INSERT INTO f13_meta (id, current_quarter, previous_quarter, built_at, source, updated_at)
         VALUES (1, $1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
            current_quarter = EXCLUDED.current_quarter,
            previous_quarter = EXCLUDED.previous_quarter,
            built_at = EXCLUDED.built_at,
            source = EXCLUDED.source,
            updated_at = EXCLUDED.updated_at`,
        [meta.currentQuarter, meta.previousQuarter, meta.builtAt, meta.source, new Date().toISOString()]
    );
}

export async function touchStoreMeta(db: PostgresExecutor) {
    await db.query('UPDATE f13_meta SET updated_at = $1 WHERE id = 1', [new Date().toISOString()]);
}

/**
 * Apply one live filing to one side of the store.
 * mode 'replace' (original 13F-HR or restatement): the filer's side is reset to exactly these positions.
 * mode 'add' (new-holdings amendment): positions are added on top of the existing side.
 */
export async function applyFilingToStore(
    db: PostgresExecutor,
    params: {
        side: StoreSide;
        quarter: string;
        cik: string;
        filerName: string;
        accessionNumber: string;
        filingDate: string;
        positions: StoreFilingPositionInput[];
        mode: 'replace' | 'add';
    }
) {
    const { side } = params;
    const filerId = await upsertFiler(db, params.cik, params.filerName);
    const aggregated = aggregateFilingPositions(params.positions);
    const securityIds = await upsertSecurities(db, Array.from(aggregated.values()).map((p) => ({ securityKey: p.securityKey, cusip: p.cusip, issuer: p.issuer })));

    if (params.mode === 'replace') {
        await db.query(`UPDATE f13_positions SET ${side}_shares = 0, ${side}_value = 0 WHERE filer_id = $1`, [filerId]);
    }

    const rows: StorePosition[] = Array.from(aggregated.values()).map((p) => ({
        securityId: securityIds.get(p.securityKey)!,
        filerId,
        prevShares: side === 'prev' ? p.shares : 0,
        prevValue: side === 'prev' ? p.value : 0,
        curShares: side === 'cur' ? p.shares : 0,
        curValue: side === 'cur' ? p.value : 0,
        isPrn: p.isPrn,
    }));
    for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
        await insertPositions(db, batch, params.mode === 'replace' ? { setSide: side } : { addSide: side });
    }

    await db.query(
        `DELETE FROM f13_positions
         WHERE filer_id = $1 AND prev_shares = 0 AND prev_value = 0 AND cur_shares = 0 AND cur_value = 0`,
        [filerId]
    );
    if (params.mode === 'replace') {
        await db.query(`UPDATE f13_filers SET ${side}_accession = $2, ${side}_filing_date = $3 WHERE id = $1`, [
            filerId,
            params.accessionNumber,
            params.filingDate,
        ]);
    }
    await db.query(
        'INSERT INTO f13_applied_filings (accession_number, quarter) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [params.accessionNumber, params.quarter]
    );
    return { filerId, positions: rows.length };
}

/** The filing date currently backing one side for a filer (null if the filer has none on that side). */
export async function queryFilerSideFilingDate(db: PostgresExecutor, cik: string, side: StoreSide): Promise<string | null> {
    const { rows } = await db.query(`SELECT ${side}_filing_date AS d FROM f13_filers WHERE cik = $1`, [normalizeCik(cik)]);
    return rows[0]?.d ? String(rows[0].d) : null;
}

/**
 * Read the whole store into memory (positions fetched in security-id chunks as column arrays).
 * Used to rewrite the store compactly: ~2.7M positions is a few hundred MB of JS objects.
 */
export async function readStoreSnapshot(pool: Pool, log = console.log): Promise<StoreSnapshot & { meta: StoreMeta }> {
    const meta = await readStoreMeta(pool);
    if (!meta) throw new Error('The 13F store is empty.');
    const [securityResult, filerResult, appliedResult, maxResult] = await Promise.all([
        pool.query('SELECT id, security_key, cusip, issuer FROM f13_securities'),
        pool.query('SELECT id, cik, name, cur_accession, cur_filing_date, prev_accession, prev_filing_date FROM f13_filers'),
        pool.query('SELECT accession_number, quarter FROM f13_applied_filings'),
        pool.query('SELECT MAX(security_id) AS max FROM f13_positions'),
    ]);
    const positions: StorePosition[] = [];
    const maxId = Number(maxResult.rows[0]?.max || 0);
    const step = 1000;
    for (let start = 0; start <= maxId; start += step) {
        const ids = Array.from({ length: step }, (_, i) => start + i);
        // A loop, not push(...chunk): big securities return 100k+ rows, too many for spread arguments.
        for (const position of await queryPositionsBySecurities(pool, ids)) positions.push(position);
        if ((start / step) % 5 === 0) log(`[13F Store] Read ${positions.length} positions (security ${start}/${maxId})`);
    }
    return {
        meta,
        securities: securityResult.rows.map((row) => ({
            id: Number(row.id),
            securityKey: String(row.security_key),
            cusip: row.cusip ? String(row.cusip) : null,
            issuer: String(row.issuer),
        })),
        filers: filerResult.rows.map((row) => ({
            id: Number(row.id),
            cik: String(row.cik),
            name: String(row.name),
            curAccession: row.cur_accession ? String(row.cur_accession) : null,
            curFilingDate: row.cur_filing_date ? String(row.cur_filing_date) : null,
            prevAccession: row.prev_accession ? String(row.prev_accession) : null,
            prevFilingDate: row.prev_filing_date ? String(row.prev_filing_date) : null,
        })),
        positions,
        appliedFilings: appliedResult.rows.map((row) => ({ accessionNumber: String(row.accession_number), quarter: String(row.quarter) })),
    };
}

/**
 * Rewrite the store from an in-memory snapshot. TRUNCATE frees the old space immediately, so unlike UPDATE-based
 * maintenance this needs no headroom and leaves no dead tuples or index bloat. Retries from memory if the reload fails.
 */
async function rewriteStore(pool: Pool, snapshot: StoreSnapshot, log = console.log) {
    for (let attempt = 1; ; attempt++) {
        try {
            await writeStoreSnapshot(pool, snapshot, log);
            await pool.query('VACUUM ANALYZE f13_positions');
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (attempt >= 3) {
                throw new Error(
                    `13F store reload failed after ${attempt} attempts; the store may be empty. ` +
                    `Rebuild it with scripts/build-13f-store.ts from SEC bulk data. Cause: ${message}`
                );
            }
            log(`[13F Store] Reload attempt ${attempt} failed (${message}); retrying`);
            await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
        }
    }
}

/** Reclaim space left by daily upserts (dead tuples are reusable after VACUUM, but the files never shrink). */
export async function compactStore(pool: Pool, log = console.log) {
    await rewriteStore(pool, await readStoreSnapshot(pool, log), log);
}

/** Shift the stored pair forward one quarter: cur becomes prev, cur starts empty. Rewrites the store compactly. */
export async function rolloverStore(pool: Pool, newCurrentQuarter: string, log = console.log) {
    const snapshot = await readStoreSnapshot(pool, log);
    const { meta } = snapshot;
    if (meta.currentQuarter === newCurrentQuarter) return false;

    // Positions held only in the outgoing previous quarter carry nothing forward.
    const positions = snapshot.positions
        .filter((p) => p.curShares > 0 || p.curValue > 0)
        .map((p) => ({ ...p, prevShares: p.curShares, prevValue: p.curValue, curShares: 0, curValue: 0 }));
    const filerIdsWithPositions = new Set(positions.map((p) => p.filerId));
    const filers = snapshot.filers
        .map((f) => ({ ...f, prevAccession: f.curAccession, prevFilingDate: f.curFilingDate, curAccession: null, curFilingDate: null }))
        .filter((f) => f.prevAccession || filerIdsWithPositions.has(f.id));

    log(`[13F Store] Rolling ${meta.currentQuarter} vs ${meta.previousQuarter} -> ${newCurrentQuarter} vs ${meta.currentQuarter}: ${positions.length} positions carried`);
    await rewriteStore(pool, {
        meta: {
            currentQuarter: newCurrentQuarter,
            previousQuarter: meta.currentQuarter,
            builtAt: meta.builtAt,
            source: `${meta.source.split('+')[0]}+rollover`,
        },
        securities: snapshot.securities,
        filers,
        positions,
        appliedFilings: snapshot.appliedFilings.filter((f) => f.quarter !== meta.previousQuarter),
    }, log);
    return true;
}

async function upsertFiler(db: PostgresExecutor, cik: string, name: string): Promise<number> {
    const { rows } = await db.query<{ id: number }>(
        `INSERT INTO f13_filers (cik, name) VALUES ($1, $2)
         ON CONFLICT (cik) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [normalizeCik(cik), name || normalizeCik(cik)]
    );
    return Number(rows[0].id);
}

async function upsertSecurities(
    db: PostgresExecutor,
    securities: Array<{ securityKey: string; cusip: string | null; issuer: string }>
): Promise<Map<string, number>> {
    const ids = new Map<string, number>();
    for (const batch of chunk(securities, INSERT_BATCH_SIZE)) {
        const { rows } = await db.query<{ id: number; security_key: string }>(
            `INSERT INTO f13_securities (security_key, cusip, issuer)
             SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
             ON CONFLICT (security_key) DO UPDATE SET issuer = EXCLUDED.issuer
             RETURNING id, security_key`,
            [batch.map((s) => s.securityKey), batch.map((s) => s.cusip), batch.map((s) => s.issuer)]
        );
        for (const row of rows) ids.set(row.security_key, Number(row.id));
    }
    return ids;
}

async function insertPositions(
    db: PostgresExecutor,
    rows: StorePosition[],
    conflict: 'insert' | { setSide: StoreSide } | { addSide: StoreSide }
) {
    let onConflict = '';
    if (conflict !== 'insert') {
        const side = 'setSide' in conflict ? conflict.setSide : conflict.addSide;
        const op = 'setSide' in conflict ? '' : `f13_positions.${side}_shares + `;
        const opValue = 'setSide' in conflict ? '' : `f13_positions.${side}_value + `;
        onConflict = `ON CONFLICT (security_id, filer_id) DO UPDATE SET
            ${side}_shares = ${op}EXCLUDED.${side}_shares,
            ${side}_value = ${opValue}EXCLUDED.${side}_value,
            is_prn = f13_positions.is_prn OR EXCLUDED.is_prn`;
    }
    await db.query(
        `INSERT INTO f13_positions (security_id, filer_id, prev_shares, prev_value, cur_shares, cur_value, is_prn)
         SELECT * FROM unnest($1::int[], $2::int[], $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bool[])
         ${onConflict}`,
        [
            rows.map((r) => r.securityId),
            rows.map((r) => r.filerId),
            rows.map((r) => Math.round(r.prevShares)),
            rows.map((r) => Math.round(r.prevValue)),
            rows.map((r) => Math.round(r.curShares)),
            rows.map((r) => Math.round(r.curValue)),
            rows.map((r) => r.isPrn),
        ]
    );
}

function aggregateFilingPositions(positions: StoreFilingPositionInput[]) {
    const bySecurity = new Map<string, { securityKey: string; cusip: string | null; issuer: string; shares: number; value: number; isPrn: boolean }>();
    for (const position of positions) {
        const issuer = normalizeStoreIssuer(position.issuer);
        const securityKey = buildStoreSecurityKey(position.cusip, issuer);
        const existing = bySecurity.get(securityKey) || {
            securityKey,
            cusip: position.cusip ? position.cusip.trim().toUpperCase() : null,
            issuer,
            shares: 0,
            value: 0,
            isPrn: false,
        };
        existing.shares += finite(position.shares);
        existing.value += finite(position.value);
        existing.isPrn ||= position.isPrn;
        bySecurity.set(securityKey, existing);
    }
    return bySecurity;
}

async function resetSerial(db: PostgresExecutor, table: string) {
    await db.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function readStoreMeta(db: PostgresExecutor): Promise<StoreMeta | null> {
    try {
        const { rows } = await db.query(
            'SELECT current_quarter, previous_quarter, built_at, source, updated_at FROM f13_meta WHERE id = 1'
        );
        const row = rows[0];
        if (!row) return null;
        return {
            currentQuarter: String(row.current_quarter),
            previousQuarter: String(row.previous_quarter),
            builtAt: String(row.built_at),
            source: String(row.source),
            updatedAt: String(row.updated_at),
        };
    } catch (error) {
        if (isUndefinedTable(error)) return null;
        throw error;
    }
}

export interface StoreDirectory {
    updatedAt: string;
    securities: StoreSecurity[];
    securitiesById: Map<number, StoreSecurity>;
    filers: StoreFiler[];
    filersById: Map<number, StoreFiler>;
    filersByCik: Map<string, StoreFiler>;
}

let directoryCache: StoreDirectory | null = null;

/** Securities + filers (~35k rows), memoised per warm instance until f13_meta.updated_at changes. */
export async function loadStoreDirectory(db: PostgresExecutor, meta: StoreMeta): Promise<StoreDirectory> {
    if (directoryCache && directoryCache.updatedAt === meta.updatedAt) return directoryCache;

    const [securityResult, filerResult] = await Promise.all([
        db.query('SELECT id, security_key, cusip, issuer FROM f13_securities'),
        db.query('SELECT id, cik, name, cur_accession, cur_filing_date, prev_accession, prev_filing_date FROM f13_filers'),
    ]);
    const securities: StoreSecurity[] = securityResult.rows.map((row) => ({
        id: Number(row.id),
        securityKey: String(row.security_key),
        cusip: row.cusip ? String(row.cusip) : null,
        issuer: String(row.issuer),
    }));
    const filers: StoreFiler[] = filerResult.rows.map((row) => ({
        id: Number(row.id),
        cik: String(row.cik),
        name: String(row.name),
        curAccession: row.cur_accession ? String(row.cur_accession) : null,
        curFilingDate: row.cur_filing_date ? String(row.cur_filing_date) : null,
        prevAccession: row.prev_accession ? String(row.prev_accession) : null,
        prevFilingDate: row.prev_filing_date ? String(row.prev_filing_date) : null,
    }));

    directoryCache = createStoreDirectory(securities, filers, meta.updatedAt);
    watchlistMatchCache.clear();
    return directoryCache;
}

export function createStoreDirectory(securities: StoreSecurity[], filers: StoreFiler[], updatedAt: string): StoreDirectory {
    return {
        updatedAt,
        securities,
        securitiesById: new Map(securities.map((s) => [s.id, s])),
        filers,
        filersById: new Map(filers.map((f) => [f.id, f])),
        filersByCik: new Map(filers.map((f) => [f.cik, f])),
    };
}

const watchlistMatchCache = new Map<string, number[]>();

/** Ids of securities whose issuer name matches the selected watchlist categories. */
export function matchStoreSecurities(
    directory: StoreDirectory,
    watchlists: RadarWatchlist[],
    selectedCategories: string[]
): number[] {
    const key = JSON.stringify([watchlists, [...selectedCategories].sort()]);
    const cached = watchlistMatchCache.get(key);
    if (cached) return cached;

    const ids = directory.securities
        .filter((security) => matchIssuerToWatchlists(security.issuer, watchlists, selectedCategories).length > 0)
        .map((security) => security.id);
    if (watchlistMatchCache.size > 50) watchlistMatchCache.clear();
    watchlistMatchCache.set(key, ids);
    return ids;
}

/**
 * Positions for a set of securities, fetched as column arrays (one row back) rather than one wire row per position:
 * hundreds of thousands of rows otherwise cost seconds in per-row protocol and parsing overhead.
 */
export async function queryPositionsBySecurities(db: PostgresExecutor, securityIds: number[]): Promise<StorePosition[]> {
    if (securityIds.length === 0) return [];
    const { rows } = await db.query(
        `SELECT
            array_agg(security_id) AS s, array_agg(filer_id) AS f,
            array_agg(prev_shares::float8) AS ps, array_agg(prev_value::float8) AS pv,
            array_agg(cur_shares::float8) AS cs, array_agg(cur_value::float8) AS cv,
            array_agg(is_prn) AS p
         FROM f13_positions WHERE security_id = ANY($1::int[])`,
        [securityIds]
    );
    const row = rows[0] as Record<string, unknown[] | null> | undefined;
    const ids = row?.s || [];
    return ids.map((securityId, i) => ({
        securityId: Number(securityId),
        filerId: Number(row!.f![i]),
        prevShares: Number(row!.ps![i]),
        prevValue: Number(row!.pv![i]),
        curShares: Number(row!.cs![i]),
        curValue: Number(row!.cv![i]),
        isPrn: Boolean(row!.p![i]),
    }));
}

export async function queryPositionsByFiler(db: PostgresExecutor, filerId: number): Promise<StorePosition[]> {
    const { rows } = await db.query(
        `SELECT security_id, filer_id, prev_shares, prev_value, cur_shares, cur_value, is_prn
         FROM f13_positions WHERE filer_id = $1`,
        [filerId]
    );
    return rows.map(toStorePosition);
}

/** Map store rows onto the radar core's per-quarter filing/holding rows. PRN (bond principal) rows are left out. */
export function buildRadarRowsFromStore(
    meta: StoreMeta,
    directory: StoreDirectory,
    positions: StorePosition[]
): { filings: RadarFilingRow[]; holdings: RadarHoldingRow[] } {
    const filings: RadarFilingRow[] = [];
    for (const filer of directory.filers) {
        if (filer.curAccession) {
            filings.push({ cik: filer.cik, fundName: filer.name, accessionNumber: filer.curAccession, filingDate: filer.curFilingDate || '', quarter: meta.currentQuarter });
        }
        if (filer.prevAccession) {
            filings.push({ cik: filer.cik, fundName: filer.name, accessionNumber: filer.prevAccession, filingDate: filer.prevFilingDate || '', quarter: meta.previousQuarter });
        }
    }

    const holdings: RadarHoldingRow[] = [];
    for (const position of positions) {
        if (position.isPrn) continue;
        const filer = directory.filersById.get(position.filerId);
        const security = directory.securitiesById.get(position.securityId);
        if (!filer || !security) continue;
        const base = { cik: filer.cik, fundName: filer.name, issuer: security.issuer, cusip: security.cusip };
        if (filer.curAccession && (position.curShares > 0 || position.curValue > 0)) {
            holdings.push({ ...base, accessionNumber: filer.curAccession, filingDate: filer.curFilingDate || '', quarter: meta.currentQuarter, value: position.curValue, shares: position.curShares });
        }
        if (filer.prevAccession && (position.prevShares > 0 || position.prevValue > 0)) {
            holdings.push({ ...base, accessionNumber: filer.prevAccession, filingDate: filer.prevFilingDate || '', quarter: meta.previousQuarter, value: position.prevValue, shares: position.prevShares });
        }
    }
    return { filings, holdings };
}

function toStorePosition(row: Record<string, unknown>): StorePosition {
    return {
        securityId: Number(row.security_id),
        filerId: Number(row.filer_id),
        prevShares: Number(row.prev_shares),
        prevValue: Number(row.prev_value),
        curShares: Number(row.cur_shares),
        curValue: Number(row.cur_value),
        isPrn: Boolean(row.is_prn),
    };
}

function isUndefinedTable(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '42P01';
}

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
}
