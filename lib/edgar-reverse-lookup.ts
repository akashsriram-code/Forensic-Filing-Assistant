/**
 * Live EDGAR lookup for Stock Search.
 * Uses SEC's EFTS full-text search to find 13F filers holding a specific stock.
 */

import { normalizeCik } from './thirteen-f-radar-core';

const SEC_USER_AGENT = 'ForensicFilingAssistant/1.0 (contact@example.com)';
const EFTS_BASE = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const RATE_LIMIT_DELAY = 120;
const MAX_CONCURRENT = 5;
const MAX_FILERS = 10;

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

export async function searchEdgarLiveHoldings(
    companyName: string,
    options: { maxResults?: number } = {}
): Promise<EdgarHolderResult[]> {
    const { maxResults = 100 } = options;
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
            await sleep(RATE_LIMIT_DELAY);
        } catch (error) {
            console.error(`[EDGAR] EFTS search failed for "${term}":`, error);
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
    console.log(`[EDGAR] Querying EFTS: ${searchTerm}`);
    const response = await fetch(url, {
        headers: { 'User-Agent': SEC_USER_AGENT, 'Accept': 'application/json' },
    });
    if (!response.ok) throw new Error(`EFTS returned ${response.status}`);
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
    return {
        cik: normalizeCik(cik),
        fundName,
        accessionNumber,
        filingDate,
        quarter: periodEndingToQuarter(periodEnding),
        shares: 0,
        value: 0,
        source: 'efts',
    };
}

export async function enrichHoldersWithXml(
    holders: EdgarHolderResult[],
    companyName: string
): Promise<EdgarHolderResult[]> {
    const batches = chunk(holders.slice(0, MAX_FILERS), MAX_CONCURRENT);
    const searchTerms = buildSearchTerms(companyName);
    console.log(`[EDGAR] Enriching ${holders.length} holders, terms: ${searchTerms.join(', ')}`);

    for (const batch of batches) {
        await Promise.all(batch.map(async (holder) => {
            try {
                const xml = await fetchInfoTableXml(holder.cik, holder.accessionNumber);
                if (!xml) return;
                const parsed = parseHoldingFromXml(xml, searchTerms);
                if (parsed) {
                    holder.shares = parsed.shares;
                    holder.value = parsed.value;
                }
            } catch (err) {
                console.error(`[EDGAR] Error enriching ${holder.cik}:`, err);
            }
        }));
        await sleep(RATE_LIMIT_DELAY);
    }
    return holders;
}

async function fetchInfoTableXml(cik: string, accession: string): Promise<string | null> {
    const accessionNoDashes = accession.replace(/-/g, '');
    const baseUrl = `${EDGAR_ARCHIVES}/${cik}/${accessionNoDashes}`;
    
    // Try common infotable filenames directly
    const filenames = ['infotable.xml', 'InfoTable.xml', 'information_table.xml', 'primary_doc.xml'];
    for (const filename of filenames) {
        try {
            const xml = await fetchWithRetry(`${baseUrl}/${filename}`);
            if (xml.includes('<infoTable') || xml.includes('<informationTable')) {
                return xml;
            }
        } catch {
            continue;
        }
    }
    
    // Fall back to fetching index and finding the XML link
    try {
        const accessionWithDashes = formatAccession(accession);
        const indexUrl = `${baseUrl}/${accessionWithDashes}-index.htm`;
        const indexHtml = await fetchWithRetry(indexUrl);
        const match = indexHtml.match(/href="([^"]*(?:infotable|information)[^"]*\.xml)"/i);
        if (match) {
            return await fetchWithRetry(`${baseUrl}/${match[1]}`);
        }
    } catch {
        // Index fetch failed
    }
    return null;
}

function formatAccession(acc: string): string {
    const clean = acc.replace(/-/g, '');
    if (clean.length === 18) {
        return `${clean.slice(0, 10)}-${clean.slice(10, 12)}-${clean.slice(12)}`;
    }
    return acc;
}

async function fetchWithRetry(url: string, retries = 1): Promise<string> {
    for (let i = 0; i <= retries; i++) {
        const res = await fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT } });
        if (res.ok) return res.text();
        if (i < retries) await sleep(RATE_LIMIT_DELAY);
    }
    throw new Error(`Failed: ${url}`);
}

function parseHoldingFromXml(xml: string, searchTerms: string[]): { shares: number; value: number } | null {
    let totalShares = 0;
    let totalValue = 0;
    let found = false;

    // Match infoTable entries (various namespace formats)
    const entryPattern = /<(?:ns1:)?infoTable[^>]*>([\s\S]*?)<\/(?:ns1:)?infoTable>/gi;
    let match;

    while ((match = entryPattern.exec(xml)) !== null) {
        const entry = match[1];
        const issuerMatch = entry.match(/<(?:ns1:)?nameOfIssuer>([^<]*)<\/(?:ns1:)?nameOfIssuer>/i);
        if (!issuerMatch) continue;

        const issuerName = issuerMatch[1].toUpperCase();
        if (!searchTerms.some(term => issuerName.includes(term))) continue;

        const valueMatch = entry.match(/<(?:ns1:)?value>(\d+)<\/(?:ns1:)?value>/i);
        const sharesMatch = entry.match(/<(?:ns1:)?sshPrnamt>(\d+)<\/(?:ns1:)?sshPrnamt>/i);

        totalValue += valueMatch ? parseInt(valueMatch[1], 10) * 1000 : 0;
        totalShares += sharesMatch ? parseInt(sharesMatch[1], 10) : 0;
        found = true;
    }

    return found ? { shares: totalShares, value: totalValue } : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
    return result;
}

function buildSearchTerms(companyName: string): string[] {
    const normalized = companyName.toUpperCase().trim();
    const terms: string[] = [normalized];
    const withoutSuffix = normalized
        .replace(/\s+(INC|CORP|CO|LTD|LLC|LP|PLC|HOLDINGS?|GROUP|TECHNOLOGIES?|TECHNOLOGY)\.?$/i, '')
        .trim();
    if (withoutSuffix !== normalized && withoutSuffix.length > 3) terms.push(withoutSuffix);
    const firstWord = normalized.split(/\s+/)[0];
    if (firstWord.length > 4 && !['THE', 'AND', 'INC'].includes(firstWord)) terms.push(firstWord);
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