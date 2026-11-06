/**
 * Parsing for raw EDGAR 13F-HR submissions, shared by the live ingestion script and the Whale Tracker's live fallback.
 */
import { parseStringPromise } from 'xml2js';

export interface HoldingInput {
    issuer: string;
    cusip: string | null;
    value: number;
    shares: number;
    putcall: string | null;
    sshPrnamtType: string | null;
}

export interface ParsedLive13FXml {
    reportDate: string | null;
    /** Cover-page amendment type for 13F-HR/A: "RESTATEMENT" or "NEW HOLDINGS". */
    amendmentType: string | null;
    holdings: HoldingInput[];
}

export async function parseLive13FXmlText(xmlContent: string): Promise<ParsedLive13FXml> {
    const cleanXml = xmlContent.replace(/<([a-zA-Z0-9]+):/g, '<').replace(/<\/([a-zA-Z0-9]+):/g, '</');
    const parsed = await parseStringPromise(cleanXml, {
        explicitArray: true,
        ignoreAttrs: false,
        tagNameProcessors: [(name: string) => name.toLowerCase()],
    });
    const reportDate = normalizeSecDate(findFirstTextByKeys(parsed, ['periodofreport', 'reportcalendarorquarter']) || '');
    const amendmentType = (findFirstTextByKeys(parsed, ['amendmenttype']) || '').trim().toUpperCase() || null;
    const infoTableRows = collectInfoTableRows(parsed);
    const holdings = infoTableRows
        .map(parseInfoTableHolding)
        .filter((holding): holding is HoldingInput => holding !== null);
    return { reportDate: reportDate || null, amendmentType, holdings };
}

export async function parseLive13FSubmissionText(submissionText: string): Promise<ParsedLive13FXml> {
    const xmlSegments = Array.from(submissionText.matchAll(/<XML>([\s\S]*?)<\/XML>/gi)).map((match) => match[1]);
    const candidates = xmlSegments.length > 0 ? xmlSegments : [submissionText];
    let reportDate: string | null = null;
    let amendmentType: string | null = null;
    let holdings: HoldingInput[] = [];

    for (const candidate of candidates) {
        try {
            const parsed = await parseLive13FXmlText(candidate);
            if (!reportDate && parsed.reportDate) reportDate = parsed.reportDate;
            if (!amendmentType && parsed.amendmentType) amendmentType = parsed.amendmentType;
            if (parsed.holdings.length > holdings.length) holdings = parsed.holdings;
        } catch {
            // Filing submission wrappers often contain non-XML documents; ignore those blocks.
        }
    }

    return { reportDate, amendmentType, holdings };
}

/** "20261103", "2026-11-03", "03-NOV-2026" -> "2026-11-03". EDGAR's daily indexes use the compact form. */
export function normalizeSecDate(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const yyyymmdd = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (yyyymmdd) return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return trimmed;
}

export function quarterFromReportDate(value: string): string | null {
    const normalized = normalizeSecDate(value);
    if (!normalized) return null;
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    const month = date.getUTCMonth();
    const quarter = Math.floor(month / 3) + 1;
    return `${date.getUTCFullYear()}-Q${quarter}`;
}

/** The newest report quarter whose period has ended (and so can be filed), e.g. 2026-Q3 on 2026-11-06. */
export function mostRecentCompletedReportQuarter(asOf = new Date()): string {
    const year = asOf.getUTCFullYear();
    const month = asOf.getUTCMonth();
    const currentQuarter = Math.floor(month / 3) + 1;
    const currentQuarterEnd = new Date(Date.UTC(year, currentQuarter * 3, 0));
    if (asOf.getTime() > currentQuarterEnd.getTime()) {
        return `${year}-Q${currentQuarter}`;
    }
    return currentQuarter === 1 ? `${year - 1}-Q4` : `${year}-Q${currentQuarter - 1}`;
}

export function parseNumber(value: string | undefined): number {
    const parsed = Number.parseFloat((value || '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseInfoTableHolding(row: unknown): HoldingInput | null {
    const issuer = (findFirstTextByKeys(row, ['nameofissuer']) || 'Unknown').toUpperCase();
    const cusip = findFirstTextByKeys(row, ['cusip']) || null;
    const value = parseNumber(findFirstTextByKeys(row, ['value']) || '0');
    const shares = parseNumber(findFirstTextByKeys(row, ['sshprnamt']) || '0');
    if (!issuer && !cusip) return null;
    return {
        issuer,
        cusip,
        value,
        shares,
        putcall: findFirstTextByKeys(row, ['putcall']) || null,
        sshPrnamtType: findFirstTextByKeys(row, ['sshprnamttype']) || null,
    };
}

function collectInfoTableRows(node: unknown, rows: unknown[] = []): unknown[] {
    if (Array.isArray(node)) {
        for (const item of node) collectInfoTableRows(item, rows);
        return rows;
    }
    if (!node || typeof node !== 'object') return rows;

    for (const [key, value] of Object.entries(node)) {
        if (key.toLowerCase() === 'infotable') {
            if (Array.isArray(value)) rows.push(...value);
            else rows.push(value);
            continue;
        }
        collectInfoTableRows(value, rows);
    }
    return rows;
}

function findFirstTextByKeys(node: unknown, keys: string[]): string | null {
    if (node === null || node === undefined) return null;
    if (typeof node === 'string' || typeof node === 'number') return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findFirstTextByKeys(item, keys);
            if (found) return found;
        }
        return null;
    }
    if (typeof node !== 'object') return null;

    for (const [key, value] of Object.entries(node)) {
        if (keys.includes(key.toLowerCase())) {
            const text = firstText(value);
            if (text) return text;
        }
    }
    for (const value of Object.values(node)) {
        const found = findFirstTextByKeys(value, keys);
        if (found) return found;
    }
    return null;
}

function firstText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = firstText(item);
            if (text) return text;
        }
        return null;
    }
    if (typeof value === 'object') {
        if ('_' in value) return firstText((value as { _: unknown })._);
        for (const nested of Object.values(value)) {
            const text = firstText(nested);
            if (text) return text;
        }
    }
    return null;
}
