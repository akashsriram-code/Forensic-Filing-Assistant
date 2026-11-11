/**
 * Hand-checked corrections for 13F filings whose stated period of report is wrong (data/13f-period-overrides.json).
 * An override assigns one accession to a report quarter regardless of the period it states. Add an entry only after
 * reading the filing on EDGAR; the `note` should say what was checked.
 *
 * Also flags "late" amendments (period 2+ quarters before the newest reportable quarter at filing time) so ingestion can
 * log them for review. Many are legitimate: e.g. a fund whose confidential treatment expired files the withheld
 * holdings a year later (Norges Bank does this). They are logged, never changed automatically.
 */
import rawOverrides from '../data/13f-period-overrides.json';
import { mostRecentCompletedReportQuarter, normalizeSecDate } from './thirteen-f-parse';

export interface PeriodOverride {
    /** Filer CIK, digits (leading zeros optional). */
    cik: string;
    /** Accession number, e.g. "0001374170-26-000021". */
    accession: string;
    /** Report quarter to assign, e.g. "2026-Q1". */
    quarter: string;
    /** Why, and what was checked on EDGAR. */
    note: string;
}

const QUARTER_PATTERN = /^(\d{4})-Q([1-4])$/;

function normalizeAccessionKey(accession: string): string {
    const digits = String(accession ?? '').replace(/\D/g, '');
    return digits.length === 18 ? `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}` : String(accession ?? '').trim();
}

function normalizeCikKey(cik: string): string {
    return String(cik ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Validates the JSON (an array of {cik, accession, quarter, note}); bad entries throw so a typo can't pass silently. */
export function parsePeriodOverrides(raw: unknown): PeriodOverride[] {
    if (!Array.isArray(raw)) throw new Error('13F period overrides must be a JSON array.');
    return raw.map((entry, i) => {
        const e = (entry ?? {}) as Partial<Record<keyof PeriodOverride, unknown>>;
        const cik = normalizeCikKey(String(e.cik ?? ''));
        const accession = normalizeAccessionKey(String(e.accession ?? ''));
        const quarter = String(e.quarter ?? '').trim().toUpperCase();
        if (!cik || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !QUARTER_PATTERN.test(quarter)) {
            throw new Error(`13F period override #${i + 1} needs a cik, an 18-digit accession and a quarter like 2026-Q1.`);
        }
        return { cik, accession, quarter, note: String(e.note ?? '') };
    });
}

export type PeriodOverrideIndex = Map<string, PeriodOverride>;

export function buildPeriodOverrideIndex(overrides: PeriodOverride[]): PeriodOverrideIndex {
    return new Map(overrides.map((o) => [normalizeAccessionKey(o.accession), o]));
}

let defaultIndex: PeriodOverrideIndex | null = null;

/** The overrides in data/13f-period-overrides.json. */
export function loadPeriodOverrides(): PeriodOverrideIndex {
    if (!defaultIndex) defaultIndex = buildPeriodOverrideIndex(parsePeriodOverrides(rawOverrides));
    return defaultIndex;
}

/** The override for this accession, if any. A CIK, when given, must match too (guards against a pasted wrong row). */
export function findPeriodOverride(index: PeriodOverrideIndex, accession: string, cik?: string | null): PeriodOverride | null {
    const override = index.get(normalizeAccessionKey(accession));
    if (!override) return null;
    if (cik && normalizeCikKey(cik) !== override.cik) return null;
    return override;
}

function quarterOrdinal(quarter: string): number | null {
    const match = QUARTER_PATTERN.exec(quarter);
    return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : null;
}

/**
 * How many quarters the stated period trails the newest quarter that could be reported on the filing date.
 * An on-time report is 0; an amendment to last quarter's report filed after the next quarter end is 1.
 */
export function amendmentLagQuarters(periodQuarter: string | null, filingDate: string): number | null {
    if (!periodQuarter) return null;
    const iso = normalizeSecDate(filingDate);
    const date = new Date(`${iso}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    const period = quarterOrdinal(periodQuarter);
    const latest = quarterOrdinal(mostRecentCompletedReportQuarter(date));
    return period === null || latest === null ? null : latest - period;
}

/** True for a 13F-HR/A whose period is 2 or more quarters before what was reportable when it was filed. */
export function isLateAmendment(form: string, periodQuarter: string | null, filingDate: string): boolean {
    if (form.trim().toUpperCase() !== '13F-HR/A') return false;
    const lag = amendmentLagQuarters(periodQuarter, filingDate);
    return lag !== null && lag >= 2;
}

export function describeLateAmendment(filing: { accessionNumber: string; cik: string; filerName?: string; periodQuarter: string | null; filingDate: string }): string {
    const lag = amendmentLagQuarters(filing.periodQuarter, filing.filingDate);
    return `13F-HR/A ${filing.accessionNumber} (CIK ${filing.cik}${filing.filerName ? `, ${filing.filerName}` : ''}) filed ${filing.filingDate} states period ${filing.periodQuarter} (${lag} quarters back). If the period is mis-stated, add it to data/13f-period-overrides.json; a late confidential-treatment release is normal.`;
}
