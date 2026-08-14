/**
 * Live EDGAR lookup for Stock Search.
 * Uses SEC's EFTS full-text search to find 13F filers holding a specific stock.
 */

import { normalizeCik } from './thirteen-f-radar-core';

const SEC_USER_AGENT = 'ForensicFilingAssistant/1.0 (contact@example.com)';
const EFTS_BASE = 'https://efts.sec.gov/LATEST/search-index';
const RATE_LIMIT_DELAY = 120; // ms between requests (10 req/sec limit)

export interface EdgarHolderResult {
    cik: string;
    fundName: string;
    accessionNumber: string;
    filingDate: string;
    quarter: string;
    shares: number;
    value: number;
    source: 'efts';
}

interface EftsHit {
    _id: string;
    _source: {
        ciks?: string[];
        display_names?: string[];
        file_date?: string;
        form?: string;
        adsh?: string;
        period_ending?: string;
    };
}

interface EftsResponse {
    hits?: {
        hits?: EftsHit[];
        total?: { value?: number };
    };
}

/**
 * Search EDGAR EFTS for 13F filings mentioning the company name.
 * Returns a list of filers who have disclosed holdings in this company.
 */
export async function searchEdgarLiveHoldings(
    companyName: string,
    options: { maxResults?: number; quarters?: string[] } = {}
): Promise<EdgarHolderResult[]> {
    const { maxResults = 100 } = options;
    
    // Build search query - exact phrase match on company name
    const searchTerms = buildSearchTerms(companyName);
    const results: EdgarHolderResult[] = [];
    const seenCiks = new Set<string>();
    
    for (const term of searchTerms) {
        if (results.length >= maxResults) break;
        
        try {
            const hits = await queryEfts(term, maxResults - results.length);
            
            for (const hit of hits) {
                const cik = hit._source.ciks?.[0];
                if (!cik || seenCiks.has(cik)) continue;
                seenCiks.add(cik);
                
                const holder = parseEftsHit(hit);
                if (holder) results.push(holder);
            }
            
            // Rate limit
            await sleep(RATE_LIMIT_DELAY);
        } catch (error) {
            console.error(`[EDGAR Live] EFTS search failed for "${term}":`, error);
        }
    }
    
    return results;
}

async function queryEfts(searchTerm: string, size: number): Promise<EftsHit[]> {
    const params = new URLSearchParams({
        q: `"${searchTerm}"`,
        dateRange: 'custom',
        startdt: getRecentStartDate(),
        enddt: getTodayDate(),
        forms: '13F-HR,13F-HR/A',
        from: '0',
        size: String(Math.min(size, 100)),
    });
    
    const url = `${EFTS_BASE}?${params.toString()}`;
    console.log(`[EDGAR Live] Querying EFTS: ${searchTerm}`);
    
    const response = await fetch(url, {
        headers: {
            'User-Agent': SEC_USER_AGENT,
            'Accept': 'application/json',
        },
    });
    
    if (!response.ok) {
        throw new Error(`EFTS returned ${response.status}`);
    }
    
    const data = await response.json() as EftsResponse;
    return data.hits?.hits || [];
}

function parseEftsHit(hit: EftsHit): EdgarHolderResult | null {
    const src = hit._source;
    const cik = src.ciks?.[0];
    const fundName = src.display_names?.[0] || '';
    const accessionNumber = src.adsh?.replace(/-/g, '') || '';
    const filingDate = src.file_date || '';
    const periodEnding = src.period_ending || '';
    
    if (!cik || !accessionNumber) return null;
    
    // Derive quarter from period_ending (e.g., "2026-03-31" -> "2026-Q1")
    const quarter = periodEndingToQuarter(periodEnding);
    
    return {
        cik: normalizeCik(cik),
        fundName,
        accessionNumber,
        filingDate,
        quarter,
        shares: 0, // EFTS doesn't return share counts - would need XML parsing
        value: 0,  // EFTS doesn't return value - would need XML parsing
        source: 'efts',
    };
}

function buildSearchTerms(companyName: string): string[] {
    // Try multiple variations to maximize matches
    const normalized = companyName.toUpperCase().trim();
    const terms: string[] = [normalized];
    
    // Remove common suffixes and try again
    const withoutSuffix = normalized
        .replace(/\s+(INC|CORP|CO|LTD|LLC|LP|PLC|HOLDINGS?|GROUP|TECHNOLOGIES?|TECHNOLOGY)\.?$/i, '')
        .trim();
    
    if (withoutSuffix !== normalized && withoutSuffix.length > 3) {
        terms.push(withoutSuffix);
    }
    
    // First significant word only (for broad match)
    const firstWord = normalized.split(/\s+/)[0];
    if (firstWord.length > 4 && !['THE', 'AND', 'INC'].includes(firstWord)) {
        terms.push(firstWord);
    }
    
    return terms;
}

function periodEndingToQuarter(periodEnding: string): string {
    if (!periodEnding) return '';
    const match = periodEnding.match(/^(\d{4})-(\d{2})/);
    if (!match) return '';
    
    const year = match[1];
    const month = parseInt(match[2], 10);
    
    if (month <= 3) return `${year}-Q1`;
    if (month <= 6) return `${year}-Q2`;
    if (month <= 9) return `${year}-Q3`;
    return `${year}-Q4`;
}

function getRecentStartDate(): string {
    // Look back 9 months for recent 13F filings
    const date = new Date();
    date.setMonth(date.getMonth() - 9);
    return date.toISOString().slice(0, 10);
}

function getTodayDate(): string {
    return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}