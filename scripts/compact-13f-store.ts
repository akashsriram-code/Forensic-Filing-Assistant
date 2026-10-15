/**
 * Rewrite the 13F store compactly (read into memory -> TRUNCATE -> bulk reload) to give back space left by upserts.
 * The live ingester does this automatically above 400 MB; this is the manual equivalent.
 *
 * Usage: npx tsx scripts/compact-13f-store.ts
 */
import 'dotenv/config';
import { assertPostgresWritable, createPostgresPool, queryPostgresDatabaseSize } from '../lib/thirteen-f-radar-postgres';
import { compactStore } from '../lib/thirteen-f-store';
import { isDirectRun } from './13f-ingestion-utils';

async function main() {
    const pool = createPostgresPool();
    try {
        await assertPostgresWritable(pool, '13F store compaction');
        const before = await queryPostgresDatabaseSize(pool);
        await compactStore(pool);
        const after = await queryPostgresDatabaseSize(pool);
        console.log(`[13F Store] Compacted: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
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
