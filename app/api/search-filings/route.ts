import { NextRequest, NextResponse } from 'next/server';
import { searchFilings } from '@/lib/filing-search';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { ticker, startDate, endDate, filingType } = body;

        const results = await searchFilings({ ticker, startDate, endDate, filingType });
        return NextResponse.json({ results });

    } catch (error: unknown) {
        console.error("Search API Error:", error);
        const message = error instanceof Error ? error.message : "Internal Server Error";
        const status =
            message === "Ticker is required" ? 400 :
            message === "Ticker not found" ? 404 :
            message === "No filings found" ? 404 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
