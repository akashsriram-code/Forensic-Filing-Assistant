"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    BarChart3,
    BookOpen,
    Database,
    Download,
    ExternalLink,
    FileSearch,
    Filter,
    Loader2,
    RefreshCw,
    Rocket,
    Search,
    Settings2,
    ShieldCheck,
    TrendingDown,
    TrendingUp,
    X,
} from 'lucide-react';
import {
    DEFAULT_RADAR_WATCHLISTS,
    hydrateEditableWatchlists,
    type CategorySummary,
    type FilerMove,
    type FilerTypeSummary,
    type PrivateCreditInstitutionSummary,
    type RadarApiResponse,
    type RadarWatchlist,
    type SecurityMovement,
    type SectorMovementSummary,
} from '@/lib/thirteen-f-radar-core';

interface ThirteenFRadarProps {
    theme: 'light' | 'dark';
}

type RadarSubtab = 'trends' | 'spacex';
type SpaceXFilter = 'holdings' | 'review' | 'narrative' | 'all';

interface SpaceXExposureRow {
    filerName: string;
    cik: string;
    form: string;
    filingDate: string;
    periodEnd: string | null;
    accessionNumber: string;
    documentName: string;
    fileDescription: string | null;
    relationshipType: string;
    confidence: number;
    matchedTerms: string[];
    securityName: string | null;
    issuerName: string | null;
    cusip: string | null;
    sharesOrBalance: number | null;
    units: string | null;
    valueUsd: number | null;
    pctValue: number | null;
    assetCategory: string | null;
    issuerCategory: string | null;
    investmentCountry: string | null;
    snippet: string;
    secDocumentUrl: string;
    secFilingUrl: string;
    openArenaStatus: string;
    openArenaNotes: string;
    notes: string;
}

interface SpaceXExposureResponse {
    generatedAt: string;
    startDate: string;
    endDate: string;
    forms: string[];
    aliases: string[];
    contextualTerms: string[];
    summary: {
        totalRows: number;
        holdingRows: number;
        narrativeRows: number;
        reviewRows: number;
        falsePositiveRows: number;
        filingsSearched: number;
        filingsFetched: number;
        searchHitsDiscovered: number;
        openArenaReviewed: number;
    };
    rows: SpaceXExposureRow[];
    reviewRows: SpaceXExposureRow[];
    warnings: string[];
    sourceCoverage: {
        forms: Record<string, number>;
        filers: Record<string, number>;
    };
}

const SPACEX_FORM_GROUPS = [
    {
        key: 'fund-holdings',
        label: 'Fund Holdings',
        forms: ['NPORT-P', 'N-PORT', 'N-CSR', 'N-CSRS', '497', '485BPOS', 'N-2'],
    },
    {
        key: '13f',
        label: '13F Check',
        forms: ['13F-HR', '13F-HR/A'],
    },
    {
        key: 'company-filings',
        label: 'Company Filings',
        forms: ['8-K', '10-K', '10-Q', '20-F', '6-K'],
    },
];

const DEFAULT_SPACEX_FORMS = SPACEX_FORM_GROUPS.flatMap((group) => group.forms);
const SPACEX_UI_MAX_FILINGS = 8;

const formatDateInput = (date: Date) => date.toISOString().slice(0, 10);

const defaultSpaceXStartDate = () => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 5);
    return formatDateInput(date);
};

const defaultSpaceXEndDate = () => formatDateInput(new Date());

const buildWatchlistText = (watchlists: RadarWatchlist[]) =>
    Object.fromEntries(
        watchlists.map((watchlist) => [
            watchlist.key,
            watchlist.items.map((item) => item.ticker).join(', '),
        ])
    );

const parseEditorList = (value: string) =>
    value
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);

const parseRadarResponse = async (res: Response): Promise<RadarApiResponse> => {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let parsed: unknown = null;

    if (contentType.includes('application/json') || text.trim().startsWith('{')) {
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error(`13F Radar returned malformed JSON (${res.status}).`);
        }
    }

    if (!res.ok) {
        const errorMessage =
            parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
                ? parsed.error
                : text.trim().slice(0, 220) || `HTTP ${res.status}`;
        throw new Error(`13F Radar failed: ${errorMessage}`);
    }

    if (!parsed) {
        const preview = text.trim().slice(0, 220);
        throw new Error(`13F Radar returned a non-JSON response${preview ? `: ${preview}` : '.'}`);
    }

    return parsed as RadarApiResponse;
};

const parseSpaceXResponse = async (res: Response): Promise<SpaceXExposureResponse> => {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let parsed: unknown = null;

    if (contentType.includes('application/json') || text.trim().startsWith('{')) {
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error(`SpaceX Exposure returned malformed JSON (${res.status}).`);
        }
    }

    if (!res.ok) {
        const errorMessage =
            parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
                ? parsed.error
                : text.trim().slice(0, 220) || `HTTP ${res.status}`;
        throw new Error(`SpaceX Exposure failed: ${errorMessage}`);
    }

    if (!parsed) {
        const preview = text.trim().slice(0, 220);
        throw new Error(`SpaceX Exposure returned a non-JSON response${preview ? `: ${preview}` : '.'}`);
    }

    return parsed as SpaceXExposureResponse;
};

const parseRadarErrorResponse = async (res: Response, fallback: string): Promise<string> => {
    const text = await res.text();
    if (text.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(text) as { error?: unknown };
            if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error;
        } catch {
            return `${fallback}: malformed error response (${res.status})`;
        }
    }

    return text.trim().slice(0, 220) || `${fallback}: HTTP ${res.status}`;
};

const getDownloadFilename = (res: Response, fallback: string): string => {
    const contentDisposition = res.headers.get('content-disposition') || '';
    const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    return filenameMatch?.[1] || fallback;
};

