import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK, fetchSubmission, fetchFilingContent, generateSecUrl } from '@/lib/sec-client';
import { parseSC13DText } from '@/lib/sc13d-parser';

export const dynamic = 'force-dynamic'; // Prevent caching of filings

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { ticker } = body;

        if (!ticker) {
            return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
        }

        console.log(`[WhaleActivist] Searching for 13D filings for ${ticker}...`);

        const cik = await fetchCIK(ticker);
        if (!cik) {
            return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
        }

        const submission = await fetchSubmission(cik);
        if (!submission) {
            return NextResponse.json({ error: "No filings found" }, { status: 404 });
        }

        // Filter for SC 13D and SC 13D/A (Amendments)
        const recent = submission.filings.recent;
        const activistFilings = [];

        for (let i = 0; i < recent.form.length; i++) {
            const formType = recent.form[i];
            if (formType === 'SC 13D' || formType === 'SC 13D/A') {
                const accessionNumber = recent.accessionNumber[i];
                const primaryDocument = recent.primaryDocument[i];
                const filingUrl = generateSecUrl(cik, accessionNumber, primaryDocument);

                // Fetch content only for top 10 (to avoid timeouts)
                // We'll process them in parallel later if needed, but for now serial is safer for rate limits

                let details = {
                    reportingPerson: "Loading...",
                    percentClass: "N/A",
                    purpose: "See filing..."
                };

                // Only parse deep content for the top 5 most recent to save time
                if (activistFilings.length < 5) {
                    try {
                        const content = await fetchFilingContent(filingUrl);
                        if (content) {
                            const parsed = parseSC13DText(content);
                            details = {
                                reportingPerson: parsed.reportingPerson,
                                percentClass: parsed.percentClass,
                                purpose: parsed.purpose
                            };
                        }
                    } catch (e) {
                        console.error(`Failed to parse ${filingUrl}:`, e);
                    }
                }

                activistFilings.push({
                    form: formType,
                    accessionNumber: accessionNumber,
                    filingDate: recent.filingDate[i],
                    reportDate: recent.reportDate[i],
                    primaryDocument: primaryDocument,
                    description: recent.primaryDocDescription[i],
                    url: filingUrl,
                    ...details
                });
            }
        }

        // Sort by date descending (already sorted in recent usually, but good to be safe)
        activistFilings.sort((a, b) => new Date(b.filingDate).getTime() - new Date(a.filingDate).getTime());

        return NextResponse.json({
            ticker,
            cik,
            companyName: submission.name,
            filings: activistFilings
        });

    } catch (error: any) {
        console.error("[WhaleActivist] Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
