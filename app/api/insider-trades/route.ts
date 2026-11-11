import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK, fetchFilingContent } from '@/lib/sec-client';
import { primaryDocUrl } from '@/lib/sec-urls';
import { byFilingDateDesc, loadSubmission, rawXmlDocument, recentFilings } from '@/lib/edgar-submissions';
import { SEC_MIN_REQUEST_INTERVAL_MS, mapWithConcurrency } from '@/lib/concurrency';
import {
    applyAmendments,
    parseForm4Transactions,
    sortTransactionsNewestFirst,
    subtractMonths,
    summarizeInsiderTrades,
    type InsiderTransaction,
} from '@/lib/form4';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Form 4 filings from the last LOOKBACK_MONTHS months are read, newest first, at most MAX_FILINGS of them. */
const LOOKBACK_MONTHS = 12;
const MAX_FILINGS = 40;
const FETCH_CONCURRENCY = 4;
/** The summary (open-market buys vs sells, cluster) covers the last SUMMARY_MONTHS months. */
const SUMMARY_MONTHS = 6;

/**
 * POST { id } — id is a ticker, company name or CIK.
 * Returns { cik, companyName, ticker, from, to, filingsChecked, transactions[], summary, warnings[] }.
 */
export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Send a JSON body like {"id": "NVDA"}.' }, { status: 400 });
    }
    const rawId = (body as { id?: unknown })?.id;
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId).trim() : '';
    if (!id) return NextResponse.json({ error: 'Enter a ticker or CIK.' }, { status: 400 });

    try {
        const cik = await fetchCIK(id);
        if (!cik) return NextResponse.json({ error: `No company found for “${id}”. Try the ticker or CIK.` }, { status: 404 });

        const loaded = await loadSubmission(cik);
        if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
        const submission = loaded.submission;

        const to = new Date().toISOString().slice(0, 10);
        const from = subtractMonths(to, LOOKBACK_MONTHS);
        const matching = recentFilings(submission)
            .filter((f) => (f.form === '4' || f.form === '4/A') && f.filingDate >= from)
            .sort(byFilingDateDesc);
        const filings = matching.slice(0, MAX_FILINGS);

        const warnings: string[] = [];
        if (matching.length > filings.length) {
            warnings.push(
                `Only the newest ${filings.length} of ${matching.length} Form 4 filings from the last ${LOOKBACK_MONTHS} months were read, so older trades in that period are missing (from ${filings[filings.length - 1].filingDate} back).`
            );
        }

        let unreadable = 0;
        const perFiling = await mapWithConcurrency(filings, FETCH_CONCURRENCY, async (filing): Promise<InsiderTransaction[]> => {
            // The listed primary document is the rendered view (xslF345X05/doc.xml); the raw XML drops the xsl folder.
            const xmlUrl = primaryDocUrl(cik, filing.accessionNumber, rawXmlDocument(filing.primaryDocument));
            const xml = xmlUrl ? await fetchFilingContent(xmlUrl) : null;
            const transactions = xml
                ? await parseForm4Transactions(xml, {
                      cik,
                      accessionNumber: filing.accessionNumber,
                      filingDate: filing.filingDate,
                      form: filing.form,
                      primaryDocument: filing.primaryDocument,
                  })
                : null;
            if (!transactions) {
                unreadable++;
                return [];
            }
            return transactions;
        }, { minIntervalMs: SEC_MIN_REQUEST_INTERVAL_MS });

        if (filings.length > 0 && unreadable === filings.length) {
            return NextResponse.json({ error: 'Couldn’t read any of the Form 4 filings from EDGAR. Try again in a minute.' }, { status: 502 });
        }
        if (unreadable > 0) warnings.push(`${unreadable} of ${filings.length} Form 4 filings couldn’t be read from EDGAR and are missing.`);

        const amended = applyAmendments(perFiling.flat());
        if (amended.replaced > 0) {
            warnings.push(`${amended.replaced} transaction(s) from original Form 4s were replaced by later amendments (4/A) and counted once.`);
        }
        const transactions = sortTransactionsNewestFirst(amended.transactions);
        const summary = summarizeInsiderTrades(transactions, { to, months: SUMMARY_MONTHS });
        // When the cap cut the list short, filings are only complete from the oldest one read.
        const coveredFrom = matching.length > filings.length ? filings[filings.length - 1].filingDate : from;
        if (coveredFrom > summary.from) {
            warnings.push(
                `The ${SUMMARY_MONTHS}-month summary is incomplete: only filings from ${coveredFrom} onward were read, not from ${summary.from}.`
            );
        }

        return NextResponse.json({
            cik,
            companyName: submission.name,
            ticker: submission.tickers?.[0] ?? null,
            from,
            to,
            coveredFrom,
            filingsChecked: filings.length,
            transactions,
            summary,
            warnings,
        });
    } catch (error) {
        console.error('[InsiderTrades] Error:', error);
        const message = error instanceof Error && error.message ? error.message : 'Something went wrong reading EDGAR.';
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
