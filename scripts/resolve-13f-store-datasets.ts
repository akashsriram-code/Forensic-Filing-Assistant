/**
 * List the published SEC Form 13F data-set ZIPs needed to (re)build the store for a quarter pair:
 * the filing window of each quarter, plus the following window (late filers), when published.
 *
 * Usage: npx tsx scripts/resolve-13f-store-datasets.ts [--current 2026-Q2 [--previous 2026-Q1]] [--github-output]
 *        (without --current: the pair currently held in the store)
 * Output: one URL per line (or `urls=<space-separated>` and `complete=true|false` for GitHub Actions).
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import { createPostgresPool } from '../lib/thirteen-f-radar-postgres';
import { readStoreMeta } from '../lib/thirteen-f-store';
import { getArg, hasArg, isDirectRun, previousReportQuarter, resolveSecDatasetUrlForQuarter } from './13f-ingestion-utils';

function nextReportQuarter(quarter: string): string {
    const [year, q] = quarter.split('-Q').map(Number);
    return q === 4 ? `${year + 1}-Q1` : `${year}-Q${q + 1}`;
}

async function main() {
    let current = getArg('--current');
    let previous = getArg('--previous');
    let prior = getArg('--prior');
    const pool = createPostgresPool();
    const meta = await readStoreMeta(pool).catch(() => null).finally(() => pool.end());
    if (!current) {
        // Default: the pair currently held in the store.
        if (!meta) {
            console.error('Store is empty; pass --current.');
            process.exit(1);
        }
        current = meta.currentQuarter;
        previous = meta.previousQuarter;
        prior = meta.priorQuarter;
    }
    previous ||= previousReportQuarter(current);
    prior ||= previousReportQuarter(previous);
    // A quarter's filings land in its own window; stragglers spill into the next one.
    // The prior quarter (kept for filers that haven't filed the current one) is included when its window is published.
    const required = [previous, current];
    const optional = [prior, nextReportQuarter(current)];

    const urls: string[] = [];
    let complete = true;
    for (const quarter of [...required, ...optional]) {
        const { url, label } = await resolveSecDatasetUrlForQuarter(quarter);
        if (url) urls.push(url);
        else if (required.includes(quarter)) {
            complete = false;
            console.error(`[13F Datasets] Not yet published: ${label}`);
        }
    }

    // Same naming as build-13f-store's datasetSource(): extracted folders are named after the ZIP.
    const source = `sec-bulk:${urls.map((url) => url.split('/').pop()!.replace(/\.zip$/i, '')).sort().join(',')}`;
    const upToDate = Boolean(
        meta && meta.currentQuarter === current && meta.previousQuarter === previous && meta.priorQuarter === prior && meta.source.split('+')[0] === source
    );

    if (hasArg('--github-output')) {
        const text = `urls=${urls.join(' ')}\ncomplete=${complete}\nup_to_date=${upToDate}\ncurrent=${current}\nprevious=${previous}\nprior=${prior}\n`;
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, text);
        else process.stdout.write(text);
    } else {
        for (const url of urls) console.log(url);
        if (!complete) process.exitCode = 1;
    }
}

if (isDirectRun(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
