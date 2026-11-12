/**
 * Reads a filer's data.sec.gov submissions file. The SEC says it updates within a second of dissemination, but on
 * 2026-11-12 it listed new filings a median 61s after acceptance, about 35s behind the live feed. So it is the
 * backstop and the source of main-document links, not the fast path.
 */
import type { FilingRow } from './types';

export function padCik(cik: string | number): string {
    return String(cik).replace(/\D/g, '').padStart(10, '0');
}

export function submissionsUrl(cik: string): string {
    return `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
}

interface SubmissionsJson {
    cik?: string | number;
    name?: string;
    filings?: {
        recent?: {
            accessionNumber?: string[];
            form?: string[];
            acceptanceDateTime?: string[];
            filingDate?: string[];
            primaryDocument?: string[];
        };
    };
}

/** The newest `limit` filings, newest first (the order EDGAR already uses). Rows without a usable time are skipped. */
export function recentFrom(json: unknown, limit = 40): FilingRow[] {
    const data = (json ?? {}) as SubmissionsJson;
    const recent = data.filings?.recent;
    const accessions = recent?.accessionNumber ?? [];
    const cik = padCik(data.cik ?? '');
    const rows: FilingRow[] = [];
    for (let i = 0; i < accessions.length && rows.length < limit; i += 1) {
        const acceptedAt = Date.parse(recent?.acceptanceDateTime?.[i] ?? '');
        if (!Number.isFinite(acceptedAt)) continue;
        rows.push({
            accession: accessions[i],
            cik,
            company: data.name ?? '',
            form: recent?.form?.[i] ?? '',
            acceptedAt,
            filingDate: recent?.filingDate?.[i] ?? '',
            primaryDocument: recent?.primaryDocument?.[i] ?? '',
        });
    }
    return rows;
}
