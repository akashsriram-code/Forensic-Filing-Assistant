import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fetchRecentIpoFilings, resolvePrimaryDocument, type IpoFiling } from '@/lib/ipo-scraper';
import { fetchFilingContent } from '@/lib/sec-client';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DATA_FILE = path.join(process.cwd(), 'data', 'ipo_filings.json');
const DEFAULT_OPENARENA_BASE_URL = 'https://aiopenarena.thomsonreuters.com';
const DEFAULT_OPENARENA_IPO_WORKFLOW_ID = 'c994c878-6dc4-482b-a711-9016ec373db';
const DEFAULT_OPENARENA_TIMEOUT_SECONDS = 45;
const DEFAULT_DIRECT_CONTEXT_CHARS = 70_000;

class OpenArenaError extends Error {
    constructor(
        public url: string,
        public status: number | null,
        public detail: string
    ) {
        super(`OpenArena POST ${url} failed with ${status ?? 'unknown'}: ${detail}`);
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const accessionNumber = typeof body.accessionNumber === 'string' ? body.accessionNumber.trim() : '';

        if (!accessionNumber) {
            return NextResponse.json({ error: 'accessionNumber is required' }, { status: 400 });
        }

        const bearerToken = process.env.OPENARENA_BEARER_TOKEN?.trim();
        if (!bearerToken) {
            return NextResponse.json({ error: 'Server missing OPENARENA_BEARER_TOKEN.' }, { status: 500 });
        }

        const workflowId = process.env.OPENARENA_IPO_WORKFLOW_ID?.trim() || DEFAULT_OPENARENA_IPO_WORKFLOW_ID;
        const baseUrl = process.env.OPENARENA_BASE_URL?.trim() || DEFAULT_OPENARENA_BASE_URL;
        const timeoutSeconds = resolveTimeoutSeconds();

        const filing = await findIpoFiling(accessionNumber);
        if (!filing) {
            return NextResponse.json({ error: `No recent IPO filing found for ${accessionNumber}.` }, { status: 404 });
        }

        const primaryDocumentUrl = await resolveAnalysisDocumentUrl(filing);
        const analysisFiling = { ...filing, reportUrl: primaryDocumentUrl };
        const html = await fetchFilingContent(primaryDocumentUrl);
        if (!html) {
            return NextResponse.json({ error: 'Could not fetch the SEC filing text.' }, { status: 502 });
        }

        const filingText = cleanFilingText(html);
        if (!filingText) {
            return NextResponse.json({ error: 'Could not extract readable text from the SEC filing.' }, { status: 422 });
        }

        const inferencePayload = await buildInferencePayload({
            analysisFiling,
            baseUrl,
            bearerToken,
            filingText,
            timeoutSeconds,
            workflowId,
        });
        const modelParams = buildModelParams();
        if (modelParams) {
            inferencePayload.modelparams = modelParams;
        }

        const responseJson = await callOpenArenaInferenceWithRetries({
            baseUrl,
            bearerToken,
            payload: inferencePayload,
            timeoutSeconds,
        });

        const rawAnswer = extractOpenArenaAnswer(responseJson);
        if (!rawAnswer) {
            return NextResponse.json({ error: 'OpenArena returned an empty answer.' }, { status: 502 });
        }

        const parsed = parseOpenArenaReport(rawAnswer);

        return NextResponse.json({
            filing: analysisFiling,
            workflowId,
            report: parsed.report,
            rawAnswer,
            warning: parsed.warning,
        });
    } catch (error) {
        console.error('[IPO Analysis] Error:', error);
        const message = error instanceof Error ? error.message : 'IPO analysis failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

function readIpoFilings(): IpoFiling[] {
    if (!fs.existsSync(DATA_FILE)) return [];

    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as IpoFiling[];
    } catch (error) {
        console.error('[IPO Analysis] Failed to read IPO cache:', error);
        return [];
    }
}

async function findIpoFiling(accessionNumber: string): Promise<IpoFiling | null> {
    const cached = readIpoFilings().find((item) => item.accessionNumber === accessionNumber);
    if (cached) return cached;

    const { startDate, endDate } = getRecentFeedWindow();
    const liveFilings = await fetchRecentIpoFilings(startDate, endDate);
    return liveFilings.find((item) => item.accessionNumber === accessionNumber) || null;
}

function getRecentFeedWindow() {
    const lookbackDays = Number.parseInt(process.env.IPO_FEED_LOOKBACK_DAYS || '30', 10);
    const days = Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 30;
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);

    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
    };
}

async function resolveAnalysisDocumentUrl(filing: IpoFiling) {
    const resolvedUrl = await resolvePrimaryDocument(filing);
    return resolvedUrl || filing.reportUrl;
}

