import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK, fetchSubmission } from '@/lib/sec-client';

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
                activistFilings.push({
                    form: formType,
                    accessionNumber: recent.accessionNumber[i],
                    filingDate: recent.filingDate[i],
                    reportDate: recent.reportDate[i],
                    primaryDocument: recent.primaryDocument[i],
                    description: recent.primaryDocDescription[i],
                    url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${recent.accessionNumber[i].replace(/-/g, '')}/${recent.primaryDocument[i]}`
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
