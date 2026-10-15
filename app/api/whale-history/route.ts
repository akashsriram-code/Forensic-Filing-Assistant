import { NextRequest, NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { fetchCIK, fetchSubmission, fetchFilingContent, parse13F } from '@/lib/sec-client';

export const maxDuration = 60; // Allow longer timeout for multiple fetches

export async function POST(req: NextRequest) {
    try {
        const { ticker, holdingInfo } = await req.json();

        if (!ticker || !holdingInfo) {
            return NextResponse.json({ error: "Missing ticker or holding info" }, { status: 400 });
        }

        const cleanHoldingName = holdingInfo.issuer.toUpperCase().split(' ')[0]; // Basic matching keyword
        const targetCusip = holdingInfo.cusip;

        console.log(`[WhaleHistory] Analyzing ${ticker} for holding: ${holdingInfo.issuer} (Keyword: ${cleanHoldingName}, CUSIP: ${targetCusip})`);

        // 1. Get Fund CIK
        const cik = await fetchCIK(ticker);
        if (!cik) {
            console.log(`[WhaleHistory] Fund not found for ticker: ${ticker}`);
            return NextResponse.json({ error: "Fund not found" }, { status: 404 });
        }

        // 2. Get Submission History
        const submission = await fetchSubmission(cik);
        if (!submission) {
            console.log(`[WhaleHistory] No submissions found for CIK: ${cik}`);
            return NextResponse.json({ error: "No filings found" }, { status: 404 });
        }

        // 3. Filter for last 8 13F-HR filings
        const recentFilings = [];
        const accessionNumbers = submission.filings.recent.accessionNumber;
        const forms = submission.filings.recent.form;
        const filingDates = submission.filings.recent.filingDate;
        const primaryDocs = submission.filings.recent.primaryDocument;

        for (let i = 0; i < accessionNumbers.length; i++) {
            if (forms[i] === '13F-HR') { // Only base filings, ignoring amendments for simplicity
                recentFilings.push({
                    accessionNumber: accessionNumbers[i],
                    filingDate: filingDates[i],
                    primaryDocument: primaryDocs[i]
                });
                if (recentFilings.length >= 8) break;
            }
        }

        console.log(`[WhaleHistory] Found ${recentFilings.length} recent 13F-HR filings.`);

        // 4. Parallel Fetch of Historical Data
        const historyPromises = recentFilings.map(async (filing) => {
            const accessionNoDash = filing.accessionNumber.replace(/-/g, '');
            let targetUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNoDash}/${filing.primaryDocument}`;
            // ... (rest of logic)

            // Logic to find the XML table if primary doc is html/txt (Copied/simplified from tracker)
            // 1. Initial attempt: Use primary document
            let content = await fetchFilingContent(targetUrl);
            let parsed = content ? await parse13F(content) : null;

            // Helper to try extraction strings from known paths
            const getRows = (p: any) => {
                const iRoot = Array.isArray(p?.informationTable) ? p.informationTable[0] : p?.informationTable;
                const sRoot = Array.isArray(p?.edgarSubmission) ? p.edgarSubmission[0] : p?.edgarSubmission;
                // Try sRoot form data path or iRoot direct path
                return iRoot?.infoTable || sRoot?.formData?.[0]?.informationTable?.[0]?.infoTable || [];
            };

            let rows = getRows(parsed);

            // 2. Fallback: If no rows found (e.g. primary doc was cover page), search index.json
            if (rows.length === 0) {
                // console.log(`[WhaleHistory] No rows in primary doc for ${filing.filingDate}. Checking index...`);
                try {
                    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNoDash}/index.json`;
                    const indexRes = await fetchWithTimeout(indexUrl, { headers: { 'User-Agent': process.env.SEC_USER_AGENT || "ForensicAnalyzer contact@example.com" } }, 15000);

                    if (indexRes.ok) {
                        const indexData = await indexRes.json();
                        const items = indexData.directory.item;

                        // Find the Information Table
                        let infoTableFile = items.find((item: any) =>
                            (item.type && item.type.includes('INFORMATION TABLE')) ||
                            (item.name && item.name.includes('.xml') && (item.name.toLowerCase().includes('info') || item.type?.includes('INFORMATION')))
                        );

                        // Robust Fallback: If no clear Info Table, grab first XML that isn't primary or stylesheet
                        if (!infoTableFile) {
                            infoTableFile = items.find((item: any) =>
                                item.name.endsWith('.xml') &&
                                item.name !== filing.primaryDocument &&
                                !item.name.includes('primary_doc') &&
                                !item.name.toLowerCase().includes('xsl') &&
                                !item.name.toLowerCase().includes('xsd')
                            );
                        }

                        if (infoTableFile) {
                            const newTargetUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNoDash}/${infoTableFile.name}`;
                            content = await fetchFilingContent(newTargetUrl);
                            parsed = content ? await parse13F(content) : null;
                            rows = getRows(parsed);
                        }
                    }
                } catch (e) {
                    console.error(`[WhaleHistory] Error checking index for ${filing.filingDate}:`, e);
                }
            }

            // if (rows.length === 0) return { date: filing.filingDate, shares: 0, value: 0, price: 0 };

            // console.log(`[WhaleHistory] ${filing.filingDate}: Extracted ${rows.length} rows.`);

            // Find specific holding
            // We use simple includes match on the issuer name provided
            const matches = rows.filter((r: any) => {
                const issuer = (r.nameOfIssuer?.[0] || "").toUpperCase();
                const rCusip = r.cusip?.[0];
                const nameMatch = issuer.includes(cleanHoldingName);
                const cusipMatch = targetCusip && rCusip === targetCusip;

                return nameMatch || cusipMatch;
            });

            // console.log(`[WhaleHistory] ${filing.filingDate}: Found ${matches.length} matches. (NameMatch: ${matches.some((m:any) => (m.nameOfIssuer?.[0] || "").toUpperCase().includes(cleanHoldingName))}, CusipMatch: ${matches.some((m:any) => targetCusip && m.cusip?.[0] === targetCusip)})`);

            if (matches.length === 0) return { date: filing.filingDate, shares: 0, value: 0, price: 0 };

            // Sum up if multiple rows (e.g. Call/Put/Share split rows) - but strictly we usually want SH (Shares)
            // Filter only for 'SH' or 'PRN' (Shares/Principal) to avoid mixing Calls/Puts unless requested
            // For simplicity, we sum all 'SH' rows.
            let totalShares = 0;
            let totalValue = 0;

            matches.forEach((m: any) => {
                const type = m.shrsOrPrnAmt?.[0]?.sshPrnamtType?.[0] || 'SH';
                if (type === 'SH' || type === 'PRN') {
                    totalShares += parseFloat(m.shrsOrPrnAmt?.[0]?.sshPrnamt?.[0] || '0');
                    totalValue += parseFloat(m.value?.[0] || '0');
                }
            });

            return {
                date: filing.filingDate,
                shares: totalShares,
                value: totalValue, // in thousands
                price: totalShares > 0 ? (totalValue * 1000) / totalShares : 0 // Implied price
            };
        });

        const results = await Promise.all(historyPromises);
        const validResults = results.filter(r => r !== null).sort((a, b) => a!.date.localeCompare(b!.date));

        return NextResponse.json({ history: validResults, holding: holdingInfo.issuer });

    } catch (error: any) {
        console.error("Historical Analysis Failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
