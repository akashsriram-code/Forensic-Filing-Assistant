"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, Split, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

function DiffViewerContent() {
    const searchParams = useSearchParams();
    const url1 = searchParams.get('url1');
    const url2 = searchParams.get('url2');
    const title = searchParams.get('title') || 'Document Comparison';

    const [diffs, setDiffs] = useState<any[]>([]);
    const [riskDiff, setRiskDiff] = useState<any[]>([]);
    const [mdaDiff, setMdaDiff] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showChangesOnly, setShowChangesOnly] = useState(false);

    // Default to 'risk' as per user feedback to narrow down noise
    const [activeTab, setActiveTab] = useState<'risk' | 'mda' | 'all'>('risk');

    useEffect(() => {
        if (!url1 || !url2) {
            setError("Missing document URLs");
            setLoading(false);
            return;
        }

        const fetchDiff = async () => {
            try {
                const res = await fetch('/api/diff', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url1, url2 })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                setDiffs(data.diffs || []);
                setRiskDiff(data.riskDiff || []);
                setMdaDiff(data.mdaDiff || []);

            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        fetchDiff();
    }, [url1, url2]);

    const currentData = activeTab === 'all' ? diffs : activeTab === 'risk' ? riskDiff : mdaDiff;

    // Construct Side-by-Side Views
    const renderSideBySide = () => {
        return (
            <div className="grid grid-cols-2 gap-4 h-full">
                {/* LEFT: OLD (Deletions Red) */}
                <div className="p-6 bg-white dark:bg-zinc-900 border rounded-xl overflow-y-auto h-[75vh] font-mono text-sm leading-6 whitespace-pre-wrap">
                    <h3 className="text-xs font-bold uppercase text-gray-400 mb-4 sticky top-0 bg-white dark:bg-zinc-900 pb-2 border-b">Previous Version</h3>
                    {currentData.length === 0 && <p className="text-gray-400 italic">No section content found.</p>}
                    {currentData.map((part, i) => {
                        if (showChangesOnly && !part.added && !part.removed) return null;
                        if (part.added) return null; // Don't show additions in Left
                        return (
                            <span key={i} className={part.removed ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 decoration-rose-400" : ""}>
                                {part.value}
                            </span>
                        );
                    })}
                </div>

                {/* RIGHT: NEW (Additions Green) */}
                <div className="p-6 bg-white dark:bg-zinc-900 border rounded-xl overflow-y-auto h-[75vh] font-mono text-sm leading-6 whitespace-pre-wrap">
                    <h3 className="text-xs font-bold uppercase text-gray-400 mb-4 sticky top-0 bg-white dark:bg-zinc-900 pb-2 border-b">New Version</h3>
                    {currentData.length === 0 && <p className="text-gray-400 italic">No section content found.</p>}
                    {currentData.map((part, i) => {
                        if (showChangesOnly && !part.added && !part.removed) return null;
                        if (part.removed) return null; // Don't show deletions in Right
                        return (
                            <span key={i} className={part.added ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" : ""}>
                                {part.value}
                            </span>
                        );
                    })}
                </div>
            </div>
        );
    };

    if (loading) return (
        <div className="flex h-screen items-center justify-center flex-col gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-purple-600" />
            <p className="text-zinc-500 font-mono text-sm">Generating semantic diff...</p>
        </div>
    );

    if (error) return (
        <div className="flex h-screen items-center justify-center flex-col gap-4 text-red-500">
            <p>Error: {error}</p>
            <Link href="/" className="underline">Go Back</Link>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 p-6">
            <div className="flex flex-col gap-4 mb-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2 hover:bg-gray-200 dark:hover:bg-zinc-800 rounded-full">
                            <ArrowLeft className="w-5 h-5 dark:text-white" />
                        </Link>
                        <h1 className="text-xl font-bold dark:text-white">{title}</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowChangesOnly(!showChangesOnly)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${showChangesOnly ? 'bg-purple-600 text-white' : 'bg-white dark:bg-zinc-800 border dark:border-zinc-700 hover:bg-gray-100 dark:text-white'}`}
                        >
                            {showChangesOnly ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                            {showChangesOnly ? "Showing Changes Only" : "Show All Context"}
                        </button>
                    </div>
                </div>

                {/* TABS */}
                <div className="flex gap-2 border-b dark:border-zinc-800">
                    <button
                        onClick={() => setActiveTab('risk')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'risk' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        Risk Factors
                    </button>
                    <button
                        onClick={() => setActiveTab('mda')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'mda' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        MD&A
                    </button>
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'all' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        Full Text (Raw)
                    </button>
                </div>
            </div>

            {renderSideBySide()}
        </div>
    );
}

export default function DiffPage() {
    return (
        <Suspense fallback={<div className="p-10">Loading...</div>}>
            <DiffViewerContent />
        </Suspense>
    );
}
