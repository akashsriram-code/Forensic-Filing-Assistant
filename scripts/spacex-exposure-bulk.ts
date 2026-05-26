import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    DEFAULT_SPACEX_EXPOSURE_FORMS,
    defaultSpaceXExposureEndDate,
    defaultSpaceXExposureStartDate,
    runSpaceXExposureRadar,
    type SpaceXExposureRequestBody,
    type SpaceXExposureRow,
} from '../lib/spacex-exposure-radar';
import {
    buildSpaceXExposureExportFilename,
    buildSpaceXExposureWorkbook,
} from '../lib/spacex-exposure-radar-export';

interface BulkCliOptions {
    startDate: string;
    endDate: string;
    forms: string[];
    maxFilings: number;
    maxDiscoveryHits: number;
    outDir: string;
    aiVerify: boolean;
    openArenaReviewLimit: number;
    requestSpacingMs: number;
    concurrency: number;
    secUserAgent: string;
}

const DEFAULT_BULK_MAX_FILINGS = 300;
const DEFAULT_BULK_CONCURRENCY = 3;
const DEFAULT_BULK_REQUEST_SPACING_MS = 400;
const DEFAULT_BULK_OPENARENA_REVIEW_LIMIT = 10;

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!options) return;

    configureBulkEnvironment(options);
    const request: SpaceXExposureRequestBody = {
        startDate: options.startDate,
        endDate: options.endDate,
        forms: options.forms,
        maxFilings: options.maxFilings,
        aiVerify: options.aiVerify,
    };

    const startedAt = new Date();
    console.log(`SpaceX Exposure bulk run started at ${startedAt.toISOString()}`);
    console.log(`Date range: ${options.startDate} to ${options.endDate}`);
    console.log(`Forms: ${options.forms.join(', ')}`);
    console.log(`SEC source filing cap: ${options.maxFilings}`);
    console.log(`SEC discovery cap: ${options.maxDiscoveryHits}`);
    console.log(`OpenArena: ${options.aiVerify ? `on, review cap ${options.openArenaReviewLimit}` : 'off'}`);
    console.log(`Output folder: ${path.resolve(options.outDir)}`);

    let lastProgressLog = 0;
    let lastDiscoveryLog = 0;
    const response = await runSpaceXExposureRadar(request, {
        requestSpacingMs: options.requestSpacingMs,
        onProgress: (progress) => {
            if (progress.phase === 'discover_search_page') {
                if (
                    progress.from === 0 ||
                    progress.discoveredCount >= lastDiscoveryLog + 1000 ||
                    progress.discoveredCount >= progress.targetHits
                ) {
                    lastDiscoveryLog = progress.discoveredCount;
                    console.log(`Discovered ${progress.discoveredCount}/${progress.targetHits} SEC search hits around "${progress.query}"`);
                }
                return;
            }

            if (
                progress.fetchedCount === progress.totalFilings ||
                progress.fetchedCount === 1 ||
                progress.fetchedCount >= lastProgressLog + 10
            ) {
                lastProgressLog = progress.fetchedCount;
                console.log(`Fetched ${progress.fetchedCount}/${progress.totalFilings}: ${progress.form} ${progress.accessionNumber}`);
            }
        },
    });

    await fs.mkdir(options.outDir, { recursive: true });
    const baseName = buildBulkBaseName(response.startDate, response.endDate);
    const xlsxPath = path.join(options.outDir, `${baseName}.xlsx`);
    const csvPath = path.join(options.outDir, `${baseName}.csv`);
    const summaryPath = path.join(options.outDir, `${baseName}.summary.json`);

    await fs.writeFile(xlsxPath, buildSpaceXExposureWorkbook(response));
    await fs.writeFile(csvPath, buildRowsCsv(response.rows), 'utf8');
    await fs.writeFile(summaryPath, JSON.stringify({
        generatedAt: response.generatedAt,
        durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
        request: {
            startDate: options.startDate,
            endDate: options.endDate,
            forms: options.forms,
            maxFilings: options.maxFilings,
            maxDiscoveryHits: options.maxDiscoveryHits,
            aiVerify: options.aiVerify,
            requestSpacingMs: options.requestSpacingMs,
            concurrency: options.concurrency,
        },
        summary: response.summary,
        warnings: response.warnings,
        files: {
            xlsx: path.resolve(xlsxPath),
            csv: path.resolve(csvPath),
        },
    }, null, 2), 'utf8');

    console.log('');
    console.log('Bulk run complete.');
    console.log(`Rows: ${response.summary.totalRows}`);
    console.log(`Holdings: ${response.summary.holdingRows}`);
    console.log(`Review: ${response.summary.reviewRows}`);
    console.log(`Narrative: ${response.summary.narrativeRows}`);
    console.log(`Filings fetched: ${response.summary.filingsFetched}`);
    console.log(`Search hits discovered: ${response.summary.searchHitsDiscovered}`);
    if (response.warnings.length > 0) {
        console.log('Warnings:');
        for (const warning of response.warnings) console.log(`- ${warning}`);
    }
    console.log(`XLSX: ${path.resolve(xlsxPath)}`);
    console.log(`CSV: ${path.resolve(csvPath)}`);
    console.log(`Summary: ${path.resolve(summaryPath)}`);
}

