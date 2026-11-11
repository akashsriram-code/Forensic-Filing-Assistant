import * as cheerio from 'cheerio';

/**
 * Reads the headline facts out of a Schedule 13D. Two formats exist:
 *  - structured XML (EDGAR's "SCHEDULE 13D" / "SCHEDULE 13D/A" since December 2024, usually primary_doc.xml with
 *    <edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D">), read field by field;
 *  - older free-form HTML or text ("SC 13D"), read with regular expressions over the cover page.
 * Missing values come back as the placeholders "Unknown", "N/A" and "See filing for details.".
 */

export interface Sc13DReportingPerson {
    name: string;
    cik: string | null;
    /** Aggregate amount beneficially owned (cover page row 11). */
    shares: number | null;
    /** Percent of class (cover page row 13). */
    percentClass: number | null;
}

export interface Sc13DDetails {
    reportingPerson: string;
    percentClass: string;
    shares: string;
    purpose: string;
    /** Only set for structured XML filings. */
    reportingPersons?: Sc13DReportingPerson[];
    issuerName?: string | null;
    issuerCik?: string | null;
    format?: 'xml' | 'html';
}

/** The Item 4 purpose is cut to this many characters (the UI says so when it is cut). */
const PURPOSE_LIMIT = 300;
const UNKNOWN_PERSON = 'Unknown';
const NO_VALUE = 'N/A';
const NO_PURPOSE = 'See filing for details.';

/** Picks the XML or HTML reader from the document itself. */
export function parseSC13D(content: string): Sc13DDetails {
    return isStructured13D(content) ? parseSC13DXml(content) : parseSC13DText(content);
}

export function isStructured13D(content: string): boolean {
    const head = content.slice(0, 4000);
    return /<(?:\w+:)?edgarSubmission\b/i.test(head) && (/schedule13D/i.test(head) || /<(?:\w+:)?reportingPersonInfo\b/i.test(content));
}

// ---------------------------------------------------------------------------
// Structured XML (Dec 2024 onwards)
// ---------------------------------------------------------------------------

function decodeXml(value: string): string {
    return value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** Inner XML of every <tag> (any namespace prefix) in `xml`. */
function xmlBlocks(xml: string, tag: string): string[] {
    const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'gi');
    return Array.from(xml.matchAll(pattern), (match) => match[1]);
}

function xmlText(xml: string, tag: string): string | null {
    const block = xmlBlocks(xml, tag)[0];
    if (block === undefined) return null;
    const text = decodeXml(block.replace(/<[^>]+>/g, ' ')).trim();
    return text || null;
}

function xmlNumber(xml: string, tag: string): number | null {
    const text = xmlText(xml, tag);
    if (!text) return null;
    const value = Number(text.replace(/[,%\s]/g, ''));
    return Number.isFinite(value) ? value : null;
}

function cleanCik(value: string | null): string | null {
    const digits = (value || '').replace(/\D/g, '');
    return digits ? digits.padStart(10, '0') : null;
}

/** Keeps paragraph breaks, collapses other whitespace, and cuts to PURPOSE_LIMIT characters. */
function summarisePurpose(text: string | null): string {
    if (!text) return NO_PURPOSE;
    const paragraphs = text
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const joined = paragraphs.join('\n\n');
    if (!joined) return NO_PURPOSE;
    return joined.length > PURPOSE_LIMIT ? `${joined.slice(0, PURPOSE_LIMIT).trimEnd()}...` : joined;
}

const formatShares = (value: number) => Math.round(value).toLocaleString('en-US');
const formatPercent = (value: number) => `${Number(value.toFixed(2))}%`;

