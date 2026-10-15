/**
 * Store-backed lookups for the Whale Tracker tab: filer holdings diff, fund overlap, and "who holds this stock".
 */
import { normalizeCik, normalizeIssuerName } from './thirteen-f-radar-core';
import { type PostgresExecutor } from './thirteen-f-radar-postgres';
import {
    queryPositionsByFiler,
    queryPositionsBySecurities,
    type StoreDirectory,
    type StoreFiler,
    type StoreMeta,
    type StorePosition,
    type StoreSecurity,
} from './thirteen-f-store';

const CORPORATE_SUFFIXES = new Set([
    'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC', 'LLC', 'LP', 'LLP',
    'HOLDINGS', 'HOLDING', 'HLDGS', 'HLDG', 'GROUP', 'GRP', 'THE', 'NV', 'SA', 'AG', 'SE', 'DE', 'NEW',
]);
// Words allowed after the company's core name in an issuer line ("ALPHABET INC CL A", "NVIDIA CORP COM").
const SHARE_CLASS_WORDS = new Set([
    'CL', 'CLASS', 'A', 'B', 'C', 'COM', 'COMMON', 'STK', 'STOCK', 'CAP', 'SHS', 'SHARES', 'SH', 'ORD', 'ORDINARY',
    'ADR', 'ADS', 'SPONSORED', 'SPON', 'NPV', 'PAR', 'USD', 'REG', 'REGISTERED', 'BEN', 'INT', 'UNIT', 'UNITS',
    'NON', 'VOTING', 'VTG', 'SER', 'SERIES', '1', '2', '3', 'NAMEN', 'AKT', 'ISIN', 'NY', 'REGISTRY', 'EACH', 'REP',
    ...CORPORATE_SUFFIXES,
]);

/** "Alphabet Inc." -> ["ALPHABET"]; drops corporate suffixes so SEC titles and 13F issuer lines line up. */
function coreNameTokens(name: string): string[] {
    const tokens = normalizeIssuerName(name).split(' ').filter(Boolean);
    while (tokens.length > 1 && CORPORATE_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
    if (tokens[0] === 'THE' && tokens.length > 1) tokens.shift();
    return tokens;
}

/**
 * Securities whose issuer line is the given company: the issuer must start with the company's core name and
 * the rest may only be share-class words. "APPLE INC" matches Apple; "APPLE HOSPITALITY REIT" does not.
 */
export function findSecuritiesForCompany(directory: StoreDirectory, companyName: string): StoreSecurity[] {
    const core = coreNameTokens(companyName);
    if (core.length === 0) return [];
    return directory.securities.filter((security) => {
        const tokens = normalizeIssuerName(security.issuer).split(' ').filter(Boolean);
        if (tokens[0] === 'THE' && core[0] !== 'THE') tokens.shift();
        if (tokens.length < core.length) return false;
        for (let i = 0; i < core.length; i++) if (tokens[i] !== core[i]) return false;
        return tokens.slice(core.length).every((token) => SHARE_CLASS_WORDS.has(token));
    });
}

export function findSecuritiesByCusip(directory: StoreDirectory, cusip: string): StoreSecurity[] {
    const normalized = cusip.trim().toUpperCase();
    return directory.securities.filter((security) => security.cusip === normalized);
}

/** A filer by CIK, or by name when the query isn't a known CIK (most 13F managers have no ticker). */
export function resolveStoreFiler(directory: StoreDirectory, query: string, cikHint?: string | null): StoreFiler | null {
    if (cikHint) {
        const byCik = directory.filersByCik.get(normalizeCik(cikHint));
        if (byCik) return byCik;
    }
    if (/^\d{1,10}$/.test(query.trim())) {
        const byCik = directory.filersByCik.get(normalizeCik(query));
        if (byCik) return byCik;
    }

    const needle = normalizeIssuerName(query);
    if (!needle) return null;
    const candidates = directory.filers.filter((filer) => normalizeIssuerName(filer.name).includes(needle));
    // Prefer filers present in the latest quarter, then the closest (shortest) name.
    return candidates.sort((a, b) =>
        Number(Boolean(b.curAccession)) - Number(Boolean(a.curAccession)) ||
        a.name.length - b.name.length
    )[0] || null;
}

export interface FilerHoldingDiff {
    issuer: string;
    cusip: string | null;
    sharesCurr: number;
    sharesPrev: number;
    valueCurr: number;
    valuePrev: number;
}

export async function loadFilerHoldingDiff(
    db: PostgresExecutor,
    directory: StoreDirectory,
    filer: StoreFiler
): Promise<FilerHoldingDiff[]> {
    const positions = await queryPositionsByFiler(db, filer.id);
    return positions.map((position) => {
        const security = directory.securitiesById.get(position.securityId);
        return {
            issuer: security?.issuer || 'UNKNOWN',
            cusip: security?.cusip || null,
            sharesCurr: filer.curAccession ? position.curShares : 0,
            sharesPrev: filer.prevAccession ? position.prevShares : 0,
            valueCurr: filer.curAccession ? position.curValue : 0,
            valuePrev: filer.prevAccession ? position.prevValue : 0,
        };
    });
}

export interface ReverseLookupRows {
    matchedHoldings: Array<{
        fundName: string;
        cik: string;
        accessionNumber: string;
        filingDate: string;
        quarter: string;
        issuer: string;
        cusip: string | null;
        value: number;
        shares: number;
    }>;
    filings: Array<{ fundName: string; cik: string; accessionNumber: string; filingDate: string; quarter: string }>;
}

/** Holders of the given securities, shaped for buildReverseLookupFunds (whale-reverse-lookup route). */
export async function loadReverseLookupRows(
    db: PostgresExecutor,
    meta: StoreMeta,
    directory: StoreDirectory,
    securities: StoreSecurity[]
): Promise<ReverseLookupRows> {
    const positions: StorePosition[] = await queryPositionsBySecurities(db, securities.map((s) => s.id));
    const rows: ReverseLookupRows = { matchedHoldings: [], filings: [] };
    const filersSeen = new Set<number>();

    for (const position of positions) {
        const filer = directory.filersById.get(position.filerId);
        const security = directory.securitiesById.get(position.securityId);
        if (!filer || !security) continue;
        const base = { fundName: filer.name, cik: filer.cik, issuer: security.issuer, cusip: security.cusip };
        if (filer.curAccession && position.curShares > 0) {
            rows.matchedHoldings.push({ ...base, accessionNumber: filer.curAccession, filingDate: filer.curFilingDate || '', quarter: meta.currentQuarter, value: position.curValue, shares: position.curShares });
        }
        if (filer.prevAccession && position.prevShares > 0) {
            rows.matchedHoldings.push({ ...base, accessionNumber: filer.prevAccession, filingDate: filer.prevFilingDate || '', quarter: meta.previousQuarter, value: position.prevValue, shares: position.prevShares });
        }
        if (filersSeen.has(filer.id)) continue;
        filersSeen.add(filer.id);
        if (filer.curAccession) {
            rows.filings.push({ fundName: filer.name, cik: filer.cik, accessionNumber: filer.curAccession, filingDate: filer.curFilingDate || '', quarter: meta.currentQuarter });
        }
        if (filer.prevAccession) {
            rows.filings.push({ fundName: filer.name, cik: filer.cik, accessionNumber: filer.prevAccession, filingDate: filer.prevFilingDate || '', quarter: meta.previousQuarter });
        }
    }
    return rows;
}