function parseArgs(argv: string[]): BulkCliOptions | null {
    const normalized = expandEqualsArgs(argv);
    if (normalized.includes('--help') || normalized.includes('-h')) {
        printHelp();
        return null;
    }

    const now = new Date();
    const options: BulkCliOptions = {
        startDate: defaultSpaceXExposureStartDate(now),
        endDate: defaultSpaceXExposureEndDate(now),
        forms: [...DEFAULT_SPACEX_EXPOSURE_FORMS],
        maxFilings: DEFAULT_BULK_MAX_FILINGS,
        maxDiscoveryHits: DEFAULT_BULK_MAX_FILINGS * 5,
        outDir: path.join(process.cwd(), 'exports', 'spacex-exposure'),
        aiVerify: false,
        openArenaReviewLimit: DEFAULT_BULK_OPENARENA_REVIEW_LIMIT,
        requestSpacingMs: DEFAULT_BULK_REQUEST_SPACING_MS,
        concurrency: DEFAULT_BULK_CONCURRENCY,
        secUserAgent: process.env.SEC_USER_AGENT || 'ForensicAnalyzer contact@example.com',
    };

    for (let index = 0; index < normalized.length; index += 1) {
        const arg = normalized[index];
        switch (arg) {
            case '--start-date':
                options.startDate = readRequiredValue(normalized, ++index, arg);
                break;
            case '--end-date':
                options.endDate = readRequiredValue(normalized, ++index, arg);
                break;
            case '--forms':
                options.forms = parseForms(readRequiredValue(normalized, ++index, arg));
                break;
            case '--max-filings':
            case '-m':
                options.maxFilings = parsePositiveInteger(readRequiredValue(normalized, ++index, arg), arg);
                options.maxDiscoveryHits = Math.max(options.maxDiscoveryHits, options.maxFilings * 5);
                break;
            case '--max-discovery-hits':
                options.maxDiscoveryHits = parsePositiveInteger(readRequiredValue(normalized, ++index, arg), arg);
                break;
            case '--out-dir':
                options.outDir = readRequiredValue(normalized, ++index, arg);
                break;
            case '--openarena':
            case '--ai-verify':
                options.aiVerify = true;
                break;
            case '--no-openarena':
            case '--no-ai-verify':
                options.aiVerify = false;
                break;
            case '--openarena-limit':
                options.openArenaReviewLimit = parsePositiveInteger(readRequiredValue(normalized, ++index, arg), arg);
                break;
            case '--request-spacing-ms':
                options.requestSpacingMs = parsePositiveInteger(readRequiredValue(normalized, ++index, arg), arg);
                break;
            case '--concurrency':
                options.concurrency = parsePositiveInteger(readRequiredValue(normalized, ++index, arg), arg);
                break;
            case '--sec-user-agent':
                options.secUserAgent = readRequiredValue(normalized, ++index, arg);
                break;
            default:
                throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
        }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.startDate)) throw new Error(`Invalid --start-date: ${options.startDate}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.endDate)) throw new Error(`Invalid --end-date: ${options.endDate}`);
    if (options.forms.length === 0) throw new Error('At least one form is required.');
    options.maxDiscoveryHits = Math.max(options.maxDiscoveryHits, options.maxFilings);

    return options;
}

function configureBulkEnvironment(options: BulkCliOptions) {
    process.env.SEC_USER_AGENT = options.secUserAgent;
    process.env.SPACEX_EXPOSURE_HARD_MAX_FILINGS = String(options.maxFilings);
    process.env.SPACEX_EXPOSURE_MAX_FILINGS = String(options.maxFilings);
    process.env.SPACEX_EXPOSURE_MAX_DISCOVERY_HITS = String(options.maxDiscoveryHits);
    process.env.SPACEX_EXPOSURE_FETCH_CONCURRENCY = String(options.concurrency);
    process.env.OPENARENA_SPACEX_EXPOSURE_REVIEW_LIMIT = String(options.openArenaReviewLimit);
}

function buildBulkBaseName(startDate: string, endDate: string) {
    const base = buildSpaceXExposureExportFilename(startDate, endDate).replace(/\.xlsx$/i, '');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${base}-bulk-${timestamp}`;
}

