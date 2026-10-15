import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK } from '@/lib/sec-client';
import { RadarDataError, getAppPostgresPool, readAppStoreMeta } from '@/lib/thirteen-f-radar-data';
import { loadFilerHoldingDiff, resolveStoreFiler } from '@/lib/thirteen-f-lookup';
import { loadStoreDirectory } from '@/lib/thirteen-f-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Quarter-over-quarter holdings diff for one 13F filer, served from the store. Each filer is compared on its own
 * latest two filed quarters, so during a filing season funds that haven't reported the newest quarter yet show
 * their previous change (e.g. Q2 vs Q1) instead of nothing.
 */
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
        const stored = [meta.currentQuarter, meta.previousQuarter, meta.priorQuarter].filter(Boolean).join(', ');
        if (!filer) {
            return NextResponse.json({ error: `No 13F filer matching "${query}" in ${stored}.` }, { status: 404 });
        }
        const diff = await loadFilerHoldingDiff(db, meta, directory, filer);
        if (!diff) {
            return NextResponse.json({ error: `${filer.name} has no stored 13F-HR (${stored}).` }, { status: 404 });
        }
        const { pair } = diff;
        // Only one filed quarter: show it as a snapshot rather than fake "new position" changes.
        const snapshotOnly = !pair.previousSide;

        // Values are returned in $ thousands, which is what the Whale Tracker UI expects.
        const comparison = diff.rows.map((row) => {
            const sharesPrev = snapshotOnly ? row.sharesCurr : row.sharesPrev;
            const change = row.sharesCurr - sharesPrev;
            const percentChange = sharesPrev > 0 ? (change / sharesPrev) * 100 : change > 0 ? 100 : 0;
            return {
                ticker: 'N/A',
                issuer: row.issuer,
                cusip: row.cusip,
                sharesCurr: row.sharesCurr,
                sharesPrev,
                change,
                percentChange: row.sharesCurr === 0 && sharesPrev > 0 ? -100 : percentChange,
                value: row.valueCurr / 1000,
                isNew: sharesPrev === 0 && row.sharesCurr > 0,
                isAddOn: sharesPrev > 0 && change > 0,
            };
        });
        comparison.sort((a, b) => b.value - a.value);

        const notes: string[] = [];
        if (pair.currentSide !== 'cur' && !snapshotOnly) {
            notes.push(`${filer.name} has not filed ${meta.currentQuarter} yet; showing its ${pair.currentQuarter} vs ${pair.previousQuarter} change.`);
        }
        if (snapshotOnly) {
            notes.push(`Only ${pair.currentQuarter} is stored for ${filer.name}; showing those holdings without quarter-over-quarter changes.`);
        }

        return NextResponse.json({
            ticker: query,
            filerName: filer.name,
            cik: filer.cik.padStart(10, '0'),
            currentQuarter: pair.currentQuarter,
            previousQuarter: pair.previousQuarter,
            filingDateCurr: pair.currentFilingDate,
            filingDatePrev: pair.previousFilingDate,
            note: notes.join(' ') || null,
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
