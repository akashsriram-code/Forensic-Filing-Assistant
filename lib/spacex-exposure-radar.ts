import * as cheerio from 'cheerio';
import { parseStringPromise } from 'xml2js';

export type SpaceXRelationshipType =
    | 'direct_holding'
    | 'portfolio_schedule_holding'
    | 'commercial_context'
    | 'spv_or_fund_name'
    | 'ambiguous_review'
    | 'false_positive';

export type SpaceXVerificationStatus = 'not_requested' | 'verified' | 'review' | 'false_positive' | 'error';

export interface SpaceXExposureRequestBody {
    startDate?: unknown;
    endDate?: unknown;
    forms?: unknown;
    maxFilings?: unknown;
    aiVerify?: unknown;
}

export interface SpaceXExposureRow {
    filerName: string;
    cik: string;
    form: string;
    filingDate: string;
    periodEnd: string | null;
    accessionNumber: string;
    documentName: string;
    fileDescription: string | null;
    relationshipType: SpaceXRelationshipType;
    confidence: number;
    matchedTerms: string[];
    securityName: string | null;
    issuerName: string | null;
    cusip: string | null;
    sharesOrBalance: number | null;
    units: string | null;
    valueUsd: number | null;
    pctValue: number | null;
    assetCategory: string | null;
    issuerCategory: string | null;
    investmentCountry: string | null;
    snippet: string;
    secDocumentUrl: string;
    secFilingUrl: string;
    sourceType: 'sec_full_text' | 'source_document';
    openArenaStatus: SpaceXVerificationStatus;
    openArenaNotes: string;
    notes: string;
}

export interface SpaceXExposureSummary {
    totalRows: number;
    holdingRows: number;
    narrativeRows: number;
    reviewRows: number;
    falsePositiveRows: number;
    filingsSearched: number;
    filingsFetched: number;
    searchHitsDiscovered: number;
    openArenaReviewed: number;
}

export interface SpaceXExposureSourceCoverage {
    forms: Record<string, number>;
    filers: Record<string, number>;
}

export interface SpaceXExposureResponse {
    generatedAt: string;
    startDate: string;
    endDate: string;
    forms: string[];
    aliases: string[];
    contextualTerms: string[];
    summary: SpaceXExposureSummary;
    rows: SpaceXExposureRow[];
    reviewRows: SpaceXExposureRow[];
    warnings: string[];
    sourceCoverage: SpaceXExposureSourceCoverage;
}

interface SpaceXExposureRunOptions {
    fetchImpl?: typeof fetch;
    now?: Date;
    requestSpacingMs?: number;
}

interface SecSearchHit {
    cik: string;
    filerName: string;
    form: string;
    filingDate: string;
    periodEnd: string | null;
    accessionNumber: string;
    documentName: string;
    fileDescription: string | null;
    secDocumentUrl: string;
    secFilingUrl: string;
    matchedTerms: string[];
}

interface ParsedHoldingCandidate {
    relationshipType: SpaceXRelationshipType;
    confidence: number;
    matchedTerms: string[];
    securityName: string | null;
    issuerName: string | null;
    cusip: string | null;
    sharesOrBalance: number | null;
    units: string | null;
    valueUsd: number | null;
    pctValue: number | null;
    assetCategory: string | null;
    issuerCategory: string | null;
    investmentCountry: string | null;
    snippet: string;
    notes: string;
}

interface OpenArenaVerificationResult {
    relationshipType?: SpaceXRelationshipType;
    verificationStatus: Exclude<SpaceXVerificationStatus, 'not_requested'>;
    confidence?: number;
    notes: string;
    evidenceTerms: string[];
}

type JsonRecord = Record<string, unknown>;

const SEC_FULL_TEXT_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';
const SEC_ARCHIVES_BASE_URL = 'https://www.sec.gov/Archives/edgar/data';
const DEFAULT_MAX_DISCOVERY_HITS = 200;
const DEFAULT_MAX_FILINGS = 5;
const DEFAULT_HARD_MAX_FILINGS = 8;
const DEFAULT_OPENARENA_REVIEW_LIMIT = 3;
const DEFAULT_SEC_REQUEST_SPACING_MS = 120;
const DEFAULT_SEC_FETCH_CONCURRENCY = 3;
const SEC_SEARCH_PAGE_SIZE = 100;
const OPENARENA_PROMPT = `You are verifying SEC filing evidence about SpaceX exposure. You will receive compact JSON with filer metadata, filing form/date/accession, matched terms, deterministic parsed fields, snippets, and source URLs.

Classify whether the evidence shows an actual investment/portfolio holding in SpaceX or only a narrative/commercial/reference mention.

Allowed relationship_type values:
direct_holding, portfolio_schedule_holding, commercial_context, spv_or_fund_name, ambiguous_review, false_positive.

Rules:
- Do not invent facts, values, dates, securities, or ownership amounts.
- Do not overwrite SEC-parsed fields.
- Treat N-PORT/13F/security schedule rows with value/share/balance fields as stronger evidence than narrative snippets.
- Mark customer, supplier, launch, satellite, licensing, or contract references as commercial_context unless a portfolio/security holding is explicit.
- Return strict JSON only:
{
  "relationship_type": "...",
  "verification_status": "verified|review|false_positive",
  "confidence": 0-1,
  "notes": "...",
  "evidence_terms": ["..."]
}`;

export const SPACEX_ALIASES = [
    'SpaceX',
    'Space Exploration Technologies',
    'SPACE EXPLORATION TECH CORP',
    'SPACE EXPLORATION TECHNOLOGIES CORP',
] as const;