function buildRowsCsv(rows: SpaceXExposureRow[]) {
    const headers = [
        'filerName',
        'cik',
        'form',
        'filingDate',
        'periodEnd',
        'accessionNumber',
        'documentName',
        'fileDescription',
        'relationshipType',
        'confidence',
        'matchedTerms',
        'securityName',
        'issuerName',
        'cusip',
        'sharesOrBalance',
        'units',
        'valueUsd',
        'pctValue',
        'assetCategory',
        'issuerCategory',
        'investmentCountry',
        'snippet',
        'secDocumentUrl',
        'secFilingUrl',
        'openArenaStatus',
        'openArenaNotes',
        'notes',
    ] as const;

    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
    ];
    return `${lines.join('\n')}\n`;
}

function csvCell(value: string | number | string[] | null) {
    const text = Array.isArray(value) ? value.join('; ') : value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function parseForms(value: string) {
    return value
        .split(',')
        .map((form) => form.trim().toUpperCase())
        .filter(Boolean);
}

function parsePositiveInteger(value: string, flag: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
    return parsed;
}

function readRequiredValue(args: string[], index: number, flag: string) {
    const value = args[index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    return value;
}

function expandEqualsArgs(args: string[]) {
    return args.flatMap((arg) => {
        if (!arg.startsWith('--') || !arg.includes('=')) return [arg];
        const [flag, ...rest] = arg.split('=');
        return [flag, rest.join('=')];
    });
}

function printHelp() {
    console.log(`
SpaceX Exposure bulk export

Usage:
  npm run spacex-exposure:bulk -- [options]

Examples:
  npm run spacex-exposure:bulk
  npm run spacex-exposure:bulk -- --max-filings 500 --no-openarena
  npm run spacex-exposure:bulk -- --max-filings 2000 --max-discovery-hits 10000 --request-spacing-ms 500 --concurrency 3 --no-openarena
  npm run spacex-exposure:bulk -- --max-filings 150 --forms NPORT-P,N-CSR,13F-HR --openarena --openarena-limit 10

Options:
  --max-filings, -m <n>       SEC source filings to fetch. Default: ${DEFAULT_BULK_MAX_FILINGS}
  --max-discovery-hits <n>    SEC full-text hits to discover before ranking. Default: maxFilings * 5
  --start-date <yyyy-mm-dd>   Default: five years ago
  --end-date <yyyy-mm-dd>     Default: today
  --forms <csv>               Filing forms to search. Default: SpaceX Exposure dashboard forms
  --out-dir <path>            Default: exports/spacex-exposure
  --openarena                 Enable OpenArena review for ambiguous rows. Default: off
  --openarena-limit <n>       Ambiguous rows to send to OpenArena. Default: ${DEFAULT_BULK_OPENARENA_REVIEW_LIMIT}
  --request-spacing-ms <n>    Delay per fetch worker. Default: ${DEFAULT_BULK_REQUEST_SPACING_MS}
  --concurrency <n>           SEC fetch concurrency. Default: ${DEFAULT_BULK_CONCURRENCY}
  --sec-user-agent <value>    SEC User-Agent header. Default: SEC_USER_AGENT env or repo fallback
`.trim());
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
