import * as fs from 'node:fs';
import { getArg, hasArg, isDirectRun, resolveIngestionSchedule } from './13f-ingestion-utils';

async function main() {
    const quarter = getArg('--quarter') || undefined;
    const asOfArg = getArg('--as-of');
    const asOf = asOfArg ? new Date(`${asOfArg}T00:00:00.000Z`) : new Date();
    const schedule = resolveIngestionSchedule(quarter, asOf);

    if (hasArg('--github-output')) {
        appendGithubOutput({
            quarter: schedule.quarter,
            as_of: schedule.asOf,
            live_active: String(schedule.liveActive),
            bulk_active: String(schedule.bulkActive),
            live_window_start: schedule.liveWindowStart,
            live_window_end: schedule.liveWindowEnd,
            bulk_window_start: schedule.bulkWindowStart,
            bulk_window_end: schedule.bulkWindowEnd,
            filing_index_year: String(schedule.filingIndexYear),
            filing_index_quarter: String(schedule.filingIndexQuarter),
        });
    } else {
        console.log(JSON.stringify(schedule, null, 2));
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
