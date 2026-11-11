"use client";

import { useEffect, useId, useMemo, useState } from 'react';
import { BookOpen, Download, ListChecks, RefreshCw } from 'lucide-react';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import {
    DEFAULT_RADAR_WATCHLISTS,
    compareQuartersAsc,
    formatQuarterLabel,
    type RadarApiResponse,
    type RadarWatchlist,
} from '@/lib/thirteen-f-radar-core';
import { Button, Chip, EmptyState, Notice, SelectControl, Tabs, Takeaway, Term, tabPanelProps } from './ui';
import { CategoryOverview } from './radar/CategoryOverview';
import { FilerMovesTable } from './radar/FilerMovesTable';
import { FilerTypeTrendsTable } from './radar/FilerTypeTrendsTable';
import { FilingSeasonStrip } from './radar/FilingSeasonStrip';
import { FundsToWatch } from './radar/FundsToWatch';
import { HowThisWorksDialog } from './radar/HowThisWorksDialog';
import { MovementTable } from './radar/MovementTable';
import { PrivateCreditTable } from './radar/PrivateCreditTable';
import { BodySkeleton, RadarSummary, TakeawaySkeleton } from './radar/RadarSummary';
import { WatchlistDialog } from './radar/WatchlistDialog';
import {
    RADAR_REQUEST_TIMEOUT_MS,
    errorMessage,
    getDownloadFilename,
    parseRadarErrorResponse,
    parseRadarResponse,
    saveBlob,
    type RadarPayload,
} from './radar/radar-api';
import { buildRadarTakeaway, getFilingSeason } from './radar/radar-takeaway';

type RadarView = 'trends' | 'watch';

interface RadarQuery {
    /** Empty means "let the server pick" (the newest pair, or the quarter before the chosen current one). */
    currentQuarter: string;
    previousQuarter: string;
    categories: string[];
    watchlists: RadarWatchlist[];
}

interface RadarResult {
    /** The request this result answers; compared with the latest request key to know whether we are loading. */
    key: string;
    data: RadarApiResponse | null;
    /** Payload that produced `data`, reused for the per-category holder requests. */
    payload: RadarPayload | null;
    error: string;
}

// Short pause before each request so quick changes (several category chips in a row) collapse into one run.
const RUN_DELAY_MS = 300;

const VIEWS = [
    { id: 'trends' as const, label: 'Trends' },
    { id: 'watch' as const, label: 'Funds to watch' },
];

