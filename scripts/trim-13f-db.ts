/**
 * Delete Q2 data from DB after it's been merged into cache.
 * This frees up space for the next batch of ingestion.
 * 
 * Usage: npx tsx scripts/trim-13f-db.ts
 */
import {
    createPostgresPool,
    getPostgresConnectionString,
    queryPostgresDatabaseSize,
} from '../lib/thirteen-f-radar-postgres';
import { getArg, hasArg, isDirectRun } from './13f-ingestion-utils';

async function main() {
    const dryRun = hasArg('--dry-run');
    const quarter = getArg('--quarter') || '2026-Q2';
    
    console.log(`[DB Trim] Trimming ${quarter} data from database...`);
    
    const connectionString = getPostgresConnectionString();
    if (!connectionString) {
        console.error('[DB Trim] Missing DATABASE_URL or POSTGRES_URL');
        process.exit(1);
    }
    
    const pool = createPostgresPool(connectionString);
    
    try {
        // Check current size
        const sizeBefore = await queryPostgresDatabaseSize(pool);
        console.log(`[DB Trim] Database size before: ${(sizeBefore / 1024 / 1024).toFixed(1)} MB`);
        
        // Count what we're about to delete
        const filingsCount = await pool.query(
            `SELECT COUNT(*) as count FROM filings WHERE quarter = $1`,
            [quarter]
        );
        const holdingsCount = await pool.query(
            `SELECT COUNT(*) as count FROM holdings h
             JOIN filings f ON h.accession_number = f.accession_number
             WHERE f.quarter = $1`,
            [quarter]
        );
        
        console.log(`[DB Trim] Found ${filingsCount.rows[0].count} filings and ${holdingsCount.rows[0].count} holdings to delete`);
        
        if (dryRun) {
            console.log('[DB Trim] Dry run - not deleting');
            await pool.end();
            return;
        }
        
        // Delete holdings first (foreign key constraint)
        console.log('[DB Trim] Deleting holdings...');
        const holdingsResult = await pool.query(
            `DELETE FROM holdings h
             USING filings f
             WHERE h.accession_number = f.accession_number
             AND f.quarter = $1`,
            [quarter]
        );
        console.log(`[DB Trim] Deleted ${holdingsResult.rowCount} holdings`);
        
        // Delete filings
        console.log('[DB Trim] Deleting filings...');
        const filingsResult = await pool.query(
            `DELETE FROM filings WHERE quarter = $1`,
            [quarter]
        );
        console.log(`[DB Trim] Deleted ${filingsResult.rowCount} filings`);
        
        // Delete orphaned securities
        console.log('[DB Trim] Deleting orphaned securities...');
        const securitiesResult = await pool.query(`
            DELETE FROM securities s
            WHERE NOT EXISTS (
                SELECT 1 FROM holdings h WHERE h.security_key = s.security_key
            )
        `);
        console.log(`[DB Trim] Deleted ${securitiesResult.rowCount} orphaned securities`);
        
        // Delete orphaned funds
        console.log('[DB Trim] Deleting orphaned funds...');
        const fundsResult = await pool.query(`
            DELETE FROM funds f
            WHERE NOT EXISTS (
                SELECT 1 FROM filings fi WHERE fi.cik = f.cik
            )
        `);
        console.log(`[DB Trim] Deleted ${fundsResult.rowCount} orphaned funds`);
        
        // Run VACUUM to reclaim space
        console.log('[DB Trim] Running VACUUM ANALYZE...');
        await pool.query('VACUUM ANALYZE');
        
        // Check size after
        const sizeAfter = await queryPostgresDatabaseSize(pool);
        console.log(`[DB Trim] Database size after: ${(sizeAfter / 1024 / 1024).toFixed(1)} MB`);
        console.log(`[DB Trim] Freed: ${((sizeBefore - sizeAfter) / 1024 / 1024).toFixed(1)} MB`);
        
    } finally {
        await pool.end();
    }
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error('[DB Trim] Failed:', error);
        process.exit(1);
    });
}