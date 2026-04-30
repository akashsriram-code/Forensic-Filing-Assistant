import * as cheerio from 'cheerio';
import { fetchCIK, fetchFilingContent, fetchSubmission, generateSecUrl } from '@/lib/sec-client';

const MAX_RESULTS = 50;
const MAX_KEYWORD_SCAN_FILINGS = 30;
const MAX_SNIPPETS_PER_FILING = 3;
const SNIPPET_RADIUS = 90;

export interface FilingResult {
  accessionNumber: string;
  filingDate: string;
  form: string;
  size: number;
  primaryDocument: string;
  description: string;
  downloadUrl: string;
  companyQuery: string;
  companyName: string;
  companyTicker: string;
  companyCik: string;
  matchedKeywords: string[];
  matchCount: number;
  matchSnippets: string[];
}

export interface SearchFilingsInput {
  ticker?: string;
  entities?: string[];
  keywords?: string[];
  startDate?: string;
  endDate?: string;
  filingType?: string;
}

export interface SearchFilingsResponse {
  results: FilingResult[];
  warnings: string[];
  partial: boolean;
}

interface FilingTextMatch {
  matchedKeywords: string[];
  matchCount: number;
  matchSnippets: string[];
}

export function matchesFilingType(formType: string, filingType?: string) {
  if (!filingType || filingType === 'ALL') return true;

  if (filingType === '10-K') {
    return formType.includes('10-K') && !formType.startsWith('NT');
  }

  if (filingType === '10-Q') {
    return formType.includes('10-Q') && !formType.startsWith('NT');
  }

  if (filingType === '424B') {
    return formType.includes('424B');
  }

  return formType.includes(filingType);
}

export function parseDelimitedInput(input: string): string[] {
  return input
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function searchFilings({
  ticker,
  entities,
  keywords,
  startDate,
  endDate,
  filingType = 'ALL',
}: SearchFilingsInput): Promise<SearchFilingsResponse> {
  const normalizedEntities = dedupeValues([...(entities || []), ...(ticker ? [ticker] : [])]);
  if (normalizedEntities.length === 0) {
    throw new Error('At least one entity is required');
  }

  const normalizedKeywords = dedupeValues(keywords || []);
  const warnings: string[] = [];
  let partial = false;

  const entityResults = await Promise.allSettled(
    normalizedEntities.map((entity) => searchEntityFilings({
      entity,
      startDate,
      endDate,
      filingType,
    }))
  );

  const aggregated: FilingResult[] = [];

  for (const result of entityResults) {
    if (result.status === 'fulfilled') {
      aggregated.push(...result.value.results);
      warnings.push(...result.value.warnings);
    } else {
      partial = true;
      warnings.push(result.reason instanceof Error ? result.reason.message : 'Failed to search an entity');
    }
  }

  if (aggregated.length === 0) {
    if (warnings.length > 0) {
      throw new Error(warnings[0]);
    }
    throw new Error('No filings found');
  }

  let filtered = aggregated;
  if (normalizedKeywords.length > 0) {
    const keywordResult = await applyKeywordFilter(aggregated, normalizedKeywords);
    filtered = keywordResult.results;
    warnings.push(...keywordResult.warnings);
    partial = partial || keywordResult.partial;
  }

  const sorted = filtered
    .sort((a, b) => {
      const dateCompare = b.filingDate.localeCompare(a.filingDate);
      if (dateCompare !== 0) return dateCompare;

      const companyCompare = a.companyName.localeCompare(b.companyName);
      if (companyCompare !== 0) return companyCompare;

      return a.form.localeCompare(b.form);
    })
    .slice(0, MAX_RESULTS);

  if (sorted.length === 0) {
    return {
      results: [],
      warnings,
      partial,
    };
  }

  return {
    results: sorted,
    warnings: dedupeValues(warnings),
    partial,
  };
}

async function searchEntityFilings({
  entity,
  startDate,
  endDate,
  filingType,
}: {
  entity: string;
  startDate?: string;
  endDate?: string;
  filingType?: string;
}): Promise<{ results: FilingResult[]; warnings: string[] }> {
  const cik = await fetchCIK(entity);
  if (!cik) {
    throw new Error(`Entity not found: ${entity}`);
  }

  const submission = await fetchSubmission(cik);
  if (!submission) {
    throw new Error(`No filings found for ${entity}`);
  }

  const recent = submission.filings.recent;
  const results: FilingResult[] = [];
  const warnings: string[] = [];

  const start = startDate ? new Date(startDate).getTime() : 0;
  const end = endDate ? new Date(endDate).getTime() : Date.now();

  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const fDate = new Date(recent.filingDate[i]).getTime();
    const formType = recent.form[i];

    if (fDate < start || fDate > end) continue;
    if (!matchesFilingType(formType, filingType)) continue;

    results.push({
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      form: formType,
      size: recent.size[i],
      primaryDocument: recent.primaryDocument[i],
      description: recent.primaryDocDescription[i],
      downloadUrl: generateSecUrl(cik, recent.accessionNumber[i], recent.primaryDocument[i]),
      companyQuery: entity,
      companyName: submission.name || entity,
      companyTicker: submission.tickers?.[0] || entity.toUpperCase(),
      companyCik: cik,
      matchedKeywords: [],
      matchCount: 0,
      matchSnippets: [],
    });
  }

  if (results.length === 0) {
    warnings.push(`No ${filingType === 'ALL' ? '' : `${filingType} `}filings found for ${entity}`.trim());
  }

  return { results, warnings };
}

