/**
 * Streaming reader for extracted SEC Form 13F data set folders (SUBMISSION, COVERPAGE, INFOTABLE TSVs).
 * https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets
 */
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { normalizeCik } from '../lib/thirteen-f-radar-core';

export type TsvRecord = Record<string, string>;

export interface DatasetFiling {
    accessionNumber: string;
    cik: string;
    filerName: string;
    filingDate: string;
    quarter: string;
    /** 'replace' = 13F-HR or restatement; 'add' = "NEW HOLDINGS" amendment layered on the base report. */
    mode: 'replace' | 'add';
}

export interface DatasetHoldingRow {
    accessionNumber: string;
    issuer: string;
    cusip: string | null;
    value: number;
    shares: number;
    putCall: string | null;
    isPrn: boolean;
}

export interface SelectedDatasetFilings {
    /** Accessions to use, keyed by accession: the base report per (CIK, quarter) plus later new-holdings amendments. */
    byAccession: Map<string, DatasetFiling>;
    /** Base report per `${quarter}|${cik}`. */
    baseByFilerQuarter: Map<string, DatasetFiling>;
    zeroValueFilings: DatasetFiling[];
    newHoldingsAmendments: number;
}

export async function readTsv(filePath: string, onRow: (row: TsvRecord) => void) {
    const lines = readline.createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
    let headers: string[] | null = null;
    for await (const line of lines) {
        if (!line) continue;
        const cols = line.split('\t');
        if (!headers) {
            headers = cols.map((col) => col.trim());
            continue;
        }
        const row: TsvRecord = {};
        headers.forEach((header, i) => (row[header] = (cols[i] || '').trim()));
        onRow(row);
    }
}

const MONTHS: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** "31-MAR-2026" -> "2026-03-31" */
export function secDateToIso(value: string): string {
    const [day, month, year] = value.split('-');
    return MONTHS[month] ? `${year}-${MONTHS[month]}-${day.padStart(2, '0')}` : value;
}

/** "31-MAR-2026" -> "2026-Q1" */
export function secDateToQuarter(value: string): string | null {
    const match = secDateToIso(value).match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-Q${Math.ceil(Number(match[2]) / 3)}` : null;
}

/** Every 13F-HR / 13F-HR/A in the given data set folders whose period of report falls in one of `quarters`. */
export async function readDatasetFilings(dirs: string[], quarters: string[]): Promise<DatasetFiling[]> {
    const wanted = new Set(quarters);
    const filings = new Map<string, DatasetFiling>();
    for (const dir of dirs) {
        const cover = new Map<string, TsvRecord>();
        await readTsv(path.join(dir, 'COVERPAGE.tsv'), (row) => cover.set(row.ACCESSION_NUMBER, row));
        await readTsv(path.join(dir, 'SUBMISSION.tsv'), (row) => {
            if (row.SUBMISSIONTYPE !== '13F-HR' && row.SUBMISSIONTYPE !== '13F-HR/A') return;
            const quarter = secDateToQuarter(row.PERIODOFREPORT);
            if (!quarter || !wanted.has(quarter)) return;
            const coverRow = cover.get(row.ACCESSION_NUMBER);
            filings.set(row.ACCESSION_NUMBER, {
                accessionNumber: row.ACCESSION_NUMBER,
                cik: normalizeCik(row.CIK),
                filerName: coverRow?.FILINGMANAGER_NAME || normalizeCik(row.CIK),
                filingDate: secDateToIso(row.FILING_DATE),
                quarter,
                mode: coverRow?.AMENDMENTTYPE === 'NEW HOLDINGS' ? 'add' : 'replace',
            });
        });
    }
    return Array.from(filings.values());
}

/**
 * Pick the filings that make up each filer's position for each quarter:
 * the latest 'replace' report (original or restatement), plus any 'add' amendments filed after it.
 * Reports with $0 total value (placeholder stubs) are dropped so they don't read as full liquidations.
 */
export function selectDatasetFilings(filings: DatasetFiling[], totalValueByAccession: Map<string, number>): SelectedDatasetFilings {
    const zeroValueFilings = filings.filter((f) => f.mode === 'replace' && !totalValueByAccession.get(f.accessionNumber));
    const zero = new Set(zeroValueFilings.map((f) => f.accessionNumber));
    const byDateDesc = (a: DatasetFiling, b: DatasetFiling) =>
        b.filingDate.localeCompare(a.filingDate) || b.accessionNumber.localeCompare(a.accessionNumber);

    const baseByFilerQuarter = new Map<string, DatasetFiling>();
    for (const filing of filings.filter((f) => f.mode === 'replace' && !zero.has(f.accessionNumber)).sort(byDateDesc)) {
        const key = `${filing.quarter}|${filing.cik}`;
        if (!baseByFilerQuarter.has(key)) baseByFilerQuarter.set(key, filing);
    }

    const byAccession = new Map<string, DatasetFiling>();
    for (const base of baseByFilerQuarter.values()) byAccession.set(base.accessionNumber, base);
    let newHoldingsAmendments = 0;
    for (const filing of filings) {
        if (filing.mode !== 'add') continue;
        const base = baseByFilerQuarter.get(`${filing.quarter}|${filing.cik}`);
        if (!base || filing.filingDate < base.filingDate) continue;
        byAccession.set(filing.accessionNumber, filing);
        newHoldingsAmendments++;
    }

    return { byAccession, baseByFilerQuarter, zeroValueFilings, newHoldingsAmendments };
}

/** Total reported value per accession (all rows, options included) - used to detect empty stub filings. */
export async function readDatasetFilingTotals(dirs: string[], accessions: Set<string>): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    await readDatasetHoldings(dirs, accessions, (row) => {
        totals.set(row.accessionNumber, (totals.get(row.accessionNumber) || 0) + row.value);
    });
    return totals;
}

export async function readDatasetHoldings(dirs: string[], accessions: Set<string>, onRow: (row: DatasetHoldingRow) => void) {
    for (const dir of dirs) {
        await readTsv(path.join(dir, 'INFOTABLE.tsv'), (row) => {
            if (!accessions.has(row.ACCESSION_NUMBER)) return;
            onRow({
                accessionNumber: row.ACCESSION_NUMBER,
                issuer: row.NAMEOFISSUER || '',
                cusip: row.CUSIP || null,
                value: Number(row.VALUE) || 0,
                shares: Number(row.SSHPRNAMT) || 0,
                putCall: row.PUTCALL || null,
                isPrn: row.SSHPRNAMTTYPE === 'PRN',
            });
        });
    }
}
