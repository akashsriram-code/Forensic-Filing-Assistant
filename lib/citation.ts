/**
 * Citations for fact-checking: a filing named the way a reporter would cite it, with its SEC accession number and a
 * link to the filing on sec.gov. Pure functions, safe on client and server.
 */
import { formatDate } from './format';
import { filingIndexUrl, formatAccession, parseSecArchiveUrl } from './sec-urls';

export interface Citation {
    /** Company or fund name as filed, e.g. "NVIDIA CORP". */
    entity: string;
    /** SEC form type, e.g. "10-K", "13F-HR", "4", "SCHEDULE 13D". */
    form: string;
    /** YYYY-MM-DD. */
    filingDate?: string | null;
    accession?: string | null;
    /** Link to the filing; when missing it is built from cik + accession. */
    url?: string | null;
    cik?: string | null;
}

/** The best link for a citation: the given URL, else the filing index page built from CIK and accession. */
export function citationUrl(citation: Citation): string | null {
    if (citation.url) return citation.url;
    if (citation.cik && citation.accession) return filingIndexUrl(citation.cik, citation.accession);
    return null;
}

/**
 * "NVIDIA CORP, Form 10-K, filed Feb 25, 2026, SEC accession no. 0001045810-26-000012,
 *  https://www.sec.gov/Archives/edgar/data/1045810/000104581026000012/0001045810-26-000012-index.htm"
 */
export function formatCitation(citation: Citation): string {
    const parts = [citation.entity.trim() || 'Unknown filer', `Form ${citation.form}`];
    if (citation.filingDate) parts.push(`filed ${formatDate(citation.filingDate)}`);
    if (citation.accession) parts.push(`SEC accession no. ${formatAccession(citation.accession)}`);
    const url = citationUrl(citation);
    if (url) parts.push(url);
    return parts.join(', ');
}

/** "Sources:" block appended to a copied takeaway; duplicates (same accession or URL) are listed once. */
export function formatSources(citations: Citation[]): string {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const citation of citations) {
        const key = citation.accession ? formatAccession(citation.accession) : citationUrl(citation) || formatCitation(citation);
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`- ${formatCitation(citation)}`);
    }
    return lines.length > 0 ? `Sources:\n${lines.join('\n')}` : '';
}

/** Builds a citation from an EDGAR document URL when only the URL is known (e.g. the two filings on the diff page). */
export function citationFromUrl(url: string, entity: string, form: string, filingDate?: string | null): Citation {
    const parsed = parseSecArchiveUrl(url);
    return { entity, form, filingDate, url, cik: parsed?.cik ?? null, accession: parsed?.accession ?? null };
}
