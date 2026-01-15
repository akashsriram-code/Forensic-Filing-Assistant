import { NextRequest, NextResponse } from 'next/server';
import { fetchFilingContent } from '@/lib/sec-client';
import { cleanHtml, generateDiff, extractSections } from '@/lib/diff-engine';
import * as cheerio from 'cheerio';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { url1, url2 } = body;

        console.log(`[DiffAPI] Comparing:\nA: ${url1}\nB: ${url2}`);

        const [content1, content2] = await Promise.all([
            fetchFilingContent(url1),
            fetchFilingContent(url2)
        ]);

        if (!content1 || !content2) {
            return NextResponse.json({ error: "Failed to fetch filing content" }, { status: 400 });
        }

        // Clean both strings first (removes scripts, styles, etc.)
        const clean1 = await cleanHtml(content1);
        const clean2 = await cleanHtml(content2);

        // Extract Narrative Sections (Risk Factors, MD&A)
        const sections1 = extractSections(clean1);
        const sections2 = extractSections(clean2);

        // Generate Diffs for these specific sections
        // Fallback text provided if regex fails
        const riskDiff = generateDiff(
            sections1.riskFactors || "Item 1A (Risk Factors) could not be automatically extracted from this filing.",
            sections2.riskFactors || "Item 1A (Risk Factors) could not be automatically extracted from this filing."
        );

        const mdaDiff = generateDiff(
            sections1.mda || "Item 7 (MD&A) could not be automatically extracted from this filing.",
            sections2.mda || "Item 7 (MD&A) could not be automatically extracted from this filing."
        );

        // Full Diff (Fallback / Complete View) using clean text body
        const $1 = cheerio.load(clean1);
        const text1 = $1('body').text();
        const $2 = cheerio.load(clean2);
        const text2 = $2('body').text();
        const fullDiff = generateDiff(text1, text2);

        // Limit huge responses
        const limit = 5000;

        return NextResponse.json({
            diffs: fullDiff.slice(0, limit), // Legacy 'All' view
            riskDiff,
            mdaDiff,
            truncated: fullDiff.length > limit
        });

    } catch (error: any) {
        console.error("[DiffAPI] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
