
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@libsql/client';

// Cache for Ticker -> Name resolution
const CACHE_REVALIDATE = 3600;

async function getCompanyName(ticker: string): Promise<string | null> {
    try {
        const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
            headers: { "User-Agent": "ForensicAnalyzer contact@example.com" },
            next: { revalidate: CACHE_REVALIDATE }
        });
        if (!response.ok) return null;

        const data = await response.json();
        const entries: any[] = Object.values(data);
        const t = ticker.toUpperCase();

        const match = entries.find(e => e.ticker === t);
        return match ? match.title : null;
    } catch (e) {
        console.error("Error fetching company name", e);
        return null;
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { ticker } = body;

        if (!ticker) {
            return NextResponse.json({ error: "Ticker required" }, { status: 400 });
        }

        const companyName = await getCompanyName(ticker);
        if (!companyName) {
            return NextResponse.json({ error: "Could not resolve ticker to specific company name" }, { status: 404 });
        }

        console.log(`[ReverseLookup] Searching for holders of: ${ticker} (${companyName})`);

        const turso = createClient({
            url: process.env.TURSO_DATABASE_URL!,
            authToken: process.env.TURSO_AUTH_TOKEN!,
        });

        // Search Query
        // 1. Find all holdings for this issuer across ALL quarters.
        // 2. We use a LIKE query on the Issuer Name.
        //    Note: This can be noisy if "Apple" matches "Apple Hospitality". 
        //    Refining search to be stricter: 

        // Clean company name for search: "APPLE INC." -> "APPLE"
        const searchName = companyName.toUpperCase().split(' ')[0].replace(/[^A-Z0-9]/g, '');
        const searchPattern = `${searchName}%`;

        const query = `
            SELECT 
                f.name as fundName, 
                f.cik, 
                h.value, 
                h.shares, 
                fil.filing_date,
                fil.quarter
            FROM holdings h 
            JOIN filings fil ON h.accession_number = fil.accession_number 
            JOIN funds f ON fil.cik = f.cik 
            WHERE 
                h.issuer LIKE ? 
            ORDER BY fil.filing_date ASC, fil.accession_number ASC
        `;

        const rs = await turso.execute({ sql: query, args: [searchPattern] });

        // Aggregation Logic
        // Map<CIK, FundData>
        const fundsMap = new Map<string, any>();

        for (const row of rs.rows as any[]) {
            if (!fundsMap.has(row.cik)) {
                fundsMap.set(row.cik, {
                    fundName: row.fundName,
                    cik: row.cik,
                    shares: 0, // Will be set to latest
                    value: 0,  // Will be set to latest
                    history: []
                });
            }

            const fund = fundsMap.get(row.cik);

            // Normalization Heuristic: Convert mixed DB units (Thousands vs Ones) to Actual Dollars
            const rawVal = row.value;
            const shares = row.shares;
            const ratio = shares > 0 ? rawVal / shares : 0;
            // Standardize to Actual Dollars (Ratio > 4 implies Ones)
            const realValue = (ratio > 500) ? rawVal : (ratio > 4 ? rawVal : rawVal * 1000);

            const point = {
                date: row.filing_date,
                quarter: row.quarter,
                shares: row.shares,
                value: realValue
            };

            // Deduplicate by Quarter: Keep only the latest filing for a given quarter
            const lastPoint = fund.history[fund.history.length - 1];
            if (lastPoint && lastPoint.quarter === row.quarter) {
                // If same quarter, overwrite the previous entry (assuming sorted by date/accession ascending)
                fund.history[fund.history.length - 1] = point;
            } else {
                fund.history.push(point);
            }

            fund.shares = shares;
            fund.value = realValue;
            fund.filing_date = row.filing_date;
        }

        // Convert to array and sort by Current Value DESC
        const allFunds = Array.from(fundsMap.values());
        const sortedFunds = allFunds.sort((a, b) => b.value - a.value);

        // Limit top 100 to avoid sending huge payload
        const topFunds = sortedFunds.slice(0, 100);

        return NextResponse.json({
            ticker,
            companyName,
            matchCount: allFunds.length,
            funds: topFunds
        });

    } catch (error: any) {
        console.error("[ReverseLookup] Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
