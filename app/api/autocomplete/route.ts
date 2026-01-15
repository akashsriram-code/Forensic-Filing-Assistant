import { NextRequest, NextResponse } from 'next/server';
import { searchTickers } from '@/lib/search-index';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');

    if (!query) {
        return NextResponse.json({ results: [] });
    }

    try {
        const results = await searchTickers(query);
        return NextResponse.json({ results });
    } catch (error) {
        console.error("Autocomplete Error:", error);
        return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
}
