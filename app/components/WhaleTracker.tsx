"use client";

import { useState } from 'react';
import { Download, X, Search, Loader2, TrendingUp, TrendingDown, CirclePlus, Plus, Users, GitMerge, Database, Megaphone } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ScatterChart, Scatter, ReferenceLine } from 'recharts';
import { getSector } from '@/lib/sectors';
import { TickerSearch } from './TickerSearch';
import { FollowButton } from './FollowButton';

// --- Types ---
interface Holding {
    issuer: string;
    cusip: string;
    sharesCurr: number;
    sharesPrev: number;
    change: number;
    percentChange: number;
    value: number;
    isNew?: boolean;
    isAddOn?: boolean;
}

interface WhaleData {
    ticker: string;
    filingDateCurr: string;
    filingDatePrev: string;
    topHoldings: Holding[];
    topBuys: Holding[];
    topSells: Holding[];
    allChanges: Holding[];
}

interface ClusterHolding {
    issuer: string;
    cusip: string;
    valueA: number;
    valueB: number;
    sharesA: number;
    sharesB: number;
    combinedValue: number;
}

interface ClusterData {
    fundA: { ticker: string, date: string, totalHoldings: number, uniqueCount: number, overlapValue: number };
    fundB: { ticker: string, date: string, totalHoldings: number, uniqueCount: number, overlapValue: number };
    overlap: { count: number, holdings: ClusterHolding[] };
}

interface ActivistFiling {
    form: string;
    filingDate: string;
    url: string;
    primaryDocument: string;
    description: string;
    reportDate: string;
    reportingPerson?: string;
    percentClass?: string;
    shares?: string;
    purpose?: string;
}

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#64748b'];

// --- Tooltips ---
const CustomTooltip = ({ active, payload, label, theme }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className={`p-3 rounded-lg border shadow-lg text-xs ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-gray-200 text-gray-900'}`}>
                <p className="font-semibold mb-1">{payload[0].name}</p>
                <p className="font-mono opacity-80">${new Intl.NumberFormat('en-US', { notation: "compact" }).format(payload[0].value)}</p>
            </div>
        );
    }
    return null;
};

