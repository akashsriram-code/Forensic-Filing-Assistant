"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    BarChart3,
    BookOpen,
    Copy,
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
    Users,
    X,
} from 'lucide-react';
import { classifyFiler } from '@/lib/filer-classification';
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

// Q2 Watch — Named funds to track for SpaceX and other watchlist activity
const Q2_WATCH_FUNDS = [
    { label: 'Citadel Advisors', patterns: ['citadel', 'citadel advisors'] },
    { label: 'Millennium Management', patterns: ['millennium', 'millennium management'] },
    { label: 'Point72', patterns: ['point72', 'point 72'] },
    { label: 'D.E. Shaw', patterns: ['d.e. shaw', 'de shaw', 'd e shaw'] },
    { label: 'Pershing Square', patterns: ['pershing square'] },
    { label: 'Third Point', patterns: ['third point'] },
    { label: 'Starboard Value', patterns: ['starboard'] },
    { label: 'Berkshire Hathaway', patterns: ['berkshire hathaway'] },
    { label: 'Carl Icahn', patterns: ['icahn', 'icahn capital', 'carl icahn'] },
    { label: 'Coatue Management', patterns: ['coatue'] },
    { label: 'Jana Partners', patterns: ['jana partners'] },
    { label: 'Lone Pine Capital', patterns: ['lone pine'] },
    { label: 'Tiger Global', patterns: ['tiger global'] },
    { label: 'Trian Fund Management', patterns: ['trian fund', 'trian partners'] },
    { label: 'ValueAct', patterns: ['valueact'] },
    { label: 'Viking Global', patterns: ['viking global'] },
    { label: 'Situational Awareness', patterns: ['situational awareness'] },
];

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
                                Q2 Filer Watch
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

            {activeRadarTab === 'spacex' && data && (
                <Q2WatchPanel
                    theme={theme}
                    moves={data.topFilerMoves}
                    panelClass={panelClass}
                />
            )}

            {activeRadarTab === 'spacex' && !data && !loading && (
                <div className={`rounded-xl border p-10 text-center ${panelClass}`}>
                    <Users className="mx-auto mb-3 h-7 w-7 text-sky-500" />
                    <div className="text-sm font-semibold">Q2 Filer Watch</div>
                    <div className={`mt-1 text-xs ${mutedText}`}>Run the 13F Trends scan first to load filer data.</div>
                </div>
            )}

            {activeRadarTab === 'spacex' && loading && !data && (
                <div className={`rounded-xl border p-10 text-center ${panelClass}`}>
                    <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-sky-500" />
                    <div className={`text-sm ${mutedText}`}>Loading filer data...</div>
                </div>
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
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                            {data.categorySummaries.map((summary) => (
                                <React.Fragment key={summary.key}>
                                    <div className={`${isDark ? 'border-zinc-800' : 'border-gray-100'} border-b md:border-b-0 md:border-r lg:border-r ${
                                        // Remove right border on last item in each row
                                        ''
                                    }`}>
                                        <ConsensusCard 
                                            theme={theme} 
                                            summary={summary}
                                            isSelected={selectedDetailCategory === summary.key}
                                            onClick={() => setSelectedDetailCategory(selectedDetailCategory === summary.key ? null : summary.key)}
                                        />
                                    </div>
                                    {selectedDetailCategory === summary.key && (
                                        <div className="col-span-1 md:col-span-2 lg:col-span-3">
                                            <CategoryHoldersPanel
                                                theme={theme}
                                                categoryKey={selectedDetailCategory}
                                                categoryLabel={summary.label}
                                                moves={data.currentHoldersByCategory?.[selectedDetailCategory] || data.topFilerMoves.filter((move) => move.categoryKey === selectedDetailCategory)}
                                                onClose={() => setSelectedDetailCategory(null)}
                                                allCategoryHolders={data.currentHoldersByCategory}
                                            />
                                        </div>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
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
    allCategoryHolders,
}: {
    theme: 'light' | 'dark';
    categoryKey: string;
    categoryLabel: string;
    moves: FilerMove[];
    onClose: () => void;
    allCategoryHolders?: Record<string, FilerMove[]>;
}) {
    // Use the rich story panel for all categories
    return (
        <CategoryStoryPanel
            theme={theme}
            categoryKey={categoryKey}
            categoryLabel={categoryLabel}
            moves={moves}
            onClose={onClose}
            allCategoryHolders={allCategoryHolders}
        />
    );
}

// Calculate Herfindahl-Hirschman Index for ownership concentration
function calculateHHI(shares: number[]): number {
    const total = shares.reduce((sum, s) => sum + s, 0);
    if (total === 0) return 0;
    const sumSquares = shares.reduce((sum, s) => {
        const marketShare = (s / total) * 100;
        return sum + marketShare * marketShare;
    }, 0);
    return Math.round(sumSquares);
}

// Get HHI classification label
function getHHILabel(hhi: number): { label: string; color: string } {
    if (hhi >= 2500) return { label: 'Highly Concentrated', color: 'text-red-500' };
    if (hhi >= 1500) return { label: 'Moderately Concentrated', color: 'text-amber-500' };
    return { label: 'Competitive', color: 'text-emerald-500' };
}

function CategoryStoryPanel({
    theme,
    categoryKey,
    categoryLabel,
    moves,
    onClose,
    allCategoryHolders,
}: {
    theme: 'light' | 'dark';
    categoryKey: string;
    categoryLabel: string;
    moves: FilerMove[];
    onClose: () => void;
    allCategoryHolders?: Record<string, FilerMove[]>;
}) {
    const isDark = theme === 'dark';
    const [copied, setCopied] = useState(false);
    const tableHead = isDark ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700';

    // Enrich with filer type and calculate share % change
    const enrichedMoves = useMemo(() => {
        return [...moves]
            .map((move) => {
                const sharePctChange = move.previousShares > 0 
                    ? ((move.currentShares - move.previousShares) / move.previousShares) * 100 
                    : (move.currentShares > 0 ? Infinity : 0);
                return {
                    ...move,
                    filerType: classifyFiler(move.cik, move.fundName).type,
                    sharePctChange,
                };
            })
            .sort((a, b) => b.currentShares - a.currentShares);
    }, [moves]);

    // Sort for table: initiations → liquidations → increased → decreased → unchanged
    const sortedForTable = useMemo(() => {
        const actionOrder = (action: string) => {
            if (action === 'initiated') return 0;
            if (action === 'liquidated') return 1;
            if (action === 'increased') return 2;
            if (action === 'decreased') return 3;
            return 4; // unchanged
        };
        return [...enrichedMoves].sort((a, b) => {
            const orderDiff = actionOrder(a.action) - actionOrder(b.action);
            if (orderDiff !== 0) return orderDiff;
            // Within same action type, sort by currentShares desc (or previousShares for liquidated)
            if (a.action === 'liquidated') return b.previousShares - a.previousShares;
            return b.currentShares - a.currentShares;
        });
    }, [enrichedMoves]);

    // Aggregate stats
    const stats = useMemo(() => {
        const totalShares = enrichedMoves.reduce((sum, m) => sum + m.currentShares, 0);
        const totalValue = enrichedMoves.reduce((sum, m) => sum + m.currentValue, 0);
        const holderCount = enrichedMoves.length;
        const top1 = enrichedMoves[0];
        const top5Shares = enrichedMoves.slice(0, 5).reduce((sum, m) => sum + m.currentShares, 0);
        const top10Shares = enrichedMoves.slice(0, 10).reduce((sum, m) => sum + m.currentShares, 0);
        const top25Shares = enrichedMoves.slice(0, 25).reduce((sum, m) => sum + m.currentShares, 0);
        const top50Shares = enrichedMoves.slice(0, 50).reduce((sum, m) => sum + m.currentShares, 0);
        const top100Shares = enrichedMoves.slice(0, 100).reduce((sum, m) => sum + m.currentShares, 0);

        // Filer type breakdown
        const byType = new Map<string, { count: number; shares: number; value: number }>();
        for (const move of enrichedMoves) {
            const existing = byType.get(move.filerType) || { count: 0, shares: 0, value: 0 };
            existing.count++;
            existing.shares += move.currentShares;
            existing.value += move.currentValue;
            byType.set(move.filerType, existing);
        }
        const filerTypeBreakdown = Array.from(byType.entries())
            .map(([type, data]) => ({ type, ...data, pct: totalShares > 0 ? (data.shares / totalShares) * 100 : 0 }))
            .sort((a, b) => b.shares - a.shares);

        // Calculate HHI for this category
        const categoryHHI = calculateHHI(enrichedMoves.map((m) => m.currentShares));

        // Cumulative ownership curve
        const cumulativeCurve = [
            { label: 'Top 1', count: 1, pct: totalShares > 0 && top1 ? (top1.currentShares / totalShares) * 100 : 0 },
            { label: 'Top 5', count: 5, pct: totalShares > 0 ? (top5Shares / totalShares) * 100 : 0 },
            { label: 'Top 10', count: 10, pct: totalShares > 0 ? (top10Shares / totalShares) * 100 : 0 },
            { label: 'Top 25', count: 25, pct: totalShares > 0 ? (top25Shares / totalShares) * 100 : 0 },
            { label: 'Top 50', count: 50, pct: totalShares > 0 ? (top50Shares / totalShares) * 100 : 0 },
            { label: 'Top 100', count: 100, pct: totalShares > 0 ? (top100Shares / totalShares) * 100 : 0 },
            { label: 'All', count: holderCount, pct: 100 },
        ];

        return {
            totalShares,
            totalValue,
            holderCount,
            top1,
            top1Pct: totalShares > 0 && top1 ? (top1.currentShares / totalShares) * 100 : 0,
            top5Pct: totalShares > 0 ? (top5Shares / totalShares) * 100 : 0,
            top10Pct: totalShares > 0 ? (top10Shares / totalShares) * 100 : 0,
            top25Pct: totalShares > 0 ? (top25Shares / totalShares) * 100 : 0,
            filerTypeBreakdown,
            maxBarShares: enrichedMoves[0]?.currentShares || 1,
            hhi: categoryHHI,
            hhiLabel: getHHILabel(categoryHHI),
            cumulativeCurve,
        };
    }, [enrichedMoves]);

    // Calculate HHI for peer categories (for comparison)
    const peerHHI = useMemo(() => {
        if (!allCategoryHolders) return [];
        
        const categoryLabels: Record<string, string> = {
            'mag7': 'Mag 7',
            'palantir': 'Palantir',
            'strategy': 'Strategy',
            'energy': 'Energy',
            'bdc': 'BDC / Alt-Credit',
            'blue-owl': 'Blue Owl',
            'software': 'Software / SaaS',
            'semiconductors': 'Semiconductors',
            'ai-infra': 'AI Infrastructure',
            'utilities-power': 'Utilities / Power',
            'data-centers': 'Data Centers',
            'spcx': 'SpaceX',
        };

        const results: { key: string; label: string; hhi: number; holders: number }[] = [];
        
        for (const [key, holders] of Object.entries(allCategoryHolders)) {
            if (holders.length === 0) continue;
            const shares = holders.map((h) => h.currentShares);
            const hhi = calculateHHI(shares);
            results.push({
                key,
                label: categoryLabels[key] || key,
                hhi,
                holders: holders.length,
            });
        }
        
        return results.sort((a, b) => b.hhi - a.hhi);
    }, [allCategoryHolders]);

    // Generate story text
    const generateStoryText = useCallback(() => {
        const lines: string[] = [
            `${categoryLabel} — Institutional 13F Ownership`,
            `=`.repeat(54),
            ``,
            `Institutional holders: ${formatNumber(stats.holderCount)} filers`,
            `Total reported shares: ${formatNumber(stats.totalShares)}`,
            `Total estimated value: ${formatMoney(stats.totalValue)}`,
            ``,
            `TOP 10 HOLDERS`,
        ];

        enrichedMoves.slice(0, 10).forEach((move, idx) => {
            const pct = stats.totalShares > 0 ? (move.currentShares / stats.totalShares) * 100 : 0;
            lines.push(`${idx + 1}. ${move.fundName} — ${formatNumber(move.currentShares)} shares (~${formatMoney(move.currentValue)}, ${pct.toFixed(1)}% of reported)`);
        });

        lines.push(``);
        lines.push(`CONCENTRATION`);
        lines.push(`Top 5 funds: ${stats.top5Pct.toFixed(1)}% of reported institutional shares`);
        lines.push(`Top 10 funds: ${stats.top10Pct.toFixed(1)}%`);
        lines.push(`Top 25 funds: ${stats.top25Pct.toFixed(1)}%`);
        lines.push(``);
        lines.push(`BY INVESTOR TYPE`);
        for (const breakdown of stats.filerTypeBreakdown.slice(0, 8)) {
            lines.push(`${breakdown.type} (${breakdown.count} filers): ${breakdown.pct.toFixed(1)}% of shares`);
        }
        lines.push(``);
        lines.push(`---`);
        lines.push(`Source: SEC 13F filings, Forensic Filing Assistant`);

        return lines.join('\n');
    }, [categoryLabel, enrichedMoves, stats]);

    // Copy to clipboard
    const copyStoryText = useCallback(async () => {
        const text = generateStoryText();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [generateStoryText]);

    // Download CSV
    const downloadCSV = useCallback(() => {
        const headers = ['Rank', 'Fund Name', 'CIK', 'Filer Type', 'Shares', 'Estimated Value', '% of Total'];
        const rows = enrichedMoves.map((move, idx) => {
            const pct = stats.totalShares > 0 ? (move.currentShares / stats.totalShares) * 100 : 0;
            return [
                idx + 1,
                `"${move.fundName.replace(/"/g, '""')}"`,
                move.cik,
                move.filerType,
                move.currentShares,
                move.currentValue,
                pct.toFixed(2),
            ].join(',');
        });
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${categoryKey}-institutional-holders.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [categoryKey, enrichedMoves, stats.totalShares]);

    return (
        <div className={`border-t ${isDark ? 'border-zinc-800 bg-zinc-950/50' : 'border-gray-100 bg-gray-50/50'}`}>
            {/* Header */}
            <div className={`flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                <div className="flex items-center gap-3">
                    <Database className="h-6 w-6 text-emerald-500" />
                    <div>
                        <div className="text-lg font-bold">{categoryLabel} Institutional Ownership</div>
                        <div className={`mt-0.5 text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                            {formatNumber(stats.holderCount)} institutional filers • 13F filings
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={copyStoryText}
                        className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                            copied
                                ? isDark ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : isDark ? 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700' : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                    >
                        <Copy className="h-4 w-4" />
                        {copied ? 'Copied!' : 'Copy Story Text'}
                    </button>
                    <button
                        onClick={downloadCSV}
                        className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${isDark ? 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                    >
                        <Download className="h-4 w-4" />
                        Download CSV
                    </button>
                    <button
                        onClick={onClose}
                        className={`rounded-md p-2 ${isDark ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'}`}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Hero Stats */}
            <div className={`grid grid-cols-2 gap-3 border-t px-5 py-4 md:grid-cols-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                <div className={`rounded-lg border p-3 ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-white'}`}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Total Shares</div>
                    <div className="mt-1 font-mono text-xl font-bold">{formatNumber(stats.totalShares)}</div>
                </div>
                <div className={`rounded-lg border p-3 ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-white'}`}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Total Value</div>
                    <div className="mt-1 font-mono text-xl font-bold text-emerald-500">{formatMoney(stats.totalValue)}</div>
                </div>
                <div className={`rounded-lg border p-3 ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-white'}`}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Holders</div>
                    <div className="mt-1 font-mono text-xl font-bold">{formatNumber(stats.holderCount)}</div>
                </div>
                <div className={`rounded-lg border p-3 ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-white'}`}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">HHI Score</div>
                    <div className="mt-1 font-mono text-xl font-bold">{formatNumber(stats.hhi)}</div>
                    <div className={`text-xs font-semibold ${stats.hhiLabel.color}`}>{stats.hhiLabel.label}</div>
                </div>
            </div>

            {/* Cumulative Ownership Curve */}
            <div className={`border-t px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold">Cumulative Ownership Curve</div>
                    <div className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                        How quickly does ownership concentrate?
                    </div>
                </div>
                <div className="flex items-end gap-1" style={{ height: '120px' }}>
                    {stats.cumulativeCurve.map((point, idx) => (
                        <div key={point.label} className="flex flex-1 flex-col items-center gap-1">
                            <div
                                className={`w-full rounded-t transition-all ${idx === stats.cumulativeCurve.length - 1 ? (isDark ? 'bg-zinc-600' : 'bg-gray-300') : 'bg-sky-500'}`}
                                style={{ height: `${point.pct}%`, minHeight: '4px' }}
                            />
                            <div className="text-center">
                                <div className="font-mono text-[10px] font-bold">{point.pct.toFixed(0)}%</div>
                                <div className={`text-[9px] ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>{point.label}</div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className={`mt-3 text-[11px] ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    Steeper curve = more concentrated ownership. The top {stats.cumulativeCurve[1]?.count || 5} holders control {stats.cumulativeCurve[1]?.pct.toFixed(1) || 0}% of reported institutional shares.
                </div>
            </div>

            {/* HHI Peer Comparison */}
            {peerHHI.length > 1 && (
                <div className={`border-t px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                    <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold">HHI vs. Peer Categories</div>
                        <div className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                            Higher = more concentrated ownership
                        </div>
                    </div>
                    <div className="space-y-1">
                        {peerHHI.slice(0, 8).map((peer) => {
                            const maxHHI = Math.max(...peerHHI.map((p) => p.hhi), 1);
                            const barWidth = (peer.hhi / maxHHI) * 100;
                            const isSpaceX = peer.key === 'spcx';
                            const hhiClass = getHHILabel(peer.hhi);
                            return (
                                <div key={peer.key} className={`flex items-center gap-2 ${isSpaceX ? 'font-semibold' : ''}`}>
                                    <div className={`w-28 truncate text-xs ${isSpaceX ? 'text-sky-400' : ''}`}>{peer.label}</div>
                                    <div className={`h-5 flex-1 overflow-hidden rounded ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
                                        <div
                                            className={`flex h-full items-center rounded px-2 text-[11px] font-medium text-white ${
                                                peer.hhi >= 2500 ? 'bg-red-500' : peer.hhi >= 1500 ? 'bg-amber-500' : 'bg-emerald-500'
                                            }`}
                                            style={{ width: `${barWidth}%` }}
                                        >
                                            {barWidth > 20 && formatNumber(peer.hhi)}
                                        </div>
                                    </div>
                                    <div className="w-16 text-right font-mono text-xs">
                                        <span className={hhiClass.color}>{formatNumber(peer.hhi)}</span>
                                    </div>
                                    <div className={`w-12 text-right text-[10px] ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
                                        {peer.holders}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className={`mt-3 text-[11px] ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                        HHI scale: &lt;1,500 = Competitive, 1,500–2,500 = Moderately Concentrated, &gt;2,500 = Highly Concentrated. {categoryLabel} {stats.hhi >= peerHHI[0]?.hhi ? 'has the most concentrated' : 'is less concentrated than the most concentrated'} institutional ownership in this watchlist.
                    </div>
                </div>
            )}

            {/* Concentration */}
            <div className={`grid gap-4 border-t px-5 py-4 md:grid-cols-2 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                        <BarChart3 className="h-4 w-4 text-sky-500" />
                        Concentration
                    </div>
                    <div className="space-y-2">
                        {[
                            { label: 'Top 5', pct: stats.top5Pct },
                            { label: 'Top 10', pct: stats.top10Pct },
                            { label: 'Top 25', pct: stats.top25Pct },
                        ].map((item) => (
                            <div key={item.label} className="flex items-center gap-3">
                                <div className="w-16 text-xs font-medium">{item.label}</div>
                                <div className={`h-4 flex-1 overflow-hidden rounded ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
                                    <div
                                        className="h-full rounded bg-sky-500"
                                        style={{ width: `${Math.min(item.pct, 100)}%` }}
                                    />
                                </div>
                                <div className="w-14 text-right font-mono text-xs font-bold">{item.pct.toFixed(1)}%</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                        <Users className="h-4 w-4 text-sky-500" />
                        By Investor Type
                    </div>
                    <div className="space-y-2">
                        {stats.filerTypeBreakdown.slice(0, 5).map((breakdown) => (
                            <div key={breakdown.type} className="flex items-center gap-3">
                                <div className="w-32 truncate text-xs font-medium">{breakdown.type}</div>
                                <div className={`h-4 flex-1 overflow-hidden rounded ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
                                    <div
                                        className="h-full rounded bg-emerald-500"
                                        style={{ width: `${Math.min(breakdown.pct, 100)}%` }}
                                    />
                                </div>
                                <div className="w-20 text-right font-mono text-xs">
                                    <span className="font-bold">{breakdown.pct.toFixed(1)}%</span>
                                    <span className={`ml-1 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>({breakdown.count})</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Top 25 Bar Chart */}
            <div className={`border-t px-5 py-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                <div className="mb-3 text-sm font-semibold">Top 25 Holders by Shares</div>
                <div className="space-y-1">
                    {enrichedMoves.slice(0, 25).map((move, idx) => {
                        const pct = stats.totalShares > 0 ? (move.currentShares / stats.totalShares) * 100 : 0;
                        const barWidth = stats.maxBarShares > 0 ? (move.currentShares / stats.maxBarShares) * 100 : 0;
                        return (
                            <div key={move.cik} className="flex items-center gap-2">
                                <div className="w-6 text-right font-mono text-[11px] text-gray-500">{idx + 1}</div>
                                <div className="w-48 truncate text-xs font-medium">{move.fundName}</div>
                                <div className={`h-5 flex-1 overflow-hidden rounded ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
                                    <div
                                        className={`flex h-full items-center rounded px-2 text-[11px] font-medium text-white ${idx < 5 ? 'bg-sky-500' : idx < 10 ? 'bg-sky-400' : 'bg-zinc-500'}`}
                                        style={{ width: `${barWidth}%` }}
                                    >
                                        {barWidth > 15 && formatNumber(move.currentShares)}
                                    </div>
                                </div>
                                <div className="w-20 text-right font-mono text-xs">
                                    <span className="font-bold">{pct.toFixed(1)}%</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Full Table */}
            <div className={`border-t ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                <div className={`px-5 py-3 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                    <div className="text-sm font-semibold">All Holders by Action</div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                        Sorted: initiations → liquidations → increased → decreased → unchanged
                    </div>
                </div>
                <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-left text-sm">
                        <thead className={`sticky top-0 text-xs uppercase ${tableHead}`}>
                            <tr>
                                <th className="px-5 py-3">Fund Name</th>
                                <th className="px-5 py-3">Type</th>
                                <th className="px-5 py-3">Action</th>
                                <th className="px-5 py-3 text-right">Shares</th>
                                <th className="px-5 py-3 text-right">Prev Shares</th>
                                <th className="px-5 py-3 text-right">Chg</th>
                                <th className="px-5 py-3 text-right">Value</th>
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${tableDivide}`}>
                            {sortedForTable.slice(0, 100).map((move) => {
                                const isNew = move.action === 'initiated';
                                const isGone = move.action === 'liquidated';
                                const pctChg = move.sharePctChange;
                                const pctChgDisplay = isNew ? 'NEW' : isGone ? 'GONE' : (pctChg === Infinity ? '∞' : `${pctChg >= 0 ? '+' : ''}${pctChg.toFixed(1)}%`);
                                const pctChgClass = isNew ? (isDark ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700') 
                                    : isGone ? (isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700')
                                    : pctChg >= 0 ? 'text-emerald-500' : 'text-red-500';
                                return (
                                    <tr key={`${move.cik}-${move.action}-row`}>
                                        <td className="px-5 py-3">
                                            <div className="font-medium">{move.fundName}</div>
                                            <div className="font-mono text-[10px] opacity-50">CIK {move.cik}</div>
                                        </td>
                                        <td className="px-5 py-3 text-xs">{move.filerType}</td>
                                        <td className="px-5 py-3">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${actionClass(move.action, isDark)}`}>
                                                {move.action}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right font-mono text-sm font-bold">{formatNumber(move.currentShares)}</td>
                                        <td className="px-5 py-3 text-right font-mono text-xs opacity-60">{formatNumber(move.previousShares)}</td>
                                        <td className="px-5 py-3 text-right">
                                            {(isNew || isGone) ? (
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pctChgClass}`}>
                                                    {pctChgDisplay}
                                                </span>
                                            ) : (
                                                <span className={`font-mono text-xs font-bold ${pctChgClass}`}>{pctChgDisplay}</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-right font-mono text-xs text-emerald-500">{formatMoney(move.currentValue)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {sortedForTable.length > 100 && (
                        <div className={`border-t px-5 py-3 text-xs ${isDark ? 'border-zinc-800 text-zinc-500' : 'border-gray-100 text-gray-500'}`}>
                            Showing first 100 of {formatNumber(sortedForTable.length)} holders. Download the CSV for the complete list.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Helper to match fund names against Q2 Watch patterns
function matchQ2WatchFund(fundName: string, patterns: string[]): boolean {
    const normalizedName = fundName.toLowerCase();
    return patterns.some((pattern) => normalizedName.includes(pattern.toLowerCase()));
}

function Q2WatchPanel({
    theme,
    moves,
    panelClass,
}: {
    theme: 'light' | 'dark';
    moves: FilerMove[];
    panelClass: string;
}) {
    const isDark = theme === 'dark';
    const [expanded, setExpanded] = useState(true);
    const [selectedFund, setSelectedFund] = useState<string | null>(null);
    const tableHead = isDark ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700';

    // Match each Q2 Watch fund against topFilerMoves
    const fundMatches = useMemo(() => {
        const results: Array<{
            label: string;
            patterns: string[];
            matches: FilerMove[];
            found: boolean;
            filerType: string;
            cik: string;
            totalShares: number;
            previousValue: number;
            distinctSecurities: number;
        }> = [];

        for (const fund of Q2_WATCH_FUNDS) {
            const matches = moves.filter((move) => matchQ2WatchFund(move.fundName, fund.patterns));
            // Aggregate stats across all matches for this fund
            const totalShares = matches.reduce((sum, m) => sum + m.currentShares, 0);
            const previousValue = matches.reduce((sum, m) => sum + m.previousValue, 0);
            // Count distinct securities from details
            const allDetails = matches.flatMap((m) => m.details || []);
            const distinctSecurities = new Set(allDetails.map((d) => (d.cusips && d.cusips[0]) || d.label)).size;
            // Get filer type and CIK from first match
            const firstMatch = matches[0];
            const filerType = firstMatch ? classifyFiler(firstMatch.cik, firstMatch.fundName).type : 'Unknown';
            const cik = firstMatch?.cik || '';
            
            results.push({
                label: fund.label,
                patterns: fund.patterns,
                matches,
                found: matches.length > 0,
                filerType,
                cik,
                totalShares,
                previousValue,
                distinctSecurities,
            });
        }

        // Sort: found funds first, then by match count
        return results.sort((a, b) => {
            if (a.found !== b.found) return a.found ? -1 : 1;
            return b.matches.length - a.matches.length;
        });
    }, [moves]);

    const foundCount = fundMatches.filter((f) => f.found).length;
    const totalCount = Q2_WATCH_FUNDS.length;

    // Group matches by category for display
    const aggregateMatchesByCategory = (matches: FilerMove[]) => {
        const byCategory = new Map<string, { label: string; moves: FilerMove[] }>();
        for (const move of matches) {
            const existing = byCategory.get(move.categoryKey) || { label: move.categoryLabel, moves: [] };
            existing.moves.push(move);
            byCategory.set(move.categoryKey, existing);
        }
        return Array.from(byCategory.entries()).map(([key, data]) => ({
            categoryKey: key,
            categoryLabel: data.label,
            moves: data.moves,
            totalValue: data.moves.reduce((sum, m) => sum + m.currentValue, 0),
            totalDelta: data.moves.reduce((sum, m) => sum + m.valueDelta, 0),
        }));
    };

    // Get all securities for a fund from its matches
    const getAllSecurities = (matches: FilerMove[]) => {
        const allDetails = matches.flatMap((m) => 
            (m.details || []).map((d) => ({
                ...d,
                categoryKey: m.categoryKey,
                categoryLabel: m.categoryLabel,
            }))
        );
        // Sort by current value descending
        return allDetails.sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));
    };

    return (
        <section className={`rounded-xl border ${panelClass}`}>
            <button
                onClick={() => setExpanded(!expanded)}
                className={`flex w-full items-center justify-between px-5 py-4 text-left ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}
            >
                <div>
                    <h3 className="text-sm font-bold">Q2 Filer Watch</h3>
                    <div className={`mt-1 text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                        {foundCount} of {totalCount} named funds found in filings — click a row for full detail
                    </div>
                </div>
                <div className={`flex items-center gap-2 text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
                    {expanded ? 'Collapse' : 'Expand'}
                    <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
                </div>
            </button>

            {expanded && (
                <div className={`border-t ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                    <div className="overflow-auto">
                        <table className="w-full min-w-[900px] text-left text-sm">
                            <thead className={`sticky top-0 text-xs uppercase ${tableHead}`}>
                                <tr>
                                    <th className="px-5 py-3">Fund</th>
                                    <th className="px-5 py-3">Type</th>
                                    <th className="px-5 py-3">Status</th>
                                    <th className="px-5 py-3 text-right"># Securities</th>
                                    <th className="px-5 py-3 text-right">Shares</th>
                                    <th className="px-5 py-3 text-right">Total Value</th>
                                    <th className="px-5 py-3 text-right">Value Delta</th>
                                    <th className="px-5 py-3 text-right">% Chg</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${tableDivide}`}>
                                {fundMatches.map((fund) => {
                                    const categoryBreakdown = aggregateMatchesByCategory(fund.matches);
                                    const totalValue = categoryBreakdown.reduce((sum, c) => sum + c.totalValue, 0);
                                    const totalDelta = categoryBreakdown.reduce((sum, c) => sum + c.totalDelta, 0);
                                    const pctChange = fund.previousValue > 0 ? ((totalDelta / fund.previousValue) * 100) : (totalValue > 0 ? 100 : 0);
                                    const actions = fund.matches.map((m) => m.action);
                                    const hasBuyer = actions.includes('initiated') || actions.includes('increased');
                                    const hasSeller = actions.includes('liquidated') || actions.includes('decreased');
                                    const isSelected = selectedFund === fund.label;
                                    const allSecurities = getAllSecurities(fund.matches);

                                    return (
                                        <React.Fragment key={fund.label}>
                                            <tr
                                                onClick={() => fund.found && setSelectedFund(isSelected ? null : fund.label)}
                                                className={`${fund.found ? 'cursor-pointer' : ''} ${!fund.found ? (isDark ? 'opacity-40' : 'opacity-50') : ''} ${isSelected ? (isDark ? 'bg-zinc-800/50' : 'bg-sky-50') : (fund.found ? (isDark ? 'hover:bg-zinc-800/30' : 'hover:bg-gray-50') : '')}`}
                                            >
                                                <td className="px-5 py-3">
                                                    <div className="flex items-center gap-2">
                                                        {fund.found && (
                                                            <span className={`transition-transform ${isSelected ? 'rotate-90' : ''}`}>▶</span>
                                                        )}
                                                        <div>
                                                            <div className="font-medium">{fund.label}</div>
                                                            {fund.found && fund.cik && (
                                                                <a 
                                                                    href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${fund.cik}&type=13F`}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className={`mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-sky-500 hover:underline`}
                                                                >
                                                                    CIK {fund.cik} <ExternalLink className="h-2.5 w-2.5" />
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3 text-xs">{fund.found ? fund.filerType : '—'}</td>
                                                <td className="px-5 py-3">
                                                    {fund.found ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {hasBuyer && (
                                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDark ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}>
                                                                    Buyer
                                                                </span>
                                                            )}
                                                            {hasSeller && (
                                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700'}`}>
                                                                    Seller
                                                                </span>
                                                            )}
                                                            {!hasBuyer && !hasSeller && (
                                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-gray-100 text-gray-500'}`}>
                                                                    Unchanged
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className={`text-xs ${isDark ? 'text-zinc-600' : 'text-gray-400'}`}>
                                                            Not in Q2
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-5 py-3 text-right font-mono text-xs">
                                                    {fund.found ? formatNumber(fund.distinctSecurities) : '—'}
                                                </td>
                                                <td className="px-5 py-3 text-right font-mono text-xs">
                                                    {fund.found ? formatNumber(fund.totalShares) : '—'}
                                                </td>
                                                <td className="px-5 py-3 text-right font-mono text-xs font-semibold">
                                                    {fund.found ? formatMoney(totalValue) : '—'}
                                                </td>
                                                <td className={`px-5 py-3 text-right font-mono text-xs ${fund.found ? (totalDelta >= 0 ? 'text-emerald-500' : 'text-red-500') : ''}`}>
                                                    {fund.found ? formatSignedMoney(totalDelta) : '—'}
                                                </td>
                                                <td className={`px-5 py-3 text-right font-mono text-xs font-semibold ${fund.found ? (pctChange >= 0 ? 'text-emerald-500' : 'text-red-500') : ''}`}>
                                                    {fund.found ? `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}%` : '—'}
                                                </td>
                                            </tr>
                                            {/* Detail card - inline expansion */}
                                            {isSelected && fund.found && (
                                                <tr>
                                                    <td colSpan={8} className={`p-0 ${isDark ? 'bg-zinc-900/50' : 'bg-gray-50'}`}>
                                                        <Q2FundDetailCard
                                                            theme={theme}
                                                            fund={fund}
                                                            categoryBreakdown={categoryBreakdown}
                                                            allSecurities={allSecurities}
                                                            totalValue={totalValue}
                                                            onClose={() => setSelectedFund(null)}
                                                        />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className={`border-t px-5 py-3 text-[11px] ${isDark ? 'border-zinc-800 text-zinc-500' : 'border-gray-100 text-gray-500'}`}>
                        Fund matching uses name-pattern search against 13F filer names. Some funds may file under different legal entity names.
                    </div>
                </div>
            )}
        </section>
    );
}

// Detail card component for Q2 Watch fund expansion
function Q2FundDetailCard({
    theme,
    fund,
    categoryBreakdown,
    allSecurities,
    totalValue,
    onClose,
}: {
    theme: 'light' | 'dark';
    fund: {
        label: string;
        cik: string;
        filerType: string;
        matches: FilerMove[];
    };
    categoryBreakdown: Array<{
        categoryKey: string;
        categoryLabel: string;
        totalValue: number;
        totalDelta: number;
    }>;
    allSecurities: Array<{
        label: string;
        cusip?: string;
        action: string;
        currentShares: number;
        previousShares: number;
        currentValue?: number;
        previousValue?: number;
        categoryKey?: string;
        categoryLabel?: string;
    }>;
    totalValue: number;
    onClose: () => void;
}) {
    const isDark = theme === 'dark';
    const tableHead = isDark ? 'bg-zinc-800 text-zinc-500' : 'bg-gray-100 text-gray-500';
    const tableDivide = isDark ? 'divide-zinc-700 text-zinc-300' : 'divide-gray-200 text-gray-700';

    // Get the first match for SEC link
    const firstMatch = fund.matches[0];
    const edgarUrl = fund.cik 
        ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${fund.cik}&type=13F-HR&dateb=&owner=include&count=40`
        : null;

    return (
        <div className={`border-t ${isDark ? 'border-zinc-700' : 'border-gray-200'}`}>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-sky-500" />
                    <div>
                        <div className="text-sm font-bold">{fund.label}</div>
                        <div className={`mt-0.5 flex flex-wrap items-center gap-2 text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-gray-200 text-gray-600'}`}>
                                {fund.filerType}
                            </span>
                            {fund.cik && (
                                <span className="font-mono">CIK {fund.cik}</span>
                            )}
                            {firstMatch && (
                                <span>Q2 2026</span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {edgarUrl && (
                        <a
                            href={edgarUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${isDark ? 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            SEC 13F Filings
                        </a>
                    )}
                    <button
                        onClick={onClose}
                        className={`rounded-md p-1.5 ${isDark ? 'hover:bg-zinc-800' : 'hover:bg-gray-200'}`}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Category breakdown bars */}
            <div className={`border-t px-5 py-4 ${isDark ? 'border-zinc-700' : 'border-gray-200'}`}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Category Breakdown</div>
                <div className="space-y-2">
                    {categoryBreakdown.map((cat) => {
                        const pct = totalValue > 0 ? (cat.totalValue / totalValue) * 100 : 0;
                        return (
                            <div key={cat.categoryKey} className="flex items-center gap-3">
                                <div className="w-28 truncate text-xs font-medium">{cat.categoryLabel}</div>
                                <div className={`h-5 flex-1 overflow-hidden rounded ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
                                    <div
                                        className={`flex h-full items-center rounded px-2 text-[11px] font-medium text-white ${cat.totalDelta >= 0 ? 'bg-sky-500' : 'bg-red-500'}`}
                                        style={{ width: `${Math.min(pct, 100)}%` }}
                                    >
                                        {pct > 15 && formatMoney(cat.totalValue)}
                                    </div>
                                </div>
                                <div className="w-16 text-right font-mono text-xs font-bold">{pct.toFixed(1)}%</div>
                                <div className={`w-20 text-right font-mono text-xs ${cat.totalDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {formatSignedMoney(cat.totalDelta)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Securities table */}
            {allSecurities.length > 0 && (
                <div className={`border-t ${isDark ? 'border-zinc-700' : 'border-gray-200'}`}>
                    <div className="px-5 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Securities Held ({allSecurities.length})
                        </div>
                    </div>
                    <div className="max-h-[300px] overflow-auto">
                        <table className="w-full text-left text-sm">
                            <thead className={`sticky top-0 text-xs uppercase ${tableHead}`}>
                                <tr>
                                    <th className="px-5 py-2">Security</th>
                                    <th className="px-5 py-2">Category</th>
                                    <th className="px-5 py-2">Action</th>
                                    <th className="px-5 py-2 text-right">Shares</th>
                                    <th className="px-5 py-2 text-right">Prev Shares</th>
                                    <th className="px-5 py-2 text-right">Value</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${tableDivide}`}>
                                {allSecurities.slice(0, 50).map((sec, idx) => (
                                    <tr key={`${sec.cusip || sec.label}-${idx}`}>
                                        <td className="px-5 py-2">
                                            <div className="font-medium">{sec.label}</div>
                                            {sec.cusip && <div className="font-mono text-[10px] opacity-50">{sec.cusip}</div>}
                                        </td>
                                        <td className="px-5 py-2 text-xs">{sec.categoryLabel || '—'}</td>
                                        <td className="px-5 py-2">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${actionClass(sec.action, isDark)}`}>
                                                {sec.action}
                                            </span>
                                        </td>
                                        <td className="px-5 py-2 text-right font-mono text-xs">{formatNumber(sec.currentShares)}</td>
                                        <td className="px-5 py-2 text-right font-mono text-xs opacity-60">{formatNumber(sec.previousShares)}</td>
                                        <td className="px-5 py-2 text-right font-mono text-xs text-emerald-500">
                                            {sec.currentValue ? formatMoney(sec.currentValue) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {allSecurities.length > 50 && (
                            <div className={`border-t px-5 py-2 text-xs ${isDark ? 'border-zinc-700 text-zinc-500' : 'border-gray-200 text-gray-500'}`}>
                                Showing first 50 of {allSecurities.length} securities.
                            </div>
                        )}
                    </div>
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
