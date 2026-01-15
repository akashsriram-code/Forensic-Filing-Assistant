import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK, fetchSubmission, generateSecUrl, fetchFilingContent, parseForm4 } from '@/lib/sec-client';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { ticker } = body;

        console.log(`[InsiderAnalysis] Analyzing ${ticker}...`);

        if (!ticker) return NextResponse.json({ error: "Ticker is required" }, { status: 400 });

        const cik = await fetchCIK(ticker);
        if (!cik) return NextResponse.json({ error: "Ticker not found" }, { status: 404 });

        const submission = await fetchSubmission(cik);
        if (!submission) return NextResponse.json({ error: "No filings found" }, { status: 404 });

        // Filter for Form 4s
        const recent = submission.filings.recent;
        const form4Indices: number[] = [];
        for (let i = 0; i < recent.form.length; i++) {
            if (recent.form[i] === '4') {
                form4Indices.push(i);
            }
        }

        // Limit to last 10 filings to avoid timeout
        const indicesToFetch = form4Indices.slice(0, 10);

        const transactions: any[] = [];

        // Fetch in parallel batches of 5
        const batchSize = 5;
        for (let i = 0; i < indicesToFetch.length; i += batchSize) {
            const batch = indicesToFetch.slice(i, i + batchSize);
            await Promise.all(batch.map(async (idx) => {
                const accessionNumber = recent.accessionNumber[idx];
                const primaryDocument = recent.primaryDocument[idx];
                const filingDate = recent.filingDate[idx];

                // Helper to construct URL
                // Strip xsl path (e.g. xslF345X03/primary_doc.xml -> primary_doc.xml) to get raw XML
                // This fix ensures we get the actual XML file, not the HTML render
                const rawFileName = primaryDocument.split('/').pop() || primaryDocument;
                const url = generateSecUrl(cik, accessionNumber, rawFileName);

                const xmlContent = await fetchFilingContent(url);
                if (!xmlContent) return;

                const parsed = await parseForm4(xmlContent);
                if (!parsed) return;

                // Handle Namespaces & Nesting (ownershipDocument is usually root)
                // Robust unwrapping to handle both Array and Object responses from xml2js
                let root = parsed.ownershipDocument;
                if (Array.isArray(root)) root = root[0];
                if (!root) root = parsed;

                // Double check: if root still has ownershipDocument property, unwrap it again
                if (root.ownershipDocument) {
                    root = Array.isArray(root.ownershipDocument) ? root.ownershipDocument[0] : root.ownershipDocument;
                }

                if (!root) return;

                const rptOwner = root.reportingOwner?.[0];
                const rptOwnerName = rptOwner?.reportingOwnerId?.[0]?.rptOwnerName?.[0];
                const isDirector = rptOwner?.reportingOwnerRelationship?.[0]?.isDirector?.[0] === '1' || rptOwner?.reportingOwnerRelationship?.[0]?.isDirector?.[0] === 'true';
                const isOfficer = rptOwner?.reportingOwnerRelationship?.[0]?.isOfficer?.[0] === '1' || rptOwner?.reportingOwnerRelationship?.[0]?.isOfficer?.[0] === 'true';
                const officerTitle = rptOwner?.reportingOwnerRelationship?.[0]?.officerTitle?.[0];

                const nonDerivTransactions = root.nonDerivativeTable?.[0]?.nonDerivativeTransaction || [];

                nonDerivTransactions.forEach((tx: any) => {
                    const txCode = tx.transactionCoding?.[0]?.transactionCode?.[0]; // P or S
                    const shares = parseFloat(tx.transactionAmounts?.[0]?.transactionShares?.[0]?.value?.[0] || '0');
                    const price = parseFloat(tx.transactionAmounts?.[0]?.transactionPricePerShare?.[0]?.value?.[0] || '0');
                    const acquiredDisposed = tx.transactionAmounts?.[0]?.transactionAcquiredDisposedCode?.[0]?.value?.[0]; // A or D
                    const postShares = parseFloat(tx.postTransactionAmounts?.[0]?.sharesOwnedFollowingTransaction?.[0]?.value?.[0] || '0');

                    // Calculate value
                    const value = shares * price;

                    transactions.push({
                        filingDate,
                        rptOwnerName,
                        title: officerTitle || (isDirector ? "Director" : "Ten Percent Owner"),
                        transactionDate: tx.transactionDate?.[0]?.value?.[0],
                        transactionCode: txCode,
                        shares,
                        price,
                        type: acquiredDisposed, // A = Buy (usually), D = Sell
                        value,
                        postShares,
                        url // Link to filing
                    });
                });
            }));
        }

        // Sort by Date Descending
        transactions.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());

        return NextResponse.json({
            ticker,
            transactions
        });

    } catch (error: any) {
        console.error("[InsiderAnalysis] Critical Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
