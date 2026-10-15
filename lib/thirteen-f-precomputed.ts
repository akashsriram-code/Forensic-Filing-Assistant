/**
 * Precomputed default-watchlist 13F Radar responses, committed to git (small JSON, no LFS) by CI:
 * data/13f-precomputed/<current>-vs-<previous>/radar.json
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { type FilerMove, type RadarApiResponse, type RadarWatchlist } from './thirteen-f-radar-core';

export interface PrecomputedRadarFile {
    schemaVersion: 1;
    generatedAt: string;
    watchlistHash: string;
    storeUpdatedAt: string | null;
    response: RadarApiResponse;
}

export interface PrecomputedPair {
    currentQuarter: string;
    previousQuarter: string;
}

const PAIR_DIR_PATTERN = /^(\d{4}-Q[1-4])-vs-(\d{4}-Q[1-4])$/;

export function getRadarWatchlistHash(watchlists: RadarWatchlist[]): string {
    const canonical = watchlists.map((watchlist) => ({
        key: watchlist.key,
        label: watchlist.label,
        description: watchlist.description,
        items: watchlist.items.map((item) => ({ ticker: item.ticker, label: item.label, aliases: [...item.aliases] })),
    }));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

export function getPrecomputedRoot(): string {
    return process.env.THIRTEEN_F_PRECOMPUTED_DIR || path.join(process.cwd(), 'data', '13f-precomputed');
}

export function getPrecomputedRadarPath(currentQuarter: string, previousQuarter: string, root = getPrecomputedRoot()): string {
    return path.join(root, `${currentQuarter}-vs-${previousQuarter}`, 'radar.json');
}

export async function listPrecomputedPairs(root = getPrecomputedRoot()): Promise<PrecomputedPair[]> {
    let entries: string[];
    try {
        entries = await fs.readdir(root);
    } catch {
        return [];
    }
    return entries
        .map((name) => name.match(PAIR_DIR_PATTERN))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => ({ currentQuarter: match[1], previousQuarter: match[2] }))
        .sort((a, b) => b.currentQuarter.localeCompare(a.currentQuarter) || b.previousQuarter.localeCompare(a.previousQuarter));
}

const memo = new Map<string, { mtimeMs: number; file: PrecomputedRadarFile }>();

export async function readPrecomputedRadar(
    currentQuarter: string,
    previousQuarter: string,
    root = getPrecomputedRoot()
): Promise<PrecomputedRadarFile | null> {
    const filePath = getPrecomputedRadarPath(currentQuarter, previousQuarter, root);
    try {
        const stat = await fs.stat(filePath);
        const cached = memo.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs) return cached.file;
        const file = JSON.parse(await fs.readFile(filePath, 'utf8')) as PrecomputedRadarFile;
        if (file.schemaVersion !== 1 || !file.response) return null;
        memo.set(filePath, { mtimeMs: stat.mtimeMs, file });
        return file;
    } catch {
        return null;
    }
}

function getPrecomputedHoldersPath(currentQuarter: string, previousQuarter: string, categoryKey: string, root: string): string {
    const safeKey = categoryKey.replace(/[^a-z0-9-]/gi, '_');
    return path.join(root, `${currentQuarter}-vs-${previousQuarter}`, 'holders', `${safeKey}.json`);
}

/** Archived full holder list for one category (written once, when a pair leaves the Postgres store). */
export async function readPrecomputedHolders(
    currentQuarter: string,
    previousQuarter: string,
    categoryKey: string,
    root = getPrecomputedRoot()
): Promise<FilerMove[] | null> {
    try {
        return JSON.parse(await fs.readFile(getPrecomputedHoldersPath(currentQuarter, previousQuarter, categoryKey, root), 'utf8')) as FilerMove[];
    } catch {
        return null;
    }
}

export async function writePrecomputedHolders(
    currentQuarter: string,
    previousQuarter: string,
    categoryKey: string,
    holders: FilerMove[],
    root = getPrecomputedRoot()
): Promise<string> {
    const filePath = getPrecomputedHoldersPath(currentQuarter, previousQuarter, categoryKey, root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(holders)}\n`, 'utf8');
    return filePath;
}

/** Comparable-filer count per precomputed pair (used to pick a sensible default during filing season). */
export async function readPrecomputedComparableFilers(pairs: PrecomputedPair[], root = getPrecomputedRoot()): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const pair of pairs) {
        const file = await readPrecomputedRadar(pair.currentQuarter, pair.previousQuarter, root);
        if (file) counts.set(`${pair.currentQuarter}|${pair.previousQuarter}`, file.response.coverage.comparableFilers);
    }
    return counts;
}

export async function writePrecomputedRadar(file: PrecomputedRadarFile, root = getPrecomputedRoot()): Promise<string> {
    const { currentQuarter, previousQuarter } = file.response.coverage;
    const filePath = getPrecomputedRadarPath(currentQuarter, previousQuarter, root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(file)}\n`, 'utf8');
    await fs.rename(tmpPath, filePath);
    return filePath;
}
