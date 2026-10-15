/**
 * Store-backed lookups for the Whale Tracker tab: filer holdings diff, fund overlap, and "who holds this stock".
 */
import { normalizeCik, normalizeIssuerName } from './thirteen-f-radar-core';
import { type PostgresExecutor } from './thirteen-f-radar-postgres';
import {
    filerComparisonPair,
    positionShares,
    positionValue,
    queryPositionsByFiler,
    queryPositionsBySecurities,
    type FilerComparisonPair,
    type StoreDirectory,
    type StoreFiler,
    type StoreMeta,
    type StorePosition,
    type StoreSecurity,
    type StoreSide,
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

/**
 * A filer's holdings on its own latest pair of quarters: cur vs prev once it has filed the newest quarter,
 * otherwise prev vs prior (so funds that haven't reported yet still show a real quarter-over-quarter change).
 */
export async function loadFilerHoldingDiff(
    db: PostgresExecutor,
    meta: StoreMeta,
    directory: StoreDirectory,
    filer: StoreFiler
): Promise<{ pair: FilerComparisonPair; rows: FilerHoldingDiff[] } | null> {
    const pair = filerComparisonPair(meta, filer);
    if (!pair) return null;
    const positions = await queryPositionsByFiler(db, filer.id);
    const rows = positions
        .map((position) => {
            const security = directory.securitiesById.get(position.securityId);
            return {
                issuer: security?.issuer || 'UNKNOWN',
                cusip: security?.cusip || null,
                sharesCurr: positionShares(position, pair.currentSide),
                valueCurr: positionValue(position, pair.currentSide),
                sharesPrev: pair.previousSide ? positionShares(position, pair.previousSide) : 0,
                valuePrev: pair.previousSide ? positionValue(position, pair.previousSide) : 0,
            };
        })
        .filter((row) => row.sharesCurr > 0 || row.sharesPrev > 0 || row.valueCurr > 0 || row.valuePrev > 0);
    return { pair, rows };
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

/**
 * Holders of the given securities, shaped for buildReverseLookupFunds (whale-reverse-lookup route).
 * Every stored slot is passed through; buildReverseLookupFunds compares each fund's latest two filed quarters.
 */
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
        const slots = filerSlots(meta, filer);
        for (const slot of slots) {
            const shares = positionShares(position, slot.side);
            if (shares <= 0) continue;
            rows.matchedHoldings.push({
                fundName: filer.name,
                cik: filer.cik,
                issuer: security.issuer,
                cusip: security.cusip,
                accessionNumber: slot.accession,
                filingDate: slot.filingDate,
                quarter: slot.quarter,
                value: positionValue(position, slot.side),
                shares,
            });
        }
        if (filersSeen.has(filer.id)) continue;
        filersSeen.add(filer.id);
        for (const slot of slots) {
            rows.filings.push({ fundName: filer.name, cik: filer.cik, accessionNumber: slot.accession, filingDate: slot.filingDate, quarter: slot.quarter });
        }
    }
    return rows;
}

function filerSlots(meta: StoreMeta, filer: StoreFiler) {
    const slots: Array<{ side: StoreSide; quarter: string; accession: string; filingDate: string }> = [];
    if (filer.curAccession) slots.push({ side: 'cur', quarter: meta.currentQuarter, accession: filer.curAccession, filingDate: filer.curFilingDate || '' });
    if (filer.prevAccession) slots.push({ side: 'prev', quarter: meta.previousQuarter, accession: filer.prevAccession, filingDate: filer.prevFilingDate || '' });
    if (filer.priorAccession && meta.priorQuarter) {
        slots.push({ side: 'prior', quarter: meta.priorQuarter, accession: filer.priorAccession, filingDate: filer.priorFilingDate || '' });
    }
    return slots;
}