function resolveTimeoutSeconds() {
    const raw = Number.parseInt(
        process.env.OPENARENA_IPO_TIMEOUT_SECONDS || process.env.OPENARENA_TIMEOUT_SECONDS || '',
        10
    );
    const requested = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OPENARENA_TIMEOUT_SECONDS;
    const maxRaw = Number.parseInt(process.env.OPENARENA_IPO_MAX_TIMEOUT_SECONDS || '', 10);
    const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : DEFAULT_OPENARENA_TIMEOUT_SECONDS;
    return Math.min(requested, max);
}

function cleanFilingText(html: string) {
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
}

function buildUploadFilename(filing: IpoFiling) {
    const company = filing.companyName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ipo-filing';
    return `${filing.filingDate}-${company}-${filing.accessionNumber}.html`;
}

function buildUploadHtml(filing: IpoFiling, filingText: string) {
    const metadata = [
        `Company: ${filing.companyName}`,
        `Form: ${filing.form}`,
        `Filing date: ${filing.filingDate}`,
        `CIK: ${filing.cik}`,
        `Accession number: ${filing.accessionNumber}`,
        `SEC URL: ${filing.reportUrl}`,
        filing.offeringType ? `Offering type: ${filing.offeringType}` : '',
        filing.pricing?.proposedSymbol ? `Proposed symbol: ${filing.pricing.proposedSymbol}` : '',
        filing.pricing?.exchange ? `Exchange: ${filing.pricing.exchange}` : '',
        filing.pricing?.priceRange ? `Price range: ${filing.pricing.priceRange}` : '',
        filing.pricing?.dealSize ? `Deal size: ${filing.pricing.dealSize}` : '',
        filing.pricing?.estimatedValuation ? `Estimated valuation: ${filing.pricing.estimatedValuation}` : '',
    ].filter(Boolean);

    return [
        '<!doctype html>',
        '<html>',
        '<head><meta charset="utf-8"><title>IPO Filing Upload</title></head>',
        '<body>',
        '<h1>IPO Filing Metadata</h1>',
        `<pre>${escapeHtml(metadata.join('\n'))}</pre>`,
        '<h1>Cleaned Filing Text</h1>',
        `<pre>${escapeHtml(filingText)}</pre>`,
        '</body>',
        '</html>',
    ].join('');
}

async function buildInferencePayload({
    analysisFiling,
    baseUrl,
    bearerToken,
    filingText,
    timeoutSeconds,
    workflowId,
}: {
    analysisFiling: IpoFiling;
    baseUrl: string;
    bearerToken: string;
    filingText: string;
    timeoutSeconds: number;
    workflowId: string;
}): Promise<Record<string, unknown>> {
    const mode = (process.env.OPENARENA_IPO_ANALYSIS_MODE || 'direct').trim().toLowerCase();

    if (mode === 'upload') {
        const fileName = buildUploadFilename(analysisFiling);
        const uploadHtml = buildUploadHtml(analysisFiling, filingText);
        const fileUuid = await uploadFilingToOpenArena({
            baseUrl,
            bearerToken,
            workflowId,
            timeoutSeconds,
            fileName,
            uploadHtml,
        });

        return {
            workflow_id: workflowId,
            query: buildIpoIntelligencePrompt(analysisFiling),
            is_persistence_allowed: false,
            input_variables: {},
            conversation_id: null,
            context: {
                input_type: 'file_uuid',
                value: [fileUuid],
            },
        };
    }

    return {
        workflow_id: workflowId,
        query: buildIpoIntelligencePrompt(analysisFiling, buildDirectFilingContext(filingText)),
        is_persistence_allowed: false,
        input_variables: {},
        conversation_id: null,
    };
}

function buildDirectFilingContext(filingText: string) {
    const maxChars = resolveDirectContextChars();
    if (filingText.length <= maxChars) return filingText;

    const normalized = filingText.replace(/\s+/g, ' ').trim();
    const chunks: Array<{ label: string; start: number; end: number }> = [];

    pushChunk(chunks, 'opening summary and offering front matter', 0, Math.min(22_000, normalized.length));

    const needles = [
        'prospectus summary',
        'the offering',
        'risk factors',
        'summary risk factors',
        'use of proceeds',
        'dividend policy',
        'capitalization',
        'dilution',
        'selected consolidated financial data',
        'management discussion and analysis',
        'business',
        'customers',
        'suppliers',
        'competition',
        'regulation',
        'management',
        'executive compensation',
        'principal stockholders',
        'related party transactions',
        'certain relationships',
        'material weakness',
        'going concern',
        'underwriting',
    ];
    const lower = normalized.toLowerCase();

    for (const needle of needles) {
        const index = lower.indexOf(needle);
        if (index === -1) continue;
        pushChunk(chunks, needle, Math.max(0, index - 2_000), Math.min(normalized.length, index + 7_000));
    }

    let output = '';
    for (const chunk of chunks) {
        const next = [
            `--- Filing context: ${chunk.label} ---`,
            normalized.slice(chunk.start, chunk.end),
        ].join('\n');
        if (output.length + next.length + 2 > maxChars) break;
        output += `${output ? '\n\n' : ''}${next}`;
    }

    return output || normalized.slice(0, maxChars);
}

