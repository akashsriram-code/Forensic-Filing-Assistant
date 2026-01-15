"use client";

import { useState } from 'react';
import { Download, Loader2, TrendingUp, TrendingDown, User, ExternalLink } from 'lucide-react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { TickerSearch } from './TickerSearch';
import { FollowButton } from './FollowButton';

export function InsiderTracker({ theme }: { theme: 'light' | 'dark' }) {
    const [ticker, setTicker] = useState("");
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState("");

    const handleAnalyze = async () => {
        if (!ticker) return;
        setLoading(true);
        setError("");
        setData(null);

        try {
            const res = await fetch('/api/insider-analysis', {
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

    const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

    // Aggregate data for Chart: Net Value by Insider
    const insiderMap = new Map();
    data?.transactions?.forEach((tx: any) => {
        const netValue = (tx.type === 'A' ? 1 : -1) * tx.value;
        insiderMap.set(tx.rptOwnerName, (insiderMap.get(tx.rptOwnerName) || 0) + netValue);
    });
    const chartData = Array.from(insiderMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 10);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Search Section */}
            <div className={`p-8 rounded-2xl border transition-all ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 shadow-xl' : 'bg-white border-gray-200 shadow-sm'}`}>
                <div className="max-w-2xl mx-auto text-center mb-8">
                    <h2 className={`text-2xl font-bold tracking-tight mb-2 flex items-center justify-center gap-3 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                        Insider Trading Analysis (Form 4)
                        {data && <FollowButton ticker={data.ticker} theme={theme} />}
                    </h2>
                    <p className={`text-sm ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                        Track real-time buying and selling by Directors, Officers, and 10% Owners.
                    </p>
                </div>
                <div className="max-w-xl mx-auto flex gap-3">
                    <div className="relative flex-1">
                        <TickerSearch
                            value={ticker}
                            onChange={setTicker}
                            onSelect={handleAnalyze}
                            theme={theme}
                            placeholder="Enter Ticker (e.g. TSLA)"
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
                {error && <div className="mt-4 text-center text-red-500 text-sm">{error}</div>}
            </div>

            {data && (
                <div className="space-y-8">
                    {/* Chart */}
                    <div className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-gray-200'}`}>
                        <h3 className={`text-xs font-semibold uppercase tracking-wider mb-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Net Insider Action (Last 20 Filings)</h3>
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} horizontal={true} vertical={true} />
                                    <XAxis type="number" fontSize={12} tickFormatter={(val) => `$${new Intl.NumberFormat('en-US', { notation: "compact" }).format(val)}`} />
                                    <YAxis dataKey="name" type="category" width={150} fontSize={11} />
                                    <Tooltip
                                        cursor={{ fill: theme === 'dark' ? '#333' : '#f3f4f6' }}
                                        contentStyle={{ backgroundColor: theme === 'dark' ? '#18181b' : 'white', borderColor: '#333' }}
                                    />
                                    <Bar dataKey="value" name="Net Value ($)" fill="#8884d8">
                                        {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.value > 0 ? '#10b981' : '#ef4444'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Table */}
                    <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-200 bg-white'}`}>
                        <table className="w-full text-sm text-left">
                            <thead className={`text-xs uppercase font-medium ${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500'}`}>
                                <tr>
                                    <th className="px-6 py-3">Date</th>
                                    <th className="px-6 py-3">Insider</th>
                                    <th className="px-6 py-3">Type</th>
                                    <th className="px-6 py-3 text-right">Shares</th>
                                    <th className="px-6 py-3 text-right">Price</th>
                                    <th className="px-6 py-3 text-right">Value</th>
                                    <th className="px-6 py-3 text-right">Post-Tx Held</th>
                                    <th className="px-6 py-3 text-right">Link</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700'}`}>
                                {data.transactions.map((tx: any, i: number) => (
                                    <tr key={i} className={`transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800/50' : 'hover:bg-gray-50'}`}>
                                        <td className="px-6 py-3 opacity-70 whitespace-nowrap">{tx.transactionDate}</td>
                                        <td className="px-6 py-3">
                                            <div className="font-medium text-xs">{tx.rptOwnerName}</div>
                                            <div className="text-[10px] opacity-50 truncate max-w-[150px]">{tx.title}</div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${tx.type === 'A' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                                                'bg-red-500/10 text-red-500 border border-red-500/20'
                                                }`}>
                                                {tx.type === 'A' ? 'BUY' : 'SELL'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-right font-mono text-xs opacity-80">{new Intl.NumberFormat('en-US').format(tx.shares)}</td>
                                        <td className="px-6 py-3 text-right font-mono text-xs opacity-80">${tx.price.toFixed(2)}</td>
                                        <td className={`px-6 py-3 text-right font-mono text-xs font-medium ${tx.type === 'A' ? 'text-emerald-500' : 'text-red-500'}`}>
                                            {formatCurrency(tx.value)}
                                        </td>
                                        <td className="px-6 py-3 text-right font-mono text-xs opacity-50">{new Intl.NumberFormat('en-US', { notation: "compact" }).format(tx.postShares)}</td>
                                        <td className="px-6 py-3 text-right">
                                            <a href={tx.url} target="_blank" rel="noopener noreferrer" className="opacity-50 hover:opacity-100">
                                                <ExternalLink className="w-4 h-4" />
                                            </a>
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
