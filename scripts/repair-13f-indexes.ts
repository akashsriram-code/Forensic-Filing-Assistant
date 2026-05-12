import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import {
    createPostgresPool,
    ensurePostgres13FIndexes,
    ensurePostgres13FSchema,
    getPostgresConnectionString,
    listPostgres13FIndexes,
    missingRequiredPostgres13FIndexes,
} from '../lib/thirteen-f-radar-postgres';
import {
    ensureRequired13FIndexes,
    getArg,
    hasArg,
    isDirectRun,
    listTableIndexes,
    missingRequiredHoldingIndexes,
    resolveIngestionTargetProvider,
} from './13f-ingestion-utils';

dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

async function main() {
    const quarter = getArg('--quarter') || '';
    const verifyOnly = hasArg('--verify-only');
    const requireAll = hasArg('--require-all');
    const githubSummary = hasArg('--github-summary');
    const githubOutput = hasArg('--github-output');
    const target = resolveIngestionTargetProvider();

    if (target === 'postgres') {
        if (!getPostgresConnectionString()) {
            console.error('Missing DATABASE_URL or POSTGRES_URL for Postgres index repair.');
            process.exit(1);
        }
        const pool = createPostgresPool();
        try {
            if (!verifyOnly) {
                console.log('[13F Index Repair] Ensuring required Postgres 13F indexes...');
                await ensurePostgres13FSchema(pool);
                await ensurePostgres13FIndexes(pool);
            }
            const indexes = await listPostgres13FIndexes(pool);
            const missing = missingRequiredPostgres13FIndexes(indexes);
            console.log('[13F Index Repair] Postgres indexes');
            console.table(indexes.map((name) => ({ name })));
            if (githubOutput) {
                appendGithubOutput({
                    indexes_ok: String(missing.length === 0),
                    holdings_indexes: indexes.join(','),
                    missing_indexes: missing.join(','),
                    target,
                });
            }
            if (githubSummary) {
                appendGithubSummary(quarter, indexes, missing, target);
            }
            if (requireAll && missing.length > 0) {
                throw new Error(`Missing required Postgres 13F indexes: ${missing.join(', ')}`);
            }
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
    if (!verifyOnly) {
        console.log('[13F Index Repair] Ensuring required 13F indexes...');
        await ensureRequired13FIndexes(turso);
    }

    const holdingsIndexes = await listTableIndexes(turso, 'holdings');
    const missing = missingRequiredHoldingIndexes(holdingsIndexes);
    console.log('[13F Index Repair] Holdings indexes');
    console.table(holdingsIndexes.map((name) => ({ name })));

    if (githubOutput) {
        appendGithubOutput({
            indexes_ok: String(missing.length === 0),
            holdings_indexes: holdingsIndexes.join(','),
            missing_indexes: missing.join(','),
            target,
        });
    }
    if (githubSummary) {
        appendGithubSummary(quarter, holdingsIndexes, missing, target);
    }
    if (requireAll && missing.length > 0) {
        throw new Error(`Missing required holdings indexes: ${missing.join(', ')}`);
    }
}

function appendGithubOutput(values: Record<string, string>) {
    const outputPath = process.env.GITHUB_OUTPUT;
    const text = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    if (outputPath) fs.appendFileSync(outputPath, text);
    else process.stdout.write(text);
}

function appendGithubSummary(quarter: string, holdingsIndexes: string[], missing: string[], target: string) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;
    fs.appendFileSync(summaryPath, [
        `## 13F Index Repair${quarter ? ` (${quarter})` : ''}`,
        '',
        `- Target: ${target}`,
        `- Holdings indexes: ${holdingsIndexes.length > 0 ? holdingsIndexes.join(', ') : 'none'}`,
        `- Missing required indexes: ${missing.length > 0 ? missing.join(', ') : 'none'}`,
        '',
    ].join('\n'));
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