function pushChunk(chunks: Array<{ label: string; start: number; end: number }>, label: string, start: number, end: number) {
    if (end <= start) return;
    const overlaps = chunks.some((chunk) => start < chunk.end && end > chunk.start);
    if (!overlaps) chunks.push({ label, start, end });
}

function resolveDirectContextChars() {
    const raw = Number.parseInt(process.env.OPENARENA_IPO_DIRECT_CONTEXT_CHARS || '', 10);
    return Number.isFinite(raw) && raw > 10_000 ? raw : DEFAULT_DIRECT_CONTEXT_CHARS;
}

async function uploadFilingToOpenArena({
    baseUrl,
    bearerToken,
    workflowId,
    timeoutSeconds,
    fileName,
    uploadHtml,
}: {
    baseUrl: string;
    bearerToken: string;
    workflowId: string;
    timeoutSeconds: number;
    fileName: string;
    uploadHtml: string;
}) {
    const uploadPayload = await postOpenArenaJson<Record<string, unknown>>({
        url: `${baseUrl.replace(/\/$/, '')}/v3/document/file_upload`,
        bearerToken,
        timeoutSeconds,
        payload: {
            files_names: [
                {
                    file_name: fileName,
                    file_id: fileName,
                },
            ],
            is_rag_storage_request: false,
            workflow_id: workflowId,
        },
    });

    const uploadUrls = Array.isArray(uploadPayload.url) ? uploadPayload.url : [];
    const uploadItem = uploadUrls[0] as { url?: { url?: string; fields?: Record<string, string>; file_name?: string } } | undefined;
    const nestedUrl = uploadItem?.url;
    const targetUrl = nestedUrl?.url;
    const fields = nestedUrl?.fields;
    const returnedFileName = nestedUrl?.file_name || fileName;

    if (!targetUrl || !fields) {
        throw new Error('OpenArena upload URL response was missing upload fields.');
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        formData.append(key, String(value));
    }
    formData.append('file', new Blob([uploadHtml], { type: 'text/html;charset=utf-8' }), returnedFileName);

    const uploadResponse = await fetchWithTimeout(targetUrl, { method: 'POST', body: formData }, timeoutSeconds);
    if (!uploadResponse.ok) {
        const detail = await uploadResponse.text();
        throw new Error(`OpenArena file upload failed with ${uploadResponse.status}: ${detail || uploadResponse.statusText}`);
    }

    const parsePayload = await postOpenArenaJson<Record<string, unknown>>({
        url: `${baseUrl.replace(/\/$/, '')}/v1/document/file_parsing`,
        bearerToken,
        timeoutSeconds,
        payload: {
            workflow_id: workflowId,
            presigned_url: {
                url: targetUrl,
                fields,
                file_name: returnedFileName,
            },
        },
    });

    const fileUuid = stringValue(parsePayload.file_uuid)
        || stringValue((parsePayload.file_parse as Record<string, unknown> | undefined)?.file_uuid);

    if (!fileUuid) {
        throw new Error('OpenArena parsing response did not include file_uuid.');
    }

    return fileUuid;
}

async function callOpenArenaInferenceWithRetries({
    baseUrl,
    bearerToken,
    payload,
    timeoutSeconds,
}: {
    baseUrl: string;
    bearerToken: string;
    payload: Record<string, unknown>;
    timeoutSeconds: number;
}) {
    const url = `${baseUrl.replace(/\/$/, '')}/v3/inference`;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await postOpenArenaJson<Record<string, unknown>>({
                url,
                bearerToken,
                timeoutSeconds,
                payload,
            });
        } catch (error) {
            const openArenaError = error instanceof OpenArenaError ? error : null;
            const shouldRetry = openArenaError?.status === 504 && attempt < maxAttempts;
            if (!shouldRetry) throw error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
        }
    }

    throw new Error('OpenArena inference retry loop exited unexpectedly.');
}

