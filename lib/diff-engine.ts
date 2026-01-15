import * as cheerio from 'cheerio';
import { diffWords } from 'diff';

export async function cleanHtml(html: string): Promise<string> {
    const $ = cheerio.load(html);

    // Remove styles and classes
    $('*').removeAttr('style').removeAttr('class').removeAttr('width').removeAttr('height').removeAttr('bgcolor');

    // Remove scripts, styles, images
    $('script').remove();
    $('style').remove();
    $('img').remove();
    $('link').remove();
    $('meta').remove();

    // Replace non-breaking spaces
    let cleanText = $.html()
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' '); // Normalize whitespace

    // Optional: Just extract text for pure text diff? 
    // User said "leaving just raw <p> and <table> tags".
    // So we return the simplified HTML structure.

    return cleanText;
}

export function generateDiff(text1: string, text2: string) {
    // We diff the texts (cleaning tags might be better for semantic diff, but let's try word diff on content)
    // Actually, diffing raw HTML is messy. 
    // Let's strip tags for the text comparison, or use a specific mode.

    // User request: "Semantic Highlighting... additions... deletions"
    const diffs = diffWords(text1, text2);
    return diffs;
}

// Helper to extract text from specific sections could go here
// But given the "Tag Soup" nature, a full document cleaner is safer MVP.

export function extractSections(html: string) {
    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' '); // Normalize spaces

    // Regex strategies for finding sections.
    // Note: SEC filings are messy. These are heuristic best-guesses.

    // Risk Factors: "Item 1A. Risk Factors" -> "Item 1B" or "Item 2"
    const riskStart = /Item\s+1A\.?\s+Risk\s+Factors/i;
    const riskEnd = /Item\s+(1B|2)\.?\s+/i;

    // MD&A: "Item 7. Management" -> "Item 7A" or "Item 8"
    const mdaStart = /Item\s+7\.?\s+Management/i;
    const mdaEnd = /Item\s+(7A|8)\.?\s+/i; // Usually 7A (Quant Disclosures) or 8 (Financials)

    const extract = (startRegex: RegExp, endRegex: RegExp) => {
        const startMatch = text.match(startRegex);
        if (!startMatch || typeof startMatch.index === 'undefined') return null;

        const startIndex = startMatch.index;
        const remainder = text.slice(startIndex);

        const endMatch = remainder.match(endRegex);
        if (!endMatch || typeof endMatch.index === 'undefined') {
            // If no end found, take a reasonable chunk or rest? 
            // Better to return rest but warn.
            return remainder.slice(0, 50000); // safety cap
        }

        return text.slice(startIndex, startIndex + endMatch.index);
    };

    return {
        riskFactors: extract(riskStart, riskEnd),
        mda: extract(mdaStart, mdaEnd)
    };
}
