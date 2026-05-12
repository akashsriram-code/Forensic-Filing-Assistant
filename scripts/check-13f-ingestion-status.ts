import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import {
    createPostgresPool,
    ensurePostgres13FSchema,
    getPostgresConnectionString,
    getPostgresIngestionRunStatus,
} from '../lib/thirteen-f-radar-postgres';
import {
    getArg,
    getIngestionRunStatus,
    hasArg,
    isDirectRun,
    resolveIngestionTargetProvider,
    type IngestionSource,
} from './13f-ingestion-utils';

dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

async function main() {
    const quarter = getArg('--quarter');
    const source = getArg('--source') as IngestionSource | null;
    if (!quarter || !source || !['live-edgar', 'sec-bulk'].includes(source)) {
        console.error('Usage: npx tsx scripts/check-13f-ingestion-status.ts --quarter 2026-Q1 --source sec-bulk [--target turso|postgres] [--github-output]');
        process.exit(1);
    }
    const target = resolveIngestionTargetProvider();
    if (target === 'postgres') {
        if (!getPostgresConnectionString()) {
            console.error('Missing DATABASE_URL or POSTGRES_URL for Postgres ingestion status.');
            process.exit(1);
        }
        const pool = createPostgresPool();
        try {
            await ensurePostgres13FSchema(pool);
            const status = await getPostgresIngestionRunStatus(pool, { quarter, source });
            emitStatus({ quarter, source, target, status });
        } finally {
            await pool.end();
        }
        return;
    }

    if (!TURSO_URL || !TURSO_TOKEN) {
        console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.');
        process.exit(1);
    }

    const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    const status = await getIngestionRunStatus(turso, { quarter, source });
    emitStatus({ quarter, source, target, status });
}

function emitStatus(params: {
    quarter: string;
    source: IngestionSource;
    target: string;
    status: {
        done: boolean;
        hasRun: boolean;
        latestStatus: string;
        liveMode: string;
        refreshExisting: boolean;
    };
}) {
    const { quarter, source, target, status } = params;
    if (hasArg('--github-output')) {
        appendGithubOutput({
            done: String(status.done),
            has_run: String(status.hasRun),
            latest_status: status.latestStatus,
            live_mode: status.liveMode,
            refresh_existing: String(status.refreshExisting),
            target,
        });
    } else {
        console.log(JSON.stringify({ quarter, source, target, ...status }, null, 2));
    }
}

function appendGithubOutput(values: Record<string, string>) {
    const outputPath = process.env.GITHUB_OUTPUT;
    const text = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    if (outputPath) fs.appendFileSync(outputPath, text);
    else process.stdout.write(text);
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
