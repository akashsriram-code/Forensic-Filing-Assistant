import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK, fetchFilingContent } from '@/lib/sec-client';
import { parseSC13D, type Sc13DReportingPerson } from '@/lib/sc13d-parser';
import { isActivistForm } from '@/lib/sec-forms';
import { filingIndexUrl, formatAccession, primaryDocUrl } from '@/lib/sec-urls';
import { byFilingDateDesc, loadSubmission, rawXmlDocument, recentFilings } from '@/lib/edgar-submissions';
import { SEC_MIN_REQUEST_INTERVAL_MS, mapWithConcurrency } from '@/lib/concurrency';

export const dynamic = 'force-dynamic'; // Prevent caching of filings
export const maxDuration = 60;

/** How many of the newest filings are opened and read; the rest are listed with their links only. */
const PARSE_LIMIT = 8;
const PARSE_CONCURRENCY = 3;

interface ActivistFilingResponse {
    form: string;
    /** CIK of the EDGAR record searched (the filing's archive folder lives under it). */
    cik: string;
    accessionNumber: string;
    filingDate: string;
    reportDate: string;
    primaryDocument: string;
    description: string;
    /** The filing as EDGAR renders it (readable in a browser). */
    url: string;
    /** The filing index page: the link to cite. */
    indexUrl: string | null;
    /** True when this filing was opened and read; false for older filings listed without details. */
    parsed: boolean;
    reportingPerson?: string;
    percentClass?: string;
    shares?: string;
    purpose?: string;
    reportingPersons?: Sc13DReportingPerson[];
    /** The company whose shares the stake is in, when the filing states it (structured filings). */
    subjectCompany?: string | null;
    subjectCik?: string | null;
}

export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Send a JSON body like {"ticker": "TSLA"}.' }, { status: 400 });
    }
    const ticker = typeof (body as { ticker?: unknown })?.ticker === 'string' ? (body as { ticker: string }).ticker.trim() : '';
    if (!ticker) {
        return NextResponse.json({ error: 'Enter a ticker, company or fund name, or CIK.' }, { status: 400 });
    }

    try {
        const cik = await fetchCIK(ticker);
        if (!cik) {
            return NextResponse.json({ error: `No company or fund found for “${ticker}”. Try the ticker or CIK.` }, { status: 404 });
        }

        const loaded = await loadSubmission(cik);
        if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
        const submission = loaded.submission;

        // Both form names: "SC 13D" before December 2024, "SCHEDULE 13D" (structured XML) after. Newest first,
        // before choosing which to read, so the parsed ones really are the newest.
        const matches = recentFilings(submission).filter((f) => isActivistForm(f.form)).sort(byFilingDateDesc);
        const warnings: string[] = [];

        const listed = matches.map((filing): ActivistFilingResponse => {
            const accessionNumber = formatAccession(filing.accessionNumber);
            return {
                form: filing.form,
                cik,
                accessionNumber,
                filingDate: filing.filingDate,
                reportDate: filing.reportDate,
                primaryDocument: filing.primaryDocument,
                description: filing.primaryDocDescription,
                url: primaryDocUrl(cik, accessionNumber, filing.primaryDocument) ?? '',
                indexUrl: filingIndexUrl(cik, accessionNumber),
                parsed: false,
            };
        });

        const readFiling = async (base: ActivistFilingResponse): Promise<ActivistFilingResponse> => {
            const { accessionNumber, url } = base;
            if (!url) return base;

            // Structured filings list the rendered view (xslSCHEDULE_13D_X02/primary_doc.xml); read the raw XML instead.
            const rawUrl = primaryDocUrl(cik, accessionNumber, rawXmlDocument(base.primaryDocument)) ?? url;
            const content = await fetchFilingContent(rawUrl);
            if (!content) {
                warnings.push(`Couldn’t open ${base.form} ${accessionNumber} filed ${base.filingDate}; its details weren’t read.`);
                return base;
            }
            try {
                const parsed = parseSC13D(content);
                return {
                    ...base,
                    parsed: true,
                    reportingPerson: parsed.reportingPerson,
                    percentClass: parsed.percentClass,
                    shares: parsed.shares,
                    purpose: parsed.purpose,
                    ...(parsed.reportingPersons ? { reportingPersons: parsed.reportingPersons } : {}),
                    ...(parsed.issuerName !== undefined ? { subjectCompany: parsed.issuerName, subjectCik: parsed.issuerCik ?? null } : {}),
                };
            } catch (error) {
                console.error(`[WhaleActivist] Failed to parse ${rawUrl}:`, error);
                warnings.push(`Couldn’t read the details of ${base.form} ${accessionNumber}.`);
                return base;
            }
        };

        // Only the newest PARSE_LIMIT are opened; older ones are listed with their links.
        const parsedNewest = await mapWithConcurrency(listed.slice(0, PARSE_LIMIT), PARSE_CONCURRENCY, readFiling, {
            minIntervalMs: SEC_MIN_REQUEST_INTERVAL_MS,
        });
        const filings = [...parsedNewest, ...listed.slice(PARSE_LIMIT)];

        return NextResponse.json({
            ticker,
            cik,
            companyName: submission.name,
            parsedCount: filings.filter((f) => f.parsed).length,
            filings,
            warnings,
        });
    } catch (error) {
        console.error('[WhaleActivist] Error:', error);
        const message = error instanceof Error && error.message ? error.message : 'Something went wrong reading EDGAR.';
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
