import { NextRequest, NextResponse } from 'next/server';
import { fetchCIK } from '@/lib/sec-client';
import { compareQuartersAsc, normalizeCik } from '@/lib/thirteen-f-radar-core';
import { RadarDataError, getAppPostgresPool, readAppStoreMeta } from '@/lib/thirteen-f-radar-data';
import { fetchNewerLive13F, type Live13FFiling } from '@/lib/thirteen-f-live';
import { loadFilerHoldingDiff, loadLiveFilerHoldingDiff, resolveStoreFiler, type FilerHoldingDiff } from '@/lib/thirteen-f-lookup';
import { mostRecentCompletedReportQuarter } from '@/lib/thirteen-f-parse';
import { loadStoreDirectory } from '@/lib/thirteen-f-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// The Whale Tracker client gives up after 30s; leave room for the store reads around the live lookup.
const LIVE_LOOKUP_TIMEOUT_MS = 20000;

/**
 * Quarter-over-quarter holdings diff for one 13F filer. Served from the store, which the daily 13F Ingestion
 * workflow keeps current; each filer is compared on its own latest two filed quarters. If the filer's newest
 * filing hasn't reached the store yet, it is read live from EDGAR and compared against the newest stored quarter.
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
        const diff = filer ? await loadFilerHoldingDiff(db, meta, directory, filer) : null;
        const stored = [meta.currentQuarter, meta.previousQuarter, meta.priorQuarter].filter(Boolean).join(', ');

        // Only ask EDGAR when the store can't already have the filer's newest quarter.
        const storedLatest = diff?.pair.currentQuarter ?? null;
        const liveCik = filer?.cik || (cikHint ? normalizeCik(cikHint) : null);
        let live: Live13FFiling | null = null;
        let liveError: string | null = null;
        if (liveCik && (!storedLatest || compareQuartersAsc(storedLatest, mostRecentCompletedReportQuarter()) < 0)) {
            try {
                live = await fetchNewerLive13F(liveCik, storedLatest, LIVE_LOOKUP_TIMEOUT_MS);
            } catch (error) {
                liveError = error instanceof Error ? error.message : String(error);
                console.warn(`[WhaleTracker] Live EDGAR lookup failed for CIK ${liveCik}:`, error);
            }
        }

        if (live) {
            const rows = await loadLiveFilerHoldingDiff(db, directory, filer, diff?.pair.currentSide ?? null, live);
            const filerName = filer?.name || live.filerName;
            const notes = [`${filerName}'s ${live.reportQuarter} 13F-HR (filed ${live.filingDate}) was read live from EDGAR; it reaches the 13F database with the next daily ingestion.`];
            if (!diff) notes.push(`No earlier quarter is stored for ${filerName}, so holdings are shown without quarter-over-quarter changes.`);
            return NextResponse.json({
                ticker: query,
                filerName,
                cik: liveCik!.padStart(10, '0'),
                currentQuarter: live.reportQuarter,
                previousQuarter: diff?.pair.currentQuarter ?? null,
                filingDateCurr: live.filingDate,
                filingDatePrev: diff?.pair.currentFilingDate ?? null,
                source: 'live-edgar',
                note: notes.join(' '),
                ...buildComparison(rows, !diff),
            });
        }

        if (!filer) {
            return NextResponse.json({ error: `No 13F filer matching "${query}" in ${stored}.` }, { status: 404 });
        }
        if (!diff) {
            return NextResponse.json({ error: `${filer.name} has no stored 13F-HR (${stored}).` }, { status: 404 });
        }
        const { pair } = diff;
        // Only one filed quarter: show it as a snapshot rather than fake "new position" changes.
        const snapshotOnly = !pair.previousSide;

        const notes: string[] = [];
        if (pair.currentSide !== 'cur' && !snapshotOnly) {
            notes.push(`${filer.name} has not filed ${meta.currentQuarter} yet; showing its ${pair.currentQuarter} vs ${pair.previousQuarter} change.`);
        }
        if (snapshotOnly) {
            notes.push(`Only ${pair.currentQuarter} is stored for ${filer.name}; showing those holdings without quarter-over-quarter changes.`);
        }
        if (liveError) {
            notes.push(`Couldn't check EDGAR for a newer filing just now (${liveError}).`);
        }

        return NextResponse.json({
            ticker: query,
            filerName: filer.name,
            cik: filer.cik.padStart(10, '0'),
            currentQuarter: pair.currentQuarter,
            previousQuarter: pair.previousQuarter,
            filingDateCurr: pair.currentFilingDate,
            filingDatePrev: pair.previousFilingDate,
            source: 'store',
            note: notes.join(' ') || null,
            ...buildComparison(diff.rows, snapshotOnly),
        });
    } catch (error) {
        console.error('[WhaleTracker] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: error instanceof RadarDataError ? error.status : 500 }
        );
    }
}

/** Values are returned in $ thousands, which is what the Whale Tracker UI expects. */
function buildComparison(rows: FilerHoldingDiff[], snapshotOnly: boolean) {
    const comparison = rows
        .filter((row) => row.sharesCurr > 0 || row.sharesPrev > 0 || row.valueCurr > 0 || row.valuePrev > 0)
        .map((row) => {
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
    return {
        topHoldings: comparison.slice(0, 5),
        topBuys: comparison.filter((x) => x.change > 0).sort((a, b) => b.change - a.change).slice(0, 5),
        topSells: comparison.filter((x) => x.change < 0).sort((a, b) => a.change - b.change).slice(0, 5),
        allChanges: comparison,
    };
}
