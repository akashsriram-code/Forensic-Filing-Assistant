/**
 * Download 13F Radar cache files from GitHub LFS.
 *
 * GitHub LFS files are publicly accessible at:
 *   https://media.githubusercontent.com/media/{owner}/{repo}/{branch}/{path}
 *
 * This script fetches the cache JSONs before Next.js builds, working around
 * Vercel's lack of native LFS support during git clone.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const REPO_OWNER = 'akashsriram-code';
const REPO_NAME = 'Forensic-Filing-Assistant';
const BRANCH = 'main';
const BASE_URL = `https://media.githubusercontent.com/media/${REPO_OWNER}/${REPO_NAME}/${BRANCH}`;

const CACHE_FILES = [
    'data/13f-radar-cache/2026-Q2-vs-2026-Q1/matched-holdings.json',
    'data/13f-radar-cache/2026-Q1-vs-2025-Q4/matched-holdings.json',
];

async function downloadFile(relativePath: string): Promise<boolean> {
    const url = `${BASE_URL}/${relativePath}`;
    const localPath = path.join(process.cwd(), relativePath);

    console.log(`[13F Cache] Downloading ${relativePath}...`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`[13F Cache] Failed to download ${relativePath}: HTTP ${response.status}`);
            return false;
        }

        const content = await response.text();

        // Validate it's actual JSON, not an LFS pointer stub
        if (content.startsWith('version https://git-lfs.github.com')) {
            console.warn(`[13F Cache] Got LFS pointer instead of content for ${relativePath}`);
            return false;
        }

        // Quick sanity check that it parses as JSON
        try {
            const parsed = JSON.parse(content);
            if (!parsed.schemaVersion || !Array.isArray(parsed.holdings)) {
                console.warn(`[13F Cache] Invalid cache structure in ${relativePath}`);
                return false;
            }
        } catch {
            console.warn(`[13F Cache] Invalid JSON in ${relativePath}`);
            return false;
        }

        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, content, 'utf8');

        const sizeKb = Math.round(content.length / 1024);
        console.log(`[13F Cache] Wrote ${relativePath} (${sizeKb} KB)`);
        return true;
    } catch (error) {
        console.warn(`[13F Cache] Download error for ${relativePath}:`, error);
        return false;
    }
}

async function main() {
    console.log('[13F Cache] Starting cache download...');
    let successCount = 0;

    for (const file of CACHE_FILES) {
        const success = await downloadFile(file);
        if (success) successCount++;
    }

    console.log(`[13F Cache] Downloaded ${successCount}/${CACHE_FILES.length} cache files.`);

    // Don't fail the build if some files couldn't be downloaded
    // The API has a DB fallback for cache misses
    if (successCount === 0) {
        console.warn('[13F Cache] Warning: No cache files downloaded. 13F Radar will use DB fallback.');
    }
}

main().catch((error) => {
    console.error('[13F Cache] Fatal error:', error);
    // Exit 0 to not fail the build - DB fallback will handle it
    process.exit(0);
});