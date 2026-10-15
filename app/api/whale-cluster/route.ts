import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK } from '@/lib/sec-client';
import { RadarDataError, getAppPostgresPool, readAppStoreMeta } from '@/lib/thirteen-f-radar-data';
import { loadFilerHoldingDiff, resolveStoreFiler } from '@/lib/thirteen-f-lookup';
import { loadStoreDirectory, type StoreDirectory } from '@/lib/thirteen-f-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface Holding {
    issuer: string;
    cusip: string;
    value: number;
    shares: number;
}

/**
 * A filer's latest stored holdings keyed by CUSIP, with values in $ thousands (what the UI expects).
 * Uses the newest quarter the filer has filed, so funds that haven't reported the current quarter yet still compare.
 */
async function getFundHoldings(
    db: ReturnType<typeof getAppPostgresPool>,
    directory: StoreDirectory,
    query: string,
    quarters: { current: string; previous: string }
) {
    const cikHint = /^\d{1,10}$/.test(query) ? query : await fetchCIK(query).catch(() => null);
    const filer = resolveStoreFiler(directory, query, cikHint);
    if (!filer || (!filer.curAccession && !filer.prevAccession)) return null;
    const useCurrent = Boolean(filer.curAccession);

    const holdings = new Map<string, Holding>();
    for (const row of await loadFilerHoldingDiff(db, directory, filer)) {
        const shares = useCurrent ? row.sharesCurr : row.sharesPrev;
        if (shares <= 0) continue;
        const key = row.cusip || row.issuer;
        holdings.set(key, { issuer: row.issuer, cusip: key, value: (useCurrent ? row.valueCurr : row.valuePrev) / 1000, shares });
    }
    return {
        ticker: query,
        filerName: filer.name,
        quarter: useCurrent ? quarters.current : quarters.previous,
        filingDate: (useCurrent ? filer.curFilingDate : filer.prevFilingDate) || '',
        holdings,
    };
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const ticker1 = typeof body.ticker1 === 'string' ? body.ticker1.trim() : '';
        const ticker2 = typeof body.ticker2 === 'string' ? body.ticker2.trim() : '';
        if (!ticker1 || !ticker2) {
            return NextResponse.json({ error: 'Two tickers required' }, { status: 400 });
        }

        const meta = await readAppStoreMeta();
        if (!meta) return NextResponse.json({ error: 'The 13F database is unavailable. Try again shortly.' }, { status: 503 });
        const db = getAppPostgresPool();
        const directory = await loadStoreDirectory(db, meta);

        const quarters = { current: meta.currentQuarter, previous: meta.previousQuarter };
        const [fundA, fundB] = await Promise.all([
            getFundHoldings(db, directory, ticker1, quarters),
            getFundHoldings(db, directory, ticker2, quarters),
        ]);
        if (!fundA || !fundB) {
            const missing = [!fundA && ticker1, !fundB && ticker2].filter(Boolean).join(' and ');
            return NextResponse.json({ error: `No ${meta.currentQuarter} or ${meta.previousQuarter} 13F holdings found for ${missing}.` }, { status: 404 });
        }

        const intersection: Array<{ issuer: string; cusip: string; valueA: number; valueB: number; sharesA: number; sharesB: number; combinedValue: number }> = [];
        let overlapValueA = 0;
        let overlapValueB = 0;
        let uniqueA = 0;
        for (const [cusip, holdingA] of fundA.holdings.entries()) {
            const holdingB = fundB.holdings.get(cusip);
            if (!holdingB) {
                uniqueA++;
                continue;
            }
            intersection.push({
                issuer: holdingA.issuer,
                cusip,
                valueA: holdingA.value,
                valueB: holdingB.value,
                sharesA: holdingA.shares,
                sharesB: holdingB.shares,
                combinedValue: holdingA.value + holdingB.value,
            });
            overlapValueA += holdingA.value;
            overlapValueB += holdingB.value;
        }
        const uniqueB = Array.from(fundB.holdings.keys()).filter((cusip) => !fundA.holdings.has(cusip)).length;
        intersection.sort((a, b) => b.combinedValue - a.combinedValue);

        return NextResponse.json({
            fundA: { ticker: fundA.ticker, name: fundA.filerName, quarter: fundA.quarter, date: fundA.filingDate, totalHoldings: fundA.holdings.size, uniqueCount: uniqueA, overlapValue: overlapValueA },
            fundB: { ticker: fundB.ticker, name: fundB.filerName, quarter: fundB.quarter, date: fundB.filingDate, totalHoldings: fundB.holdings.size, uniqueCount: uniqueB, overlapValue: overlapValueB },
            overlap: { count: intersection.length, holdings: intersection.slice(0, 50) },
        });
    } catch (error) {
        console.error('[WhaleCluster] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: error instanceof RadarDataError ? error.status : 500 }
        );
    }
}
