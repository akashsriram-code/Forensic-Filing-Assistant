
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@libsql/client';

export const dynamic = 'force-dynamic'; // Always fetch fresh data

export async function GET(req: NextRequest) {
    try {
        // Disable SSL verification for development
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

        const turso = createClient({
            url: process.env.TURSO_DATABASE_URL!,
            authToken: process.env.TURSO_AUTH_TOKEN!,
        });

        // 1. Fetch recent filing themes (last 100)
        const rs = await turso.execute({
            sql: `
                SELECT accession_number, cik, ticker, form, filing_date, themes 
                FROM filing_themes 
                ORDER BY filing_date DESC, extracted_at DESC 
                LIMIT 100
            `,
            args: []
        });

        // 2. Get total count
        const countRs = await turso.execute("SELECT count(*) as total FROM filing_themes");
        const totalCount = countRs.rows[0].total as number;

        const filings = [];
        const themeCounts: Record<string, { count: number, sentimentScore: number, contexts: string[] }> = {};

        for (const row of rs.rows as any[]) {
            try {
                const themes = JSON.parse(row.themes);

                filings.push({
                    ticker: row.ticker,
                    form: row.form,
                    date: row.filing_date,
                    filingUrl: row.filing_url || null,
                    themes: themes
                });

                // Aggregate
                for (const t of themes) {
                    // Normalize theme name (basic)
                    const key = t.theme.trim();

                    if (!themeCounts[key]) {
                        themeCounts[key] = { count: 0, sentimentScore: 0, contexts: [] };
                    }

                    themeCounts[key].count++;
                    if (themeCounts[key].contexts.length < 3) {
                        themeCounts[key].contexts.push(`${row.ticker}: ${t.context}`);
                    }

                    // Sentiment Map
                    if (t.sentiment?.toLowerCase().includes('pos')) themeCounts[key].sentimentScore += 1;
                    if (t.sentiment?.toLowerCase().includes('neg')) themeCounts[key].sentimentScore -= 1;
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        // Convert to array
        const topThemes = Object.entries(themeCounts)
            .map(([name, data]) => ({
                name,
                count: data.count,
                sentiment: data.sentimentScore > 0 ? 'Positive' : (data.sentimentScore < 0 ? 'Negative' : 'Neutral'),
                examples: data.contexts
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        return NextResponse.json({
            count: totalCount || filings.length,
            top_themes: topThemes,
            recent_filings: filings.slice(0, 20)
        });

    } catch (error: any) {
        console.error("[MarketTrends] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
