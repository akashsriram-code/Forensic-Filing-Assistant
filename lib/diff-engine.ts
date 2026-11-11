/**
 * "What changed" between two 10-K (or 10-Q) filings, paragraph by paragraph.
 *
 * 1. extractParagraphs: the raw filing HTML -> the document's paragraphs, flagging headings (bold or italic leads,
 *    h1-h6, short standalone lines). Runs on the raw HTML because the bold/italic styling is the heading signal.
 * 2. findSection: the paragraphs of Item 1A (risk factors) or Item 7 (MD&A), skipping the table of contents.
 * 3. compareParagraphs / diffParagraphs: which paragraphs were added, removed or reworded, and which risk-factor
 *    headings are new or gone, plus word-level parts for the side-by-side view.
 *
 * Server-side only for extraction (cheerio); the types are safe to import from client components.
 */
import * as cheerio from 'cheerio';
import { diffArrays, diffWords } from 'diff';

export interface Paragraph {
    /** The paragraph's text, whitespace collapsed. */
    text: string;
    /** A heading: h1-h6, a paragraph led by bold or italic text, or a short standalone line. */
    heading: boolean;
    /** For a run-in heading ("Competition. We face intense competition..."), the bold or italic lead only. */
    lead?: string;
    /** A table row made mostly of figures (financial tables, table-of-contents rows). Not listed as a passage. */
    table?: boolean;
}

/** One run of words in a word-level diff (the shape `diff` returns). */
export interface WordPart {
    value: string;
    added?: boolean;
    removed?: boolean;
}

export interface ChangedParagraph {
    before: Paragraph;
    after: Paragraph;
    /** Word-level diff of before -> after. */
    parts: WordPart[];
    /** Word-set similarity (Sorensen-Dice, figures ignored), 0-1. */
    similarity: number;
}

/** A risk factor that appears in only one of the two filings: its heading and the paragraphs under it. */
export interface HeadingChange {
    heading: string;
    /** The paragraphs that follow the heading in that filing, up to the next heading (capped). */
    body: string[];
}

export interface ParagraphDiff {
    /** Paragraphs only in the current filing (excluding rows of figures). */
    added: Paragraph[];
    /** Paragraphs only in the previous filing (excluding rows of figures). */
    removed: Paragraph[];
    /** Paragraphs present in both, reworded (similarity >= 0.6). */
    changed: ChangedParagraph[];
    /** Paragraphs identical in both filings (after normalising case, quotes, dashes and spaces), including moved ones. */
    unchangedCount: number;
    /** Identical paragraphs that moved to a different place. Included in unchangedCount. */
    movedCount: number;
    /** Rows of figures that were added, removed or changed; shown only in the full text comparison. */
    tableRowsChanged: number;
    /** Headings of new risk factors (heading paragraphs only in the current filing, excluding "Risks related to…" group titles). */
    newHeadings: string[];
    /** Headings of removed risk factors. */
    removedHeadings: string[];
    /** newHeadings with the text under each heading. */
    newFactors: HeadingChange[];
    /** removedHeadings with the text under each heading. */
    removedFactors: HeadingChange[];
    /** Added paragraphs that aren't part of a new risk factor (e.g. a new paragraph inside an existing one). */
    otherAdded: Paragraph[];
    /** Removed paragraphs that aren't part of a removed risk factor. */
    otherRemoved: Paragraph[];
}

export type SectionKind = 'risk' | 'mda';

