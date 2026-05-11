import * as fs from 'node:fs';
import { getArg, hasArg, isDirectRun, resolveSecDatasetUrlForQuarter } from './13f-ingestion-utils';

async function main() {
    const quarter = getArg('--quarter');
    if (!quarter) {
        console.error('Usage: npx tsx scripts/resolve-sec-13f-dataset-url.ts --quarter 2026-Q1 [--github-output]');
        process.exit(1);
    }

    const resolved = await resolveSecDatasetUrlForQuarter(quarter);
    if (hasArg('--github-output')) {
        appendGithubOutput({
            sec_zip_url: resolved.url || '',
            sec_zip_label: resolved.label,
        });
    } else {
        console.log(JSON.stringify(resolved, null, 2));
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