const CustomScatterTooltip = ({ active, payload, theme }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className={`p-3 rounded-lg border shadow-lg text-xs ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-gray-200 text-gray-900'}`}>
                <p className="font-semibold mb-1">{data.name}</p>
                <p className="font-mono">Value: ${new Intl.NumberFormat('en-US', { notation: "compact" }).format(data.x)}</p>
                <p className={`font-mono ${data.originalPercent > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    Action: {data.originalPercent > 0 ? '+' : ''}{data.originalPercent.toFixed(1)}%
                </p>
            </div>
        );
    }
    return null;
};

export function WhaleTracker({ theme }: { theme: 'light' | 'dark' }) {
    const [viewMode, setViewMode] = useState<'single' | 'compare' | 'reverse' | 'activist'>('single');

    // Single Mode State
    const [ticker, setTicker] = useState("");
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<WhaleData | null>(null);
    const [error, setError] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: 'change' | 'percentChange', direction: 'asc' | 'desc' } | null>(null);

    // Compare Mode State
    const [tickerA, setTickerA] = useState("");
    const [tickerB, setTickerB] = useState("");
    const [clusterData, setClusterData] = useState<ClusterData | null>(null);

    // History State
    const [analyzingHistory, setAnalyzingHistory] = useState(false);
    const [historyData, setHistoryData] = useState<any[] | null>(null);
    const [selectedHolding, setSelectedHolding] = useState<string | null>(null);

    // Reverse Lookup State (Existing)
    const [reverseTicker, setReverseTicker] = useState("");
    const [reverseData, setReverseData] = useState<any | null>(null);

    // Activist Watch State
    const [activistTicker, setActivistTicker] = useState("");
    const [activistData, setActivistData] = useState<ActivistFiling[] | null>(null);
    // NEW: Popout State
    const [selectedFundHistory, setSelectedFundHistory] = useState<any[] | null>(null);
    const [selectedFundName, setSelectedFundName] = useState<string | null>(null);

    // --- Handlers (Existing) ---
    // ...




    const handleAnalyze = async () => {
        if (!ticker) return;
        setLoading(true);
        setError("");
        setData(null);
        setActivistData(null);

        try {
            // Parallel Fetch: 13F (Holdings) + 13D (Activist)
            const [resWhale, resActivist] = await Promise.all([
                fetch('/api/whale-tracker', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ticker })
                }),
                fetch('/api/whale-activist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ticker })
                })
            ]);

            const resultWhale = await resWhale.json();

            // Allow activist to fail (it's secondary)
            let resultActivist = null;
            if (resActivist.ok) {
                resultActivist = await resActivist.json();
            }

            if (!resWhale.ok) throw new Error(resultWhale.error || "Analysis failed");

            setData(resultWhale);
            if (resultActivist && resultActivist.filings) {
                setActivistData(resultActivist.filings);
            }

        } catch (e: any) {
            setError(e.message || "An error occurred");
        } finally {
            setLoading(false);
        }
    };

    const handleCompare = async () => {
        if (!tickerA || !tickerB) return;
        setLoading(true);
        setError("");
        setClusterData(null);

        try {
            const res = await fetch('/api/whale-cluster', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker1: tickerA, ticker2: tickerB })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || "Comparison failed");
            setClusterData(result);
        } catch (e: any) {
            setError(e.message || "Comparison failed");
        } finally {
            setLoading(false);
        }
    };

    const handleReverseLookup = async () => {
        if (!reverseTicker) return;
        setLoading(true);
        setError("");
        setReverseData(null);
        setActivistData(null);
        try {
            // Parallel Fetch: Reverse Lookup + 13D (Activist)
            const [resReverse, resActivist] = await Promise.all([
                fetch('/api/whale-reverse-lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ticker: reverseTicker })
                }),
                fetch('/api/whale-activist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ticker: reverseTicker })
                })
            ]);

            const result = await resReverse.json();

            // Allow activist to fail
            let resultActivist = null;
            if (resActivist.ok) {
                resultActivist = await resActivist.json();
            }

            if (!resReverse.ok) throw new Error(result.error || "Lookup failed");
            setReverseData(result);
            if (resultActivist && resultActivist.filings) {
                setActivistData(resultActivist.filings);
            }

        } catch (e: any) {
            setError(e.message || "An error occurred");
        } finally {
            setLoading(false);
        }
    };

    const handleActivistSearch = async () => {
        if (!activistTicker) return;
        setLoading(true);
        setError("");
        setActivistData(null);
        try {
            const res = await fetch('/api/whale-activist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker: activistTicker })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || "Analysis failed");
            setActivistData(result.filings || []);
        } catch (e: any) {
            setError(e.message || "An error occurred");
        } finally {
            setLoading(false);
        }
    };

    const formatNumber = (num: number) => {
        return new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(num);
    };

    const handleDownloadCSV = (dataToExport: any[], filename: string) => {
        if (!dataToExport || dataToExport.length === 0) return;
        const headers = Object.keys(dataToExport[0]);
        const csvContent = [
            headers.join(','),
            ...dataToExport.map(row => headers.map(header => JSON.stringify(row[header])).join(','))
        ].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${filename}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleHistoryClick = async (issuer: string) => {
        setSelectedHolding(issuer);
        setAnalyzingHistory(true);
        setHistoryData(null);
        try {
            const res = await fetch('/api/whale-history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker: data?.ticker || tickerA, holdingInfo: { issuer } }) // Fallback to tickerA if in compare mode
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            setHistoryData(result.history);
        } catch (e) {
            console.error(e);
            alert("Could not fetch historical data.");
            setAnalyzingHistory(false);
            setSelectedHolding(null);
        }
    };

    // --- Render Logic ---

    // History Modal
    const renderHistoryModal = () => (
        (analyzingHistory || historyData) && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className={`w-full max-w-4xl p-6 rounded-2xl shadow-2xl relative ${theme === 'dark' ? 'bg-zinc-900 border border-zinc-700' : 'bg-white'}`}>
                    <button
                        onClick={() => { setAnalyzingHistory(false); setHistoryData(null); setSelectedHolding(null); }}
                        className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                    <h2 className="text-xl font-bold mb-1">Historical Analysis: {selectedHolding}</h2>
                    <p className="text-sm opacity-60 mb-6">Tracking position size over last 1.5 - 2 years</p>
                    {analyzingHistory && !historyData ? (
                        <div className="h-64 flex flex-col items-center justify-center gap-4">
                            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                            <p className="text-sm font-medium animate-pulse">Scanning historical SEC filings...</p>
                        </div>
                    ) : historyData && (
                        <div className="space-y-6">
                            <div className="h-80 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={historyData}>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                        <XAxis dataKey="date" fontSize={12} tickFormatter={(val) => val.substring(0, 7)} />
                                        <YAxis yAxisId="left" fontSize={12} tickFormatter={(val) => `$${formatNumber(val * 1000)}`} />
                                        <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#18181b' : 'white', borderColor: '#333' }} labelStyle={{ color: theme === 'dark' ? 'white' : 'black' }} />
                                        <Legend />
                                        <Line yAxisId="left" type="monotone" dataKey="value" name="Value ($)" stroke="#8884d8" strokeWidth={2} dot={{ r: 4 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex justify-end">
                                <button onClick={() => handleDownloadCSV(historyData!, `${selectedHolding}_history`)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                                    <Download className="w-4 h-4" /> CSV
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    );

    // Single Mode Renders...
    // (Collapsed simple variables for brevity)
    const chartData = data?.topHoldings.map(h => ({ name: h.issuer, value: h.value })) || [];
    const sectorMap = new Map<string, number>();
    data?.topHoldings.forEach(h => { const s = getSector(h.issuer); sectorMap.set(s, (sectorMap.get(s) || 0) + h.value); });
    const sectorData = Array.from(sectorMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const sortedChanges = data ? [...data.allChanges].sort((a, b) => {
        if (!sortConfig) return 0;
        const multiplier = sortConfig.direction === 'asc' ? 1 : -1;
        return (a[sortConfig.key] - b[sortConfig.key]) * multiplier;
    }) : [];

    const scatterData = data?.allChanges.filter(h => h.value > 1000).map(h => ({ name: h.issuer, x: h.value * 1000, y: h.percentChange > 200 ? 200 : (h.percentChange < -100 ? -100 : h.percentChange), originalPercent: h.percentChange, fill: h.change > 0 ? '#10b981' : (h.change < 0 ? '#ef4444' : '#94a3b8') })) || [];



    // Reverse History Modal
    const renderReverseHistoryModal = () => (
        selectedFundHistory && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className={`w-full max-w-4xl p-6 rounded-2xl shadow-2xl relative ${theme === 'dark' ? 'bg-zinc-900 border border-zinc-700' : 'bg-white'}`}>
                    <button
                        onClick={() => { setSelectedFundHistory(null); setSelectedFundName(null); }}
                        className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                    <h2 className="text-xl font-bold mb-1">Conviction History: {selectedFundName}</h2>
                    <p className="text-sm opacity-60 mb-6">Tracking position across recent filings</p>

                    <div className="space-y-6">
                        {/* Chart */}
                        <div className="h-80 w-full animate-in fade-in zoom-in-95 duration-300">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={selectedFundHistory}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                    <XAxis dataKey="date" fontSize={12} tickFormatter={(val) => val} />
                                    <YAxis yAxisId="left" fontSize={12} tickFormatter={(val) => `$${formatNumber(val * 1000)}`} />
                                    <YAxis yAxisId="right" orientation="right" fontSize={12} tickFormatter={(val) => formatNumber(val)} />
                                    <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#18181b' : 'white', borderColor: '#333' }} labelStyle={{ color: theme === 'dark' ? 'white' : 'black' }} />
                                    <Legend />
                                    <Line yAxisId="left" type="monotone" dataKey="value" name="Value ($)" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                                    <Line yAxisId="right" type="monotone" dataKey="shares" name="Shares" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Detailed Table */}
                        <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-200 bg-zinc-50'}`}>
                            <table className="w-full text-sm text-left">
                                <thead className={`text-xs uppercase font-medium ${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-100 text-gray-500'}`}>
                                    <tr>
                                        <th className="px-6 py-3">Filing Date</th>
                                        <th className="px-6 py-3 text-right">Shares</th>
                                        <th className="px-6 py-3 text-right">Value</th>
                                        <th className="px-6 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-200 text-gray-700'}`}>
                                    {[...selectedFundHistory].reverse().map((point, i, arr) => {
                                        // Calculate change from PREVIOUS (which is next in reversed array, i+1)
                                        const prev = arr[i + 1];
                                        const change = prev ? point.shares - prev.shares : 0;
                                        const changePercent = prev && prev.shares > 0 ? (change / prev.shares) * 100 : 0;

                                        return (
                                            <tr key={i}>
                                                <td className="px-6 py-3 font-mono text-xs">{point.date} ({point.quarter})</td>
                                                <td className="px-6 py-3 text-right font-mono text-xs">{formatNumber(point.shares)}</td>
                                                <td className="px-6 py-3 text-right font-mono text-xs">${formatNumber(point.value)} k</td>
                                                <td className={`px-6 py-3 text-right font-mono text-xs font-bold ${change > 0 ? 'text-emerald-500' : (change < 0 ? 'text-red-500' : 'opacity-50')}`}>
                                                    {change > 0 ? '+' : ''}{change !== 0 ? `${formatNumber(change)} (${changePercent.toFixed(1)}%)` : '-'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        )
    );

    return (

        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500 relative">
            {renderHistoryModal()}
            {renderReverseHistoryModal()}

            {/* View Mode Tabs */}
            <div className="flex justify-center mb-6">
                <div className={`p-1 rounded-lg border flex gap-1 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'}`}>
                    <button
                        onClick={() => setViewMode('single')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'single' ? (theme === 'dark' ? 'bg-zinc-800 text-white' : 'bg-gray-100 text-gray-900') : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Single Fund
                    </button>
                    <button
                        onClick={() => setViewMode('compare')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'compare' ? (theme === 'dark' ? 'bg-zinc-800 text-white' : 'bg-gray-100 text-gray-900') : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Users className="w-3 h-3" /> Head-to-Head
                    </button>
                    <button
                        onClick={() => setViewMode('reverse')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'reverse' ? (theme === 'dark' ? 'bg-zinc-800 text-white' : 'bg-gray-100 text-gray-900') : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Database className="w-3 h-3" /> Stock Search
                    </button>
                    <button
                        onClick={() => setViewMode('activist')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'activist' ? (theme === 'dark' ? 'bg-zinc-800 text-white' : 'bg-gray-100 text-gray-900') : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Megaphone className="w-3 h-3" /> Activist Watch
                    </button>
                </div>
            </div>

            {/* --- SINGLE MODE --- */}
            {viewMode === 'single' && (
                <>
                    <div className={`p-8 rounded-2xl border transition-all ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 shadow-xl' : 'bg-white border-gray-200 shadow-sm'}`}>
                        <div className="max-w-2xl mx-auto text-center mb-8">
                            <h2 className={`text-2xl font-bold tracking-tight mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Institutional 13-F Analysis</h2>
                            <p className={`text-sm ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Track major holdings andportfolio shifts.</p>
                        </div>
                        <div className="max-w-xl mx-auto flex gap-3">
                            <div className="relative flex-1">
                                <TickerSearch value={ticker} onChange={setTicker} onSelect={handleAnalyze} theme={theme} placeholder="Enter Ticker, Fund Name, or CIK" />
                            </div>
                            <button onClick={handleAnalyze} disabled={loading} className={`px-6 font-medium rounded-lg text-sm ${theme === 'dark' ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze"}
                            </button>
                        </div>
                        {error && <div className="mt-4 text-center text-sm font-medium text-red-500 bg-red-500/5 p-2 rounded">{error}</div>}
                    </div>

                    {/* Single Visualization Logic (Copied from previous version essentially) */}
                    {data && (
                        <div className="space-y-8">
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className={`h-5 w-5 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-400'}`} />
                                    <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{data.ticker}</span>
                                    <FollowButton ticker={data.ticker} theme={theme} />
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className={`text-xs font-mono ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                                        {data.filingDatePrev} <span className="mx-1">â†’</span> {data.filingDateCurr}
                                    </div>

                                    <button onClick={() => handleDownloadCSV(data.allChanges, `${data.ticker}_QoQ_changes`)} className={`text-xs flex items-center gap-1 font-medium hover:underline text-emerald-500`}>
                                        <Download className="w-3 h-3" /> Export CSV
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                <div className={`col-span-1 p-6 rounded-xl border flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                                    <h3 className={`text-xs font-semibold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Stock Weighing (Top 5)</h3>
                                    <div className="h-40 w-full"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartData} innerRadius={50} outerRadius={70} paddingAngle={2} dataKey="value">{chartData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip content={<CustomTooltip theme={theme} />} /></PieChart></ResponsiveContainer></div>
                                </div>
                                <div className={`col-span-1 p-6 rounded-xl border flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                                    <h3 className={`text-xs font-semibold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Sector Exposure</h3>
                                    <div className="h-40 w-full"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sectorData} innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">{sectorData.map((e, i) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}</Pie><Tooltip content={<CustomTooltip theme={theme} />} /></PieChart></ResponsiveContainer></div>
                                </div>
                                <div className={`col-span-1 md:col-span-2 p-6 rounded-xl border ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                                    <h3 className={`text-xs font-semibold uppercase tracking-wider mb-6 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Conviction (Value vs. Action)</h3>
                                    <div className="h-40 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                                <XAxis dataKey="x" type="number" name="Value" tickFormatter={(val) => `$${new Intl.NumberFormat('en-US', { notation: "compact" }).format(val)}`} fontSize={10} axisLine={false} tickLine={false} />
                                                <YAxis dataKey="y" type="number" name="Change" unit="%" fontSize={10} axisLine={false} tickLine={false} />
                                                <ReferenceLine y={0} stroke={theme === 'dark' ? '#52525b' : '#e5e7eb'} strokeDasharray="3 3" />
                                                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomScatterTooltip theme={theme} />} />
                                                <Scatter name="Holdings" data={scatterData} fill="#8884d8">{scatterData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Scatter>
                                            </ScatterChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            {/* Detailed Table (Simplified for brevity of overwrite) */}
                            <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-200 bg-white'}`}>
                                <div className={`px-6 py-4 border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-100'}`}><h3 className="font-semibold text-sm">Portfolio Changes</h3></div>
                                <table className="w-full text-sm text-left">
                                    <thead className={`text-xs uppercase font-medium ${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500'}`}>
                                        <tr><th className="px-6 py-3">Issuer</th><th className="px-6 py-3 text-right">Value (k)</th><th className="px-6 py-3 text-right">Change</th></tr>
                                    </thead>
                                    <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700'}`}>
                                        {sortedChanges.slice(0, 20).map((h, i) => (
                                            <tr key={i} onClick={() => handleHistoryClick(h.issuer)} className="cursor-pointer hover:opacity-70">
                                                <td className="px-6 py-3 font-medium">{h.issuer}</td>
                                                <td className="px-6 py-3 text-right font-mono text-xs">${formatNumber(h.value)}</td>
                                                <td className={`px-6 py-3 text-right font-mono text-xs ${h.change > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{h.change > 0 ? '+' : ''}{formatNumber(h.change)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* --- COMPARE MODE --- */}
            {viewMode === 'compare' && (
                <>
                    <div className={`p-8 rounded-2xl border transition-all ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 shadow-xl' : 'bg-white border-gray-200 shadow-sm'}`}>
                        <div className="max-w-2xl mx-auto text-center mb-8">
                            <h2 className={`text-2xl font-bold tracking-tight mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Head-to-Head Comparison</h2>
                            <p className={`text-sm ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Analyze overlap and shared conviction between two funds.</p>
                        </div>
                        <div className="max-w-3xl mx-auto flex items-center gap-4">
                            <div className="flex-1">
                                <label className="text-[10px] uppercase font-bold text-blue-500 mb-1 block">Fund A</label>
                                <TickerSearch value={tickerA} onChange={setTickerA} onSelect={() => { }} theme={theme} placeholder="e.g. Berkshire..." />
                            </div>
                            <div className="pt-5 text-zinc-500 font-bold">VS</div>
                            <div className="flex-1">
                                <label className="text-[10px] uppercase font-bold text-orange-500 mb-1 block">Fund B</label>
                                <TickerSearch value={tickerB} onChange={setTickerB} onSelect={() => { }} theme={theme} placeholder="e.g. Bridgewater..." />
                            </div>
                            <div className="pt-5">
                                <button onClick={handleCompare} disabled={loading} className={`px-6 py-2.5 font-medium rounded-lg text-sm ${theme === 'dark' ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Compare"}
                                </button>
                            </div>
                        </div>
                        {error && <div className="mt-4 text-center text-sm font-medium text-red-500 bg-red-500/5 p-2 rounded">{error}</div>}
                    </div>

                    {clusterData && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
                            {/* OVERLAP STATS */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Fund A */}
                                <div className={`relative p-6 rounded-xl border overflow-hidden ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                    <h3 className="text-sm font-semibold text-blue-500 mb-2 truncate">{clusterData.fundA.ticker}</h3>
                                    <p className="text-2xl font-mono font-bold">{clusterData.fundA.uniqueCount} <span className="text-xs font-sans font-normal opacity-60">Unique Stakes</span></p>
                                    <p className="text-xs opacity-50 mt-1">Total Holdings: {clusterData.fundA.totalHoldings}</p>
                                </div>
                                {/* Intersection */}
                                <div className={`relative p-6 rounded-xl border flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-purple-900/10 border-purple-500/30' : 'bg-purple-50 border-purple-200'}`}>
                                    <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-2">
                                        <GitMerge className="w-5 h-5" />
                                        <h3 className="text-sm font-bold uppercase">Shared Conviction</h3>
                                    </div>
                                    <p className="text-4xl font-mono font-bold flex items-baseline gap-2">
                                        {clusterData.overlap.count}
                                        <span className="text-sm font-sans font-normal opacity-60">Stocks</span>
                                    </p>
                                    <p className="text-xs text-center opacity-60 mt-1 max-w-[200px]">Held by BOTH funds simultaneously</p>
                                </div>
                                {/* Fund B */}
                                <div className={`relative p-6 rounded-xl border overflow-hidden ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                                    <div className="absolute top-0 right-0 w-1 h-full bg-orange-500"></div>
                                    <h3 className="text-sm font-semibold text-orange-500 mb-2 text-right truncate">{clusterData.fundB.ticker}</h3>
                                    <p className="text-2xl font-mono font-bold text-right">{clusterData.fundB.uniqueCount} <span className="text-xs font-sans font-normal opacity-60">Unique Stakes</span></p>
                                    <p className="text-xs opacity-50 mt-1 text-right">Total Holdings: {clusterData.fundB.totalHoldings}</p>
                                </div>
                            </div>

                            {/* SHARED TABLE */}
                            <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-200 bg-white'}`}>
                                <div className={`px-6 py-4 border-b flex justify-between items-center ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-100'}`}>
                                    <h3 className="font-bold text-sm">Top Shared Holdings (Sorted by Combined Bet Size)</h3>
                                </div>
                                <table className="w-full text-sm text-left">
                                    <thead className={`text-xs uppercase font-medium ${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500'}`}>
                                        <tr>
                                            <th className="px-6 py-3">Issuer</th>
                                            <th className="px-6 py-3 text-right text-blue-500">{clusterData.fundA.ticker} Value</th>
                                            <th className="px-6 py-3 text-right text-orange-500">{clusterData.fundB.ticker} Value</th>
                                            <th className="px-6 py-3 text-right">Combined</th>
                                        </tr>
                                    </thead>
                                    <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700'}`}>
                                        {clusterData.overlap.holdings.map((h, i) => (
                                            <tr key={i} onClick={() => handleHistoryClick(h.issuer)} className="cursor-pointer hover:opacity-70">
                                                <td className="px-6 py-3 font-medium flex items-center gap-2">
                                                    {h.issuer}
                                                    {/* Highlight Consensus if massive overlap */}
                                                    {i < 3 && <span className="px-1.5 py-0.5 text-[10px] bg-purple-100 text-purple-700 rounded-full font-bold">TOP PICK</span>}
                                                </td>
                                                <td className="px-6 py-3 text-right font-mono text-xs opacity-80">${formatNumber(h.valueA * 1000)}</td>
                                                <td className="px-6 py-3 text-right font-mono text-xs opacity-80">${formatNumber(h.valueB * 1000)}</td>
                                                <td className="px-6 py-3 text-right font-mono text-xs font-bold text-emerald-500">${formatNumber(h.combinedValue * 1000)}</td>
                                            </tr>
                                        ))}
                                        {clusterData.overlap.holdings.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="px-6 py-8 text-center opacity-50">No overlapping holdings found between these two funds.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {
                viewMode === 'reverse' && (
                    <>
                        <div className={`p-8 rounded-2xl border transition-all ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 shadow-xl' : 'bg-white border-gray-200 shadow-sm'}`}>
                            <div className="max-w-2xl mx-auto text-center mb-8">
                                <h2 className={`text-2xl font-bold tracking-tight mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Reverse Whale Lookup</h2>
                                <p className={`text-sm ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Find which top funds hold a specific stock.</p>
                            </div>
                            <div className="max-w-xl mx-auto flex gap-3">
                                <div className="relative flex-1">
                                    <TickerSearch value={reverseTicker} onChange={setReverseTicker} onSelect={handleReverseLookup} theme={theme} placeholder="Enter Stock Ticker (e.g. AAPL)" />
                                </div>
                                <button onClick={handleReverseLookup} disabled={loading} className={`px-6 font-medium rounded-lg text-sm ${theme === 'dark' ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search Fund DB"}
                                </button>
                            </div>
                            {error && <div className="mt-4 text-center text-sm font-medium text-red-500 bg-red-500/5 p-2 rounded">{error}</div>}
                        </div>

                        {reverseData && (
                            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">

                                <div className="flex items-center justify-between px-2">
                                    <div className="flex items-center gap-2">
                                        <Database className={`h-5 w-5 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-400'}`} />
                                        <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Funds Holding {reverseData.companyName}</span>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">{reverseData.matchCount} Found</span>
                                    </div>
                                </div>

                                <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-200 bg-white'}`}>
                                    <table className="w-full text-sm text-left">
                                        <thead className={`text-xs uppercase font-medium ${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500'}`}>
                                            <tr>
                                                <th className="px-6 py-3">Fund Name</th>
                                                <th className="px-6 py-3 text-right">Shares Held</th>
                                                <th className="px-6 py-3 text-right">Position Value</th>
                                                <th className="px-6 py-3 text-right">Trend (History)</th>
                                                <th className="px-6 py-3 text-right">Filing Date</th>
                                            </tr>
                                        </thead>
                                        <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700'}`}>
                                            {reverseData.funds.map((f: any, i: number) => (
                                                <tr key={i} className="hover:opacity-70 transition-opacity">
                                                    <td className="px-6 py-3 font-medium">
                                                        <div>{f.fundName}</div>
                                                        <div className="text-[10px] opacity-50">CIK: {f.cik}</div>
                                                    </td>
                                                    <td className="px-6 py-3 text-right font-mono text-xs">{formatNumber(f.shares)}</td>
                                                    <td className="px-6 py-3 text-right font-mono text-xs font-bold text-emerald-500">${formatNumber(f.value)}</td>
                                                    <td
                                                        className="px-6 py-3 text-right w-32 h-16 cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (f.history && f.history.length > 0) {
                                                                setSelectedFundHistory(f.history);
                                                                setSelectedFundName(f.fundName);
                                                            }
                                                        }}
                                                    >
                                                        {/* Sparkline */}
                                                        {f.history && f.history.length > 1 ? (
                                                            <div className="w-24 h-10 ml-auto pointer-events-none">
                                                                <ResponsiveContainer width="100%" height="100%">
                                                                    <LineChart data={f.history}>
                                                                        <Line
                                                                            type="monotone"
                                                                            dataKey="value"
                                                                            stroke={f.value > (f.history[0]?.value || 0) ? "#10b981" : "#ef4444"}
                                                                            strokeWidth={2}
                                                                            dot={false}
                                                                        />
                                                                    </LineChart>
                                                                </ResponsiveContainer>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs opacity-30">No History</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-3 text-right text-xs opacity-60">{f.filing_date}</td>
                                                </tr>
                                            ))}
                                            {reverseData.funds.length === 0 && (
                                                <tr>
                                                    <td colSpan={5} className="px-6 py-8 text-center opacity-50">No funds found holding this stock in the current database.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}

            {/* ACTIVIST WATCH TAB */}
            {viewMode === 'activist' && (
                <>
                    <div className={`p-8 rounded-2xl border transition-all ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 shadow-xl' : 'bg-white border-gray-200 shadow-sm'}`}>
                        <div className="max-w-2xl mx-auto text-center mb-8">
                            <h2 className={`text-2xl font-bold tracking-tight mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Activist Watch</h2>
                            <p className={`text-sm ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Monitor hostile takeovers and activist campaigns (SC 13D).</p>
                        </div>
                        <div className="max-w-xl mx-auto flex gap-3">
                            <div className="relative flex-1">
                                <TickerSearch value={activistTicker} onChange={setActivistTicker} onSelect={handleActivistSearch} theme={theme} placeholder="Fund Name or Target Company" />
                            </div>
                            <button onClick={handleActivistSearch} disabled={loading} className={`px-6 font-medium rounded-lg text-sm ${theme === 'dark' ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scan Filings"}
                            </button>
                        </div>
                        {error && <div className="mt-4 text-center text-sm font-medium text-red-500 bg-red-500/5 p-2 rounded">{error}</div>}
                    </div>

                    {activistData && (
                        <div key="activist-container" className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
                            <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-200 bg-white'}`}>
                                <div className={`px-6 py-4 border-b flex items-center gap-2 ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-100'}`}>
                                    <Megaphone className="w-5 h-5 text-red-500" />
                                    <h3 className="font-semibold text-sm">Campaign Details</h3>
                                </div>
                                <table className="w-full text-sm text-left">
                                    <thead className={`text-xs uppercase font-medium ${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500'}`}>
                                        <tr>
                                            <th className="px-6 py-3">Filing Date</th>
                                            <th className="px-6 py-3">Reporting Person</th>
                                            <th className="px-6 py-3">Stake</th>
                                            <th className="px-6 py-3">Purpose / Notes</th>
                                            <th className="px-6 py-3 text-right">Access</th>
                                        </tr>
                                    </thead>
                                    <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700'}`}>
                                        {activistData.map((f, i) => (
                                            <tr key={i} className="hover:opacity-70 transition-opacity">
                                                <td className="px-6 py-3 font-mono text-xs whitespace-nowrap">{f.filingDate}</td>
                                                <td className="px-6 py-3">
                                                    <div className="text-xs font-bold">{f.reportingPerson || "Unknown"}</div>
                                                    <div className="text-[10px] opacity-60">{f.form}</div>
                                                </td>
                                                <td className="px-6 py-3">
                                                    <div className="text-xs font-mono font-bold text-emerald-500">{f.percentClass || "N/A"}</div>
                                                    <div className="text-[10px] opacity-60 font-mono">{f.shares ? `${new Intl.NumberFormat('en-US', { notation: "compact" }).format(parseInt(f.shares))} shares` : ''}</div>
                                                </td>
                                                <td className="px-6 py-3 text-xs opacity-80 max-w-xs truncate" title={f.purpose}>
                                                    {f.purpose || f.description}
                                                </td>
                                                <td className="px-6 py-3 text-right">
                                                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-500 hover:underline">
                                                        Read Filing
                                                    </a>
                                                </td>
                                            </tr>
                                        ))}
                                        {activistData.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="px-6 py-8 text-center opacity-50">No SC 13D Activist filings found in recent history.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

        </div >
    );
}
