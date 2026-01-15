"use client";

import { useState } from 'react';
import { Download, X, Search, Loader2, TrendingUp, TrendingDown, CirclePlus, Plus } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ScatterChart, Scatter, ReferenceLine } from 'recharts';
import { getSector } from '@/lib/sectors';
import { TickerSearch } from './TickerSearch';
import { FollowButton } from './FollowButton';

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

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#64748b'];

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
    // ... existing state ...
    const [ticker, setTicker] = useState("");
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<WhaleData | null>(null);
    const [error, setError] = useState("");
    const [sortConfig, setSortConfig] = useState<{ key: 'change' | 'percentChange', direction: 'asc' | 'desc' } | null>(null);

    // New State for History & Sectors
    const [analyzingHistory, setAnalyzingHistory] = useState(false);
    const [historyData, setHistoryData] = useState<any[] | null>(null);
    const [selectedHolding, setSelectedHolding] = useState<string | null>(null);

    // ... existing handlers (handleAnalyze, handleSort etc) ...

    const handleAnalyze = async () => {
        if (!ticker) return;
        setLoading(true);
        setError("");
        setData(null);

        try {
            const res = await fetch('/api/whale-tracker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || "Analysis failed");
            setData(result);
        } catch (e: any) {
            setError(e.message || "An error occurred");
        } finally {
            setLoading(false);
        }
    };

    const formatNumber = (num: number) => {
        return new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(num);
    };

    const handleSort = (key: 'change' | 'percentChange') => {
        setSortConfig(current => {
            if (current?.key === key) {
                return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'desc' };
        });
    };

    const sortedChanges = data ? [...data.allChanges].sort((a, b) => {
        if (!sortConfig) return 0;
        const multiplier = sortConfig.direction === 'asc' ? 1 : -1;
        return (a[sortConfig.key] - b[sortConfig.key]) * multiplier;
    }) : [];

    // --- NEW FEATURES ---

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

    const handleHistoryClick = async (holding: any) => {
        setSelectedHolding(holding.issuer);
        setAnalyzingHistory(true);
        setHistoryData(null);

        try {
            const res = await fetch('/api/whale-history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker: data?.ticker, holdingInfo: holding })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            setHistoryData(result.history);
        } catch (e) {
            console.error(e);
            alert("Could not fetch historical data. It might be unavailable for this ticker.");
            setAnalyzingHistory(false);
            setSelectedHolding(null);
        }
    };

    // Calculate Sector Data
    const sectorMap = new Map<string, number>();
    data?.topHoldings.forEach(h => {
        const sector = getSector(h.issuer);
        sectorMap.set(sector, (sectorMap.get(sector) || 0) + h.value);
    });

    // Top 5 Sectors + Other
    const sectorData = Array.from(sectorMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    // Chart Data Preps
    const chartData = data?.topHoldings.map(h => ({ name: h.issuer, value: h.value })) || [];
    const scatterData = data?.allChanges
        .filter(h => h.value > 1000)
        .map(h => ({
            name: h.issuer,
            x: h.value * 1000,
            y: h.percentChange > 200 ? 200 : (h.percentChange < -100 ? -100 : h.percentChange),
            originalPercent: h.percentChange,
            fill: h.change > 0 ? '#10b981' : (h.change < 0 ? '#ef4444' : '#94a3b8')
        })) || [];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500 relative">

            {/* HISTORY MODAL overlay */}
            {(analyzingHistory || historyData) && (
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
                                <p className="text-sm font-medium animate-pulse">Scanning historical SEC filings (this takes ~5s)...</p>
                            </div>
                        ) : historyData && (
                            <div className="space-y-6">
                                <div className="h-80 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={historyData}>
                                            <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                            <XAxis dataKey="date" fontSize={12} tickFormatter={(val) => val.substring(0, 7)} />
                                            <YAxis yAxisId="left" fontSize={12} tickFormatter={(val) => `$${formatNumber(val * 1000)}`} />
                                            <YAxis yAxisId="right" orientation="right" fontSize={12} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: theme === 'dark' ? '#18181b' : 'white', borderColor: '#333' }}
                                                labelStyle={{ color: theme === 'dark' ? 'white' : 'black' }}
                                            />
                                            <Legend />
                                            <Line yAxisId="left" type="monotone" dataKey="value" name="Position Value ($)" stroke="#8884d8" strokeWidth={2} dot={{ r: 4 }} />
                                            <Line yAxisId="right" type="monotone" dataKey="shares" name="Shares Held" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => handleDownloadCSV(historyData, `${selectedHolding}_history`)}
                                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                                    >
                                        <Download className="w-4 h-4" /> Download History CSV
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}


            {/* Search Block */}
            <div className={`p-8 rounded-2xl border transition-all ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 shadow-xl' : 'bg-white border-gray-200 shadow-sm'}`}>
                <div className="max-w-2xl mx-auto text-center mb-8">
                    <h2 className={`text-2xl font-bold tracking-tight mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                        Institutional 13-F Analysis
                    </h2>
                    <p className={`text-sm ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                        Track major holdings, recent moves, and portfolio shifts.
                    </p>
                </div>

                <div className="max-w-xl mx-auto flex gap-3">
                    <div className="relative flex-1">
                        <TickerSearch
                            value={ticker}
                            onChange={(val) => setTicker(val)}
                            onSelect={(val) => handleAnalyze()}
                            theme={theme}
                            placeholder="Enter Ticker, Fund Name, or CIK"
                        />
                    </div>
                    <button
                        onClick={handleAnalyze}
                        disabled={loading}
                        className={`px-6 font-medium rounded-lg text-sm transition-all ${theme === 'dark' ? 'bg-white text-black hover:bg-gray-200' : 'bg-gray-900 text-white hover:bg-black'}`}
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze"}
                    </button>
                </div>
                {error && (
                    <div className="mt-4 text-center text-sm font-medium text-red-500 bg-red-500/5 p-2 rounded">
                        {error}
                    </div>
                )}
            </div>

            {data && (
                <div className="space-y-8">
                    {/* Header */}
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                            <TrendingUp className={`h-5 w-5 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-400'}`} />
                            <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{data.ticker}</span>
                            <FollowButton ticker={data.ticker} theme={theme} />
                        </div>
                        <div className="flex items-center gap-4">
                            <div className={`text-xs font-mono ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                                {data.filingDatePrev} <span className="mx-1">→</span> {data.filingDateCurr}
                            </div>
                            <button
                                onClick={() => handleDownloadCSV(data.allChanges, `${data.ticker}_QoQ_changes`)}
                                className={`text-xs flex items-center gap-1 font-medium hover:underline ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}
                            >
                                <Download className="w-3 h-3" /> Export CSV
                            </button>
                        </div>
                    </div>

                    {/* Main Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

                        {/* VISUALIZATION 1: Allocation Pie (Top Holdings) */}
                        <div className={`col-span-1 md:col-span-1 p-6 rounded-xl border flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                            <h3 className={`text-xs font-semibold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Stock Weighing (Top 5)</h3>
                            <div className="h-40 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={chartData} innerRadius={50} outerRadius={70} paddingAngle={2} dataKey="value">
                                            {chartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip theme={theme} />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* VISUALIZATION 2: Sector Breakdown (New) */}
                        <div className={`col-span-1 md:col-span-1 p-6 rounded-xl border flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                            <h3 className={`text-xs font-semibold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Sector Exposure</h3>
                            <div className="h-40 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={sectorData} innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                                            {sectorData.map((entry, index) => (
                                                <Cell key={`cell-sec-${index}`} fill={COLORS[(index + 3) % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip theme={theme} />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex flex-wrap gap-2 justify-center mt-2">
                                <span className="text-[10px] opacity-50">Top: {sectorData[0]?.name}</span>
                            </div>
                        </div>


                        {/* VISUALIZATION 3: Quadrant Analysis */}
                        <div className={`col-span-1 md:col-span-2 p-6 rounded-xl border ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className={`text-xs font-semibold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                                    Conviction (Value vs. Action)
                                </h3>
                                <div className="flex gap-4 text-[10px] opacity-60">
                                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Buy</span>
                                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Sell</span>
                                </div>
                            </div>
                            <div className="h-40 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                        <XAxis
                                            dataKey="x"
                                            type="number"
                                            name="Value"
                                            tickFormatter={(val) => `$${new Intl.NumberFormat('en-US', { notation: "compact" }).format(val)}`}
                                            fontSize={10}
                                            tickLine={false}
                                            axisLine={false}
                                        />
                                        <YAxis
                                            dataKey="y"
                                            type="number"
                                            name="Change"
                                            unit="%"
                                            fontSize={10}
                                            tickLine={false}
                                            axisLine={false}
                                        />
                                        <ReferenceLine y={0} stroke={theme === 'dark' ? '#52525b' : '#e5e7eb'} strokeDasharray="3 3" />
                                        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomScatterTooltip theme={theme} />} />
                                        <Scatter name="Holdings" data={scatterData} fill="#8884d8">
                                            {scatterData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.fill} />
                                            ))}
                                        </Scatter>
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Stats List Grid (Unchanged mostly) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* 1. Top Holdings */}
                        <div className={`col-span-1 md:col-span-1 p-6 rounded-xl border overflow-hidden ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                            <h3 className={`text-xs font-semibold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Top Holdings</h3>
                            <div className="space-y-2">
                                {data.topHoldings.slice(0, 5).map((h, i) => (
                                    <div key={i} className="flex justify-between items-center text-sm cursor-pointer hover:opacity-70" onClick={() => handleHistoryClick(h)}>
                                        <span className={`font-medium truncate w-24 ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-900'}`}>{h.issuer}</span>
                                        <span className={`font-mono text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>${formatNumber(h.value * 1000)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Top Buys/Sells ... (Simplified for brevity in update) */}
                        <div className={`col-span-1 md:col-span-1 p-6 rounded-xl border ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                            <h3 className={`text-xs font-semibold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Top Buys</h3>
                            <div className="space-y-2">
                                {data.topBuys.slice(0, 5).map((h, i) => (
                                    <div key={i} className="flex justify-between items-center text-sm cursor-pointer hover:opacity-70" onClick={() => handleHistoryClick(h)}>
                                        <span className={`font-medium truncate w-24 ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-900'}`}>{h.issuer}</span>
                                        <span className="font-mono text-xs text-emerald-500">+{formatNumber(h.change)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className={`col-span-1 md:col-span-1 p-6 rounded-xl border ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                            <h3 className={`text-xs font-semibold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Top Sells</h3>
                            <div className="space-y-2">
                                {data.topSells.slice(0, 5).map((h, i) => (
                                    <div key={i} className="flex justify-between items-center text-sm cursor-pointer hover:opacity-70" onClick={() => handleHistoryClick(h)}>
                                        <span className={`font-medium truncate w-24 ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-900'}`}>{h.issuer}</span>
                                        <span className="font-mono text-xs text-red-500">{formatNumber(h.change)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Detailed Table */}
                    <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-200 bg-white'}`}>
                        {/* ... Table Header ... */}
                        <div className={`px-6 py-4 border-b flex justify-between items-center ${theme === 'dark' ? 'border-zinc-800' : 'border-gray-100'}`}>
                            <h3 className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Detailed Portfolio Changes</h3>
                            <div className="text-xs text-zinc-500">Click any row for history</div>
                        </div>
                        <table className="w-full text-sm text-left">
                            <thead className={`text-xs uppercase font-medium ${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500'}`}>
                                <tr>
                                    <th className="px-6 py-3 font-medium">Issuer</th>
                                    <th className="px-6 py-3 font-medium hidden md:table-cell">Sector</th>
                                    <th className="px-6 py-3 text-right font-medium">Prev</th>
                                    <th className="px-6 py-3 text-right font-medium">Curr</th>
                                    <th className="px-6 py-3 text-right font-medium">Change</th>
                                    <th className="px-6 py-3 text-right font-medium">% Change</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700'}`}>
                                {sortedChanges.slice(0, 50).map((h, i) => (
                                    <tr
                                        key={i}
                                        onClick={() => handleHistoryClick(h)}
                                        className={`cursor-pointer transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800/50' : 'hover:bg-purple-50'}`}
                                        title="Click for historical analysis"
                                    >
                                        <td className={`px-6 py-3 font-medium ${theme === 'dark' ? 'text-zinc-200' : 'text-gray-900'}`}>
                                            <div className="flex items-center gap-2">
                                                {h.issuer}
                                                {h.isNew && (
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                                        <CirclePlus className="w-3 h-3" /> NEW
                                                    </span>
                                                )}
                                                {h.isAddOn && (
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                                        <Plus className="w-3 h-3" /> ADD
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 font-mono text-xs opacity-50 hidden md:table-cell">{getSector(h.issuer)}</td>
                                        <td className="px-6 py-3 text-right font-mono text-xs opacity-60">{formatNumber(h.sharesPrev)}</td>
                                        <td className="px-6 py-3 text-right font-mono text-xs opacity-60">{formatNumber(h.sharesCurr)}</td>
                                        <td className={`px-6 py-3 text-right font-mono text-xs ${h.change > 0 ? 'text-emerald-500' : h.change < 0 ? 'text-red-500' : 'opacity-40'}`}>
                                            {h.change > 0 ? '+' : ''}{formatNumber(h.change)}
                                        </td>
                                        <td className={`px-6 py-3 text-right font-mono text-xs ${h.percentChange > 0 ? 'text-emerald-500' : h.percentChange < 0 ? 'text-red-500' : 'opacity-40'}`}>
                                            {h.percentChange.toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}