export const SPACEX_CONTEXTUAL_TERMS = ['Starlink'] as const;

export const DEFAULT_SPACEX_EXPOSURE_FORMS = [
    'NPORT-P',
    'N-PORT',
    'N-CSR',
    'N-CSRS',
    '13F-HR',
    '13F-HR/A',
    '8-K',
    '10-K',
    '10-Q',
    '20-F',
    '6-K',
    '497',
    '485BPOS',
    'N-2',
] as const;

const HOLDING_RELATIONSHIP_TYPES = new Set<SpaceXRelationshipType>([
    'direct_holding',
    'portfolio_schedule_holding',
]);

const REVIEW_RELATIONSHIP_TYPES = new Set<SpaceXRelationshipType>([
    'ambiguous_review',
    'spv_or_fund_name',
]);

const COMMERCIAL_CONTEXT_PATTERN = /\b(customer|supplier|contract|launch|satellite|license|licensing|agreement|service|services|network|terminal|antenna|rocket|payload|reseller|manufactur|partner|strategic relationship)\b/i;
const HOLDING_CONTEXT_PATTERN = /\b(portfolio|investment|security|securities|holding|holdings|schedule of investments|fair value|preferred|common stock|class [a-z]|shares|balance|cost|value|principal amount|units)\b/i;
const VALUE_CONTEXT_PATTERN = /(\$|usd|valusd|fair value|value|pctval|percent|shares|balance|units|cusip|\d{1,3}(,\d{3})+|\d+\.\d+)/i;
const FUND_CONTEXT_PATTERN = /\b(spv|fund|partners|capital|venture|private shares|select fund|growth fund|portfolio company)\b/i;

export function defaultSpaceXExposureStartDate(now = new Date()): string {
    return isoDate(addYears(now, -5));
}

export function defaultSpaceXExposureEndDate(now = new Date()): string {
    return isoDate(now);
}

export function normalizeSpaceXExposureRequest(
    body: SpaceXExposureRequestBody = {},
    now = new Date()
) {
    const startDate = normalizeDateInput(body.startDate, defaultSpaceXExposureStartDate(now));
    const endDate = normalizeDateInput(body.endDate, defaultSpaceXExposureEndDate(now));
    const forms = normalizeForms(body.forms);
    const requestedMaxFilings = parsePositiveInteger(body.maxFilings);
    const hardMaxFilings = getEnvInteger('SPACEX_EXPOSURE_HARD_MAX_FILINGS', DEFAULT_HARD_MAX_FILINGS);
    const configuredDefault = Math.min(getEnvInteger('SPACEX_EXPOSURE_MAX_FILINGS', DEFAULT_MAX_FILINGS), hardMaxFilings);
    const maxFilings = Math.min(requestedMaxFilings || configuredDefault, hardMaxFilings);
    const aiVerify = body.aiVerify === true || String(body.aiVerify).toLowerCase() === 'true';

    return {
        startDate,
        endDate,
        forms,
        maxFilings,
        requestedMaxFilings,
        hardMaxFilings,
        aiVerify,
        maxDiscoveryHits: getEnvInteger('SPACEX_EXPOSURE_MAX_DISCOVERY_HITS', DEFAULT_MAX_DISCOVERY_HITS),
    };
}

export async function runSpaceXExposureRadar(
    body: SpaceXExposureRequestBody = {},
    options: SpaceXExposureRunOptions = {}
): Promise<SpaceXExposureResponse> {
    const now = options.now || new Date();
    const request = normalizeSpaceXExposureRequest(body, now);
    const fetchImpl = options.fetchImpl || fetch;
    const warnings: string[] = [];
    if (request.requestedMaxFilings && request.requestedMaxFilings > request.maxFilings) {
        warnings.push(`Max filings was capped at ${request.maxFilings} for this synchronous deployment-safe run. Set SPACEX_EXPOSURE_HARD_MAX_FILINGS to raise the server cap.`);
    }
    const discoveredHits = await discoverSpaceXSearchHits(request, fetchImpl, warnings);
    const limitedHits = discoveredHits.slice(0, request.maxFilings);
    const rows: SpaceXExposureRow[] = [];
    let fetchedCount = 0;

    await mapWithConcurrency(limitedHits, getEnvInteger('SPACEX_EXPOSURE_FETCH_CONCURRENCY', DEFAULT_SEC_FETCH_CONCURRENCY), async (hit) => {
        try {
            await sleep(options.requestSpacingMs ?? getEnvInteger('SEC_REQUEST_SPACING_MS', DEFAULT_SEC_REQUEST_SPACING_MS));
            const content = await fetchTextWithRetry(hit.secDocumentUrl, fetchImpl);
            fetchedCount += 1;
            rows.push(...await buildRowsForHit(hit, content));
        } catch (error) {
            warnings.push(`Could not fetch ${hit.form} ${hit.accessionNumber} ${hit.documentName}: ${errorMessage(error)}`);
        }
    });

    const dedupedRows = dedupeExposureRows(rows);
    const openArenaReviewed = request.aiVerify
        ? await verifyAmbiguousRowsWithOpenArena(dedupedRows, fetchImpl, warnings)
        : 0;

    const sortedRows = sortExposureRows(dedupedRows);
    const summary = buildSpaceXExposureSummary({
        rows: sortedRows,
        filingsSearched: discoveredHits.length,
        filingsFetched: fetchedCount,
        searchHitsDiscovered: discoveredHits.length,
        openArenaReviewed,
    });

    return {
        generatedAt: now.toISOString(),
        startDate: request.startDate,
        endDate: request.endDate,
        forms: request.forms,
        aliases: [...SPACEX_ALIASES],
        contextualTerms: [...SPACEX_CONTEXTUAL_TERMS],
        summary,
        rows: sortedRows,
        reviewRows: sortedRows.filter((row) => isReviewRow(row)),
        warnings: dedupeStrings(warnings),
        sourceCoverage: buildSourceCoverage(sortedRows),
    };
}

