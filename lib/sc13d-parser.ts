
import * as cheerio from 'cheerio';

export interface Sc13DDetails {
    reportingPerson: string;
    percentClass: string;
    shares: string;
    purpose: string;
}

export function parseSC13DText(html: string): Sc13DDetails {
    const $ = cheerio.load(html);
    const text = $.text().replace(/\s+/g, ' ').trim(); // Normalize whitespace

    // 1. Reporting Person
    // Look for "NAME OF REPORTING PERSONS" followed by the name
    let reportingPerson = "Unknown";
    const nameMatch = text.match(/NAME OF REPORTING PERSONS.*?([A-Z\s.,&]+)(?=\s+I\.R\.S|\s+CHECK THE APPROPRIATE BOX)/i);
    if (nameMatch && nameMatch[1]) {
        reportingPerson = nameMatch[1].trim();
    }

    // 2. Percent of Class
    // Look for "PERCENT OF CLASS REPRESENTED BY AMOUNT"
    let percentClass = "N/A";
    const percentMatch = text.match(/PERCENT OF CLASS REPRESENTED BY AMOUNT.*?([\d.]+%?)/i);
    if (percentMatch && percentMatch[1]) {
        percentClass = percentMatch[1].trim();
        if (!percentClass.includes('%')) percentClass += '%'; // Add % if missing
    }

    // 3. Amount (Shares)
    // Look for "AGGREGATE AMOUNT BENEFICIALLY OWNED"
    let shares = "N/A";
    const amountMatch = text.match(/AGGREGATE AMOUNT BENEFICIALLY OWNED.*?([\d,]+)/i);
    if (amountMatch && amountMatch[1]) {
        shares = amountMatch[1].trim();
    }

    // 4. Purpose of Transaction (Item 4)
    // This is harder, usually a block of text. We'll grab the first 200 chars.
    let purpose = "See filing for details.";
    // Try to find "Item 4" and "Purpose"
    const item4Regex = /Item\s+4[\.\s]+Purpose\s+of\s+Transaction(.*?)(?:Item\s+5|SIGNATURE)/i;
    const item4Match = text.match(item4Regex);

    if (item4Match && item4Match[1]) {
        let rawPurpose = item4Match[1].trim();
        // Clean up common "intro" noise if any
        if (rawPurpose.length > 300) {
            purpose = rawPurpose.substring(0, 300) + "...";
        } else {
            purpose = rawPurpose;
        }
    }

    return {
        reportingPerson,
        percentClass,
        shares,
        purpose
    };
}