export function ThirteenFRadar({ theme }: ThirteenFRadarProps) {
    const isDark = theme === 'dark';
    const [activeRadarTab, setActiveRadarTab] = useState<RadarSubtab>('trends');
    const [data, setData] = useState<RadarApiResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState('');
    const [currentQuarter, setCurrentQuarter] = useState('');
    const [previousQuarter, setPreviousQuarter] = useState('');
    const [watchlists, setWatchlists] = useState<RadarWatchlist[]>(DEFAULT_RADAR_WATCHLISTS);
    const [editorText, setEditorText] = useState<Record<string, string>>(() => buildWatchlistText(DEFAULT_RADAR_WATCHLISTS));
    const [editorOpen, setEditorOpen] = useState(false);
    const [methodologyOpen, setMethodologyOpen] = useState(false);
    const [selectedCategories, setSelectedCategories] = useState<string[]>(
        DEFAULT_RADAR_WATCHLISTS.map((watchlist) => watchlist.key)
    );
    const [selectedDetailCategory, setSelectedDetailCategory] = useState<string | null>(null);
    const initialLoadRef = useRef(false);

    const panelClass = isDark ? 'border-zinc-800 bg-zinc-900/45' : 'border-gray-200 bg-white';
    const softPanelClass = isDark ? 'border-zinc-800 bg-zinc-950/35' : 'border-gray-200 bg-gray-50/70';
    const mutedText = isDark ? 'text-zinc-400' : 'text-gray-500';
    const inputClass = isDark
        ? 'bg-black/20 border-zinc-800 text-white focus:border-zinc-500'
        : 'bg-white border-gray-200 text-gray-900 focus:border-gray-400';

    const availableQuarters = data?.availableQuarters || [];

    const buildRequestPayload = useCallback((override?: {
        currentQuarter?: string;
        previousQuarter?: string;
        watchlists?: RadarWatchlist[];
        selectedCategories?: string[];
    }) => {
        const requestCurrent = override?.currentQuarter ?? (currentQuarter || undefined);
        const requestPrevious = override?.previousQuarter ?? (previousQuarter || undefined);
        const requestWatchlists = override?.watchlists ?? watchlists;
        const requestCategories = override?.selectedCategories ?? selectedCategories;

        return {
            currentQuarter: requestCurrent,
            previousQuarter: requestPrevious,
            categories: requestCategories,
            watchlists: requestWatchlists,
            movementBasis: 'filer-count',
        };
    }, [currentQuarter, previousQuarter, selectedCategories, watchlists]);

    const loadRadar = useCallback(async (override?: {
        currentQuarter?: string;
        previousQuarter?: string;
        watchlists?: RadarWatchlist[];
        selectedCategories?: string[];
    }) => {
        setLoading(true);
        setError('');

        const payload = buildRequestPayload(override);

        try {
            const res = await fetch('/api/13f-radar', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const radar = await parseRadarResponse(res);
            setData(radar);
            setWatchlists(radar.watchlists);
            setCurrentQuarter(radar.coverage.currentQuarter);
            setPreviousQuarter(radar.coverage.previousQuarter);
            setEditorText(buildWatchlistText(radar.watchlists));
        } catch (err) {
            setError(err instanceof Error ? err.message : '13F Radar failed');
        } finally {
            setLoading(false);
        }
    }, [buildRequestPayload]);

    const exportAuditWorkbook = useCallback(async () => {
        setExporting(true);
        setError('');

        try {
            const res = await fetch('/api/13f-radar/export', {
                method: 'POST',
                headers: { 'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Type': 'application/json' },
                body: JSON.stringify(buildRequestPayload()),
            });

            if (!res.ok) {
                throw new Error(await parseRadarErrorResponse(res, '13F Radar export failed'));
            }

            const blob = await res.blob();
            const fallbackFilename = `13f-radar-audit-${currentQuarter || data?.coverage.currentQuarter || 'current'}-vs-${previousQuarter || data?.coverage.previousQuarter || 'previous'}.xlsx`;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = getDownloadFilename(res, fallbackFilename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : '13F Radar export failed');
        } finally {
            setExporting(false);
        }
    }, [buildRequestPayload, currentQuarter, data?.coverage.currentQuarter, data?.coverage.previousQuarter, previousQuarter]);

    useEffect(() => {
        if (initialLoadRef.current) return;
        initialLoadRef.current = true;
        void loadRadar();
    }, [loadRadar]);

    const selectedCategorySet = useMemo(() => new Set(selectedCategories), [selectedCategories]);
    const biggestSectorBuying = useMemo(
        () => data ? findTopSectorMover(data.sectorMovers, 'buy') : null,
        [data]
    );
    const biggestSectorSelling = useMemo(
        () => data ? findTopSectorMover(data.sectorMovers, 'sell') : null,
        [data]
    );

    const toggleCategory = (key: string) => {
        setSelectedCategories((prev) => {
            if (prev.includes(key)) {
                return prev.length === 1 ? prev : prev.filter((item) => item !== key);
            }
            return [...prev, key];
        });
    };

    const applyWatchlists = () => {
        const editedItemsByKey = Object.fromEntries(
            watchlists.map((watchlist) => [watchlist.key, parseEditorList(editorText[watchlist.key] || '')])
        );
        const nextWatchlists = hydrateEditableWatchlists(DEFAULT_RADAR_WATCHLISTS, editedItemsByKey);
        setWatchlists(nextWatchlists);
        setEditorOpen(false);
        void loadRadar({ watchlists: nextWatchlists });
    };

    const refreshWithSelectedQuarters = () => {
        void loadRadar({ currentQuarter, previousQuarter });
    };

    return (
        <div className={`space-y-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            <section className={`rounded-xl border p-5 shadow-sm ${panelClass}`}>
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5 text-emerald-500" />
                            <h2 className="text-xl font-bold tracking-tight">13F Radar</h2>
                        </div>
                        <div className={`text-xs ${mutedText}`}>
                            {activeRadarTab === 'trends' && data
                                ? `${data.coverage.currentQuarter} vs ${data.coverage.previousQuarter}`
                                : activeRadarTab === 'trends'
                                    ? 'Loading comparable 13F quarters'
                                    : 'SEC full-text discovery for SpaceX holding evidence'}
                        </div>
                        <div className={`mt-3 inline-flex rounded-lg border p-1 ${isDark ? 'border-zinc-800 bg-zinc-950' : 'border-gray-200 bg-gray-50'}`}>
                            <button
                                onClick={() => setActiveRadarTab('trends')}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${activeRadarTab === 'trends'
                                    ? isDark ? 'bg-zinc-800 text-white' : 'bg-white text-gray-900 shadow-sm'
                                    : isDark ? 'text-zinc-500 hover:text-zinc-200' : 'text-gray-500 hover:text-gray-900'
                                    }`}
                            >
                                13F Trends
                            </button>
                            <button
                                onClick={() => setActiveRadarTab('spacex')}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${activeRadarTab === 'spacex'
                                    ? isDark ? 'bg-zinc-800 text-white' : 'bg-white text-gray-900 shadow-sm'
                                    : isDark ? 'text-zinc-500 hover:text-zinc-200' : 'text-gray-500 hover:text-gray-900'
                                    }`}
                            >
                                SpaceX Exposure
                            </button>
                        </div>
                    </div>

                    {activeRadarTab === 'trends' && (
                        <div className="flex flex-wrap items-end gap-3">
                            <QuarterSelect
                                label="Current"
                                value={currentQuarter}
                                quarters={availableQuarters}
                                inputClass={inputClass}
                                onChange={setCurrentQuarter}
                            />
                            <QuarterSelect
                                label="Previous"
                                value={previousQuarter}
                                quarters={availableQuarters.filter((quarter) => quarter !== currentQuarter)}
                                inputClass={inputClass}
                                onChange={setPreviousQuarter}
                            />
                            <button
                                onClick={refreshWithSelectedQuarters}
                                disabled={loading}
                                className={`flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50 ${isDark ? 'bg-white text-black hover:bg-zinc-200' : 'bg-gray-900 text-white hover:bg-black'}`}
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                Run
                            </button>
                            <button
                                onClick={exportAuditWorkbook}
                                disabled={exporting}
                                className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium disabled:opacity-50 ${isDark ? 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                            >
                                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                {exporting ? 'Exporting...' : 'Export Audit Workbook'}
                            </button>
                            <button
                                onClick={() => setMethodologyOpen((open) => !open)}
                                className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${isDark ? 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                            >
                                <BookOpen className="h-4 w-4" />
                                Methodology
                            </button>
                            <button
                                onClick={() => setEditorOpen((open) => !open)}
                                className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${isDark ? 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                            >
                                <Settings2 className="h-4 w-4" />
                                Watchlists
                            </button>
                        </div>
                    )}
                </div>

                {activeRadarTab === 'trends' && <div className="mt-5 flex flex-wrap gap-2">
                    {watchlists.map((watchlist) => {
                        const selected = selectedCategorySet.has(watchlist.key);
                        return (
                            <button
                                key={watchlist.key}
                                onClick={() => toggleCategory(watchlist.key)}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${selected
                                    ? isDark
                                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : isDark
                                        ? 'border-zinc-800 bg-zinc-950 text-zinc-500'
                                        : 'border-gray-200 bg-gray-50 text-gray-500'
                                    }`}
                            >
                                <Filter className="h-3.5 w-3.5" />
                                {watchlist.label}
                                <span className="font-mono opacity-60">{watchlist.items.length}</span>
                            </button>
                        );
                    })}
                </div>}

                {activeRadarTab === 'trends' && editorOpen && (
                    <div className={`mt-5 rounded-xl border p-4 ${softPanelClass}`}>
                        <div className="mb-4 flex items-center justify-between">
                            <div className="text-sm font-semibold">Editable Watchlists</div>
                            <button
                                onClick={() => setEditorOpen(false)}
                                className={`rounded-md p-2 ${isDark ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'}`}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {watchlists.map((watchlist) => (
                                <label key={watchlist.key} className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                            {watchlist.label}
                                        </span>
                                        <span className={`text-[11px] ${mutedText}`}>
                                            {parseEditorList(editorText[watchlist.key] || '').length} names
                                        </span>
                                    </div>
                                    <textarea
                                        value={editorText[watchlist.key] || ''}
                                        onChange={(event) =>
                                            setEditorText((prev) => ({
                                                ...prev,
                                                [watchlist.key]: event.target.value,
                                            }))
                                        }
                                        className={`min-h-24 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs outline-none ${inputClass}`}
                                    />
                                </label>
                            ))}
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={applyWatchlists}
                                className={`rounded-lg px-4 py-2 text-sm font-medium ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                )}

                {activeRadarTab === 'trends' && methodologyOpen && (
                    <MethodologyPanel
                        theme={theme}
                        softPanelClass={softPanelClass}
                        mutedText={mutedText}
                        onClose={() => setMethodologyOpen(false)}
                    />
                )}
            </section>

            {activeRadarTab === 'trends' && error && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${isDark ? 'border-red-900/70 bg-red-950/30 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {error}
                </div>
            )}

            {activeRadarTab === 'trends' && loading && !data && (
                <div className={`rounded-xl border p-10 text-center ${panelClass}`}>
                    <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-emerald-500" />
                    <div className={`text-sm ${mutedText}`}>Scanning ingested 13F holdings...</div>
                </div>
            )}

            {activeRadarTab === 'spacex' && (
                <SpaceXExposurePanel
                    theme={theme}
                    panelClass={panelClass}
                    softPanelClass={softPanelClass}
                    inputClass={inputClass}
                    mutedText={mutedText}
                />
            )}

            {activeRadarTab === 'trends' && data && (
                <>
                    <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
                        <MetricCard
                            theme={theme}
                            label="Comparable Filers"
                            value={formatNumber(data.coverage.comparableFilers)}
                            sub={`${formatNumber(data.coverage.currentFilers)} current / ${formatNumber(data.coverage.previousFilers)} previous`}
                        />
                        <MetricCard
                            theme={theme}
                            label="Watched Filers"
                            value={formatNumber(data.coverage.watchedFilers)}
                            sub={`${formatNumber(data.coverage.watchedHoldingRows)} matched rows`}
                        />
                        <MetricCard
                            theme={theme}
                            label="Biggest Sector Buying"
                            value={biggestSectorBuying?.sector || 'N/A'}
                            sub={biggestSectorBuying
                                ? `${formatNumber(biggestSectorBuying.buyers)} buyers (${formatPct(biggestSectorBuying.buyerPctOfComparable)} comparable), net ${formatSignedNumber(biggestSectorBuying.netBuyers)}`
                                : 'Watched-universe sector movers'}
                        />
                        <MetricCard
                            theme={theme}
                            label="Biggest Sector Selling"
                            value={biggestSectorSelling?.sector || 'N/A'}
                            sub={biggestSectorSelling
                                ? `${formatNumber(biggestSectorSelling.sellers)} sellers (${formatPct(biggestSectorSelling.sellerPctOfComparable)} comparable), net ${formatSignedNumber(biggestSectorSelling.netBuyers)}`
                                : 'Watched-universe sector movers'}
                        />
                    </section>

                    {data.notes.length > 0 && (
                        <div className={`rounded-xl border p-4 text-xs ${isDark ? 'border-amber-900/60 bg-amber-950/20 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                            <div className="mb-2 flex items-center gap-2 font-semibold">
                                <AlertTriangle className="h-4 w-4" />
                                Data Notes
                            </div>
                            <div className="grid gap-1 md:grid-cols-2">
                                {data.notes.map((note) => (
                                    <div key={note}>{note}</div>
                                ))}
                            </div>
                        </div>
                    )}

                    <section className={`rounded-xl border ${panelClass}`}>
                        <div className={`border-b px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                            <h3 className="text-sm font-bold">Overview</h3>
                            <div className={`mt-1 text-xs ${mutedText}`}>Click a category card to see holders sorted by shares</div>
                        </div>
                        <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0 lg:grid-cols-3 lg:divide-x">
                            {data.categorySummaries.map((summary) => (
                                <ConsensusCard 
                                    key={summary.key} 
                                    theme={theme} 
                                    summary={summary}
                                    isSelected={selectedDetailCategory === summary.key}
                                    onClick={() => setSelectedDetailCategory(selectedDetailCategory === summary.key ? null : summary.key)}
                                />
                            ))}
                        </div>
                        {selectedDetailCategory && (
                            <CategoryHoldersPanel
                                theme={theme}
                                categoryKey={selectedDetailCategory}
                                categoryLabel={data.categorySummaries.find((cat) => cat.key === selectedDetailCategory)?.label || selectedDetailCategory}
                                moves={data.topFilerMoves.filter((move) => move.categoryKey === selectedDetailCategory)}
                                onClose={() => setSelectedDetailCategory(null)}
                            />
                        )}
                    </section>

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <MovementTable
                            theme={theme}
                            title="Brand-New Positions"
                            movements={data.initiations}
                            countKey="initiatedFilers"
                            sampleKey="sampleInitiators"
                            emptyLabel="No initiations found for the selected watchlists."
                        />
                        <MovementTable
                            theme={theme}
                            title="Liquidated Positions"
                            movements={data.liquidations}
                            countKey="liquidatedFilers"
                            sampleKey="sampleLiquidators"
                            emptyLabel="No liquidations found for the selected watchlists."
                        />
                    </div>

                    <section className={`rounded-xl border ${panelClass}`}>
                        <div className={`border-b px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                            <h3 className="text-sm font-bold">Top Filer Moves</h3>
                        </div>
                        <FilerMovesTable theme={theme} moves={data.topFilerMoves} />
                    </section>

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <section className={`rounded-xl border ${panelClass}`}>
                            <div className={`border-b px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                                <h3 className="text-sm font-bold">Filer Type Trends</h3>
                                <div className={`mt-1 text-xs ${mutedText}`}>First-pass CIK/name classification; use as a reporting lead, not final taxonomy.</div>
                            </div>
                            <FilerTypeTrendsTable theme={theme} summaries={data.filerTypeSummaries} />
                        </section>

                        <section className={`rounded-xl border ${panelClass}`}>
                            <div className={`border-b px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                                <h3 className="text-sm font-bold">Private Credit Institutions</h3>
                                <div className={`mt-1 text-xs ${mutedText}`}>Pension, public-fund, and endowment filers with BDC/private-credit exposure.</div>
                            </div>
                            <PrivateCreditTable theme={theme} summaries={data.privateCreditInstitutionSummaries} />
                        </section>
                    </div>
                </>
            )}
        </div>
    );
}

