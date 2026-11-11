import { NextRequest, NextResponse } from 'next/server';
import { fetchFilingContent } from '@/lib/sec-client';
import { isSecUrl } from '@/lib/sec-http';
import {
    compareParagraphs,
    emptyParagraphDiff,
    extractParagraphs,
    findSection,
    type Paragraph,
    type SectionKind,
    type SectionSummary,
    type WordPart,
} from '@/lib/diff-engine';

interface DiffResponse {
    /** Word-level parts for the whole document (capped at FULL_TEXT_PART_LIMIT). */
    diffs: WordPart[];
    /** Word-level parts for Item 1A, paragraphs separated by blank lines. Empty unless found in both filings. */
    riskDiff: WordPart[];
    /** Word-level parts for Item 7 (MD&A). */
    mdaDiff: WordPart[];
    /** True when `diffs` was cut at FULL_TEXT_PART_LIMIT. */
    truncated: boolean;
    summary: Record<SectionKind, SectionSummary>;
}

const FULL_TEXT_PART_LIMIT = 5000;

function compareSection(previous: Paragraph[], current: Paragraph[], kind: SectionKind): { summary: SectionSummary; parts: WordPart[] } {
    const prevSection = findSection(previous, kind);
    const currSection = findSection(current, kind);
    const found = { previous: Boolean(prevSection), current: Boolean(currSection) };
    const paragraphCount = { previous: prevSection?.length ?? 0, current: currSection?.length ?? 0 };
    const headingCount = {
        previous: prevSection?.filter((paragraph) => paragraph.heading).length ?? 0,
        current: currSection?.filter((paragraph) => paragraph.heading).length ?? 0,
    };
    if (!prevSection || !currSection) {
        return { summary: { ...emptyParagraphDiff(), found, paragraphCount, headingCount }, parts: [] };
    }
    const { diff, parts } = compareParagraphs(prevSection, currSection);
    return { summary: { ...diff, found, paragraphCount, headingCount }, parts };
}

/** POST {url1: previous filing, url2: current filing} -> DiffResponse. */
export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as { url1?: unknown; url2?: unknown };
        const url1 = typeof body.url1 === 'string' ? body.url1 : '';
        const url2 = typeof body.url2 === 'string' ? body.url2 : '';

        if (!isSecUrl(url1) || !isSecUrl(url2)) {
            return NextResponse.json({ error: 'Only filings on sec.gov can be compared.' }, { status: 400 });
        }

        console.log(`[DiffAPI] Comparing:\nA: ${url1}\nB: ${url2}`);

        const [content1, content2] = await Promise.all([fetchFilingContent(url1), fetchFilingContent(url2)]);

        if (!content1 || !content2) {
            return NextResponse.json({ error: 'One of the filings could not be downloaded from sec.gov. Try again in a minute.' }, { status: 400 });
        }

        const previous = extractParagraphs(content1);
        const current = extractParagraphs(content2);

        const risk = compareSection(previous, current, 'risk');
        const mda = compareSection(previous, current, 'mda');
        const full = compareParagraphs(previous, current).parts;

        const response: DiffResponse = {
            diffs: full.slice(0, FULL_TEXT_PART_LIMIT),
            riskDiff: risk.parts,
            mdaDiff: mda.parts,
            truncated: full.length > FULL_TEXT_PART_LIMIT,
            summary: { risk: risk.summary, mda: mda.summary },
        };
        return NextResponse.json(response);
    } catch (error: unknown) {
        console.error('[DiffAPI] Error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'The comparison failed.' }, { status: 500 });
    }
}
