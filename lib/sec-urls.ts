/**
 * EDGAR archive URLs, built from a filer's CIK and a filing's accession number. Pure functions, safe on client and
 * server. Every page that links to or cites a filing should use these rather than building URLs by hand.
 */

/** "0001067983" -> "1067983" (archive paths use the CIK without leading zeros). Null when there are no digits. */
export function cikPath(cik: string | number | null | undefined): string | null {
    const digits = String(cik ?? '').replace(/\D/g, '').replace(/^0+/, '');
    return digits || null;
}

/** "000104581026000012" or "0001045810-26-000012" -> "0001045810-26-000012"; anything else is returned trimmed. */
export function formatAccession(accession: string | null | undefined): string {
    const raw = String(accession ?? '').trim();
    const digits = raw.replace(/-/g, '');
    return /^\d{18}$/.test(digits) ? `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}` : raw;
}

/** https://www.sec.gov/Archives/edgar/data/{cik}/{accessionNoDashes}/ — the folder holding every document of a filing. */
export function buildSecAccessionFolderUrl(cik: string, accessionNumber: string): string | null {
    const path = cikPath(cik);
    const accessionNoDash = String(accessionNumber ?? '').replace(/-/g, '');
    if (!path || !accessionNoDash) return null;
    return `https://www.sec.gov/Archives/edgar/data/${path}/${accessionNoDash}/`;
}

/** The full submission text file ({accession}.txt) inside the filing folder. */
export function buildSecSubmissionTextUrl(cik: string, accessionNumber: string): string | null {
    const folderUrl = buildSecAccessionFolderUrl(cik, accessionNumber);
    if (!folderUrl || !accessionNumber) return null;
    return `${folderUrl}${formatAccession(accessionNumber)}.txt`;
}

/** The human-readable filing index page ({accession}-index.htm): the best link to cite. */
export function filingIndexUrl(cik: string, accessionNumber: string): string | null {
    const folderUrl = buildSecAccessionFolderUrl(cik, accessionNumber);
    if (!folderUrl || !accessionNumber) return null;
    return `${folderUrl}${formatAccession(accessionNumber)}-index.htm`;
}

/** A specific document inside the filing, e.g. the 10-K's primary HTML document. */
export function primaryDocUrl(cik: string, accessionNumber: string, primaryDocument: string): string | null {
    const folderUrl = buildSecAccessionFolderUrl(cik, accessionNumber);
    if (!folderUrl || !primaryDocument) return null;
    return `${folderUrl}${primaryDocument.replace(/^\/+/, '')}`;
}

/**
 * Reads the CIK and accession number back out of any EDGAR archive URL
 * (https://www.sec.gov/Archives/edgar/data/1045810/000104581026000012/nvda-2026.htm). Null if it isn't one.
 */
export function parseSecArchiveUrl(url: string | null | undefined): { cik: string; accession: string } | null {
    const match = String(url ?? '').match(/sec\.gov\/Archives\/edgar\/data\/(\d+)\/(\d{18})(?:\/|$)/i);
    if (!match) return null;
    return { cik: match[1], accession: formatAccession(match[2]) };
}

/** EDGAR's browse page listing every filing by one filer. */
export function edgarFilerUrl(cik: string | number): string | null {
    const path = cikPath(cik);
    return path ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${path}&owner=include&count=40` : null;
}
