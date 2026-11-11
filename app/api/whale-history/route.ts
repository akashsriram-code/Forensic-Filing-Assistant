import { NextRequest, NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { SEC_USER_AGENT } from '@/lib/sec-http';
import { fetchCIK, fetchFilingContent, parse13F } from '@/lib/sec-client';
import { buildSecAccessionFolderUrl, filingIndexUrl, formatAccession, primaryDocUrl } from '@/lib/sec-urls';
import { byFilingDateDesc, loadSubmission, recentFilings, type RecentFiling } from '@/lib/edgar-submissions';
import { SEC_MIN_REQUEST_INTERVAL_MS, mapWithConcurrency } from '@/lib/concurrency';

export const maxDuration = 60; // Allow longer timeout for multiple fetches

/** How many of the fund's newest original 13F-HR filings to read. */
const FILING_LIMIT = 8;
const FETCH_CONCURRENCY = 4;

/**
 * One quarter of the position. `value` is exactly as reported in that filing's information table: whole dollars for
 * filings made on or after 2023-01-03, thousands of dollars before (SEC rule change). The client converts by filing
 * date (historyPointFromApi in app/components/whale/model.ts).
 */
interface HistoryPointResponse {
    /** Filing date (kept as `date` for existing callers). */
    date: string;
    filingDate: string;
    /** Period of report (quarter end), YYYY-MM-DD, when EDGAR lists it. */
    reportDate: string | null;
    accessionNumber: string;
    form: string;
    /** Filing index page on sec.gov: the link to cite. */
    url: string | null;
    shares: number;
    value: number;
}

interface InfoTableRow {
    nameOfIssuer?: string[];
    cusip?: string[];
    value?: string[];
    shrsOrPrnAmt?: { sshPrnamt?: string[]; sshPrnamtType?: string[] }[];
}

type Parsed13F = {
    informationTable?: { infoTable?: InfoTableRow[] } | { infoTable?: InfoTableRow[] }[];
    edgarSubmission?: unknown;
} | null;

interface IndexItem {
    name?: string;
    type?: string;
}

function first<T>(value: T | T[] | undefined): T | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/** Holdings rows from a parsed 13F information table (either a bare informationTable or one inside edgarSubmission). */
function infoTableRows(parsed: Parsed13F): InfoTableRow[] {
    const iRoot = first(parsed?.informationTable);
    if (iRoot?.infoTable) return iRoot.infoTable;
    const sRoot = first(parsed?.edgarSubmission as { formData?: { informationTable?: { infoTable?: InfoTableRow[] }[] }[] } | undefined);
    return sRoot?.formData?.[0]?.informationTable?.[0]?.infoTable || [];
}

const normalizeCusip = (value: unknown) => String(value ?? '').trim().toUpperCase();
/** "Apple Inc." and "APPLE INC" compare equal. */
const normalizeIssuer = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

const numberOf = (value: string | undefined) => {
    const n = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};

/** Reads the filing's information table: the XML the filing index labels as such, else the primary document. */
async function readInfoTable(cik: string, filing: RecentFiling): Promise<InfoTableRow[] | null> {
    const folder = buildSecAccessionFolderUrl(cik, filing.accessionNumber);
    if (!folder) return null;
    try {
        const indexRes = await fetchWithTimeout(`${folder}index.json`, { headers: { 'User-Agent': SEC_USER_AGENT }, next: { revalidate: 86400 } }, 15000);
        if (indexRes.ok) {
            const indexData = (await indexRes.json()) as { directory?: { item?: IndexItem[] } };
            const items = indexData.directory?.item || [];
            const primaryName = filing.primaryDocument.split('/').pop();
            const infoTableFile =
                items.find((item) => item.type?.toUpperCase().includes('INFORMATION TABLE')) ||
                items.find((item) => {
                    const name = (item.name || '').toLowerCase();
                    return name.endsWith('.xml') && name.includes('info');
                }) ||
                items.find((item) => {
                    const name = (item.name || '').toLowerCase();
                    return name.endsWith('.xml') && item.name !== primaryName && !name.includes('primary_doc') && !name.includes('xsl') && !name.includes('xsd');
                });
            if (infoTableFile?.name) {
                const url = primaryDocUrl(cik, filing.accessionNumber, infoTableFile.name);
                const content = url ? await fetchFilingContent(url) : null;
                const rows = content ? infoTableRows((await parse13F(content)) as Parsed13F) : [];
                if (rows.length > 0) return rows;
            }
        }
    } catch (error) {
        console.error(`[WhaleHistory] Couldn’t read the index for ${filing.accessionNumber}:`, error);
    }

    // Older filings may carry the table in the primary document itself.
    const primaryUrl = primaryDocUrl(cik, filing.accessionNumber, filing.primaryDocument);
    const content = primaryUrl ? await fetchFilingContent(primaryUrl) : null;
    if (!content) return null;
    return infoTableRows((await parse13F(content)) as Parsed13F);
}

export async function POST(req: NextRequest) {
    let body: { ticker?: unknown; holdingInfo?: { issuer?: unknown; cusip?: unknown } };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Send a JSON body with ticker and holdingInfo.' }, { status: 400 });
    }
    const ticker = typeof body?.ticker === 'string' ? body.ticker.trim() : '';
    const issuer = typeof body?.holdingInfo?.issuer === 'string' ? body.holdingInfo.issuer.trim() : '';
    const targetCusip = normalizeCusip(body?.holdingInfo?.cusip);
    if (!ticker || (!issuer && !targetCusip)) {
        return NextResponse.json({ error: 'Missing the fund (ticker) or the holding (issuer or CUSIP).' }, { status: 400 });
    }

    // A CUSIP identifies one security exactly, so when we have one it is the only thing matched. The issuer name is a
    // fallback for the rare holding without a CUSIP, and must match the whole name, not just a word of it.
    const matchedBy: 'cusip' | 'name' = targetCusip ? 'cusip' : 'name';
    const targetName = normalizeIssuer(issuer);

    try {
        const cik = await fetchCIK(ticker);
        if (!cik) return NextResponse.json({ error: `No fund found for “${ticker}”.` }, { status: 404 });

        const loaded = await loadSubmission(cik);
        if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

        // Original 13F-HR reports only (amendments would double-count or partly restate a quarter).
        const filings = recentFilings(loaded.submission)
            .filter((f) => f.form === '13F-HR')
            .sort(byFilingDateDesc)
            .slice(0, FILING_LIMIT);

        let skippedStubs = 0;
        let unreadable = 0;
        const points = await mapWithConcurrency(filings, FETCH_CONCURRENCY, async (filing): Promise<HistoryPointResponse | null> => {
            const rows = await readInfoTable(cik, filing);
            if (rows === null) {
                unreadable++;
                return null;
            }
            // A filing with no holdings or no reported value is a placeholder (e.g. a confidential-treatment stub),
            // not a sign the fund sold out, so it is left out rather than plotted as "not held".
            const totalValue = rows.reduce((sum, r) => sum + numberOf(r.value?.[0]), 0);
            if (rows.length === 0 || totalValue <= 0) {
                skippedStubs++;
                return null;
            }

            const matches = rows.filter((r) =>
                matchedBy === 'cusip' ? normalizeCusip(r.cusip?.[0]) === targetCusip : normalizeIssuer(r.nameOfIssuer?.[0]) === targetName
            );

            // Shares and principal rows only; option rows (calls/puts) are reported separately and aren't summed.
            let shares = 0;
            let value = 0;
            for (const m of matches) {
                const type = (m.shrsOrPrnAmt?.[0]?.sshPrnamtType?.[0] || 'SH').toUpperCase();
                if (type === 'SH' || type === 'PRN') {
                    shares += numberOf(m.shrsOrPrnAmt?.[0]?.sshPrnamt?.[0]);
                    value += numberOf(m.value?.[0]);
                }
            }

            const accessionNumber = formatAccession(filing.accessionNumber);
            return {
                date: filing.filingDate,
                filingDate: filing.filingDate,
                reportDate: filing.reportDate || null,
                accessionNumber,
                form: filing.form,
                url: filingIndexUrl(cik, accessionNumber),
                shares,
                value,
            };
            // Each filing takes two requests (index + information table), so space starts twice as far apart.
        }, { minIntervalMs: SEC_MIN_REQUEST_INTERVAL_MS * 2 });

        const history = points.filter((p): p is HistoryPointResponse => p !== null).sort((a, b) => a.date.localeCompare(b.date));
        const warnings: string[] = [];
        if (skippedStubs > 0) warnings.push(`${skippedStubs} filing(s) listed no holdings (placeholder or confidential filings) and were left out.`);
        if (unreadable > 0) warnings.push(`${unreadable} filing(s) couldn’t be read from EDGAR and were left out.`);

        return NextResponse.json({
            history,
            holding: issuer || targetCusip,
            cik,
            matchedBy,
            cusip: targetCusip || null,
            filingsChecked: filings.length,
            skippedFilings: skippedStubs + unreadable,
            warnings,
        });
    } catch (error) {
        console.error('[WhaleHistory] Historical analysis failed:', error);
        const message = error instanceof Error && error.message ? error.message : 'Something went wrong reading EDGAR.';
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
