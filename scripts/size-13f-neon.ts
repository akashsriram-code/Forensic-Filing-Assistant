import * as dotenv from 'dotenv';
import {
    createPostgresPool,
    getPostgresConnectionString,
    POSTGRES_13F_SIZE_TARGET_BYTES,
    queryPostgresDatabaseSize,
    queryPostgresTableSizes,
} from '../lib/thirteen-f-radar-postgres';
import { isDirectRun } from './13f-ingestion-utils';

dotenv.config();

async function main() {
    const postgresUrl = getPostgresConnectionString();
    if (!postgresUrl) throw new Error('Missing DATABASE_URL or POSTGRES_URL for Neon/Postgres size check.');

    const pool = createPostgresPool(postgresUrl);
    try {
        const databaseSize = await queryPostgresDatabaseSize(pool);
        const tableSizes = await queryPostgresTableSizes(pool);
        console.log(`[13F Neon Size] Database size: ${formatBytes(databaseSize)} / target ${formatBytes(POSTGRES_13F_SIZE_TARGET_BYTES)}`);
        console.table(tableSizes.map((row) => ({
            name: row.tableName,
            size: formatBytes(row.sizeBytes),
            bytes: row.sizeBytes,
        })));
    } finally {
        await pool.end();
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    for (const unit of units) {
        if (value < 1024) return `${value.toFixed(1)} ${unit}`;
        value /= 1024;
    }
    return `${value.toFixed(1)} TB`;
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