function SpaceXExposurePanel({
    theme,
    panelClass,
    softPanelClass,
    inputClass,
    mutedText,
}: {
    theme: 'light' | 'dark';
    panelClass: string;
    softPanelClass: string;
    inputClass: string;
    mutedText: string;
}) {
    const isDark = theme === 'dark';
    const [data, setData] = useState<SpaceXExposureResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState('');
    const [startDate, setStartDate] = useState(defaultSpaceXStartDate);
    const [endDate, setEndDate] = useState(defaultSpaceXEndDate);
    const [maxFilings, setMaxFilings] = useState(5);
    const [selectedForms, setSelectedForms] = useState<string[]>(DEFAULT_SPACEX_FORMS);
    const [aiVerify, setAiVerify] = useState(false);
    const [filter, setFilter] = useState<SpaceXFilter>('holdings');

    const payload = useMemo(() => ({
        startDate,
        endDate,
        forms: selectedForms,
        maxFilings,
        aiVerify,
    }), [aiVerify, endDate, maxFilings, selectedForms, startDate]);

    const visibleRows = useMemo(() => {
        const rows = data?.rows || [];
        if (filter === 'all') return rows;
        if (filter === 'holdings') return rows.filter((row) => isSpaceXHoldingRow(row));
        if (filter === 'review') return rows.filter((row) => isSpaceXReviewRow(row));
        return rows.filter((row) => row.relationshipType === 'commercial_context');
    }, [data?.rows, filter]);

    const runExposure = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/spacex-exposure-radar', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const parsed = await parseSpaceXResponse(res);
            setData(parsed);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'SpaceX Exposure failed');
        } finally {
            setLoading(false);
        }
    }, [payload]);

    const exportWorkbook = useCallback(async () => {
        setExporting(true);
        setError('');
        try {
            const res = await fetch('/api/spacex-exposure-radar/export', {
                method: 'POST',
                headers: { 'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                throw new Error(await parseRadarErrorResponse(res, 'SpaceX Exposure export failed'));
            }

            const blob = await res.blob();
            const fallbackFilename = `spacex-exposure-radar-${startDate}-to-${endDate}.xlsx`;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = getDownloadFilename(res, fallbackFilename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'SpaceX Exposure export failed');
        } finally {
            setExporting(false);
        }
    }, [endDate, payload, startDate]);

    const toggleFormGroup = (forms: string[]) => {
        setSelectedForms((current) => {
            const allSelected = forms.every((form) => current.includes(form));
            if (allSelected && current.length > forms.length) {
                return current.filter((form) => !forms.includes(form));
            }
            return Array.from(new Set([...current, ...forms]));
        });
    };

    return (
        <div className="space-y-6">
            <section className={`rounded-xl border p-5 shadow-sm ${panelClass}`}>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <label className="space-y-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Start</span>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(event) => setStartDate(event.target.value)}
                                className={`h-10 w-full rounded-lg border px-3 text-sm outline-none ${inputClass}`}
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">End</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(event) => setEndDate(event.target.value)}
                                className={`h-10 w-full rounded-lg border px-3 text-sm outline-none ${inputClass}`}
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">SEC Fetch Cap</span>
                            <input
                                type="number"
                                min={1}
                                max={SPACEX_UI_MAX_FILINGS}
                                value={maxFilings}
                                onChange={(event) => setMaxFilings(Math.min(SPACEX_UI_MAX_FILINGS, Math.max(1, Number.parseInt(event.target.value || '1', 10))))}
                                className={`h-10 w-full rounded-lg border px-3 text-sm outline-none ${inputClass}`}
                            />
                        </label>
                    </div>

                    <div className="flex flex-wrap items-end justify-start gap-3 lg:justify-end">
                        <label className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm ${isDark ? 'border-zinc-800 bg-zinc-900' : 'border-gray-200 bg-white'}`}>
                            <input
                                type="checkbox"
                                checked={aiVerify}
                                onChange={(event) => setAiVerify(event.target.checked)}
                                className="h-4 w-4"
                            />
                            <ShieldCheck className="h-4 w-4 text-emerald-500" />
                            OpenArena
                        </label>
                        <button
                            onClick={runExposure}
                            disabled={loading || selectedForms.length === 0}
                            className={`flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50 ${isDark ? 'bg-white text-black hover:bg-zinc-200' : 'bg-gray-900 text-white hover:bg-black'}`}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            {loading ? 'Running...' : 'Run Exposure'}
                        </button>
                        <button
                            onClick={exportWorkbook}
                            disabled={exporting || loading}
                            className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium disabled:opacity-50 ${isDark ? 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                        >
                            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            {exporting ? 'Exporting...' : 'Export Workbook'}
                        </button>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    {SPACEX_FORM_GROUPS.map((group) => {
                        const selected = group.forms.every((form) => selectedForms.includes(form));
                        return (
                            <button
                                key={group.key}
                                onClick={() => toggleFormGroup(group.forms)}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${selected
                                    ? isDark ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-sky-200 bg-sky-50 text-sky-700'
                                    : isDark ? 'border-zinc-800 bg-zinc-950 text-zinc-500' : 'border-gray-200 bg-gray-50 text-gray-500'
                                    }`}
                            >
                                <FileSearch className="h-3.5 w-3.5" />
                                {group.label}
                                <span className="font-mono opacity-60">{group.forms.length}</span>
                            </button>
                        );
                    })}
                </div>

                <div className={`mt-4 rounded-lg border px-3 py-2 text-xs ${isDark ? 'border-amber-900/60 bg-amber-950/20 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    This synchronous deployment run fetches up to {SPACEX_UI_MAX_FILINGS} SEC source documents. 13F Check is limited to Section 13(f) reportable securities; private SpaceX holdings are more likely in N-PORT and fund schedule disclosures.
                </div>
            </section>

            {error && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${isDark ? 'border-red-900/70 bg-red-950/30 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {error}
                </div>
            )}

            {loading && !data && (
                <div className={`rounded-xl border p-10 text-center ${panelClass}`}>
                    <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-sky-500" />
                    <div className={`text-sm ${mutedText}`}>Searching SEC filings for SpaceX exposure...</div>
                </div>
            )}

            {data ? (
                <>
                    <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
                        <MetricCard theme={theme} label="Holdings" value={formatNumber(data.summary.holdingRows)} sub={`${formatNumber(data.summary.totalRows)} total classified rows`} />
                        <MetricCard theme={theme} label="Review" value={formatNumber(data.summary.reviewRows)} sub={`${formatNumber(data.summary.openArenaReviewed)} OpenArena checks`} />
                        <MetricCard theme={theme} label="Narrative" value={formatNumber(data.summary.narrativeRows)} sub="Commercial and operational context" />
                        <MetricCard theme={theme} label="Fetched" value={formatNumber(data.summary.filingsFetched)} sub={`${formatNumber(data.summary.searchHitsDiscovered)} SEC search hits`} />
                    </section>

                    {data.warnings.length > 0 && (
                        <div className={`rounded-xl border p-4 text-xs ${isDark ? 'border-amber-900/60 bg-amber-950/20 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                            <div className="mb-2 flex items-center gap-2 font-semibold">
                                <AlertTriangle className="h-4 w-4" />
                                Run Warnings
                            </div>
                            <div className="grid gap-1 md:grid-cols-2">
                                {data.warnings.map((warning) => (
                                    <div key={warning}>{warning}</div>
                                ))}
                            </div>
                        </div>
                    )}

                    <section className={`rounded-xl border ${panelClass}`}>
                        <div className={`flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                            <div>
                                <h3 className="text-sm font-bold">SpaceX Evidence</h3>
                                <div className={`mt-1 text-xs ${mutedText}`}>
                                    {data.startDate} to {data.endDate}; {data.forms.length} forms searched
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(['holdings', 'review', 'narrative', 'all'] as SpaceXFilter[]).map((option) => (
                                    <button
                                        key={option}
                                        onClick={() => setFilter(option)}
                                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize ${filter === option
                                            ? isDark ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-sky-200 bg-sky-50 text-sky-700'
                                            : isDark ? 'border-zinc-800 bg-zinc-950 text-zinc-500' : 'border-gray-200 bg-gray-50 text-gray-500'
                                            }`}
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <SpaceXRowsTable theme={theme} rows={visibleRows} />
                    </section>

                    <section className={`rounded-xl border p-4 ${softPanelClass}`}>
                        <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                            <Rocket className="h-4 w-4 text-sky-500" />
                            Source Coverage
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <CoverageList title="Forms" values={data.sourceCoverage.forms} mutedText={mutedText} />
                            <CoverageList title="Top Filers" values={data.sourceCoverage.filers} mutedText={mutedText} />
                        </div>
                    </section>
                </>
            ) : !loading && (
                <div className={`rounded-xl border p-10 text-center ${panelClass}`}>
                    <Rocket className="mx-auto mb-3 h-7 w-7 text-sky-500" />
                    <div className="text-sm font-semibold">Ready to search SpaceX exposure</div>
                    <div className={`mt-1 text-xs ${mutedText}`}>Run the default five-year scan or narrow the filing groups first.</div>
                </div>
            )}
        </div>
    );
}