export function buildSecFullTextSearchUrl(params: {
    query: string;
    forms: string[];
    startDate: string;
    endDate: string;
    from?: number;
}): string {
    const url = new URL(SEC_FULL_TEXT_SEARCH_URL);
    const secForms = normalizeFormsForSecFullText(params.forms);
    url.searchParams.set('q', params.query);
    if (secForms.length > 0) {
        url.searchParams.set('forms', secForms.join(','));
    }
    url.searchParams.set('startdt', params.startDate);
    url.searchParams.set('enddt', params.endDate);
    url.searchParams.set('from', String(params.from || 0));
    return url.toString();
}

export function normalizeFormsForSecFullText(forms: string[]): string[] {
    return dedupeStrings(forms
        .map((form) => form.trim().toUpperCase())
        .filter(Boolean)
        .map((form) => form.endsWith('/A') ? form.slice(0, -2) : form));
}

export function dedupeSecSearchHits(hits: SecSearchHit[]): SecSearchHit[] {
    const byDocument = new Map<string, SecSearchHit>();

    for (const hit of hits) {
        const key = `${hit.accessionNumber}|${hit.documentName}`;
        const existing = byDocument.get(key);
        if (existing) {
            existing.matchedTerms = dedupeStrings([...existing.matchedTerms, ...hit.matchedTerms]);
            continue;
        }
        byDocument.set(key, { ...hit, matchedTerms: dedupeStrings(hit.matchedTerms) });
    }

    return Array.from(byDocument.values()).sort((a, b) =>
        secSearchHitFetchRank(a) - secSearchHitFetchRank(b) ||
        b.filingDate.localeCompare(a.filingDate) ||
        a.filerName.localeCompare(b.filerName) ||
        a.documentName.localeCompare(b.documentName)
    );
}

function secSearchHitFetchRank(hit: SecSearchHit): number {
    const form = hit.form.toUpperCase();
    if (form.includes('NPORT') || form.includes('N-PORT')) return 0;
    if (form === 'N-CSR' || form === 'N-CSRS') return 1;
    if (form.startsWith('13F')) return 2;
    if (form === '497' || form === '485BPOS' || form === 'N-2') return 3;
    return 4;
}

export async function parseNPortXmlForSpaceX(content: string): Promise<ParsedHoldingCandidate[]> {
    const parsed = await parseXml(content);
    if (!parsed) return [];

    const globalFields = {
        registrantName: findFirstText(parsed, ['regName', 'registrantName']),
        seriesName: findFirstText(parsed, ['seriesName']),
    };
    const candidates: ParsedHoldingCandidate[] = [];
    for (const record of collectObjects(parsed)) {
        const name = firstText(record, ['name']);
        const title = firstText(record, ['title']);
        const joined = [name, title].filter(Boolean).join(' ');
        const matchedTerms = matchSpaceXTerms(joined);
        if (matchedTerms.length === 0) continue;
        if (!hasAnyKey(record, ['valUSD', 'balance', 'pctVal', 'assetCat'])) continue;

        const valueUsd = parseNumber(firstText(record, ['valUSD', 'valueUSD', 'value']));
        const balance = parseNumber(firstText(record, ['balance']));
        const pctValue = parseNumber(firstText(record, ['pctVal']));
        candidates.push({
            relationshipType: 'direct_holding',
            confidence: valueUsd !== null || balance !== null ? 0.96 : 0.86,
            matchedTerms,
            securityName: title || name || null,
            issuerName: name || title || null,
            cusip: normalizeNullable(firstText(record, ['cusip'])),
            sharesOrBalance: balance,
            units: normalizeNullable(firstText(record, ['units'])),
            valueUsd,
            pctValue,
            assetCategory: normalizeNullable(firstText(record, ['assetCat'])),
            issuerCategory: normalizeNullable(firstText(record, ['issuerCat'])),
            investmentCountry: normalizeNullable(firstText(record, ['invCountry', 'investmentCountry'])),
            snippet: buildCompactSnippet([
                globalFields.registrantName,
                globalFields.seriesName,
                name,
                title,
                valueUsd !== null ? `Value USD ${valueUsd}` : '',
                balance !== null ? `Balance ${balance}` : '',
            ].filter(Boolean).join(' | '), joined),
            notes: 'Parsed from Form N-PORT XML portfolio holding fields.',
        });
    }

    return candidates;
}

