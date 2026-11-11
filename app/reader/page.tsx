"use client";

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Download, Printer } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { Button, Notice, Skeleton, buttonClass } from '../components/ui';

const BACK = { href: '/?tab=downloader', label: 'Back to search results' };

function ReaderContent() {
    const searchParams = useSearchParams();
    const url = searchParams.get('url');
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(Boolean(url));
    const [error, setError] = useState(url ? '' : 'This link is missing the filing address.');
    const [pdfState, setPdfState] = useState<{ running: boolean; error: string }>({ running: false, error: '' });

    useEffect(() => {
        if (!url) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/download-proxy?url=${encodeURIComponent(url)}`);
                if (!res.ok) throw new Error(`The SEC returned an error (${res.status}).`);
                const html = await res.text();
                if (!cancelled) setContent(html);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'The filing could not be loaded.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [url]);

    const handleDownloadPdf = async () => {
        const element = document.querySelector('.filing-prose');
        if (!element) return;
        setPdfState({ running: true, error: '' });
        // Render the PDF in light colors even when the page is dark, then restore the theme.
        const root = document.documentElement;
        const wasDark = root.classList.contains('dark');
        root.classList.remove('dark');
        try {
            const html2pdf = (await import('html2pdf.js')).default;
            await html2pdf()
                .set({
                    margin: [10, 10, 10, 10] as [number, number, number, number],
                    filename: 'sec-filing.pdf',
                    image: { type: 'jpeg' as const, quality: 0.95 },
                    html2canvas: { scale: 1, useCORS: true, logging: false },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
                })
                .from(element as HTMLElement)
                .save();
            setPdfState({ running: false, error: '' });
        } catch (err) {
            setPdfState({
                running: false,
                error: `The PDF couldn't be created (${err instanceof Error ? err.message : 'unknown error'}). Use Print instead and choose "Save as PDF".`,
            });
        } finally {
            if (wasDark) root.classList.add('dark');
        }
    };

    return (
        <div className="min-h-screen bg-paper print:bg-white">
            <AppHeader back={BACK} />

            {!loading && !error && (
                <div className="border-b border-rule bg-surface print:hidden">
                    <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
                        <p className="text-sm text-ink-muted">Reader view of the original SEC filing. Formatting is simplified for reading and printing.</p>
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={handleDownloadPdf} loading={pdfState.running} icon={<Download className="h-4 w-4" aria-hidden />}>
                                {pdfState.running ? 'Creating PDF…' : 'Download PDF'}
                            </Button>
                            <Button size="sm" variant="primary" onClick={() => window.print()} icon={<Printer className="h-4 w-4" aria-hidden />}>
                                Print
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <main className="mx-auto max-w-[860px] px-4 py-8 sm:px-8 sm:py-12 print:max-w-none print:p-0">
                {pdfState.error && <Notice tone="error" className="mb-6">{pdfState.error}</Notice>}

                {loading && (
                    <div role="status" aria-label="Loading the filing" className="space-y-4">
                        <Skeleton className="h-8 w-2/3" />
                        {Array.from({ length: 10 }, (_, index) => (
                            <Skeleton key={index} className="h-4 w-full" />
                        ))}
                        <p className="pt-2 text-sm text-ink-muted">Loading the filing from the SEC…</p>
                    </div>
                )}

                {error && (
                    <Notice tone="error" title="This filing couldn't be opened" action={<Link href={BACK.href} className={buttonClass('secondary', 'sm')}>Back to search results</Link>}>
                        {error} The SEC site may be busy; try again in a minute.
                    </Notice>
                )}

                {!loading && !error && (
                    <article className="filing-prose" dangerouslySetInnerHTML={{ __html: content }} />
                )}
            </main>
        </div>
    );
}

export default function ReaderPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-paper" />}>
            <ReaderContent />
        </Suspense>
    );
}
