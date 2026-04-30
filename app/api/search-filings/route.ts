import { NextRequest, NextResponse } from 'next/server';
import { parseDelimitedInput, searchFilings } from '@/lib/filing-search';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { ticker, entities, keywords, startDate, endDate, filingType } = body;

        const normalizedEntities = Array.isArray(entities)
            ? entities
            : typeof entities === 'string'
                ? parseDelimitedInput(entities)
                : [];

        const normalizedKeywords = Array.isArray(keywords)
            ? keywords
            : typeof keywords === 'string'
                ? parseDelimitedInput(keywords)
                : [];

        const result = await searchFilings({
            ticker,
            entities: normalizedEntities,
            keywords: normalizedKeywords,
            startDate,
            endDate,
            filingType,
        });

        return NextResponse.json(result);

    } catch (error: unknown) {
        console.error("Search API Error:", error);
        const message = error instanceof Error ? error.message : "Internal Server Error";
        const status =
            message === "Ticker is required" || message === "At least one entity is required" ? 400 :
            message.startsWith("Entity not found:") ? 404 :
            message.startsWith("No filings found for") ? 404 :
            message === "Ticker not found" ? 404 :
            message === "No filings found" ? 404 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