function QuarterSelect({
    label,
    value,
    quarters,
    inputClass,
    onChange,
}: {
    label: string;
    value: string;
    quarters: string[];
    inputClass: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="space-y-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className={`h-10 min-w-32 rounded-lg border px-3 text-sm outline-none ${inputClass}`}
            >
                {!value && <option value="">Auto</option>}
                {quarters.map((quarter) => (
                    <option key={quarter} value={quarter}>
                        {quarter}
                    </option>
                ))}
            </select>
        </label>
    );
}

function SpaceXRowsTable({ theme, rows }: { theme: 'light' | 'dark'; rows: SpaceXExposureRow[] }) {
    const isDark = theme === 'dark';
    const tableHead = isDark ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700';

    if (rows.length === 0) {
        return (
            <div className={`px-5 py-8 text-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                No rows match this filter.
            </div>
        );
    }

    return (
        <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className={`sticky top-0 text-xs uppercase ${tableHead}`}>
                    <tr>
                        <th className="px-5 py-3">Filer</th>
                        <th className="px-5 py-3">Evidence</th>
                        <th className="px-5 py-3">Security</th>
                        <th className="px-5 py-3 text-right">Value</th>
                        <th className="px-5 py-3 text-right">Balance</th>
                        <th className="px-5 py-3">Snippet</th>
                        <th className="px-5 py-3">Source</th>
                    </tr>
                </thead>
                <tbody className={`divide-y ${tableDivide}`}>
                    {rows.slice(0, 120).map((row) => (
                        <tr key={`${row.accessionNumber}-${row.documentName}-${row.relationshipType}-${row.securityName || row.snippet.slice(0, 32)}`}>
                            <td className="px-5 py-3 align-top">
                                <div className="max-w-56 font-medium">{row.filerName}</div>
                                <div className="mt-1 font-mono text-[11px] opacity-50">CIK {row.cik}</div>
                                <div className="mt-1 text-[11px] opacity-60">{row.form} filed {row.filingDate}</div>
                            </td>
                            <td className="px-5 py-3 align-top">
                                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${spaceXRelationshipClass(row.relationshipType, isDark)}`}>
                                    {formatRelationship(row.relationshipType)}
                                </span>
                                <div className="mt-2 font-mono text-[11px] opacity-60">{formatConfidence(row.confidence)}</div>
                                {row.openArenaStatus !== 'not_requested' && (
                                    <div className="mt-1 text-[11px] text-sky-500">OpenArena: {row.openArenaStatus}</div>
                                )}
                            </td>
                            <td className="px-5 py-3 align-top">
                                <div className="max-w-56 font-medium">{row.securityName || row.issuerName || 'N/A'}</div>
                                <div className="mt-1 font-mono text-[11px] opacity-50">{row.cusip || 'No CUSIP'}</div>
                                <div className="mt-1 text-[11px] opacity-60">
                                    {[row.assetCategory, row.issuerCategory, row.investmentCountry].filter(Boolean).join(' / ') || row.matchedTerms.join(', ')}
                                </div>
                            </td>
                            <td className="px-5 py-3 text-right align-top font-mono text-xs">
                                {row.valueUsd !== null ? formatMoney(row.valueUsd) : 'N/A'}
                                {row.pctValue !== null && <div className="mt-1 opacity-60">{formatPct(row.pctValue)}</div>}
                            </td>
                            <td className="px-5 py-3 text-right align-top font-mono text-xs">
                                {row.sharesOrBalance !== null ? formatNumber(row.sharesOrBalance) : 'N/A'}
                                {row.units && <div className="mt-1 opacity-60">{row.units}</div>}
                            </td>
                            <td className="max-w-md px-5 py-3 align-top text-xs opacity-80">
                                {row.snippet || row.notes || 'N/A'}
                                {row.openArenaNotes && <div className="mt-2 text-sky-500">{row.openArenaNotes}</div>}
                            </td>
                            <td className="px-5 py-3 align-top text-xs">
                                <div className="flex flex-col gap-2">
                                    <a className="inline-flex items-center gap-1 text-sky-500 hover:underline" href={row.secDocumentUrl} target="_blank" rel="noreferrer">
                                        Document <ExternalLink className="h-3 w-3" />
                                    </a>
                                    <a className="inline-flex items-center gap-1 text-sky-500 hover:underline" href={row.secFilingUrl} target="_blank" rel="noreferrer">
                                        Filing <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {rows.length > 120 && (
                <div className={`border-t px-5 py-3 text-xs ${isDark ? 'border-zinc-800 text-zinc-500' : 'border-gray-100 text-gray-500'}`}>
                    Showing first 120 of {formatNumber(rows.length)} rows. Use the workbook export for the full set.
                </div>
            )}
        </div>
    );
}

function CoverageList({ title, values, mutedText }: { title: string; values: Record<string, number>; mutedText: string }) {
    const entries = Object.entries(values).slice(0, 8);
    return (
        <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</div>
            <div className={`mt-2 space-y-2 text-sm ${mutedText}`}>
                {entries.length > 0 ? entries.map(([label, count]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                        <span className="truncate">{label}</span>
                        <span className="font-mono">{formatNumber(count)}</span>
                    </div>
                )) : (
                    <div>No coverage yet.</div>
                )}
            </div>
        </div>
    );
}

function MetricCard({ theme, label, value, sub }: { theme: 'light' | 'dark'; label: string; value: string; sub: string }) {
    const isDark = theme === 'dark';
    return (
        <div className={`rounded-xl border p-4 ${isDark ? 'border-zinc-800 bg-zinc-900/45' : 'border-gray-200 bg-white'}`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
            <div className="mt-2 font-mono text-2xl font-bold">{value}</div>
            <div className={`mt-1 text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>{sub}</div>
        </div>
    );
}

function ConsensusCard({ theme, summary, onClick, isSelected }: { theme: 'light' | 'dark'; summary: CategorySummary; onClick?: () => void; isSelected?: boolean }) {
    const isDark = theme === 'dark';
    return (
        <div 
            className={`p-5 cursor-pointer transition-colors ${isDark ? 'border-zinc-800' : 'border-gray-100'} ${isSelected ? (isDark ? 'bg-zinc-800/50 ring-2 ring-emerald-500/40' : 'bg-emerald-50/50 ring-2 ring-emerald-200') : (isDark ? 'hover:bg-zinc-800/30' : 'hover:bg-gray-50')}`}
            onClick={onClick}
        >
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-bold">{summary.label}</div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                        {formatCountPct(summary.exposedFilers, summary.exposedPctOfComparable)} exposed filers; held in either compared quarter
                    </div>
                </div>
                <Database className="h-4 w-4 text-gray-400" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
                <SignalBlock
                    label="Buyers"
                    value={formatCountPct(summary.buyers, summary.buyerPctOfComparable)}
                    sub={`${formatPct(summary.buyerPctOfExposed)} of exposed`}
                    tone="buy"
                />
                <SignalBlock
                    label="Sellers"
                    value={formatCountPct(summary.sellers, summary.sellerPctOfComparable)}
                    sub={`${formatPct(summary.sellerPctOfExposed)} of exposed`}
                    tone="sell"
                />
            </div>
            <div className={`mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                <MetricLine label="Current holders" value={formatCountPct(summary.currentHolders, summary.currentHolderPctOfComparable)} />
                <MetricLine label="Prior holders" value={formatCountPct(summary.previousHolders, summary.previousHolderPctOfComparable)} />
                <MetricLine label="Initiated" value={`${formatNumber(summary.initiatedFilers)} (${formatPct(summary.initiatedPctOfExposed)} exposed)`} />
                <MetricLine label="Liquidated" value={`${formatNumber(summary.liquidatedFilers)} (${formatPct(summary.liquidatedPctOfExposed)} exposed)`} />
                <MetricLine label="Unchanged" value={formatNumber(summary.unchangedFilers)} />
                <MetricLine label="Net buyers" value={formatSignedNumber(summary.buyers - summary.sellers)} />
            </div>
            <div className={`mt-3 text-[11px] leading-relaxed ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                Initiated is a subset of buyers; liquidated is a subset of sellers. Comparable means filers with both quarter filings.
            </div>
        </div>
    );
}

function SignalBlock({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'buy' | 'sell' }) {
    const toneClass = tone === 'buy' ? 'text-emerald-500' : 'text-red-500';
    return (
        <div>
            <div className={`flex items-center gap-1 text-xs font-semibold ${toneClass}`}>
                {tone === 'buy' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {label}
            </div>
            <div className="mt-1 font-mono text-lg font-bold">{value}</div>
            <div className="text-xs text-gray-500">{sub}</div>
        </div>
    );
}

function MetricLine({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span>{label}</span>
            <span className="font-mono">{value}</span>
        </div>
    );
}

function MovementTable({
    theme,
    title,
    movements,
    countKey,
    sampleKey,
    emptyLabel,
}: {
    theme: 'light' | 'dark';
    title: string;
    movements: SecurityMovement[];
    countKey: 'initiatedFilers' | 'liquidatedFilers';
    sampleKey: 'sampleInitiators' | 'sampleLiquidators';
    emptyLabel: string;
}) {
    const isDark = theme === 'dark';
    const panelClass = isDark ? 'border-zinc-800 bg-zinc-900/45' : 'border-gray-200 bg-white';
    const tableHead = isDark ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700';

    return (
        <section className={`rounded-xl border ${panelClass}`}>
            <div className={`border-b px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                <h3 className="text-sm font-bold">{title}</h3>
            </div>
            {movements.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className={`text-xs uppercase ${tableHead}`}>
                            <tr>
                                <th className="px-5 py-3">Issuer</th>
                                <th className="px-5 py-3">Category</th>
                                <th className="px-5 py-3 text-right">Filers</th>
                                <th className="px-5 py-3">Examples</th>
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${tableDivide}`}>
                            {movements.slice(0, 20).map((movement) => (
                                <tr key={`${movement.categoryKey}-${movement.cusip || movement.issuer}-${title}`}>
                                    <td className="px-5 py-3">
                                        <div className="font-medium">{movement.issuer}</div>
                                        <div className="font-mono text-[11px] opacity-50">{movement.cusip || 'No CUSIP'}</div>
                                    </td>
                                    <td className="px-5 py-3 text-xs">{movement.categoryLabel}</td>
                                    <td className="px-5 py-3 text-right font-mono text-sm font-bold">{movement[countKey]}</td>
                                    <td className="max-w-72 px-5 py-3 text-xs opacity-75">{movement[sampleKey].join(', ') || 'N/A'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className={`px-5 py-8 text-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    {emptyLabel}
                </div>
            )}
        </section>
    );
}

function FilerMovesTable({ theme, moves }: { theme: 'light' | 'dark'; moves: FilerMove[] }) {
    const isDark = theme === 'dark';
    const tableHead = isDark ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700';

    if (moves.length === 0) {
        return (
            <div className={`px-5 py-8 text-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                No filer moves found for the selected watchlists.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className={`text-xs uppercase ${tableHead}`}>
                    <tr>
                        <th className="px-5 py-3">Filer</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3">Action</th>
                        <th className="px-5 py-3 text-right">Value Delta</th>
                        <th className="px-5 py-3 text-right">New</th>
                        <th className="px-5 py-3 text-right">Gone</th>
                        <th className="px-5 py-3">Drivers</th>
                    </tr>
                </thead>
                <tbody className={`divide-y ${tableDivide}`}>
                    {moves.slice(0, 30).map((move) => (
                        <tr key={`${move.cik}-${move.categoryKey}-${move.action}`}>
                            <td className="px-5 py-3">
                                <div className="font-medium">{move.fundName}</div>
                                <div className="font-mono text-[11px] opacity-50">CIK {move.cik}</div>
                            </td>
                            <td className="px-5 py-3 text-xs">{move.categoryLabel}</td>
                            <td className="px-5 py-3">
                                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${actionClass(move.action, isDark)}`}>
                                    {move.action}
                                </span>
                            </td>
                            <td className={`px-5 py-3 text-right font-mono text-xs ${move.valueDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {formatSignedMoney(move.valueDelta)}
                            </td>
                            <td className="px-5 py-3 text-right font-mono text-xs">{move.initiatedCount}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs">{move.liquidatedCount}</td>
                            <td className="max-w-80 px-5 py-3 text-xs opacity-75">
                                {move.details.slice(0, 5).map((detail) => `${detail.label}: ${detail.action}`).join(', ') || 'N/A'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function FilerTypeTrendsTable({ theme, summaries }: { theme: 'light' | 'dark'; summaries: FilerTypeSummary[] }) {
    const isDark = theme === 'dark';
    const tableHead = isDark ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700';

    if (summaries.length === 0) {
        return (
            <div className={`px-5 py-8 text-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                No filer-type trends found for the selected watchlists.
            </div>
        );
    }

    return (
        <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left text-sm">
                <thead className={`sticky top-0 text-xs uppercase ${tableHead}`}>
                    <tr>
                        <th className="px-5 py-3">Filer Type</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3 text-right">Exposed</th>
                        <th className="px-5 py-3 text-right">Buyers</th>
                        <th className="px-5 py-3 text-right">Sellers</th>
                        <th className="px-5 py-3 text-right">Net</th>
                        <th className="px-5 py-3 text-right">New</th>
                        <th className="px-5 py-3 text-right">Gone</th>
                    </tr>
                </thead>
                <tbody className={`divide-y ${tableDivide}`}>
                    {summaries.slice(0, 60).map((summary) => (
                        <tr key={`${summary.filerType}-${summary.categoryKey}`}>
                            <td className="px-5 py-3 font-medium">{summary.filerType}</td>
                            <td className="px-5 py-3 text-xs">{summary.categoryLabel}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs">{formatNumber(summary.exposedFilers)}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs text-emerald-500">{formatNumber(summary.buyers)}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs text-red-500">{formatNumber(summary.sellers)}</td>
                            <td className={`px-5 py-3 text-right font-mono text-xs ${summary.netBuyers >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {formatSignedNumber(summary.netBuyers)}
                            </td>
                            <td className="px-5 py-3 text-right font-mono text-xs">{formatNumber(summary.initiatedFilers)}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs">{formatNumber(summary.liquidatedFilers)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function PrivateCreditTable({ theme, summaries }: { theme: 'light' | 'dark'; summaries: PrivateCreditInstitutionSummary[] }) {
    const isDark = theme === 'dark';
    const tableHead = isDark ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700';

    if (summaries.length === 0) {
        return (
            <div className={`px-5 py-8 text-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                No pension, public-fund, or endowment private-credit matches in this comparison.
            </div>
        );
    }

    return (
        <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left text-sm">
                <thead className={`sticky top-0 text-xs uppercase ${tableHead}`}>
                    <tr>
                        <th className="px-5 py-3">Filer</th>
                        <th className="px-5 py-3">Type</th>
                        <th className="px-5 py-3">Action</th>
                        <th className="px-5 py-3 text-right">Value Delta</th>
                        <th className="px-5 py-3">Current Items</th>
                        <th className="px-5 py-3">New / Gone</th>
                    </tr>
                </thead>
                <tbody className={`divide-y ${tableDivide}`}>
                    {summaries.slice(0, 60).map((summary) => (
                        <tr key={`${summary.cik}-${summary.action}-${summary.currentItems.join('|')}`}>
                            <td className="px-5 py-3">
                                <div className="font-medium">{summary.fundName}</div>
                                <div className="font-mono text-[11px] opacity-50">CIK {summary.cik}</div>
                            </td>
                            <td className="px-5 py-3 text-xs">{summary.filerType}</td>
                            <td className="px-5 py-3">
                                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${actionClass(summary.action, isDark)}`}>
                                    {summary.action}
                                </span>
                            </td>
                            <td className={`px-5 py-3 text-right font-mono text-xs ${summary.valueDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {formatSignedMoney(summary.valueDelta)}
                            </td>
                            <td className="max-w-64 px-5 py-3 text-xs opacity-75">{summary.currentItems.join(', ') || 'None'}</td>
                            <td className="max-w-64 px-5 py-3 text-xs opacity-75">
                                {[summary.initiatedItems.length ? `New: ${summary.initiatedItems.join(', ')}` : '', summary.liquidatedItems.length ? `Gone: ${summary.liquidatedItems.join(', ')}` : '']
                                    .filter(Boolean)
                                    .join(' | ') || 'No item-level new/gone'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CategoryHoldersPanel({
    theme,
    categoryKey,
    categoryLabel,
    moves,
    onClose,
}: {
    theme: 'light' | 'dark';
    categoryKey: string;
    categoryLabel: string;
    moves: FilerMove[];
    onClose: () => void;
}) {
    const isDark = theme === 'dark';
    const tableHead = isDark ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700';
    
    // Sort by current shares descending
    const sortedMoves = useMemo(() => {
        return [...moves].sort((a, b) => b.currentShares - a.currentShares);
    }, [moves]);

    return (
        <div className={`border-t ${isDark ? 'border-zinc-800 bg-zinc-950/50' : 'border-gray-100 bg-gray-50/50'}`}>
            <div className={`flex items-center justify-between gap-3 px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                <div>
                    <div className="text-sm font-bold">{categoryLabel} Holders</div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                        {formatNumber(sortedMoves.length)} filers sorted by current shares held
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className={`rounded-md p-2 ${isDark ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'}`}
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
            {sortedMoves.length > 0 ? (
                <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-left text-sm">
                        <thead className={`sticky top-0 text-xs uppercase ${tableHead}`}>
                            <tr>
                                <th className="px-5 py-3">Fund Name</th>
                                <th className="px-5 py-3">CIK</th>
                                <th className="px-5 py-3">Action</th>
                                <th className="px-5 py-3 text-right">Current Shares</th>
                                <th className="px-5 py-3 text-right">Previous Shares</th>
                                <th className="px-5 py-3 text-right">Current Value</th>
                                <th className="px-5 py-3 text-right">Value Delta</th>
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${tableDivide}`}>
                            {sortedMoves.slice(0, 100).map((move) => (
                                <tr key={`${move.cik}-${move.categoryKey}`}>
                                    <td className="px-5 py-3 font-medium">{move.fundName}</td>
                                    <td className="px-5 py-3 font-mono text-xs opacity-60">{move.cik}</td>
                                    <td className="px-5 py-3">
                                        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${actionClass(move.action, isDark)}`}>
                                            {move.action}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right font-mono text-sm font-bold">
                                        {formatNumber(move.currentShares)}
                                    </td>
                                    <td className="px-5 py-3 text-right font-mono text-xs opacity-70">
                                        {formatNumber(move.previousShares)}
                                    </td>
                                    <td className="px-5 py-3 text-right font-mono text-xs">
                                        {formatMoney(move.currentValue)}
                                    </td>
                                    <td className={`px-5 py-3 text-right font-mono text-xs ${move.valueDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {formatSignedMoney(move.valueDelta)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {sortedMoves.length > 100 && (
                        <div className={`border-t px-5 py-3 text-xs ${isDark ? 'border-zinc-800 text-zinc-500' : 'border-gray-100 text-gray-500'}`}>
                            Showing top 100 of {formatNumber(sortedMoves.length)} holders. Use the workbook export for the full list.
                        </div>
                    )}
                </div>
            ) : (
                <div className={`px-5 py-8 text-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    No holders found for {categoryLabel}.
                </div>
            )}
        </div>
    );
}

function MethodologyPanel({
    theme,
    softPanelClass,
    mutedText,
    onClose,
}: {
    theme: 'light' | 'dark';
    softPanelClass: string;
    mutedText: string;
    onClose: () => void;
}) {
    const isDark = theme === 'dark';
    const terms = [
        ['Comparable filers', 'Filers with latest filings in both selected quarters.'],
        ['Exposed filers', 'Comparable filers that held a watched category in either compared quarter.'],
        ['Buyers / sellers', 'Aggregate watched shares rose or fell for that filer and category.'],
        ['Initiated / liquidated', 'Zero-to-positive and positive-to-zero positions; subsets of buyers and sellers.'],
        ['Current / previous holders', 'Filers with positive category shares in the current or previous quarter.'],
        ['Net buyers', 'Buyer count minus seller count.'],
        ['Raw 13F value', 'The ingested source value from the holdings table.'],
        ['Estimated value', 'Dashboard-normalized value; likely 13F-thousands values are multiplied by 1,000.'],
        ['Sector movers', 'Computed from matched watched holdings, so they are watched-universe movers.'],
        ['Timing', '13F filings show quarter-end holdings, not exact trade timing.'],
        ['Filer type', 'A first-pass local classification from CIK overrides and filer-name keyword rules.'],
    ];

    return (
        <div className={`mt-5 rounded-xl border p-4 ${softPanelClass}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold">Methodology & Terms</div>
                    <div className={`mt-1 text-xs ${mutedText}`}>These definitions are also included in the audit workbook Read Me sheet.</div>
                </div>
                <button
                    onClick={onClose}
                    className={`rounded-md p-2 ${isDark ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'}`}
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
                {terms.map(([term, definition]) => (
                    <div key={term} className={`rounded-lg border p-3 ${isDark ? 'border-zinc-800 bg-zinc-950/30' : 'border-gray-200 bg-white'}`}>
                        <div className="text-xs font-semibold uppercase text-gray-500">{term}</div>
                        <div className={`mt-1 text-sm ${mutedText}`}>{definition}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function findTopSectorMover(movers: SectorMovementSummary[], direction: 'buy' | 'sell') {
    return [...movers]
        .filter((summary) => direction === 'buy' ? summary.buyers > 0 : summary.sellers > 0)
        .sort((a, b) => {
            const primary = direction === 'buy' ? b.buyers - a.buyers : b.sellers - a.sellers;
            if (primary !== 0) return primary;
            return Math.abs(b.netBuyers) - Math.abs(a.netBuyers);
        })[0] || null;
}

function formatNumber(value: number) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0);
}

function formatPct(value: number) {
    return `${(value || 0).toFixed(1)}%`;
}

function formatCountPct(count: number, pctValue: number) {
    return `${formatNumber(count)} (${formatPct(pctValue)})`;
}

function formatSignedNumber(value: number) {
    const safeValue = value || 0;
    return `${safeValue >= 0 ? '+' : ''}${formatNumber(safeValue)}`;
}

function formatSignedMoney(value: number) {
    const prefix = value >= 0 ? '+' : '-';
    return `${prefix}${formatMoney(Math.abs(value))}`;
}

function formatMoney(value: number) {
    return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)}`;
}

function isSpaceXHoldingRow(row: SpaceXExposureRow) {
    return row.relationshipType === 'direct_holding' || row.relationshipType === 'portfolio_schedule_holding';
}

function isSpaceXReviewRow(row: SpaceXExposureRow) {
    return row.relationshipType === 'ambiguous_review' ||
        row.relationshipType === 'spv_or_fund_name' ||
        row.openArenaStatus === 'review' ||
        row.openArenaStatus === 'error';
}

function formatRelationship(value: string) {
    return value.replace(/_/g, ' ');
}

function formatConfidence(value: number) {
    return `${Math.round((value || 0) * 100)}% confidence`;
}

function spaceXRelationshipClass(value: string, isDark: boolean) {
    if (value === 'direct_holding' || value === 'portfolio_schedule_holding') {
        return isDark ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700';
    }
    if (value === 'commercial_context') {
        return isDark ? 'bg-sky-500/10 text-sky-300' : 'bg-sky-50 text-sky-700';
    }
    if (value === 'false_positive') {
        return isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-gray-100 text-gray-500';
    }
    return isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700';
}

function actionClass(action: string, isDark: boolean) {
    if (action === 'initiated' || action === 'increased') {
        return isDark ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700';
    }
    if (action === 'liquidated' || action === 'decreased') {
        return isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700';
    }
    return isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-gray-100 text-gray-600';
}
