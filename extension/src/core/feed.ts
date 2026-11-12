/**
 * Reads EDGAR's live "Latest Filings" Atom feed (browse-edgar?action=getcurrent&output=atom). The feed has a fixed,
 * machine-generated layout, so a few regular expressions are enough and the parser runs anywhere (service worker,
 * Node tests) without a DOM.
 */
import type { FeedEntry } from './types';

export const FEED_PAGE_SIZE = 100;

/** Newest filings first, one entry per party. `start` pages back through older entries. */
export function feedUrl(start = 0): string {
    return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=&company=&dateb=&owner=include&start=${start}&count=${FEED_PAGE_SIZE}&output=atom`;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
        if (code[0] === '#') {
            const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(value) ? String.fromCodePoint(value) : match;
        }
        return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    });
}

function tag(block: string, name: string): string | null {
    const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return match ? decodeEntities(match[1].trim()) : null;
}

function attr(block: string, element: string, attribute: string): string | null {
    const el = block.match(new RegExp(`<${element}\\b[^>]*>`, 'i'));
    if (!el) return null;
    const value = el[0].match(new RegExp(`\\b${attribute}="([^"]*)"`, 'i'));
    return value ? decodeEntities(value[1]) : null;
}

/** "4 - LanzaTech Global, Inc. (0001843724) (Issuer)" -> form, company, CIK, role. */
const TITLE = /^(.+?) - (.*?) \((\d{10})\)(?: \(([^)]+)\))?\s*$/;

export function parseFeed(xml: string): FeedEntry[] {
    const entries: FeedEntry[] = [];
    for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
        const block = match[1];
        const title = tag(block, 'title');
        const parts = title?.match(TITLE);
        const accession = tag(block, 'id')?.match(/accession-number=(\d{10}-\d{2}-\d{6})/)?.[1];
        const acceptedAt = Date.parse(tag(block, 'updated') ?? '');
        if (!parts || !accession || !Number.isFinite(acceptedAt)) continue;
        entries.push({
            accession,
            cik: parts[3],
            role: parts[4] ?? null,
            form: (attr(block, 'category', 'term') ?? parts[1]).trim(),
            company: parts[2].trim(),
            acceptedAt,
            indexUrl: attr(block, 'link', 'href') ?? '',
        });
    }
    return entries;
}

/** The SEC's fair-access block: HTTP 403/429, or the "Request Rate Threshold Exceeded" page served in its place. */
export function isBlockResponse(status: number, body: string): boolean {
    return status === 403 || status === 429 || /Request Rate Threshold Exceeded/i.test(body);
}
