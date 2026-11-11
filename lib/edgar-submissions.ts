/**
 * Reads a filer's EDGAR submissions record (data.sec.gov/submissions) and tells "no such filer" (404) apart from
 * "SEC didn't answer" (502), so API routes can return the right error. Server-side.
 */
import { fetchWithTimeout } from './fetch-with-timeout';
import { SEC_USER_AGENT } from './sec-http';
import type { SecSubmission } from './sec-client';

export type SubmissionResult =
    | { ok: true; submission: SecSubmission }
    | { ok: false; status: 404 | 502; error: string };

export async function loadSubmission(cik: string, timeoutMs = 15000): Promise<SubmissionResult> {
    const padded = String(cik).replace(/\D/g, '').padStart(10, '0');
    try {
        const response = await fetchWithTimeout(
            `https://data.sec.gov/submissions/CIK${padded}.json`,
            { headers: { 'User-Agent': SEC_USER_AGENT }, next: { revalidate: 3600 } },
            timeoutMs
        );
        if (response.status === 404) return { ok: false, status: 404, error: `EDGAR has no filer with CIK ${padded}.` };
        if (!response.ok) return { ok: false, status: 502, error: `EDGAR answered with an error (HTTP ${response.status}). Try again in a minute.` };
        const submission = (await response.json()) as SecSubmission;
        if (!submission?.filings?.recent) return { ok: false, status: 502, error: 'EDGAR returned an unreadable filing list. Try again in a minute.' };
        return { ok: true, submission };
    } catch (error) {
        const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
        return { ok: false, status: 502, error: `Couldn’t reach EDGAR${detail}.` };
    }
}

/** One row of submissions.filings.recent, read as an object. */
export interface RecentFiling {
    form: string;
    accessionNumber: string;
    filingDate: string;
    reportDate: string;
    primaryDocument: string;
    primaryDocDescription: string;
}

export function recentFilings(submission: SecSubmission): RecentFiling[] {
    const recent = submission.filings.recent;
    return recent.form.map((form, i) => ({
        form,
        accessionNumber: recent.accessionNumber[i],
        filingDate: recent.filingDate[i],
        reportDate: recent.reportDate?.[i] ?? '',
        primaryDocument: recent.primaryDocument?.[i] ?? '',
        primaryDocDescription: recent.primaryDocDescription?.[i] ?? '',
    }));
}

/** Newest filing first; ties broken by accession number so the order is stable. */
export function byFilingDateDesc(a: { filingDate: string; accessionNumber: string }, b: { filingDate: string; accessionNumber: string }): number {
    return b.filingDate.localeCompare(a.filingDate) || b.accessionNumber.localeCompare(a.accessionNumber);
}

/**
 * Structured filings (Form 4, Schedule 13D since Dec 2024, 13F cover pages) list a rendered view as their primary
 * document, e.g. "xslF345X05/doc.xml". Dropping the xsl folder gives the raw XML ("doc.xml").
 */
export function rawXmlDocument(primaryDocument: string): string {
    return primaryDocument.replace(/^xsl[^/]*\//i, '');
}