export async function parse13FXmlForSpaceX(content: string): Promise<ParsedHoldingCandidate[]> {
    const parsed = await parseXml(content);
    if (!parsed) return [];

    const candidates: ParsedHoldingCandidate[] = [];
    for (const record of collectObjects(parsed)) {
        const issuer = firstText(record, ['nameOfIssuer']);
        if (!issuer) continue;
        const title = firstText(record, ['titleOfClass']);
        const matchedTerms = matchSpaceXTerms([issuer, title].filter(Boolean).join(' '));
        if (matchedTerms.length === 0) continue;

        const reportedValue = parseNumber(firstText(record, ['value']));
        const shares = parseNumber(firstTextDeep(record, ['sshPrnamt', 'shares']));
        candidates.push({
            relationshipType: 'direct_holding',
            confidence: 0.9,
            matchedTerms,
            securityName: title || issuer,
            issuerName: issuer,
            cusip: normalizeNullable(firstText(record, ['cusip'])),
            sharesOrBalance: shares,
            units: normalizeNullable(firstTextDeep(record, ['sshPrnamtType'])),
            valueUsd: reportedValue === null ? null : reportedValue * 1000,
            pctValue: null,
            assetCategory: null,
            issuerCategory: null,
            investmentCountry: null,
            snippet: buildCompactSnippet(`${issuer} | ${title || ''} | CUSIP ${firstText(record, ['cusip']) || ''} | value ${reportedValue ?? ''}`, issuer),
            notes: 'Parsed from Form 13F information table; reported 13F value is normalized from thousands to dollars.',
        });
    }

    return candidates;
}

export function parseHtmlOrTextForSpaceX(content: string): ParsedHoldingCandidate[] {
    const text = extractSearchableText(content);
    const matchedTerms = matchSpaceXTerms(text, true);
    if (matchedTerms.length === 0) return [];

    const snippets = buildSnippets(text, matchedTerms, 4);
    const tableRows = extractMatchingTableRows(content);
    const candidates: ParsedHoldingCandidate[] = [];

    for (const rowText of tableRows) {
        const relationshipType = classifyNarrativeText(rowText);
        candidates.push({
            relationshipType,
            confidence: relationshipType === 'portfolio_schedule_holding' ? 0.74 : 0.55,
            matchedTerms: matchSpaceXTerms(rowText, true),
            securityName: inferSecurityName(rowText),
            issuerName: inferIssuerName(rowText),
            cusip: inferCusip(rowText),
            sharesOrBalance: null,
            units: null,
            valueUsd: inferMoney(rowText),
            pctValue: null,
            assetCategory: null,
            issuerCategory: null,
            investmentCountry: null,
            snippet: rowText,
            notes: relationshipType === 'portfolio_schedule_holding'
                ? 'Matched a source table row with holding/value context.'
                : 'Matched a source table row, but holding status needs review.',
        });
    }

    if (candidates.length === 0) {
        const relationshipType = classifyNarrativeText(snippets.join(' '));
        candidates.push({
            relationshipType,
            confidence: relationshipType === 'commercial_context' ? 0.62 : 0.5,
            matchedTerms,
            securityName: null,
            issuerName: null,
            cusip: null,
            sharesOrBalance: null,
            units: null,
            valueUsd: null,
            pctValue: null,
            assetCategory: null,
            issuerCategory: null,
            investmentCountry: null,
            snippet: snippets[0] || '',
            notes: relationshipType === 'commercial_context'
                ? 'Narrative mention appears commercial or operational rather than a portfolio holding.'
                : 'Narrative mention requires manual or OpenArena review.',
        });
    }

    return candidates;
}

export function buildSpaceXExposureWorkbookRows(response: SpaceXExposureResponse) {
    const holdings = response.rows.filter((row) => HOLDING_RELATIONSHIP_TYPES.has(row.relationshipType));
    const narrative = response.rows.filter((row) =>
        row.relationshipType === 'commercial_context' ||
        row.relationshipType === 'spv_or_fund_name' ||
        row.relationshipType === 'ambiguous_review'
    );
    const thirteenF = response.rows.filter((row) => row.form.startsWith('13F'));
    const openArena = response.rows.filter((row) => row.openArenaStatus !== 'not_requested');

    return { holdings, narrative, thirteenF, openArena };
}

async function discoverSpaceXSearchHits(
    request: ReturnType<typeof normalizeSpaceXExposureRequest>,
    fetchImpl: typeof fetch,
    warnings: string[]
): Promise<SecSearchHit[]> {
    const hits: SecSearchHit[] = [];
    const queries = [...SPACEX_ALIASES];
    const targetHits = Math.min(
        request.maxDiscoveryHits,
        Math.max(SEC_SEARCH_PAGE_SIZE, request.maxFilings * 5)
    );
    for (const query of queries) {
        for (let from = 0; from < targetHits; from += SEC_SEARCH_PAGE_SIZE) {
            const url = buildSecFullTextSearchUrl({
                query: query.includes(' ') ? `"${query}"` : query,
                forms: request.forms,
                startDate: request.startDate,
                endDate: request.endDate,
                from,
            });
            try {
                const json = await fetchJsonWithRetry<JsonRecord>(url, fetchImpl);
                const pageHits = parseSearchHits(json, query);
                hits.push(...pageHits);
                const total = readSearchTotal(json);
                if (pageHits.length < SEC_SEARCH_PAGE_SIZE || from + SEC_SEARCH_PAGE_SIZE >= total || from + SEC_SEARCH_PAGE_SIZE >= targetHits) break;
            } catch (error) {
                warnings.push(`SEC full-text search failed for ${query}: ${errorMessage(error)}`);
                break;
            }
        }
    }

    return dedupeSecSearchHits(hits).slice(0, targetHits);
}