async function postOpenArenaJson<T>({
    url,
    bearerToken,
    payload,
    timeoutSeconds,
}: {
    url: string;
    bearerToken: string;
    payload: Record<string, unknown>;
    timeoutSeconds: number;
}): Promise<T> {
    const response = await fetchWithTimeout(
        url,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${bearerToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        },
        timeoutSeconds
    );

    const text = await response.text();
    if (!response.ok) {
        throw new OpenArenaError(url, response.status, text || response.statusText);
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`OpenArena returned malformed JSON from ${url}.`);
    }
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutSeconds: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeoutSeconds} seconds: ${input}`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function buildModelParams(): Record<string, unknown> | null {
    const raw = process.env.OPENARENA_IPO_MODELPARAMS_JSON?.trim();
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Expected a JSON object.');
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Invalid JSON.';
        throw new Error(`OPENARENA_IPO_MODELPARAMS_JSON must be a valid JSON object: ${detail}`);
    }
}

function buildIpoIntelligencePrompt(filing: IpoFiling, filingContext?: string) {
    return `
You are an investigative IPO filing analyst.

Read the provided S-1, S-1/A, F-1, or F-1/A filing material and produce a useful, reportable, story-driven analyst report.

Do not limit yourself to oddities. Surface any detail that could help a journalist, analyst, investor, or researcher understand the company's story, risks, incentives, business quality, market positioning, or IPO structure.

Include curious or unusual details, useful business and financial facts, reportable claims or metrics, boilerplate risk factors when they are relevant, and details that could become article angles, diligence questions, or follow-up research threads.

Filing metadata:
Company: ${filing.companyName}
Form: ${filing.form}
Filing date: ${filing.filingDate}
CIK: ${filing.cik}
Accession number: ${filing.accessionNumber}
SEC URL: ${filing.reportUrl}

${filingContext ? `Filing context:\n${filingContext}\n` : 'Use the uploaded filing document as the source text.\n'}

Return strictly valid JSON with this exact shape:
{
  "quickTake": "Concise 4-6 sentence summary of the company, the offering, and the main storylines.",
  "mostReportableFindings": [
    {
      "title": "Short headline",
      "whyItMatters": "Why this is useful, reportable, or story-generating.",
      "filingEvidence": "Quote or close paraphrase from the filing.",
      "sectionSource": "Filing section/source if available",
      "angleType": "Business Model | Financial | Risk Factor | Governance | Insider | Offering Structure | Market Claim | Customer/Supplier | Legal/Regulatory | Oddity",
      "reportabilityScore": 1,
      "followUpQuestion": "Concrete question to investigate next."
    }
  ],
  "riskFactorReadout": [
    {
      "title": "Risk factor theme",
      "whyItMatters": "Explain why it matters in this company's context, including meaningful boilerplate.",
      "filingEvidence": "Quote or close paraphrase.",
      "sectionSource": "Risk Factors"
    }
  ],
  "financialAndOfferingNotes": [
    {
      "title": "Financial or offering point",
      "note": "Useful number, structure, proceeds, dilution, insider selling, cash need, or valuation clue.",
      "filingEvidence": "Quote or close paraphrase.",
      "sectionSource": "Section/source if available"
    }
  ],
  "bestStoryAngles": [
    {
      "headline": "Article-style angle",
      "whyItWorks": "Why the angle is compelling and reportable.",
      "evidence": "Filing-backed evidence."
    }
  ],
  "followUpDiligenceQuestions": ["Specific question a reporter or analyst should investigate next."],
  "plainEnglishVerdict": "This filing is interesting because..."
}

Rules:
- Do not hallucinate.
- Use filing evidence for every major claim.
- Preserve exact numbers, dates, percentages, share counts, dollar amounts, names, and quoted phrases when available.
- Do not dismiss boilerplate automatically; explain whether it is generic, meaningful, or unusually important here.
- If the filing is mundane, still extract the most useful reportable facts.
- Return JSON only. Do not wrap the JSON in Markdown.
`.trim();
}

function extractOpenArenaAnswer(payload: Record<string, unknown>) {
    const result = payload.result as Record<string, unknown> | undefined;
    const answer = result?.answer;

    if (typeof answer === 'string') return answer.trim();
    if (answer && typeof answer === 'object') {
        for (const value of Object.values(answer as Record<string, unknown>)) {
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
    }

    const fallbackAnswer = payload.answer;
    return typeof fallbackAnswer === 'string' ? fallbackAnswer.trim() : '';
}

function parseOpenArenaReport(rawAnswer: string): { report: unknown | null; warning?: string } {
    const candidates = [
        rawAnswer.trim(),
        stripJsonFence(rawAnswer.trim()),
        extractJsonObject(rawAnswer),
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            return { report: JSON.parse(candidate) };
        } catch {
            // Try the next candidate.
        }
    }

    return {
        report: null,
        warning: 'OpenArena returned text that could not be parsed as structured JSON.',
    };
}

function stripJsonFence(value: string) {
    const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match?.[1]?.trim() || '';
}

function extractJsonObject(value: string) {
    const first = value.indexOf('{');
    const last = value.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return '';
    return value.slice(first, last + 1).trim();
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
