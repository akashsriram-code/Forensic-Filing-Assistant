import { Pool, type PoolClient, type PoolConfig } from 'pg';

/** Storage budget for the 13F store (the database cannot be expanded). */
export const POSTGRES_13F_SIZE_TARGET_BYTES = 480 * 1024 * 1024;

export type PostgresExecutor = Pool | PoolClient;

export function getPostgresConnectionString(): string | null {
    return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

export function createPostgresPool(
    connectionString = getPostgresConnectionString(),
    overrides: Pick<PoolConfig, 'connectionTimeoutMillis' | 'query_timeout'> = {}
): Pool {
    if (!connectionString) {
        throw new Error('Missing DATABASE_URL or POSTGRES_URL for Postgres 13F Radar.');
    }

    const normalizedConnectionString = normalizePostgresConnectionStringForNode(connectionString);
    const isLocal = /localhost|127\.0\.0\.1/i.test(normalizedConnectionString);
    const hasSslMode = /[?&]sslmode=/i.test(normalizedConnectionString);
    const config: PoolConfig & { enableChannelBinding?: boolean } = {
        connectionString: normalizedConnectionString,
        max: 4,
        ssl: isLocal || hasSslMode ? undefined : { rejectUnauthorized: false },
        ...overrides,
    };
    if (/[?&]channel_binding=require/i.test(normalizedConnectionString)) {
        config.enableChannelBinding = true;
    }

    return new Pool(config);
}

export async function assertPostgresWritable(
    db: PostgresExecutor,
    context = 'Postgres 13F target'
) {
    const result = await db.query<{
        in_recovery: boolean;
        transaction_read_only: string;
        default_transaction_read_only: string;
    }>(`
        SELECT
            pg_is_in_recovery() AS in_recovery,
            current_setting('transaction_read_only') AS transaction_read_only,
            current_setting('default_transaction_read_only') AS default_transaction_read_only
    `);
    const row = result.rows[0];
    const isReadOnly =
        row?.in_recovery ||
        row?.transaction_read_only === 'on' ||
        row?.default_transaction_read_only === 'on';

    if (!isReadOnly) return;

    throw new Error(
        `${context} is read-only. 13F ingestion needs the primary Postgres write URI; ` +
        `update AIVEN_DATABASE_URL, DATABASE_URL, or POSTGRES_URL to the read-write primary service URI, not a read-only replica URI.`
    );
}

function normalizePostgresConnectionStringForNode(connectionString: string): string {
    const needsLibpqCompat = /[?&]sslmode=(require|prefer)(?:&|$)/i.test(connectionString) &&
        !/[?&]uselibpqcompat=/i.test(connectionString);
    if (!needsLibpqCompat) return connectionString;

    return `${connectionString}${connectionString.includes('?') ? '&' : '?'}uselibpqcompat=true`;
}

export async function queryPostgresDatabaseSize(db: PostgresExecutor): Promise<number> {
    const result = await db.query('SELECT pg_database_size(current_database()) AS size_bytes');
    return Number(result.rows[0]?.size_bytes || 0);
}

export async function queryPostgresTableSizes(db: PostgresExecutor): Promise<Array<{ tableName: string; sizeBytes: number }>> {
    const result = await db.query(`
        SELECT
            relname AS table_name,
            pg_total_relation_size(c.oid) AS size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND relkind IN ('r', 'i')
        ORDER BY size_bytes DESC
    `);
    return result.rows.map((row) => ({
        tableName: String(row.table_name),
        sizeBytes: Number(row.size_bytes || 0),
    }));
}
