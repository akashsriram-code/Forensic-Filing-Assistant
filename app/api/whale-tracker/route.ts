import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK } from '@/lib/sec-client';
import { RadarDataError, getAppPostgresPool, readAppStoreMeta } from '@/lib/thirteen-f-radar-data';
import { loadFilerHoldingDiff, resolveStoreFiler } from '@/lib/thirteen-f-lookup';
import { loadStoreDirectory } from '@/lib/thirteen-f-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Quarter-over-quarter holdings diff for one 13F filer, served from the stored latest two quarters. */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const query = typeof body.ticker === 'string' ? body.ticker.trim() : '';
        if (!query) return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });

        const meta = await readAppStoreMeta();
        if (!meta) return NextResponse.json({ error: 'The 13F database is unavailable. Try again shortly.' }, { status: 503 });
        const db = getAppPostgresPool();
        const directory = await loadStoreDirectory(db, meta);

        const cikHint = /^\d{1,10}$/.test(query) ? query : await fetchCIK(query).catch(() => null);
        const filer = resolveStoreFiler(directory, query, cikHint);
        if (!filer) {
            return NextResponse.json({ error: `No 13F filer matching "${query}" in ${meta.currentQuarter} or ${meta.previousQuarter}.` }, { status: 404 });
        }
        if (!filer.curAccession && !filer.prevAccession) {
            return NextResponse.json({ error: `${filer.name} has no 13F-HR for ${meta.currentQuarter} or ${meta.previousQuarter}.` }, { status: 404 });
        }

        // During a filing season most filers have not reported the newest quarter yet: show their latest stored
        // quarter as a snapshot (no changes) rather than failing.
        const snapshotOnly = !filer.curAccession || !filer.prevAccession;
        const snapshotQuarter = filer.curAccession ? meta.currentQuarter : meta.previousQuarter;
        const diff = (await loadFilerHoldingDiff(db, directory, filer)).map((row) =>
            snapshotOnly
                ? { ...row, sharesCurr: row.sharesCurr || row.sharesPrev, valueCurr: row.valueCurr || row.valuePrev, sharesPrev: row.sharesCurr || row.sharesPrev, valuePrev: row.valueCurr || row.valuePrev }
                : row
        );

        // Values are returned in $ thousands, which is what the Whale Tracker UI expects.
        const comparison = diff.map((row) => {
            const change = row.sharesCurr - row.sharesPrev;
            const percentChange = row.sharesPrev > 0 ? (change / row.sharesPrev) * 100 : change > 0 ? 100 : 0;
            return {
                ticker: 'N/A',
                issuer: row.issuer,
                cusip: row.cusip,
                sharesCurr: row.sharesCurr,
                sharesPrev: row.sharesPrev,
                change,
                percentChange: row.sharesCurr === 0 && row.sharesPrev > 0 ? -100 : percentChange,
                value: row.valueCurr / 1000,
                isNew: row.sharesPrev === 0 && row.sharesCurr > 0,
                isAddOn: row.sharesPrev > 0 && change > 0,
            };
        });
        comparison.sort((a, b) => b.value - a.value);

        return NextResponse.json({
            ticker: query,
            filerName: filer.name,
            cik: filer.cik.padStart(10, '0'),
            currentQuarter: snapshotOnly ? snapshotQuarter : meta.currentQuarter,
            previousQuarter: snapshotOnly ? null : meta.previousQuarter,
            filingDateCurr: snapshotOnly ? (filer.curFilingDate || filer.prevFilingDate) : filer.curFilingDate,
            filingDatePrev: snapshotOnly ? null : filer.prevFilingDate,
            note: snapshotOnly
                ? `${filer.name} has filed only ${snapshotQuarter} of the stored quarters (${meta.currentQuarter}, ${meta.previousQuarter}); showing those holdings without quarter-over-quarter changes.`
                : null,
            topHoldings: comparison.slice(0, 5),
            topBuys: comparison.filter((x) => x.change > 0).sort((a, b) => b.change - a.change).slice(0, 5),
            topSells: comparison.filter((x) => x.change < 0).sort((a, b) => a.change - b.change).slice(0, 5),
            allChanges: comparison,
        });
    } catch (error) {
        console.error('[WhaleTracker] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: error instanceof RadarDataError ? error.status : 500 }
        );
    }
}