export function ThirteenFRadar() {
    const [view, setView] = useState<RadarView>('trends');
    const [query, setQuery] = useState<RadarQuery>({
        currentQuarter: '',
        previousQuarter: '',
        categories: DEFAULT_RADAR_WATCHLISTS.map((watchlist) => watchlist.key),
        watchlists: DEFAULT_RADAR_WATCHLISTS,
    });
    const [reloadToken, setReloadToken] = useState(0);
    const [result, setResult] = useState<RadarResult>({ key: '', data: null, payload: null, error: '' });
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');
    const [watchlistsOpen, setWatchlistsOpen] = useState(false);
    const [howOpen, setHowOpen] = useState(false);
    const currentId = useId();
    const previousId = useId();

    const payload = useMemo<RadarPayload>(
        () => ({
            currentQuarter: query.currentQuarter || undefined,
            previousQuarter: query.previousQuarter || undefined,
            categories: query.categories,
            watchlists: query.watchlists,
            movementBasis: 'filer-count',
        }),
        [query]
    );
    const payloadJson = JSON.stringify(payload);
    const requestKey = `${reloadToken}:${payloadJson}`;
    const loading = result.key !== requestKey;
    const { data } = result;

    // Every change to the query runs the comparison. The cleanup aborts the previous request, so a slow, stale
    // response can never overwrite a newer one.
    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            try {
                const res = await fetchWithTimeout('/api/13f-radar', {
                    method: 'POST',
                    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                    body: payloadJson,
                    signal: controller.signal,
                }, RADAR_REQUEST_TIMEOUT_MS);
                const radar = await parseRadarResponse(res);
                if (controller.signal.aborted) return;
                setResult({ key: requestKey, data: radar, payload: JSON.parse(payloadJson) as RadarPayload, error: '' });
            } catch (err) {
                if (controller.signal.aborted) return;
                setResult((prev) => ({ ...prev, key: requestKey, error: errorMessage(err, 'The comparison did not load.') }));
            }
        }, RUN_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [payloadJson, requestKey]);

    const season = useMemo(() => (data ? getFilingSeason(data) : null), [data]);
    const takeaway = useMemo(() => (data && season ? buildRadarTakeaway(data, season) : ''), [data, season]);

    const availableQuarters = data?.availableQuarters || [];
    const shownCurrent = query.currentQuarter || data?.coverage.currentQuarter || '';
    const resultMatchesCurrent = Boolean(data && (!query.currentQuarter || query.currentQuarter === data.coverage.currentQuarter));
    const shownPrevious = query.previousQuarter || (resultMatchesCurrent ? data?.coverage.previousQuarter || '' : '');
    const earlierQuarters = availableQuarters.filter((quarter) => shownCurrent && compareQuartersAsc(quarter, shownCurrent) < 0);
    const previousOptions = earlierQuarters.length > 0 ? earlierQuarters : availableQuarters.filter((quarter) => quarter !== shownCurrent);

    // Stored comparisons are consecutive pairs, so a new current quarter lets the server pick the quarter before it.
    const changeCurrent = (quarter: string) => setQuery((prev) => ({ ...prev, currentQuarter: quarter, previousQuarter: '' }));
    const changePrevious = (quarter: string) => setQuery((prev) => ({ ...prev, currentQuarter: shownCurrent, previousQuarter: quarter }));
    const viewBaseline = (quarter: string) => setQuery((prev) => ({ ...prev, currentQuarter: quarter, previousQuarter: '' }));

    const toggleCategory = (key: string) =>
        setQuery((prev) => {
            if (prev.categories.includes(key)) {
                return prev.categories.length === 1 ? prev : { ...prev, categories: prev.categories.filter((item) => item !== key) };
            }
            return { ...prev, categories: [...prev.categories, key] };
        });

    const applyWatchlists = (next: RadarWatchlist[]) => {
        setWatchlistsOpen(false);
        setQuery((prev) => ({ ...prev, watchlists: next }));
    };

    const retry = () => setReloadToken((value) => value + 1);

    const exportAuditWorkbook = async () => {
        setExporting(true);
        setExportError('');
        try {
            const res = await fetchWithTimeout('/api/13f-radar/export', {
                method: 'POST',
                headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Type': 'application/json' },
                body: payloadJson,
            }, RADAR_REQUEST_TIMEOUT_MS * 2);
            if (!res.ok) throw new Error(await parseRadarErrorResponse(res));
            const blob = await res.blob();
            const fallbackFilename = `13f-radar-audit-${query.currentQuarter || data?.coverage.currentQuarter || 'current'}-vs-${query.previousQuarter || data?.coverage.previousQuarter || 'previous'}.xlsx`;
            saveBlob(blob, getDownloadFilename(res, fallbackFilename));
        } catch (err) {
            setExportError(errorMessage(err, 'The export did not finish.'));
        } finally {
            setExporting(false);
        }
    };

    const quarterLabel = data ? formatQuarterLabel(data.coverage.currentQuarter) : '';
    const previousLabel = data ? formatQuarterLabel(data.coverage.previousQuarter) : '';
    const selectedCategories = new Set(query.categories);

    return (
        <div className="space-y-8">
            <header className="space-y-5">
                {data && season ? (
                    <>
                        <Takeaway copyText={takeaway} asOf={data.coverage.latestFilingDate || null} updating={loading} note={<span>Source: SEC 13F filings</span>}>
                            {takeaway}
                        </Takeaway>
                        <FilingSeasonStrip data={data} season={season} loading={loading} onViewBaseline={viewBaseline} />
                    </>
                ) : loading ? (
                    <TakeawaySkeleton />
                ) : null}
            </header>

            {result.error && (
                <Notice
                    tone="error"
                    title="Couldn’t load the 13F comparison"
                    action={
                        <Button size="sm" onClick={retry} loading={loading} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
                            Retry
                        </Button>
                    }
                >
                    {result.error} Try again, or pick a different pair of quarters.
                </Notice>
            )}

            <div className="space-y-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-lg text-ink">
                        <span aria-hidden>Comparing</span>
                        <label htmlFor={currentId} className="sr-only">Current quarter</label>
                        <SelectControl
                            id={currentId}
                            value={shownCurrent}
                            onChange={(event) => changeCurrent(event.target.value)}
                            disabled={availableQuarters.length === 0}
                            className="w-auto min-w-32"
                        >
                            {!shownCurrent && <option value="">Loading…</option>}
                            {availableQuarters.map((quarter) => (
                                <option key={quarter} value={quarter}>{formatQuarterLabel(quarter)}</option>
                            ))}
                        </SelectControl>
                        <span aria-hidden>with</span>
                        <label htmlFor={previousId} className="sr-only">Previous quarter to compare with</label>
                        <SelectControl
                            id={previousId}
                            value={shownPrevious}
                            onChange={(event) => changePrevious(event.target.value)}
                            disabled={previousOptions.length === 0}
                            className="w-auto min-w-32"
                        >
                            {!shownPrevious && <option value="">{availableQuarters.length === 0 ? 'Loading…' : 'The quarter before'}</option>}
                            {previousOptions.map((quarter) => (
                                <option key={quarter} value={quarter}>{formatQuarterLabel(quarter)}</option>
                            ))}
                        </SelectControl>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => setWatchlistsOpen(true)} icon={<ListChecks className="h-4 w-4" aria-hidden />}>
                            Watchlists
                        </Button>
                        <Button size="sm" onClick={() => setHowOpen(true)} icon={<BookOpen className="h-4 w-4" aria-hidden />}>
                            How this works
                        </Button>
                        <Button size="sm" onClick={exportAuditWorkbook} loading={exporting} icon={<Download className="h-4 w-4" aria-hidden />}>
                            {exporting ? 'Exporting…' : 'Export audit workbook'}
                        </Button>
                    </div>
                </div>

                <div role="group" aria-label="Categories to include" className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-sm text-ink-muted">
                        <Term id="watchlists">Categories</Term>
                    </span>
                    {query.watchlists.map((watchlist) => (
                        <Chip
                            key={watchlist.key}
                            selected={selectedCategories.has(watchlist.key)}
                            onClick={() => toggleCategory(watchlist.key)}
                            count={watchlist.items.length}
                        >
                            {watchlist.label}
                        </Chip>
                    ))}
                </div>

                {exportError && (
                    <Notice
                        tone="error"
                        title="Couldn’t export the audit workbook"
                        action={<Button size="sm" onClick={exportAuditWorkbook} loading={exporting}>Try again</Button>}
                    >
                        {exportError}
                    </Notice>
                )}
            </div>

            {data && <Tabs items={VIEWS} value={view} onChange={setView} label="13F Radar views" idPrefix="radar-view" variant="segmented" />}

            {!data ? (
                loading ? <BodySkeleton /> : null
            ) : (
                // While a new comparison loads, keep the previous one on screen, dimmed (the takeaway says "Updating…").
                <div {...tabPanelProps('radar-view', view)} aria-busy={loading || undefined} className="transition-opacity" style={{ opacity: loading ? 0.6 : 1 }}>
                    {view === 'trends' ? (
                        data.coverage.comparableFilers === 0 ? (
                            <EmptyState
                                title="No funds to compare yet"
                                actions={
                                    season?.baselineQuarter ? (
                                        <Button variant="primary" onClick={() => viewBaseline(season.baselineQuarter!)}>
                                            View the {formatQuarterLabel(season.baselineQuarter)} comparison
                                        </Button>
                                    ) : undefined
                                }
                            >
                                No fund has filed for both {quarterLabel} and {previousLabel} yet. Pick an earlier quarter above.
                            </EmptyState>
                        ) : (
                            <div className="space-y-12">
                                <RadarSummary data={data} />
                                {result.payload && <CategoryOverview data={data} payload={result.payload} version={result.key} />}
                                <MovementTable kind="initiated" movements={data.initiations} />
                                <MovementTable kind="liquidated" movements={data.liquidations} />
                                <FilerMovesTable moves={data.topFilerMoves} />
                                <FilerTypeTrendsTable summaries={data.filerTypeSummaries} />
                                <PrivateCreditTable summaries={data.privateCreditInstitutionSummaries} />
                            </div>
                        )
                    ) : (
                        <FundsToWatch moves={data.topFilerMoves} quarterLabel={quarterLabel} previousLabel={previousLabel} />
                    )}
                </div>
            )}

            <WatchlistDialog open={watchlistsOpen} watchlists={query.watchlists} onClose={() => setWatchlistsOpen(false)} onApply={applyWatchlists} />
            <HowThisWorksDialog open={howOpen} onClose={() => setHowOpen(false)} />
        </div>
    );
}