function parseSearchHits(json: unknown, matchedTerm: string): SecSearchHit[] {
    if (!json || typeof json !== 'object') return [];
    const hitsContainer = (json as JsonRecord).hits;
    if (!hitsContainer || typeof hitsContainer !== 'object') return [];
    const rawHits = (hitsContainer as JsonRecord).hits;
    if (!Array.isArray(rawHits)) return [];

    return rawHits.flatMap((rawHit) => {
        if (!rawHit || typeof rawHit !== 'object') return [];
        const hitRecord = rawHit as JsonRecord;
        const source = hitRecord._source;
        if (!source || typeof source !== 'object') return [];
        const sourceRecord = source as JsonRecord;
        const accessionNumber = stringValue(sourceRecord.adsh);
        const documentName = parseDocumentName(stringValue(hitRecord._id), accessionNumber);
        const cik = arrayStringValue(sourceRecord.ciks, 0);
        if (!accessionNumber || !documentName || !cik) return [];

        return [{
            cik: normalizeCik(cik),
            filerName: parseFilerName(arrayStringValue(sourceRecord.display_names, 0)),
            form: stringValue(sourceRecord.form) || arrayStringValue(sourceRecord.root_forms, 0),
            filingDate: stringValue(sourceRecord.file_date),
            periodEnd: normalizeNullable(stringValue(sourceRecord.period_ending)),
            accessionNumber,
            documentName,
            fileDescription: normalizeNullable(stringValue(sourceRecord.file_description) || stringValue(sourceRecord.file_type)),
            secDocumentUrl: buildSecDocumentUrl(cik, accessionNumber, documentName),
            secFilingUrl: buildSecFilingUrl(cik, accessionNumber),
            matchedTerms: [matchedTerm],
        }];
    });
}

function readSearchTotal(json: unknown): number {
    if (!json || typeof json !== 'object') return 0;
    const hits = (json as JsonRecord).hits;
    if (!hits || typeof hits !== 'object') return 0;
    const total = (hits as JsonRecord).total;
    if (typeof total === 'number') return total;
    if (total && typeof total === 'object') {
        const value = (total as JsonRecord).value;
        if (typeof value === 'number') return value;
    }
    return 0;
}

async function buildRowsForHit(hit: SecSearchHit, content: string): Promise<SpaceXExposureRow[]> {
    const lowerDocument = hit.documentName.toLowerCase();
    const candidates = lowerDocument.endsWith('.xml') || content.trim().startsWith('<')
        ? await parseStructuredXmlCandidates(hit, content)
        : parseHtmlOrTextForSpaceX(content);
    const fallbackCandidates = candidates.length > 0 ? candidates : parseHtmlOrTextForSpaceX(content);

    return fallbackCandidates.map((candidate) => ({
        filerName: hit.filerName,
        cik: hit.cik,
        form: hit.form,
        filingDate: hit.filingDate,
        periodEnd: hit.periodEnd,
        accessionNumber: hit.accessionNumber,
        documentName: hit.documentName,
        fileDescription: hit.fileDescription,
        relationshipType: candidate.relationshipType,
        confidence: candidate.confidence,
        matchedTerms: dedupeStrings([...hit.matchedTerms, ...candidate.matchedTerms]),
        securityName: candidate.securityName,
        issuerName: candidate.issuerName,
        cusip: candidate.cusip,
        sharesOrBalance: candidate.sharesOrBalance,
        units: candidate.units,
        valueUsd: candidate.valueUsd,
        pctValue: candidate.pctValue,
        assetCategory: candidate.assetCategory,
        issuerCategory: candidate.issuerCategory,
        investmentCountry: candidate.investmentCountry,
        snippet: candidate.snippet,
        secDocumentUrl: hit.secDocumentUrl,
        secFilingUrl: hit.secFilingUrl,
        sourceType: 'source_document',
        openArenaStatus: 'not_requested',
        openArenaNotes: '',
        notes: candidate.notes,
    }));
}

async function parseStructuredXmlCandidates(hit: SecSearchHit, content: string): Promise<ParsedHoldingCandidate[]> {
    const form = hit.form.toUpperCase();
    if (form.includes('NPORT') || form.includes('N-PORT')) {
        const nport = await parseNPortXmlForSpaceX(content);
        if (nport.length > 0) return nport;
    }
    if (form.startsWith('13F')) {
        const thirteenF = await parse13FXmlForSpaceX(content);
        if (thirteenF.length > 0) return thirteenF;
    }

    return parseHtmlOrTextForSpaceX(content);
}

async function verifyAmbiguousRowsWithOpenArena(
    rows: SpaceXExposureRow[],
    fetchImpl: typeof fetch,
    warnings: string[]
): Promise<number> {
    const token = process.env.OPENARENA_BEARER_TOKEN;
    const workflowId =
        process.env.OPENARENA_SPACEX_EXPOSURE_WORKFLOW_ID ||
        process.env.OPENARENA_FORMD_WORKFLOW_ID ||
        '6218d1c2-b197-44ca-95df-6a279e5b5f25';

    if (!token) {
        warnings.push('OpenArena verification was requested but OPENARENA_BEARER_TOKEN is not set.');
        return 0;
    }

    const ambiguousRows = rows.filter((row) =>
        row.relationshipType === 'ambiguous_review' ||
        (row.relationshipType === 'portfolio_schedule_holding' && row.confidence < 0.8)
    );
    const reviewLimit = getEnvInteger('OPENARENA_SPACEX_EXPOSURE_REVIEW_LIMIT', DEFAULT_OPENARENA_REVIEW_LIMIT);
    if (ambiguousRows.length > reviewLimit) {
        warnings.push(`OpenArena verification was capped at ${reviewLimit} ambiguous row(s) for this synchronous run.`);
    }
    let reviewed = 0;

    for (const row of ambiguousRows.slice(0, reviewLimit)) {
        try {
            const result = await callOpenArenaVerification(row, workflowId, token, fetchImpl);
            reviewed += 1;
            row.openArenaStatus = result.verificationStatus;
            row.openArenaNotes = result.notes;
            if (result.relationshipType && result.verificationStatus !== 'false_positive') {
                row.relationshipType = result.relationshipType;
            }
            if (typeof result.confidence === 'number') {
                row.confidence = Math.max(0, Math.min(1, result.confidence));
            }
            row.matchedTerms = dedupeStrings([...row.matchedTerms, ...result.evidenceTerms]);
        } catch (error) {
            row.openArenaStatus = 'error';
            row.openArenaNotes = errorMessage(error);
            warnings.push(`OpenArena verification failed for ${row.accessionNumber}: ${errorMessage(error)}`);
        }
    }

    return reviewed;
}