/** The comparison of one section, as returned by /api/diff in `summary.risk` / `summary.mda`. */
export interface SectionSummary extends ParagraphDiff {
    /** Whether the section was found in each filing. The comparison is empty unless it was found in both. */
    found: { previous: boolean; current: boolean };
    paragraphCount: { previous: number; current: number };
    /** Heading paragraphs in the section; 0 in both means risk factors can't be told apart, so count paragraphs. */
    headingCount: { previous: number; current: number };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Paragraph extraction
// ---------------------------------------------------------------------------------------------------------------

/** The minimal slice of domhandler's node shape that the walker needs. */
interface DomNode {
    type: string;
    name?: string;
    data?: string;
    attribs?: Record<string, string>;
    children?: DomNode[];
}

const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'div', 'dl', 'dt', 'fieldset',
    'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'html', 'li', 'main',
    'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const SKIP_TAGS = new Set(['head', 'script', 'style', 'title', 'noscript', 'template', 'ix:header', 'svg', 'object']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** A table row longer than this is treated as layout (some old filings wrap whole pages in one cell). */
const MAX_ROW_TEXT = 1500;
const MAX_BOLD_HEADING = 500;
const MAX_ITALIC_HEADING = 200;

interface Segment {
    text: string;
    bold: boolean;
    italic: boolean;
}

interface Style {
    bold: boolean;
    italic: boolean;
}

function styleOf(node: DomNode, inherited: Style): Style | null {
    const name = node.name ?? '';
    const css = (node.attribs?.style ?? '').toLowerCase();
    if (/display\s*:\s*none/.test(css)) return null;
    let { bold, italic } = inherited;
    if (name === 'b' || name === 'strong' || name === 'th' || HEADING_TAGS.has(name)) bold = true;
    if (name === 'i' || name === 'em') italic = true;
    const weight = css.match(/font-weight\s*:\s*([a-z0-9]+)/);
    if (weight) {
        const value = weight[1];
        if (value === 'bold' || value === 'bolder' || /^[6-9]00$/.test(value)) bold = true;
        else if (value === 'normal' || value === 'lighter' || /^[1-5]00$/.test(value)) bold = false;
    }
    const fontStyle = css.match(/font-style\s*:\s*([a-z]+)/);
    if (fontStyle) italic = fontStyle[1] === 'italic' || fontStyle[1] === 'oblique';
    return { bold, italic };
}

function collapse(text: string): string {
    return text.replace(/[\s ​﻿]+/g, ' ').trim();
}

/** Text length of a subtree, stopping early past `limit`; -1 when it contains a nested table. */
function rowTextLength(node: DomNode, limit: number): number {
    let total = 0;
    const visit = (current: DomNode): boolean => {
        if (current.type === 'text') {
            total += (current.data ?? '').length;
            return total <= limit;
        }
        if (current.name === 'table') {
            total = -1;
            return false;
        }
        for (const child of current.children ?? []) {
            if (!visit(child)) return false;
        }
        return true;
    };
    for (const child of node.children ?? []) {
        if (!visit(child)) break;
    }
    return total;
}

const PAGE_NUMBER = /^(?:page\s*)?[-–—]?\s*(?:[a-z]-?)?(?:\d{1,3}|[ivxlc]{1,7})\s*[-–—]?$/i;
const BACK_LINK = /^(?:back\s+to\s+|return\s+to\s+)?(?:table\s+of\s+contents|index|contents|toc)$/i;
const BULLET_ONLY = /^[\s•·▪●◦–—\-*]+$/;
const NUMERIC_CELL = /^[\s$€£()%,.\-–—\d]*\d[\s$€£()%,.\-–—\d]*$/;

function isNoise(text: string): boolean {
    return !text || PAGE_NUMBER.test(text) || BACK_LINK.test(text) || BULLET_ONLY.test(text) || !/[a-z0-9]/i.test(text);
}

/** Splits the leading bold/italic run off a paragraph's segments. */
function leadingRun(segments: Segment[]): { text: string; bold: boolean } | null {
    let text = '';
    let bold = false;
    let started = false;
    for (const segment of segments) {
        const blank = !segment.text.trim();
        if (blank) {
            text += segment.text;
            continue;
        }
        if (!started && BULLET_ONLY.test(segment.text)) continue;
        if (!segment.bold && !segment.italic) break;
        started = true;
        if (segment.bold) bold = true;
        text += segment.text;
    }
    const lead = collapse(text);
    return lead.length >= 3 && /[a-z]/i.test(lead) ? { text: lead, bold } : null;
}

function wordCount(text: string): number {
    return text.split(' ').filter(Boolean).length;
}

/** A short line standing on its own, like "Competition" or "RESULTS OF OPERATIONS". */
function isShortStandaloneLine(text: string): boolean {
    if (text.length > 90 || wordCount(text) > 10) return false;
    if (/[.,;:]$/.test(text)) return false;
    if (!/^[A-Z]/.test(text)) return false;
    // "Our results could be harmed by the loss of" is a sentence cut by a page break, not a title.
    if (/\b(?:a|an|and|as|at|by|for|from|in|of|on|or|our|that|the|to|with)$/i.test(text)) return false;
    const words = text.split(' ');
    const wordy = words.filter((word) => /^[A-Za-z(]/.test(word)).length;
    return wordy / words.length >= 0.5;
}

/**
 * The document's paragraphs, in reading order. Walks the raw HTML, starting a new paragraph at each block element
 * (so nested blocks never double-count text), joins the cells of a table row into one paragraph, and flags headings
 * from the inline styling. Page numbers, "Table of Contents" back-links, hidden iXBRL data and running headers or
 * footers (short lines repeated many times) are dropped.
 */
export function extractParagraphs(rawHtml: string): Paragraph[] {
    const $ = cheerio.load(rawHtml);
    const root = $.root()[0] as unknown as DomNode;
    const out: Paragraph[] = [];

    /** Headings detected only because the line is short (no styling): may be the first half of a split paragraph. */
    const weakHeadings = new WeakSet<Paragraph>();
    let segments: Segment[] = [];
    let headingTagDepth = 0;
    let inListItem = 0;
    let pendingBreak = false;

    const flush = (row?: { cells: string[] }) => {
        const current = segments;
        segments = [];
        pendingBreak = false;
        // "•Text" (bullet and text in adjacent spans, spaced by CSS padding) -> "• Text".
        const text = collapse(current.map((segment) => segment.text).join('')).replace(/^([•·▪●◦])(?=\S)/, '$1 ');
        if (isNoise(text)) return;

        let table = false;
        if (row) {
            const cells = row.cells.filter(Boolean);
            const numericCells = cells.filter((cell) => NUMERIC_CELL.test(cell)).length;
            const tokens = text.split(' ');
            const numericTokens = tokens.filter((token) => /\d/.test(token) && !/[a-z]{2,}/i.test(token)).length;
            table = (cells.length >= 3 && numericCells >= 1) || (tokens.length >= 2 && numericTokens / tokens.length >= 0.4);
        }

        let heading = headingTagDepth > 0;
        let lead: string | undefined;
        const run = leadingRun(current);
        // A heading never starts mid-sentence (lowercase): that is the rest of a paragraph split by a page break.
        if (run && !/^[a-z]/.test(text)) {
            const limit = run.bold ? MAX_BOLD_HEADING : MAX_ITALIC_HEADING;
            if (run.text === text || text.endsWith(run.text)) {
                // Italic-only text is a heading when it is a single short sentence; longer italic text is an
                // emphasised paragraph (e.g. "The following risk factors should be considered…").
                const italicProse = !run.bold && (run.text.length > MAX_ITALIC_HEADING || /[.!?]\s+["“]?[A-Z]/.test(run.text));
                if (run.text.length <= limit && !italicProse) heading = true;
            } else if (run.text.length <= Math.min(limit, 300)) {
                // A run-in heading ends in punctuation ("Competition." / "Export controls:") or is followed by it.
                const rest = text.slice(text.indexOf(run.text) + run.text.length).trimStart();
                if (/[.:!?—–-]$/.test(run.text) || /^[.:—–-]/.test(rest)) {
                    heading = true;
                    lead = run.text.replace(/[\s.:—–-]+$/, '');
                }
            }
        }
        let weak = false;
        if (!heading && !row && inListItem === 0 && isShortStandaloneLine(text)) {
            heading = true;
            weak = true;
        }

        const paragraph: Paragraph = { text, heading };
        if (lead && lead !== text) paragraph.lead = lead;
        if (table) paragraph.table = true;
        if (weak) weakHeadings.add(paragraph);
        out.push(paragraph);
    };

    const pushText = (raw: string, style: Style) => {
        if (!raw) return;
        if (raw.trim()) pendingBreak = false;
        segments.push({ text: raw, bold: style.bold, italic: style.italic });
    };

    // Inside a table row: block elements don't split the paragraph; cells are separated by a space.
    const walkInRow = (node: DomNode, style: Style, cellTexts: string[]) => {
        for (const child of node.children ?? []) {
            if (child.type === 'text') {
                pushText(child.data ?? '', style);
                continue;
            }
            if (child.type !== 'tag' || SKIP_TAGS.has(child.name ?? '')) continue;
            const childStyle = styleOf(child, style);
            if (!childStyle) continue;
            if (child.name === 'td' || child.name === 'th') {
                const startIndex = segments.length;
                walkInRow(child, childStyle, cellTexts);
                const cellText = collapse(segments.slice(startIndex).map((segment) => segment.text).join(''));
                cellTexts.push(cellText);
                if (cellText) segments.push({ text: ' ', bold: false, italic: false });
                continue;
            }
            if (child.name === 'br') {
                segments.push({ text: ' ', bold: false, italic: false });
                continue;
            }
            walkInRow(child, childStyle, cellTexts);
        }
    };

    const walk = (node: DomNode, style: Style) => {
        for (const child of node.children ?? []) {
            if (child.type === 'text') {
                pushText(child.data ?? '', style);
                continue;
            }
            if (child.type !== 'tag' && child.type !== 'root') continue;
            const name = child.name ?? '';
            if (SKIP_TAGS.has(name)) continue;
            const childStyle = styleOf(child, style);
            if (!childStyle) continue;

            if (name === 'br') {
                // One <br> is a line wrap; two in a row end the paragraph.
                if (pendingBreak) flush();
                else {
                    segments.push({ text: ' ', bold: false, italic: false });
                    pendingBreak = true;
                }
                continue;
            }

            if (name === 'tr') {
                const length = rowTextLength(child, MAX_ROW_TEXT);
                if (length >= 0 && length <= MAX_ROW_TEXT) {
                    flush();
                    const cells: string[] = [];
                    walkInRow(child, childStyle, cells);
                    flush({ cells });
                    continue;
                }
            }

            if (BLOCK_TAGS.has(name)) {
                flush();
                const isHeadingTag = HEADING_TAGS.has(name);
                if (isHeadingTag) headingTagDepth += 1;
                if (name === 'li') inListItem += 1;
                walk(child, childStyle);
                flush();
                if (isHeadingTag) headingTagDepth -= 1;
                if (name === 'li') inListItem -= 1;
                continue;
            }

            walk(child, childStyle);
        }
    };

    walk(root, { bold: false, italic: false });
    flush();

    // Running page headers and footers ("NVIDIA Corporation | 2026 Form 10-K") repeat on every page.
    const counts = new Map<string, number>();
    const keyOf = (paragraph: Paragraph) => normalizeForCompare(paragraph.text).replace(/\d+/g, '#');
    for (const paragraph of out) {
        if (paragraph.table || paragraph.text.length > 100) continue;
        const key = keyOf(paragraph);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const kept = out.filter((paragraph) => paragraph.table || paragraph.text.length > 100 || (counts.get(keyOf(paragraph)) ?? 0) < 6);

    // A paragraph split by a page break: the first part stops mid-sentence and the next starts in lowercase.
    const merged: Paragraph[] = [];
    for (const paragraph of kept) {
        const last = merged[merged.length - 1];
        if (
            last &&
            (!last.heading || weakHeadings.has(last)) &&
            !last.table &&
            !paragraph.heading &&
            !paragraph.table &&
            !/[.!?:;"'”’)]$/.test(last.text) &&
            /^[a-z]/.test(paragraph.text)
        ) {
            last.text = `${last.text} ${paragraph.text}`;
            last.heading = false;
        } else {
            merged.push(paragraph);
        }
    }
    return merged;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Section finding
// ---------------------------------------------------------------------------------------------------------------

interface SectionSpec {
    item: string;
    title: RegExp;
    ends: string[];
}

const SECTION_SPECS: Record<SectionKind, SectionSpec[]> = {
    risk: [{ item: '1a', title: /^risk\s+factors\b/, ends: ['1b', '1c', '2', '3', '4'] }],
    mda: [
        // 10-K: Item 7, ending at Item 7A (market risk) or Item 8 (financial statements).
        { item: '7', title: /^management'?s?\b/, ends: ['7a', '8', '9'] },
        // 10-Q: Part I, Item 2, ending at Item 3 or Item 4.
        { item: '2', title: /^management'?s?\b/, ends: ['3', '4'] },
    ],
};

const PART_PREFIX = String.raw`(?:part\s+[ivx]+\s*[,.:-]?\s*)?`;
/** Start and end markers must look like headings: at the start of a short paragraph. */
const MAX_MARKER_LENGTH = 160;
const MAX_UNTERMINATED_SECTION = 5000;

function itemPattern(items: string[]): RegExp {
    return new RegExp(String.raw`^${PART_PREFIX}item\s*(?:${items.join('|')})\b\s*[.:-]?\s*`);
}

function isEndMarker(paragraph: Paragraph, normalized: string, pattern: RegExp): boolean {
    if (!pattern.test(normalized)) return false;
    return paragraph.heading || normalized.length <= 120;
}

/**
 * The paragraphs of a filing section, without its own "Item 1A. Risk Factors" heading, or null when it isn't found.
 * Every heading-like "Item 1A" line is a candidate start (the table of contents has one too); the candidate that
 * yields the longest section wins, which skips the table of contents. The section ends at the next heading-like
 * item marker (Item 1B/1C/2 for risk factors, Item 7A/8 for MD&A), so in-body cross-references such as
 * "see Item 2" don't cut it short.
 */
export function findSection(paragraphs: Paragraph[], kind: SectionKind): Paragraph[] | null {
    const normalized = paragraphs.map((paragraph) => normalizeForCompare(paragraph.text));
    let best: { start: number; end: number } | null = null;

    const consider = (bodyStart: number, endPattern: RegExp) => {
        let end = Math.min(paragraphs.length, bodyStart + MAX_UNTERMINATED_SECTION);
        for (let index = bodyStart; index < paragraphs.length; index++) {
            if (isEndMarker(paragraphs[index], normalized[index], endPattern)) {
                end = index;
                break;
            }
        }
        if (end > bodyStart && (!best || end - bodyStart >= best.end - best.start)) best = { start: bodyStart, end };
    };

    for (const spec of SECTION_SPECS[kind]) {
        const startPattern = itemPattern([spec.item]);
        const endPattern = itemPattern(spec.ends);
        for (let index = 0; index < paragraphs.length; index++) {
            const text = normalized[index];
            if (text.length > MAX_MARKER_LENGTH) continue;
            const match = text.match(startPattern);
            if (!match) continue;
            const rest = text.slice(match[0].length);
            if (spec.title.test(rest)) {
                consider(index + 1, endPattern);
            } else if (!/[a-z]/.test(rest) && index + 1 < paragraphs.length) {
                // "Item 1A." and "Risk Factors" in adjacent paragraphs.
                const next = normalized[index + 1];
                if (next.length <= MAX_MARKER_LENGTH && spec.title.test(next)) consider(index + 2, endPattern);
            }
        }
    }

    if (!best && kind === 'risk') {
        // No "Item 1A" line at all: fall back to a standalone "Risk Factors" heading.
        const anyItem = itemPattern([String.raw`\d{1,2}[a-c]?`]);
        normalized.forEach((text, index) => {
            if (/^risk\s+factors$/.test(text)) consider(index + 1, anyItem);
        });
    }

    const found = best as { start: number; end: number } | null;
    return found ? paragraphs.slice(found.start, found.end) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Comparison
// ---------------------------------------------------------------------------------------------------------------

/** Lowercase, collapse whitespace, and unify curly quotes and dashes, so cosmetic edits don't count as changes. */
export function normalizeForCompare(text: string): string {
    return text
        .toLowerCase()
        .replace(/[‘’‚‛′`´]/g, "'")
        .replace(/[“”„‟″]/g, '"')
        .replace(/[‐-―−­]/g, '-')
        .replace(/[\s ​﻿]+/g, ' ')
        .trim();
}

export const SIMILARITY_THRESHOLD = 0.6;

/** The set of words in a paragraph, ignoring figures (so "revenue rose 114%" vs "rose 126%" still pairs). */
function wordSet(normalized: string): Set<string> {
    return new Set(normalized.match(/[a-z]+(?:'[a-z]+)?/g) ?? []);
}

/** Sorensen-Dice similarity of two word sets: 2|A and B| / (|A| + |B|). */
export function wordSetSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let shared = 0;
    for (const word of small) if (large.has(word)) shared += 1;
    return (2 * shared) / (a.size + b.size);
}

/** Group titles inside Item 1A ("Risks Related to Our Industry"), not individual risk factors. */
const GROUP_HEADING = /^(?:risks?|factors?)\b.{0,60}\b(?:related|relating|associated|pertaining|specific)\b|^general\s+risks?\b|^risk\s+factors?(?:\s+summary)?$|^summary\s+of\s+risk/;

function isFactorHeading(paragraph: Paragraph): boolean {
    if (!paragraph.heading || paragraph.table) return false;
    const title = normalizeForCompare(paragraph.lead ?? paragraph.text);
    // Group titles are short and unpunctuated; a factor such as "Risks associated with X could harm us." is not.
    return !(title.length <= 100 && !/[.!?]$/.test(title) && GROUP_HEADING.test(title));
}

function headingText(paragraph: Paragraph): string {
    return paragraph.lead ?? paragraph.text;
}

const MAX_FACTOR_BODY = 15;

/** The paragraphs under a heading, up to the next heading. */
function bodyUnder(paragraphs: Paragraph[], index: number): { body: string[]; indexes: number[] } {
    const heading = paragraphs[index];
    const body: string[] = [];
    const indexes: number[] = [];
    if (heading.lead) {
        const rest = heading.text.slice(heading.text.indexOf(heading.lead) + heading.lead.length).replace(/^[\s.:—–-]+/, '');
        if (rest) body.push(rest);
    }
    for (let next = index + 1; next < paragraphs.length && body.length < MAX_FACTOR_BODY; next++) {
        if (paragraphs[next].heading) break;
        body.push(paragraphs[next].text);
        indexes.push(next);
    }
    return { body, indexes };
}

type Op = { kind: 'same'; i: number; j: number } | { kind: 'del'; i: number } | { kind: 'ins'; j: number };

function mergeParts(parts: WordPart[]): WordPart[] {
    const merged: WordPart[] = [];
    for (const part of parts) {
        if (!part.value) continue;
        const last = merged[merged.length - 1];
        if (last && Boolean(last.added) === Boolean(part.added) && Boolean(last.removed) === Boolean(part.removed)) {
            last.value += part.value;
        } else {
            merged.push({ value: part.value, ...(part.added ? { added: true } : {}), ...(part.removed ? { removed: true } : {}) });
        }
    }
    return merged;
}

function wordDiff(before: string, after: string): WordPart[] {
    return diffWords(before, after).map((change) => ({
        value: change.value,
        ...(change.added ? { added: true } : {}),
        ...(change.removed ? { removed: true } : {}),
    }));
}

/**
 * Paragraph-level comparison of two sections (previous -> current), plus word-level parts for the whole section in
 * reading order of the current filing (paragraphs separated by blank lines), for the side-by-side view.
 */
export function compareParagraphs(prev: Paragraph[], curr: Paragraph[]): { diff: ParagraphDiff; parts: WordPart[] } {
    // A serial comma added or dropped ("Demand, Supply and" -> "Demand, Supply, and") is not a rewording.
    const compareKey = (paragraph: Paragraph) => normalizeForCompare(paragraph.text).replace(/,(?=\s)/g, '');
    const prevNorm = prev.map(compareKey);
    const currNorm = curr.map(compareKey);

    const ops: Op[] = [];
    let i = 0;
    let j = 0;
    for (const change of diffArrays(prevNorm, currNorm)) {
        const count = change.count;
        for (let step = 0; step < count; step++) {
            if (change.added) ops.push({ kind: 'ins', j: j++ });
            else if (change.removed) ops.push({ kind: 'del', i: i++ });
            else ops.push({ kind: 'same', i: i++, j: j++ });
        }
    }

    const removedIdx = ops.flatMap((op) => (op.kind === 'del' ? [op.i] : []));
    const addedIdx = ops.flatMap((op) => (op.kind === 'ins' ? [op.j] : []));

    // Pairs: removed index -> added index. Identical text first (moved paragraphs), then reworded ones.
    const pairOfRemoved = new Map<number, number>();
    const pairOfAdded = new Map<number, { i: number; similarity: number }>();
    const moved = new Set<number>();

    const addedByText = new Map<string, number[]>();
    for (const index of addedIdx) {
        const list = addedByText.get(currNorm[index]) ?? [];
        list.push(index);
        addedByText.set(currNorm[index], list);
    }
    for (const index of removedIdx) {
        const candidates = addedByText.get(prevNorm[index]);
        const match = candidates?.shift();
        if (match === undefined) continue;
        pairOfRemoved.set(index, match);
        pairOfAdded.set(match, { i: index, similarity: 1 });
        moved.add(match);
    }

    const openRemoved = removedIdx.filter((index) => !pairOfRemoved.has(index));
    const openAdded = addedIdx.filter((index) => !pairOfAdded.has(index));
    const prevSets = new Map(openRemoved.map((index) => [index, wordSet(prevNorm[index])]));
    const currSets = new Map(openAdded.map((index) => [index, wordSet(currNorm[index])]));
    // Dice >= t requires the smaller set to be at least t / (2 - t) of the larger.
    const minRatio = SIMILARITY_THRESHOLD / (2 - SIMILARITY_THRESHOLD);

    const prevLeads = new Map(openRemoved.filter((index) => prev[index].lead).map((index) => [index, normalizeForCompare(prev[index].lead!)]));
    const currLeads = new Map(openAdded.filter((index) => curr[index].lead).map((index) => [index, normalizeForCompare(curr[index].lead!)]));

    const candidates: { i: number; j: number; similarity: number }[] = [];
    for (const ri of openRemoved) {
        const before = prev[ri];
        const beforeSet = prevSets.get(ri)!;
        const beforeLead = prevLeads.get(ri);
        for (const aj of openAdded) {
            const after = curr[aj];
            if (before.heading !== after.heading || Boolean(before.table) !== Boolean(after.table)) continue;
            // A run-in heading whose lead is unchanged is the same risk factor, however much its text changed.
            if (beforeLead && beforeLead === currLeads.get(aj)) {
                candidates.push({ i: ri, j: aj, similarity: Math.max(SIMILARITY_THRESHOLD, wordSetSimilarity(beforeSet, currSets.get(aj)!)) });
                continue;
            }
            const afterSet = currSets.get(aj)!;
            const small = Math.min(beforeSet.size, afterSet.size);
            const large = Math.max(beforeSet.size, afterSet.size);
            if (small === 0 || small / large < minRatio) continue;
            const similarity = wordSetSimilarity(beforeSet, afterSet);
            if (similarity >= SIMILARITY_THRESHOLD) candidates.push({ i: ri, j: aj, similarity });
        }
    }
    candidates.sort((a, b) => b.similarity - a.similarity || Math.abs(a.i - a.j) - Math.abs(b.i - b.j));
    for (const candidate of candidates) {
        if (pairOfRemoved.has(candidate.i) || pairOfAdded.has(candidate.j)) continue;
        pairOfRemoved.set(candidate.i, candidate.j);
        pairOfAdded.set(candidate.j, { i: candidate.i, similarity: candidate.similarity });
    }

    // Word-level parts, in the current filing's reading order.
    const SEP = '\n\n';
    const parts: WordPart[] = [];
    const changedParts = new Map<number, WordPart[]>();
    for (const op of ops) {
        if (op.kind === 'same') {
            parts.push({ value: curr[op.j].text + SEP });
        } else if (op.kind === 'del') {
            if (!pairOfRemoved.has(op.i)) parts.push({ value: prev[op.i].text + SEP, removed: true });
        } else {
            const pair = pairOfAdded.get(op.j);
            if (!pair) parts.push({ value: curr[op.j].text + SEP, added: true });
            else if (moved.has(op.j)) parts.push({ value: curr[op.j].text + SEP });
            else {
                const words = wordDiff(prev[pair.i].text, curr[op.j].text);
                changedParts.set(op.j, words);
                parts.push(...words, { value: SEP });
            }
        }
    }

    const unpairedAdded = addedIdx.filter((index) => !pairOfAdded.has(index));
    const unpairedRemoved = removedIdx.filter((index) => !pairOfRemoved.has(index));
    const changedIdx = addedIdx.filter((index) => pairOfAdded.has(index) && !moved.has(index));

    const factorChanges = (paragraphs: Paragraph[], unpaired: number[]) => {
        const unpairedSet = new Set(unpaired);
        const factors: HeadingChange[] = [];
        const covered = new Set<number>();
        for (const index of unpaired) {
            if (!isFactorHeading(paragraphs[index])) continue;
            const { body, indexes } = bodyUnder(paragraphs, index);
            factors.push({ heading: headingText(paragraphs[index]), body });
            covered.add(index);
            // Body paragraphs that are themselves new (or gone) belong to the factor, not to "other" changes.
            for (const bodyIndex of indexes) if (unpairedSet.has(bodyIndex)) covered.add(bodyIndex);
        }
        const other = unpaired.filter((index) => !covered.has(index) && !paragraphs[index].table).map((index) => paragraphs[index]);
        return { factors, other };
    };

    const newSide = factorChanges(curr, unpairedAdded);
    const oldSide = factorChanges(prev, unpairedRemoved);

    const tableRowsChanged =
        unpairedAdded.filter((index) => curr[index].table).length +
        unpairedRemoved.filter((index) => prev[index].table).length +
        changedIdx.filter((index) => curr[index].table).length;

    const diff: ParagraphDiff = {
        added: unpairedAdded.filter((index) => !curr[index].table).map((index) => curr[index]),
        removed: unpairedRemoved.filter((index) => !prev[index].table).map((index) => prev[index]),
        changed: changedIdx
            .filter((index) => !curr[index].table)
            .map((index) => {
                const pair = pairOfAdded.get(index)!;
                return { before: prev[pair.i], after: curr[index], parts: changedParts.get(index) ?? [], similarity: Math.round(pair.similarity * 100) / 100 };
            }),
        unchangedCount: ops.filter((op) => op.kind === 'same').length + moved.size,
        movedCount: moved.size,
        tableRowsChanged,
        newHeadings: newSide.factors.map((factor) => factor.heading),
        removedHeadings: oldSide.factors.map((factor) => factor.heading),
        newFactors: newSide.factors,
        removedFactors: oldSide.factors,
        otherAdded: newSide.other,
        otherRemoved: oldSide.other,
    };

    return { diff, parts: mergeParts(parts) };
}

/** Paragraph-level comparison of two sections: previous -> current. */
export function diffParagraphs(prev: Paragraph[], curr: Paragraph[]): ParagraphDiff {
    return compareParagraphs(prev, curr).diff;
}

/** An empty comparison, for when a section is missing from one of the filings. */
export function emptyParagraphDiff(): ParagraphDiff {
    return {
        added: [],
        removed: [],
        changed: [],
        unchangedCount: 0,
        movedCount: 0,
        tableRowsChanged: 0,
        newHeadings: [],
        removedHeadings: [],
        newFactors: [],
        removedFactors: [],
        otherAdded: [],
        otherRemoved: [],
    };
}