async function applyKeywordFilter(results: FilingResult[], keywords: string[]): Promise<SearchFilingsResponse> {
  const warnings: string[] = [];
  let partial = false;
  const limitedResults = results.slice(0, MAX_KEYWORD_SCAN_FILINGS);

  if (results.length > MAX_KEYWORD_SCAN_FILINGS) {
    partial = true;
    warnings.push(`Keyword search scanned the first ${MAX_KEYWORD_SCAN_FILINGS} filings only to keep the request responsive.`);
  }

  const matched = await Promise.all(
    limitedResults.map(async (result) => {
      try {
        const html = await fetchFilingContent(result.downloadUrl);
        if (!html) {
          warnings.push(`Could not read filing content for ${result.companyTicker} ${result.form} on ${result.filingDate}.`);
          partial = true;
          return null;
        }

        const filingText = extractSearchableText(html);
        const match = findKeywordMatches(filingText, keywords);
        if (!match) return null;

        return {
          ...result,
          matchedKeywords: match.matchedKeywords,
          matchCount: match.matchCount,
          matchSnippets: match.matchSnippets,
        };
      } catch {
        warnings.push(`Keyword search failed for ${result.companyTicker} ${result.form} on ${result.filingDate}.`);
        partial = true;
        return null;
      }
    })
  );

  return {
    results: matched.filter((value): value is FilingResult => value !== null),
    warnings: dedupeValues(warnings),
    partial,
  };
}

function extractSearchableText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

function findKeywordMatches(text: string, keywords: string[]): FilingTextMatch | null {
  const lowerText = text.toLowerCase();
  const matchedKeywords: string[] = [];
  const snippets: string[] = [];
  let totalMatches = 0;

  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    let startIndex = 0;
    let foundForKeyword = false;

    while (startIndex < lowerText.length) {
      const matchIndex = lowerText.indexOf(lowerKeyword, startIndex);
      if (matchIndex === -1) break;

      totalMatches += 1;
      foundForKeyword = true;

      if (snippets.length < MAX_SNIPPETS_PER_FILING) {
        snippets.push(buildSnippet(text, matchIndex, keyword.length));
      }

      startIndex = matchIndex + lowerKeyword.length;
    }

    if (foundForKeyword) {
      matchedKeywords.push(keyword);
    }
  }

  if (matchedKeywords.length === 0) {
    return null;
  }

  return {
    matchedKeywords,
    matchCount: totalMatches,
    matchSnippets: snippets,
  };
}

function buildSnippet(text: string, matchIndex: number, keywordLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + keywordLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function dedupeValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
