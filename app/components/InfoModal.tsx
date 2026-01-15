"use client";

import { X, Search, Activity, LineChart, Split, Bell, Info } from 'lucide-react';
import { useState } from 'react';

export function InfoModal({ theme }: { theme: 'light' | 'dark' }) {
    const [isOpen, setIsOpen] = useState(false);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className={`p-2 rounded-full transition-colors ${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'}`}
                title="About & Features"
            >
                <Info className="w-5 h-5" />
            </button>
        );
    }

    return (
        // ALIGNMENT CHANGE: items-start + pt-20 ensures the modal starts from the top, never clipped.
        <div className="fixed inset-0 z-[100] flex justify-center items-start pt-12 sm:pt-20 p-4 animate-in fade-in duration-200">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setIsOpen(false)}
            />

            {/* Modal Container */}
            <div
                className={`
                    relative w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col 
                    max-h-[80vh]
                    ${theme === 'dark' ? 'bg-zinc-900 border border-zinc-700 text-zinc-100' : 'bg-white text-gray-900'}
                `}
                role="dialog"
                aria-modal="true"
            >

                {/* Header */}
                <div className={`px-6 py-4 border-b flex items-center justify-between shrink-0 ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-100 bg-white'} rounded-t-2xl`}>
                    <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-md ${theme === 'dark' ? 'bg-zinc-800 text-zinc-200' : 'bg-gray-900 text-white'}`}>
                            <Activity className="h-4 w-4" />
                        </div>
                        <h2 className="font-bold text-lg">Platform Guide</h2>
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className={`p-2 rounded-full transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400 hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-900'}`}
                        title="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content - min-h-0 is CRITICAL for nested flex scrolling */}
                <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-8 scroll-smooth">

                    {/* 1. Downloader */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-blue-500 font-semibold">
                            <Search className="w-5 h-5" />
                            <h3>Filing Downloader</h3>
                        </div>
                        <div className={`space-y-2 text-sm leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                            <p>
                                <strong>Search & Download:</strong> Access the entire SEC EDGAR database back to 2001. Filter by specific form types (10-K, 10-Q, 8-K) and date ranges.
                            </p>
                            <p>
                                <strong>Bulk Actions:</strong> Download multiple filings at once as a ZIP archive, or read them individually in a clean, print-friendly format.
                            </p>
                        </div>
                    </section>

                    {/* 2. Whale Tracker */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-purple-500 font-semibold">
                            <LineChart className="w-5 h-5" />
                            <h3>Whale Tracker (13F)</h3>
                        </div>
                        <div className={`space-y-2 text-sm leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                            <p>
                                <strong>Institutional Analysis:</strong> Track the portfolios of major funds (e.g., Berkshire Hathaway, Bridgewater) using 13F filings.
                            </p>
                            <ul className="list-disc pl-4 space-y-1 opacity-90">
                                <li><strong>New Position Badges:</strong> Instantly spot new entries vs add-ons.</li>
                                <li><strong>Sector Breakdown:</strong> Visualize exposure by industry.</li>
                                <li><strong>Historical Tracking:</strong> Click any holding to see size changes over the last 2 years.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 3. Insider Analysis */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-emerald-500 font-semibold">
                            <Activity className="w-5 h-5" />
                            <h3>Insider Analysis (Form 4)</h3>
                        </div>
                        <p className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                            Track C-suite execution. Enter a company ticker to visualize recent insider buying and selling activity. Note: Bars represent net transaction value.
                        </p>
                    </section>

                    {/* 4. Diff Engine */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-orange-500 font-semibold">
                            <Split className="w-5 h-5" />
                            <h3>Intelligent Diff Engine</h3>
                        </div>
                        <p className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                            Automatically compare a current 10-K/10-Q with the previous period.
                            The engine extracts "Risk Factors" and "MD&A" sections for focused side-by-side comparison, highlighting semantic changes.
                        </p>
                    </section>

                    {/* 5. Notifications */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-pink-500 font-semibold">
                            <Bell className="w-5 h-5" />
                            <h3>Smart Notifications</h3>
                        </div>
                        <p className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-600'}`}>
                            Follow any ticker by clicking the Bell icon.
                            Use the <strong>Gear icon</strong> to customize alerts for specific filing types (e.g., "Only 10-K and 8-K"). Alerts are delivered locally in your browser.
                        </p>
                    </section>

                </div>

                {/* Footer */}
                <div className={`p-4 border-t flex items-center justify-between shrink-0 ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-100 bg-gray-50'} rounded-b-2xl`}>
                    <span className="text-xs opacity-50">Use the Theme toggle (🌙/☀️) to switch modes.</span>
                    <button
                        onClick={() => setIsOpen(false)}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-white border border-gray-200 hover:bg-gray-100 text-gray-900'}`}
                    >
                        Close Guide
                    </button>
                </div>
            </div>
        </div>
    );
}