async function callOpenArenaVerification(
    row: SpaceXExposureRow,
    workflowId: string,
    token: string,
    fetchImpl: typeof fetch
): Promise<OpenArenaVerificationResult> {
    const apiUrl = process.env.OPENARENA_API_URL || `https://api.openarena.ai/v1/workflows/${workflowId}/runs`;
    const response = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            workflow_id: workflowId,
            prompt: OPENARENA_PROMPT,
            input: compactOpenArenaFacts(row),
        }),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    return parseOpenArenaResponse(json);
}

function compactOpenArenaFacts(row: SpaceXExposureRow) {
    return {
        filer_name: row.filerName,
        cik: row.cik,
        form: row.form,
        filing_date: row.filingDate,
        accession_number: row.accessionNumber,
        document_name: row.documentName,
        deterministic_relationship_type: row.relationshipType,
        deterministic_confidence: row.confidence,
        matched_terms: row.matchedTerms,
        security_name: row.securityName,
        issuer_name: row.issuerName,
        cusip: row.cusip,
        shares_or_balance: row.sharesOrBalance,
        units: row.units,
        value_usd: row.valueUsd,
        pct_value: row.pctValue,
        snippet: row.snippet,
        sec_document_url: row.secDocumentUrl,
        sec_filing_url: row.secFilingUrl,
    };
}

function parseOpenArenaResponse(value: unknown): OpenArenaVerificationResult {
    const record = extractJsonRecord(value);
    const relationshipType = parseRelationshipType(stringValue(record.relationship_type || record.relationshipType));
    const rawStatus = stringValue(record.verification_status || record.verificationStatus).toLowerCase();
    const verificationStatus: OpenArenaVerificationResult['verificationStatus'] =
        rawStatus === 'verified' || rawStatus === 'false_positive' || rawStatus === 'review'
            ? rawStatus
            : 'review';
    const confidence = typeof record.confidence === 'number'
        ? record.confidence
        : parseNumber(stringValue(record.confidence)) ?? undefined;
    const evidenceTerms = Array.isArray(record.evidence_terms)
        ? record.evidence_terms.map((item) => stringValue(item)).filter(Boolean)
        : [];

    return {
        relationshipType,
        verificationStatus,
        confidence,
        notes: stringValue(record.notes),
        evidenceTerms,
    };
}

function extractJsonRecord(value: unknown): JsonRecord {
    if (value && typeof value === 'object') {
        const record = value as JsonRecord;
        const direct = normalizeJsonRecord(record);
        if (direct) return direct;
        for (const key of ['output', 'result', 'response', 'data']) {
            const nested = record[key];
            const parsed = normalizeJsonRecord(nested);
            if (parsed) return parsed;
        }
    }

    const asText = typeof value === 'string' ? value : JSON.stringify(value || {});
    const jsonMatch = asText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed && typeof parsed === 'object' ? parsed as JsonRecord : {};
    } catch {
        return {};
    }
}

function normalizeJsonRecord(value: unknown): JsonRecord | null {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : null;
        } catch {
            return null;
        }
    }
    return null;
}

function buildSpaceXExposureSummary(params: {
    rows: SpaceXExposureRow[];
    filingsSearched: number;
    filingsFetched: number;
    searchHitsDiscovered: number;
    openArenaReviewed: number;
}): SpaceXExposureSummary {
    const { rows } = params;
    return {
        totalRows: rows.length,
        holdingRows: rows.filter((row) => HOLDING_RELATIONSHIP_TYPES.has(row.relationshipType)).length,
        narrativeRows: rows.filter((row) => row.relationshipType === 'commercial_context').length,
        reviewRows: rows.filter((row) => isReviewRow(row)).length,
        falsePositiveRows: rows.filter((row) => row.relationshipType === 'false_positive').length,
        filingsSearched: params.filingsSearched,
        filingsFetched: params.filingsFetched,
        searchHitsDiscovered: params.searchHitsDiscovered,
        openArenaReviewed: params.openArenaReviewed,
    };
}

function buildSourceCoverage(rows: SpaceXExposureRow[]): SpaceXExposureSourceCoverage {
    const forms: Record<string, number> = {};
    const filers: Record<string, number> = {};
    for (const row of rows) {
        forms[row.form || 'Unknown'] = (forms[row.form || 'Unknown'] || 0) + 1;
        filers[row.filerName || row.cik || 'Unknown'] = (filers[row.filerName || row.cik || 'Unknown'] || 0) + 1;
    }
    return { forms: sortCountRecord(forms), filers: sortCountRecord(filers) };
}

