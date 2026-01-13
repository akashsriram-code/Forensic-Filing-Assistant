"use client";

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Printer, ArrowLeft, Download } from 'lucide-react';
import Link from 'next/link';

function ReaderContent() {
    const searchParams = useSearchParams();
    const url = searchParams.get('url');
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!url) return;

        const fetchContent = async () => {
            try {
                // Use our existing proxy to fetch the raw HTML
                const res = await fetch(`/api/download-proxy?url=${encodeURIComponent(url)}`);
                if (!res.ok) throw new Error("Failed to load filing");
                const html = await res.text();

                // transform content logic could go here or in a separate API, 
                // but for now we'll just inject it and let CSS handle the cleanup
                setContent(html);
            } catch (err) {
                console.error(err);
                setError("Could not load the filing.");
            } finally {
                setLoading(false);
            }
        };

        fetchContent();
    }, [url]);

    const handlePrint = () => {
        window.print();
    };

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <p className="text-sm font-medium text-gray-500">Preparing Reader View...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center text-red-500">
                {error}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white text-gray-900 font-serif print:p-0">
            {/* Control Bar - Hidden when printing */}
            <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-white/90 backdrop-blur border-b border-gray-200 print:hidden">
                <Link href="/" className="flex items-center gap-2 text-sm font-sans font-medium text-gray-600 hover:text-black transition-colors">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Dashboard
                </Link>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handlePrint}
                        className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-sans font-medium rounded-lg hover:bg-gray-800 transition-colors"
                    >
                        <Printer className="h-4 w-4" />
                        Print / Save as PDF
                    </button>
                    <a
                        href={`/api/download-proxy?url=${encodeURIComponent(url || "")}&filename=filing.htm`}
                        className="p-2 border border-gray-200 rounded-lg text-gray-500 hover:text-black hover:bg-gray-50 transition-colors"
                        title="Download Original HTML"
                    >
                        <Download className="h-4 w-4" />
                    </a>
                </div>
            </div>

            {/* Content Area */}
            <div className="max-w-[900px] mx-auto py-12 px-8 md:px-12 print:max-w-none print:p-0 print:py-0">
                {/* 
                   We use a shadow DOM or iframe approach usually to isolate styles, 
                   but for simplicity here we assume SEC HTML is inline-style heavy.
                   We'll inject it but override font-family globally. 
                */}
                <div
                    className="prose prose-lg max-w-none prose-headings:font-sans prose-p:leading-relaxedsec-content-wrapper"
                    dangerouslySetInnerHTML={{ __html: content }}
                    style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
                />
            </div>

            <style jsx global>{`
                /* Specialized cleanup for SEC filings */
                .sec-content-wrapper table {
                    width: 100% !important;
                    display: table !important;
                    margin-bottom: 1.5rem;
                }
                .sec-content-wrapper img {
                    max-width: 100%;
                    height: auto;
                }
                /* Hide SEC header junk if identifiable */
                .sec-content-wrapper header, 
                .sec-content-wrapper #header {
                    display: none !important;
                }
                @media print {
                    body { 
                        background: white; 
                        color: black;
                    }
                    /* Ensure hrefs are not printed */
                    a[href]:after {
                        content: none !important;
                    }
                }
            `}</style>
        </div>
    );
}

export default function ReaderPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ReaderContent />
        </Suspense>
    );
}
