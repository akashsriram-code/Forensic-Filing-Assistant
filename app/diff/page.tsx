"use client";

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppHeader } from '../components/AppHeader';
import { Notice, Panel, Skeleton, Tabs, Term, buttonClass, tabPanelProps } from '../components/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

interface DiffPart {
    value: string;
    added?: boolean;
    removed?: boolean;
}

type SectionId = 'risk' | 'mda' | 'all';
type Pane = 'previous' | 'current';

const BACK = { href: '/?tab=downloader', label: 'Back to search results' };

const SECTION_TABS: { id: SectionId; label: string }[] = [
    { id: 'risk', label: 'Risk factors' },
    { id: 'mda', label: 'MD&A' },
    { id: 'all', label: 'Full text' },
];

const SECTION_NAMES: Record<SectionId, string> = { risk: 'the risk factors', mda: 'MD&A', all: 'the full text' };

function countWords(parts: DiffPart[], kind: 'added' | 'removed'): number {
    return parts.reduce((total, part) => (part[kind] ? total + (part.value.trim().match(/\S+/g)?.length ?? 0) : total), 0);
}

function DiffText({ parts, pane, changesOnly }: { parts: DiffPart[]; pane: Pane; changesOnly: boolean }) {
    if (parts.length === 0) {
        return <p className="text-base text-ink-muted">This section wasn&apos;t found in the filing. Try Full text.</p>;
    }
    return (
        <div className="whitespace-pre-wrap font-serif text-base leading-7 text-ink">
            {parts.map((part, index) => {
                if (pane === 'previous' && part.added) return null;
                if (pane === 'current' && part.removed) return null;
                if (changesOnly && !part.added && !part.removed) {
                    return <span key={index} className="block select-none py-1 text-center text-sm text-ink-muted" aria-hidden>…</span>;
                }
                const className = part.removed ? 'diff-del' : part.added ? 'diff-ins' : undefined;
                return (
                    <span key={index} className={className}>
                        {part.value}
                    </span>
                );
            })}
        </div>
    );
}

function DiffViewerContent() {
    const searchParams = useSearchParams();
    const url1 = searchParams.get('url1');
    const url2 = searchParams.get('url2');
    const title = searchParams.get('title') || 'Compare two filings';

    const [data, setData] = useState<Record<SectionId, DiffPart[]>>({ risk: [], mda: [], all: [] });
    const [loading, setLoading] = useState(Boolean(url1 && url2));
    const [error, setError] = useState(url1 && url2 ? '' : 'This link is missing one of the two filings to compare.');
    const [section, setSection] = useState<SectionId>('risk');
    const [pane, setPane] = useState<Pane>('current');
    const [changesOnly, setChangesOnly] = useState(false);

    useEffect(() => {
        if (!url1 || !url2) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/diff', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url1, url2 }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'The comparison failed.');
                if (!cancelled) setData({ risk: json.riskDiff || [], mda: json.mdaDiff || [], all: json.diffs || [] });
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'The comparison failed.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [url1, url2]);

    const parts = data[section];
    const added = useMemo(() => countWords(parts, 'added'), [parts]);
    const removed = useMemo(() => countWords(parts, 'removed'), [parts]);

    const summary =
        parts.length === 0
            ? `No ${SECTION_NAMES[section]} section was found to compare.`
            : added === 0 && removed === 0
                ? `No words changed in ${SECTION_NAMES[section]}.`
                : `${formatNumber(added)} words added and ${formatNumber(removed)} removed in ${SECTION_NAMES[section]}.`;

    return (
        <div className="min-h-screen bg-paper">
            <AppHeader back={BACK} />
            <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-8 sm:px-8">
                <div className="max-w-4xl">
                    <h1 className="font-serif text-2xl font-semibold text-ink">{title}</h1>
                    <p className="mt-2 text-lg text-ink-muted">
                        Word-level changes between the previous filing and the current one, starting with the <Term id="riskFactors">risk factors</Term> and{' '}
                        <Term id="mdna">MD&amp;A</Term>. Added words are <span className="diff-ins">underlined in green</span>; removed words are{' '}
                        <span className="diff-del">struck through in red</span>.
                    </p>
                </div>

                {loading && (
                    <div role="status" aria-label="Comparing filings" className="space-y-4">
                        <p className="text-base text-ink-muted">Comparing the two filings. Long 10-Ks can take up to a minute.</p>
                        <div className="grid gap-4 lg:grid-cols-2">
                            {[0, 1].map((column) => (
                                <Panel key={column} className="space-y-3 p-6">
                                    {Array.from({ length: 12 }, (_, index) => (
                                        <Skeleton key={index} className="h-4 w-full" />
                                    ))}
                                </Panel>
                            ))}
                        </div>
                    </div>
                )}

                {error && (
                    <Notice tone="error" title="These filings couldn't be compared" action={<Link href={BACK.href} className={buttonClass('secondary', 'sm')}>Back to search results</Link>}>
                        {error}
                    </Notice>
                )}

                {!loading && !error && (
                    <>
                        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule">
                            <Tabs
                                items={SECTION_TABS}
                                value={section}
                                onChange={setSection}
                                label="Filing section"
                                idPrefix="diff"
                            />
                            <label className="mb-2 flex items-center gap-2 text-base text-ink">
                                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} />
                                Show only changed passages
                            </label>
                        </div>

                        <div {...tabPanelProps('diff', section)} className="space-y-4 outline-none">
                            <p className="font-serif text-xl text-ink" aria-live="polite">{summary}</p>

                            {/* Below lg, show one version at a time. */}
                            <div className="lg:hidden">
                                <Tabs
                                    items={[
                                        { id: 'previous', label: 'Previous filing' },
                                        { id: 'current', label: 'Current filing' },
                                    ]}
                                    value={pane}
                                    onChange={(id) => setPane(id as Pane)}
                                    label="Version"
                                    idPrefix="diff-pane"
                                    variant="segmented"
                                />
                            </div>

                            <div className="grid gap-4 lg:grid-cols-2">
                                {(['previous', 'current'] as Pane[]).map((which) => (
                                    <Panel key={which} as="section" className={cn('min-w-0', which !== pane && 'hidden lg:block')}>
                                        <h2 className="border-b border-rule px-5 py-3 text-base font-semibold">
                                            {which === 'previous' ? 'Previous filing' : 'Current filing'}
                                            <span className="ml-2 text-sm font-normal text-ink-muted">
                                                {which === 'previous' ? 'removed words struck through' : 'added words underlined'}
                                            </span>
                                        </h2>
                                        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
                                            <DiffText parts={parts} pane={which} changesOnly={changesOnly} />
                                        </div>
                                    </Panel>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

export default function DiffPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-paper" />}>
            <DiffViewerContent />
        </Suspense>
    );
}