function sortCountRecord(record: Record<string, number>): Record<string, number> {
    return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function isReviewRow(row: SpaceXExposureRow) {
    return REVIEW_RELATIONSHIP_TYPES.has(row.relationshipType) || row.openArenaStatus === 'review' || row.openArenaStatus === 'error';
}

function sortExposureRows(rows: SpaceXExposureRow[]): SpaceXExposureRow[] {
    const relationshipRank: Record<SpaceXRelationshipType, number> = {
        direct_holding: 0,
        portfolio_schedule_holding: 1,
        ambiguous_review: 2,
        spv_or_fund_name: 3,
        commercial_context: 4,
        false_positive: 5,
    };

    return [...rows].sort((a, b) =>
        relationshipRank[a.relationshipType] - relationshipRank[b.relationshipType] ||
        b.filingDate.localeCompare(a.filingDate) ||
        b.confidence - a.confidence ||
        a.filerName.localeCompare(b.filerName)
    );
}

function dedupeExposureRows(rows: SpaceXExposureRow[]): SpaceXExposureRow[] {
    const byEvidence = new Map<string, SpaceXExposureRow>();
    for (const row of rows) {
        const key = [
            row.accessionNumber,
            row.documentName,
            row.relationshipType,
            row.securityName || row.issuerName || row.snippet.slice(0, 90),
        ].join('|');
        const existing = byEvidence.get(key);
        if (existing) {
            existing.matchedTerms = dedupeStrings([...existing.matchedTerms, ...row.matchedTerms]);
            existing.confidence = Math.max(existing.confidence, row.confidence);
            continue;
        }
        byEvidence.set(key, { ...row });
    }
    return Array.from(byEvidence.values());
}

function classifyNarrativeText(text: string): SpaceXRelationshipType {
    if (!containsPrimarySpaceXTerm(text) && containsContextualTerm(text)) return 'commercial_context';
    if (HOLDING_CONTEXT_PATTERN.test(text) && VALUE_CONTEXT_PATTERN.test(text)) return 'portfolio_schedule_holding';
    if (COMMERCIAL_CONTEXT_PATTERN.test(text)) return 'commercial_context';
    if (FUND_CONTEXT_PATTERN.test(text)) return 'spv_or_fund_name';
    return 'ambiguous_review';
}

function extractMatchingTableRows(content: string): string[] {
    const $ = cheerio.load(content);
    const rows: string[] = [];
    $('tr').each((_, element) => {
        const rowText = $(element).text().replace(/\s+/g, ' ').trim();
        if (rowText.length > 30 && matchSpaceXTerms(rowText, true).length > 0) {
            rows.push(rowText.slice(0, 1000));
        }
    });
    return dedupeStrings(rows).slice(0, 8);
}

function extractSearchableText(content: string): string {
    if (/<[a-z][\s\S]*>/i.test(content)) {
        const $ = cheerio.load(content);
        $('script, style, noscript').remove();
        return $.text().replace(/\s+/g, ' ').trim();
    }
    return content.replace(/\s+/g, ' ').trim();
}

function buildSnippets(text: string, terms: string[], limit: number): string[] {
    const lowerText = text.toLowerCase();
    const snippets: string[] = [];
    for (const term of terms) {
        const lowerTerm = term.toLowerCase();
        let startIndex = 0;
        while (snippets.length < limit) {
            const matchIndex = lowerText.indexOf(lowerTerm, startIndex);
            if (matchIndex === -1) break;
            snippets.push(buildCompactSnippet(text, text.slice(matchIndex, matchIndex + term.length)));
            startIndex = matchIndex + lowerTerm.length;
        }
    }
    return dedupeStrings(snippets);
}

function buildCompactSnippet(text: string, needle: string): string {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const cleanNeedle = needle.trim();
    const index = cleanNeedle ? cleanText.toLowerCase().indexOf(cleanNeedle.toLowerCase()) : -1;
    if (index === -1) return cleanText.slice(0, 360);
    const start = Math.max(0, index - 150);
    const end = Math.min(cleanText.length, index + cleanNeedle.length + 180);
    return `${start > 0 ? '...' : ''}${cleanText.slice(start, end)}${end < cleanText.length ? '...' : ''}`;
}

function matchSpaceXTerms(value: string, includeContextual = false): string[] {
    const normalized = normalizeText(value);
    const terms: string[] = SPACEX_ALIASES.filter((alias) => normalized.includes(normalizeText(alias)));
    if (includeContextual) {
        for (const term of SPACEX_CONTEXTUAL_TERMS) {
            if (normalized.includes(normalizeText(term))) terms.push(term);
        }
    }
    return dedupeStrings(terms);
}

function containsPrimarySpaceXTerm(value: string): boolean {
    return matchSpaceXTerms(value).length > 0;
}

function containsContextualTerm(value: string): boolean {
    const normalized = normalizeText(value);
    return SPACEX_CONTEXTUAL_TERMS.some((term) => normalized.includes(normalizeText(term)));
}

function inferSecurityName(text: string): string | null {
    const matched = SPACEX_ALIASES.find((alias) => normalizeText(text).includes(normalizeText(alias)));
    return matched || null;
}

function inferIssuerName(text: string): string | null {
    return inferSecurityName(text);
}

function inferCusip(text: string): string | null {
    const match = text.match(/\b[0-9A-Z]{9}\b/);
    if (!match || match[0] === '000000000') return match?.[0] || null;
    return match[0];
}

function inferMoney(text: string): number | null {
    const moneyMatch = text.match(/\$\s?([0-9][0-9,]*(?:\.\d+)?)/);
    if (!moneyMatch) return null;
    return parseNumber(moneyMatch[1]);
}

async function parseXml(content: string): Promise<unknown | null> {
    try {
        return await parseStringPromise(content, {
            explicitArray: false,
            trim: true,
            mergeAttrs: true,
            tagNameProcessors: [(name) => name.split(':').pop() || name],
        });
    } catch {
        return null;
    }
}

function collectObjects(value: unknown): JsonRecord[] {
    const records: JsonRecord[] = [];
    const visit = (node: unknown) => {
        if (Array.isArray(node)) {
            for (const item of node) visit(item);
            return;
        }
        if (!node || typeof node !== 'object') return;
        const record = node as JsonRecord;
        records.push(record);
        for (const child of Object.values(record)) visit(child);
    };
    visit(value);
    return records;
}

function findFirstText(value: unknown, keys: string[]): string | null {
    for (const record of collectObjects(value)) {
        const found = firstText(record, keys);
        if (found) return found;
    }
    return null;
}

function firstText(record: JsonRecord, keys: string[]): string | null {
    for (const key of keys) {
        const value = record[key];
        const text = nodeText(value);
        if (text) return text;
    }
    return null;
}

function firstTextDeep(record: JsonRecord, keys: string[]): string | null {
    for (const nested of collectObjects(record)) {
        const text = firstText(nested, keys);
        if (text) return text;
    }
    return null;
}

function hasAnyKey(record: JsonRecord, keys: string[]): boolean {
    return keys.some((key) => record[key] !== undefined && record[key] !== null);
}

function nodeText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const text = String(value).trim();
        return text || null;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = nodeText(item);
            if (text) return text;
        }
    }
    if (typeof value === 'object') {
        const record = value as JsonRecord;
        for (const key of ['_', '#text', 'text']) {
            const text = nodeText(record[key]);
            if (text) return text;
        }
    }
    return null;
}

