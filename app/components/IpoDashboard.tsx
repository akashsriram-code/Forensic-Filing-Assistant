
"use client";

import { useState, useEffect } from 'react';
import { IpoFiling } from '@/lib/ipo-scraper';
import { RefreshCw, FileText, TrendingUp, DollarSign, PieChart, Activity, AlertCircle, X, Target, Building, Users } from 'lucide-react';

interface IpoDashboardProps {
    theme: 'light' | 'dark';
}

export function IpoDashboard({ theme }: IpoDashboardProps) {
    const [filings, setFilings] = useState<IpoFiling[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedFiling, setSelectedFiling] = useState<IpoFiling | null>(null);

    const fetchData = async (forceRefresh = false) => {
        if (forceRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            const method = forceRefresh ? 'POST' : 'GET';
            const res = await fetch('/api/ipo-filings', { method });
            const data = await res.json();
            if (data.filings) {
                setFilings(data.filings);
            }
        } catch (e) {
            console.error("Failed to fetch IPOs", e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const openAnalysis = (filing: IpoFiling) => {
        setSelectedFiling(filing);
    };

    const closeAnalysis = () => {
        setSelectedFiling(null);
    };

    // Styling helpers
    const cardBg = theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-200';
    const textMain = theme === 'dark' ? 'text-zinc-100' : 'text-gray-900';
    const textMuted = theme === 'dark' ? 'text-zinc-400' : 'text-gray-500';

    return (
        <div className="space-y-6">
            {/* Disclaimer */}
            <div className={`p-4 rounded-lg border flex items-start gap-3 ${theme === 'dark' ? 'bg-blue-900/20 border-blue-800 text-blue-200' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                <Activity className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                    <p className="font-semibold">IPO Watchlist <span className="ml-2 text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded">BETA</span></p>
                    <p className="opacity-80">
                        Monitoring S-1 and F-1 registration statements. Data is parsed heuristically. Always verify with official SEC filings.
                        Click "Analyze" to view extracted pricing and financial data.
                    </p>
                </div>
                <button
                    onClick={() => fetchData(true)}
                    disabled={refreshing}
                    className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                >
                    <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? "Scanning..." : "Refresh Data"}
                </button>
            </div>

            {/* List */}
            <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
                <div className={`px-6 py-4 border-b ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-100 bg-gray-50/50'}`}>
                    <h3 className={`font-semibold ${textMain}`}>Recent Filings</h3>
                </div>
                {loading && filings.length === 0 ? (
                    <div className="p-12 text-center opacity-50">Loading filings...</div>
                ) : (
                    <table className="w-full text-sm text-left">
                        <thead className={`${theme === 'dark' ? 'bg-zinc-900/50 text-zinc-500' : 'bg-gray-50 text-gray-500'} text-xs uppercase font-medium`}>
                            <tr>
                                <th className="px-6 py-3">Date</th>
                                <th className="px-6 py-3">Company</th>
                                <th className="px-6 py-3">Form</th>
                                <th className="px-6 py-3">Valuation</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800' : 'divide-gray-100'}`}>
                            {filings.map((filing, idx) => (
                                <tr key={idx} className={`group transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800/50' : 'hover:bg-gray-50'}`}>
                                    <td className={`px-6 py-4 font-mono text-xs ${textMuted}`}>{filing.filingDate}</td>
                                    <td className={`px-6 py-4 font-medium ${textMain}`}>
                                        <div className="flex items-center gap-2">
                                            {filing.companyName}
                                            {filing.offeringType === 'Uplisting' && (
                                                <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 rounded border border-amber-200 dark:border-amber-800 uppercase tracking-wide">
                                                    Uplisting
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[10px] opacity-50 font-mono">CIK: {filing.cik}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${filing.form.includes('S-1') ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                                            }`}>
                                            {filing.form}
                                        </span>
                                    </td>
                                    <td className={`px-6 py-4 font-mono text-xs ${textMuted}`}>
                                        {filing.pricing?.estimatedValuation ? (
                                            <span className="bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[11px]">
                                                {filing.pricing.estimatedValuation.split('(')[0].trim()}
                                            </span>
                                        ) : (
                                            <span className="opacity-50">-</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => openAnalysis(filing)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-white border border-gray-200 hover:bg-gray-50 text-gray-900 shadow-sm'}`}
                                        >
                                            <TrendingUp className="h-3 w-3" />
                                            Analyze
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Analysis Modal */}
            {selectedFiling && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className={`w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl ${theme === 'dark' ? 'bg-zinc-950 border border-zinc-800' : 'bg-white'}`}>
                        <div className={`sticky top-0 z-10 px-6 py-4 border-b flex items-center justify-between ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950' : 'border-gray-200 bg-white'}`}>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className={`text-lg font-bold ${textMain}`}>{selectedFiling.companyName}</h2>
                                    {selectedFiling.offeringType && (
                                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md border ${selectedFiling.offeringType === 'IPO'
                                            ? 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800'
                                            : 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
                                            }`}>
                                            {selectedFiling.offeringType}
                                        </span>
                                    )}
                                </div>
                                <p className={`text-xs ${textMuted}`}>Filing: {selectedFiling.form} • Date: {selectedFiling.filingDate}</p>
                            </div>
                            <button onClick={closeAnalysis} className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 ${textMuted}`}>
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-8">

                            {/* Dashboard Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className={`p-4 rounded-xl border ${cardBg}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-1.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-md">
                                            <TrendingUp className="h-4 w-4" />
                                        </div>
                                        <span className={`text-xs font-medium uppercase tracking-wide ${textMuted}`}>Price Range</span>
                                    </div>
                                    <div className={`text-xl font-bold ${textMain}`}>
                                        {selectedFiling.pricing?.priceRange || "N/A"}
                                    </div>
                                    <div className={`text-xs mt-1 ${textMuted}`}>
                                        Symbol: <span className="font-mono bg-gray-100 dark:bg-zinc-800 px-1 rounded">{selectedFiling.pricing?.proposedSymbol || "?"}</span>
                                    </div>
                                </div>

                                <div className={`p-4 rounded-xl border ${cardBg}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-1.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-md">
                                            <PieChart className="h-4 w-4" />
                                        </div>
                                        <span className={`text-xs font-medium uppercase tracking-wide ${textMuted}`}>Shares Issued</span>
                                    </div>
                                    <div className={`text-xl font-bold ${textMain}`}>
                                        {selectedFiling.pricing?.sharesOffered || "N/A"}
                                    </div>
                                </div>

                                <div className={`p-4 rounded-xl border ${cardBg}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-md">
                                            <DollarSign className="h-4 w-4" />
                                        </div>
                                        <span className={`text-xs font-medium uppercase tracking-wide ${textMuted}`}>Total Raise</span>
                                    </div>
                                    <div className={`text-xl font-bold ${textMain}`}>
                                        {selectedFiling.pricing?.dealSize || "--"}
                                    </div>
                                </div>

                                <div className={`p-4 rounded-xl border ${cardBg}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-1.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded-md">
                                            <Activity className="h-4 w-4" />
                                        </div>
                                        <span className={`text-xs font-medium uppercase tracking-wide ${textMuted}`}>Market Cap</span>
                                    </div>
                                    <div className={`text-xl font-bold ${textMain}`}>
                                        {selectedFiling.pricing?.estimatedValuation || "--"}
                                    </div>
                                    <div className={`text-xs mt-1 ${textMuted}`}>
                                        {selectedFiling.pricing?.sharesOutstanding ? "Post-Offering" : "Not Found"}
                                    </div>
                                </div>
                            </div>

                            {/* Exchange & Underwriters Row */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className={`p-4 rounded-xl border ${cardBg}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-1.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-md">
                                            <Building className="h-4 w-4" />
                                        </div>
                                        <span className={`text-xs font-medium uppercase tracking-wide ${textMuted}`}>Exchange</span>
                                    </div>
                                    <div className={`text-base font-semibold ${textMain}`}>
                                        {selectedFiling.pricing?.exchange || "Not Specified"}
                                    </div>
                                </div>

                                <div className={`p-4 rounded-xl border ${cardBg}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-1.5 bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 rounded-md">
                                            <Users className="h-4 w-4" />
                                        </div>
                                        <span className={`text-xs font-medium uppercase tracking-wide ${textMuted}`}>Underwriters</span>
                                    </div>
                                    <div className={`text-base font-semibold ${textMain}`}>
                                        {selectedFiling.pricing?.underwriters || "Not Found"}
                                    </div>
                                </div>
                            </div>

                            {/* Use of Proceeds */}
                            {selectedFiling.pricing?.useOfProceeds && (
                                <div className={`mb-6 p-4 rounded-xl border ${cardBg}`}>
                                    <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-2 ${textMuted}`}>
                                        <Target className="h-4 w-4" />
                                        Use of Proceeds
                                    </h3>
                                    <p className={`text-sm ${textMain} leading-relaxed`}>
                                        {selectedFiling.pricing.useOfProceeds}
                                    </p>
                                </div>
                            )}

                            {/* Financials Section */}
                            <div>
                                <h3 className={`text-sm font-bold uppercase tracking-wide mb-4 flex items-center gap-2 ${textMuted}`}>
                                    <FileText className="h-4 w-4" />
                                    Extracted Financials
                                </h3>

                                <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
                                    <table className="w-full text-sm">
                                        <thead className={`${theme === 'dark' ? 'bg-zinc-900' : 'bg-gray-50'} text-xs uppercase font-medium`}>
                                            <tr>
                                                <th className="px-6 py-3 text-left">Metric</th>
                                                <th className="px-6 py-3 text-right">Value (Extracted)</th>
                                            </tr>
                                        </thead>
                                        <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800' : 'divide-gray-100'}`}>
                                            <tr>
                                                <td className={`px-6 py-3 font-medium ${textMain}`}>Revenue / Sales</td>
                                                <td className={`px-6 py-3 text-right font-mono ${textMuted}`}>{selectedFiling.financials?.revenue || "Not Found"}</td>
                                            </tr>
                                            <tr>
                                                <td className={`px-6 py-3 font-medium ${textMain}`}>Net Income (Loss)</td>
                                                <td className={`px-6 py-3 text-right font-mono ${textMuted}`}>{selectedFiling.financials?.netIncome || "Not Found"}</td>
                                            </tr>
                                            <tr>
                                                <td className={`px-6 py-3 font-medium ${textMain}`}>Total Assets</td>
                                                <td className={`px-6 py-3 text-right font-mono ${textMuted}`}>{selectedFiling.financials?.totalAssets || "Not Found"}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                                    <AlertCircle className="h-3 w-3" />
                                    Data extracted automatically via heuristics. Tables in HTML filings vary significantly.
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end pt-4 border-t border-gray-100 dark:border-zinc-800">
                                <a
                                    href={selectedFiling.reportUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${theme === 'dark' ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800'}`}
                                >
                                    View Full Filing
                                </a>
                            </div>

                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