export function parseSC13DXml(xml: string): Sc13DDetails {
    const reportingPersons: Sc13DReportingPerson[] = xmlBlocks(xml, 'reportingPersonInfo')
        .map((block) => ({
            name: xmlText(block, 'reportingPersonName') || '',
            cik: cleanCik(xmlText(block, 'reportingPersonCIK')),
            shares: xmlNumber(block, 'aggregateAmountOwned'),
            percentClass: xmlNumber(block, 'percentOfClass'),
        }))
        .filter((person) => person.name);

    // Joint filers each report their own cover page; the group's stake is the largest one any of them reports
    // (e.g. the fund manager and its founder both "beneficially own" the same shares). The first person listed is
    // normally the lead filer, so the label uses that name.
    const lead = reportingPersons[0];
    const largest = reportingPersons.reduce<Sc13DReportingPerson | null>((best, person) => {
        if (person.percentClass === null && person.shares === null) return best;
        if (!best) return person;
        const a = person.percentClass ?? -1;
        const b = best.percentClass ?? -1;
        return a > b || (a === b && (person.shares ?? -1) > (best.shares ?? -1)) ? person : best;
    }, null);

    const others = reportingPersons.length - 1;
    const reportingPerson = lead
        ? others > 0
            ? `${lead.name} and ${others} other${others === 1 ? '' : 's'}`
            : lead.name
        : UNKNOWN_PERSON;

    const item4 = xmlBlocks(xml, 'item4')[0] ?? '';
    const issuerInfo = xmlBlocks(xml, 'issuerInfo')[0] ?? '';

    return {
        reportingPerson,
        percentClass: largest?.percentClass != null ? formatPercent(largest.percentClass) : NO_VALUE,
        shares: largest?.shares != null ? formatShares(largest.shares) : NO_VALUE,
        purpose: summarisePurpose(xmlText(item4, 'transactionPurpose') ?? (item4 ? decodeXml(item4.replace(/<[^>]+>/g, ' ')) : null)),
        reportingPersons,
        issuerName: xmlText(issuerInfo, 'issuerName') ?? xmlText(xml, 'issuerName'),
        issuerCik: cleanCik(xmlText(issuerInfo, 'issuerCIK')),
        format: 'xml',
    };
}

// ---------------------------------------------------------------------------
// Older HTML / text filings ("SC 13D", before Dec 2024)
// ---------------------------------------------------------------------------

export function parseSC13DText(html: string): Sc13DDetails {
    const $ = cheerio.load(html);
    const text = $.text().replace(/\s+/g, ' ').trim(); // Normalize whitespace

    // 1. Reporting Person: cover-page row 1, "NAME OF REPORTING PERSON(S)" up to row 2 "CHECK THE APPROPRIATE BOX".
    // The row may also carry the "I.R.S. IDENTIFICATION NOS. OF ABOVE PERSONS (ENTITIES ONLY)" label, before or after.
    let reportingPerson = UNKNOWN_PERSON;
    const nameMatch = text.match(/NAMES? OF REPORTING PERSONS?\s*(.{1,300}?)\s*(?:\(?\d{1,2}\)?\.?\s*)?CHECK THE APPROPRIATE BOX/i);
    if (nameMatch && nameMatch[1]) {
        const name = nameMatch[1]
            .replace(/I\.?\s*R\.?\s*S\.?\s*IDENTIFICATION\s+NOS?\.?(?:\s+OF\s+ABOVE\s+PERSONS?)?(?:\s*\((?:ENTITIES ONLY|VOLUNTARY)\))*\s*:?/gi, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^[\s:–-]+/, '')
            .trim();
        if (name) reportingPerson = name;
    }

    // 2. Percent of Class: row 13, "PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (11)" then the figure. The row
    // reference "(11)" is skipped so it isn't read as the percentage.
    let percentClass = NO_VALUE;
    const percentMatch =
        text.match(/PERCENT OF CLASS REPRESENTED BY AMOUNT(?:\s+IN\s+ROW\s*\(?\s*\d+\s*\)?)?[^\d]{0,40}?(\d+(?:\.\d+)?)\s*%/i) ||
        text.match(/PERCENT OF CLASS REPRESENTED BY AMOUNT(?:\s+IN\s+ROW\s*\(?\s*\d+\s*\)?)?[^\d]{0,40}?(\d+(?:\.\d+)?)/i);
    if (percentMatch && percentMatch[1]) {
        percentClass = `${percentMatch[1]}%`;
    }

    // 3. Amount (Shares): row 11, "AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON" then the figure.
    let shares = NO_VALUE;
    const amountMatch = text.match(/AGGREGATE AMOUNT BENEFICIALLY OWNED(?:\s+BY\s+EACH\s+REPORTING\s+PERSON)?[^\d]{0,40}?(\d[\d,]*)/i);
    if (amountMatch && amountMatch[1]) {
        shares = amountMatch[1].replace(/,$/, '');
    }

    // 4. Purpose of Transaction (Item 4): a block of text; keep the first PURPOSE_LIMIT (300) characters.
    let purpose = NO_PURPOSE;
    const item4Match = text.match(/Item\s+4[.\s]+Purpose\s+of\s+Transaction(.*?)(?:Item\s+5|SIGNATURE)/i);
    if (item4Match && item4Match[1]) {
        const rawPurpose = item4Match[1].trim();
        purpose = rawPurpose.length > PURPOSE_LIMIT ? `${rawPurpose.substring(0, PURPOSE_LIMIT)}...` : rawPurpose;
    }

    return {
        reportingPerson,
        percentClass,
        shares,
        purpose,
        format: 'html',
    };
}