async function fetchJsonWithRetry<T>(url: string, fetchImpl: typeof fetch, attempts = 3): Promise<T> {
    const text = await fetchTextWithRetry(url, fetchImpl, attempts, 'application/json');
    return JSON.parse(text) as T;
}

async function fetchTextWithRetry(
    url: string,
    fetchImpl: typeof fetch,
    attempts = 3,
    accept = '*/*'
): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetchImpl(url, {
                headers: {
                    'User-Agent': process.env.SEC_USER_AGENT || 'ForensicAnalyzer contact@example.com',
                    'Accept': accept,
                },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            lastError = error;
            if (attempt < attempts) await sleep(250 * attempt);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
) {
    let nextIndex = 0;
    const runWorker = async () => {
        while (nextIndex < items.length) {
            const item = items[nextIndex];
            nextIndex += 1;
            await worker(item);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, runWorker));
}

function buildSecDocumentUrl(cik: string, accessionNumber: string, documentName: string): string {
    return `${SEC_ARCHIVES_BASE_URL}/${normalizeCikPath(cik)}/${accessionNumber.replace(/-/g, '')}/${documentName}`;
}

function buildSecFilingUrl(cik: string, accessionNumber: string): string {
    return `${SEC_ARCHIVES_BASE_URL}/${normalizeCikPath(cik)}/${accessionNumber.replace(/-/g, '')}/${accessionNumber}-index.html`;
}

function parseDocumentName(id: string, accessionNumber: string): string {
    const prefix = `${accessionNumber}:`;
    if (id.startsWith(prefix)) return id.slice(prefix.length);
    const parts = id.split(':');
    return parts.length > 1 ? parts.slice(1).join(':') : '';
}

function parseFilerName(displayName: string): string {
    return displayName.replace(/\s+\(CIK\s+\d+\).*$/i, '').trim() || displayName;
}

function parseRelationshipType(value: string): SpaceXRelationshipType | undefined {
    const allowed: SpaceXRelationshipType[] = [
        'direct_holding',
        'portfolio_schedule_holding',
        'commercial_context',
        'spv_or_fund_name',
        'ambiguous_review',
        'false_positive',
    ];
    return allowed.includes(value as SpaceXRelationshipType) ? value as SpaceXRelationshipType : undefined;
}

function normalizeForms(value: unknown): string[] {
    if (!Array.isArray(value)) return [...DEFAULT_SPACEX_EXPOSURE_FORMS];
    const parsed = value
        .map((item) => stringValue(item).trim().toUpperCase())
        .filter(Boolean);
    return parsed.length > 0 ? dedupeStrings(parsed) : [...DEFAULT_SPACEX_EXPOSURE_FORMS];
}

function normalizeDateInput(value: unknown, fallback: string): string {
    const text = stringValue(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function parsePositiveInteger(value: unknown): number | null {
    const parsed = Number.parseInt(stringValue(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getEnvInteger(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseNumber(value: string | null | undefined): number | null {
    if (!value) return null;
    const normalized = value.replace(/[$,%]/g, '').replace(/,/g, '').trim();
    if (!normalized || /^n\/?a$/i.test(normalized)) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCik(cik: string): string {
    return cik.replace(/\D/g, '').replace(/^0+/, '') || cik;
}

function normalizeCikPath(cik: string): string {
    return normalizeCik(cik);
}

function normalizeText(value: string): string {
    return value.toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeNullable(value: string | null | undefined): string | null {
    const text = (value || '').trim();
    return text ? text : null;
}

function stringValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
}

function arrayStringValue(value: unknown, index: number): string {
    if (Array.isArray(value)) return stringValue(value[index]);
    return index === 0 ? stringValue(value) : '';
}

function dedupeStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function addYears(date: Date, years: number): Date {
    const next = new Date(date);
    next.setFullYear(next.getFullYear() + years);
    return next;
}

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function sleep(ms: number) {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
