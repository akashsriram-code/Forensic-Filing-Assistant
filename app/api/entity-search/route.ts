import { NextRequest, NextResponse } from 'next/server';
import { searchTickers } from '@/lib/search-index';
import { readAppStoreMeta, getAppPostgresPool } from '@/lib/thirteen-f-radar-data';
import { loadStoreDirectory, type StoreDirectory, type StoreFiler } from '@/lib/thirteen-f-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PER_GROUP = 6;
/** Ask the company index for more than we show, so exact ticker and prefix matches can be moved to the top. */
const COMPANY_CANDIDATES = 30;
const FUND_CANDIDATES = 30;
/** The header search is typed into; don't let a slow database hold up the company results. */
const FUND_TIMEOUT_MS = 4000;
const MAX_QUERY_LENGTH = 100;

export interface EntitySearchResult {
    type: 'company' | 'fund';
    /** 10-digit, zero-padded. */
    cik: string;
    ticker?: string;
    name: string;
}

/**
 * Header search: companies from the SEC ticker list plus 13F filers (funds) from the store directory. Each source
 * can fail on its own; the other's results still come back, with a `warnings` entry explaining what's missing.
 */
export async function GET(req: NextRequest) {
    const query = (req.nextUrl.searchParams.get('q') || '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
    if (query.length < 2) return NextResponse.json({ results: [] });

    const [companies, funds] = await Promise.allSettled([searchCompanies(query), searchFunds(query)]);
    const results: EntitySearchResult[] = [];
    const warnings: string[] = [];

    if (companies.status === 'fulfilled') results.push(...companies.value);
    else {
        console.error('[EntitySearch] Company search failed:', companies.reason);
        warnings.push('Company search is unavailable right now (the SEC company list did not load).');
    }

    if (funds.status === 'fulfilled') {
        if (funds.value.warning) warnings.push(funds.value.warning);
        // A fund that is also one of the matched companies (Berkshire Hathaway) goes first: it's almost always the one meant.
        const companyCiks = new Set(results.map((result) => result.cik));
        const alsoCompany = funds.value.results.filter((fund) => companyCiks.has(fund.cik));
        const others = funds.value.results.filter((fund) => !companyCiks.has(fund.cik));
        results.push(...[...alsoCompany, ...others].slice(0, MAX_PER_GROUP));
    } else if (funds.reason instanceof FundTimeoutError) {
        // The directory keeps loading in the background and is cached once it arrives, so the next keystroke usually works.
        warnings.push('Fund results are still loading. Keep typing or try again in a few seconds.');
    } else {
        console.error('[EntitySearch] Fund search failed:', funds.reason);
        warnings.push('Fund search is unavailable right now (the 13F database did not respond).');
    }

    return NextResponse.json(warnings.length > 0 ? { results, warnings } : { results }, {
        headers: { 'Cache-Control': warnings.length > 0 ? 'no-store' : 'public, max-age=60, s-maxage=600' },
    });
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

async function searchCompanies(query: string): Promise<EntitySearchResult[]> {
    const hits = await searchTickers(query, COMPANY_CANDIDATES);
    const tickerQuery = query.toUpperCase().replace(/[./]/g, '-');
    const lowerQuery = query.toLowerCase();
    // "BRK.B" -> "BRK": the index keeps one ticker per CIK, so a share-class query may come back as its sibling (BRK-A).
    const classBase = /^[A-Z0-9]+-[A-Z0-9]{1,2}$/.test(tickerQuery) ? tickerQuery.split('-')[0] : null;

    const rank = (ticker: string, title: string): number => {
        const lowerTitle = title.toLowerCase();
        if (ticker === tickerQuery) return 0;
        if (classBase && ticker.split('-')[0] === classBase) return 1;
        if (lowerTitle === lowerQuery) return 1;
        if (ticker.startsWith(tickerQuery)) return 2;
        if (lowerTitle.startsWith(lowerQuery)) return 3;
        if (tokenize(title).some((token) => token.startsWith(lowerQuery))) return 4;
        return 5;
    };

    const seen = new Set<string>();
    return hits
        .map((hit, order) => {
            const ticker = hit.ticker.toUpperCase();
            const value = rank(ticker, hit.title);
            // Within a tier, shorter wins: "apple" -> Apple Inc. before Apple Hospitality REIT; "nv" -> NVDA before NVDAX.
            const length = value === 2 ? ticker.length : value < 5 ? hit.title.length : 0;
            return { hit, order, rank: value, length };
        })
        .sort((a, b) => a.rank - b.rank || a.length - b.length || a.order - b.order)
        .filter(({ hit }) => {
            const key = `${hit.cik}:${hit.ticker}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, MAX_PER_GROUP)
        .map(({ hit }) => ({ type: 'company' as const, cik: hit.cik, ticker: hit.ticker, name: hit.title }));
}

// ---------------------------------------------------------------------------
// Funds
// ---------------------------------------------------------------------------

interface IndexedFiler {
    filer: StoreFiler;
    cikDigits: string;
    lowerName: string;
    tokens: string[];
}

const filerIndexCache = new WeakMap<StoreDirectory, IndexedFiler[]>();

async function searchFunds(query: string): Promise<{ results: EntitySearchResult[]; warning?: string }> {
    const directory = await withTimeout(loadDirectory(), FUND_TIMEOUT_MS, 'The 13F database took too long to answer.');
    if (!directory) {
        return { results: [], warning: 'Fund search is unavailable: the 13F database is not set up on this server.' };
    }
    return { results: matchFunds(indexFilers(directory), query) };
}

async function loadDirectory(): Promise<StoreDirectory | null> {
    const meta = await readAppStoreMeta();
    if (!meta) return null;
    return loadStoreDirectory(getAppPostgresPool(), meta);
}

function indexFilers(directory: StoreDirectory): IndexedFiler[] {
    let indexed = filerIndexCache.get(directory);
    if (!indexed) {
        indexed = directory.filers.map((filer) => ({
            filer,
            cikDigits: String(filer.cik).replace(/\D/g, '').replace(/^0+/, ''),
            lowerName: filer.name.toLowerCase(),
            tokens: tokenize(filer.name),
        }));
        filerIndexCache.set(directory, indexed);
    }
    return indexed;
}

/**
 * A fund matches when every word of the query starts a word of its name ("berk hath" finds BERKSHIRE HATHAWAY INC),
 * or when an all-digit query is the start of its CIK (leading zeros ignored). Best matches first: exact name, name
 * starting with the query, CIK, then the rest; ties go to funds with holdings in the stored quarters, then shorter
 * names. Returns up to FUND_CANDIDATES; GET trims to MAX_PER_GROUP after promoting funds that are also companies.
 */
function matchFunds(filers: IndexedFiler[], query: string): EntitySearchResult[] {
    const lowerQuery = query.toLowerCase();
    const queryTokens = tokenize(query);
    const digits = /^\d+$/.test(query.replace(/\s/g, '')) ? query.replace(/\D/g, '').replace(/^0+/, '') : null;
    if (queryTokens.length === 0 && !digits) return [];

    const matches: { item: IndexedFiler; rank: number }[] = [];
    for (const item of filers) {
        let rank = -1;
        if (digits && item.cikDigits.startsWith(digits)) rank = item.cikDigits === digits ? 0 : 3;
        else if (queryTokens.length > 0 && queryTokens.every((token) => item.tokens.some((word) => word.startsWith(token)))) {
            if (item.lowerName === lowerQuery) rank = 1;
            else if (item.lowerName.startsWith(lowerQuery)) rank = 2;
            else if (item.tokens[0]?.startsWith(queryTokens[0])) rank = 4;
            else rank = 5;
        }
        if (rank >= 0) matches.push({ item, rank });
    }

    const hasHoldings = (filer: StoreFiler) => Number(Boolean(filer.curAccession || filer.prevAccession));
    matches.sort(
        (a, b) =>
            a.rank - b.rank ||
            hasHoldings(b.item.filer) - hasHoldings(a.item.filer) ||
            a.item.lowerName.length - b.item.lowerName.length ||
            a.item.lowerName.localeCompare(b.item.lowerName)
    );

    return matches.slice(0, FUND_CANDIDATES).map(({ item }) => ({
        type: 'fund' as const,
        cik: item.cikDigits.padStart(10, '0'),
        name: item.filer.name,
    }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenize(value: string): string[] {
    return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

class FundTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FundTimeoutError(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
