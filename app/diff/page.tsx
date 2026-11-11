"use client";

import { useEffect, useId, useMemo, useState, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { Button, ChangeBadge, Input, Notice, Panel, SectionHeader, Skeleton, Tabs, Takeaway, Term, buttonClass, tabPanelProps } from '../components/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { citationFromUrl, type Citation } from '@/lib/citation';
import type { ChangedParagraph, HeadingChange, Paragraph, SectionKind, SectionSummary, WordPart } from '@/lib/diff-engine';
import { SECTION_NAMES, count, countsByHeading, sectionTakeaway } from '@/lib/diff-summary';

type SectionId = SectionKind | 'all';
type Pane = 'previous' | 'current';

interface DiffData {
    parts: Record<SectionId, WordPart[]>;
    summary: Record<SectionKind, SectionSummary> | null;
    truncated: boolean;
}

const BACK = { href: '/?tab=downloader', label: 'Back to search results' };

const SECTION_TABS: { id: SectionId; label: string }[] = [
    { id: 'risk', label: 'Risk factors' },
    { id: 'mda', label: 'MD&A' },
    { id: 'all', label: 'Full text' },
];

/** Lists show this many items until "Show all" is pressed. */
const LIST_PREVIEW = 10;

// ---------------------------------------------------------------------------------------------------------------
// Text helpers (sentence building lives in lib/diff-summary.ts, shared with the company page)
// ---------------------------------------------------------------------------------------------------------------

function firstSentence(text: string): string {
    const match = text.match(/^.+?[.!?](?=\s+["“(]?[A-Z]|$)/);
    return match ? match[0] : text;
}

function countWords(parts: WordPart[], kind: 'added' | 'removed'): number {
    return parts.reduce((total, part) => (part[kind] ? total + (part.value.trim().match(/\S+/g)?.length ?? 0) : total), 0);
}

const MONTHS: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "Feb 25, 2026" or "2026-02-25" -> "2026-02-25"; null if it isn't a date. */
function toIsoDate(text: string): string | null {
    const value = text.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const match = value.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    const month = match ? MONTHS[match[1].toLowerCase()] : undefined;
    return match && month ? `${match[3]}-${month}-${match[2].padStart(2, '0')}` : null;
}

/** The comparison link's title: "{TICKER} {FORM}: {prevDate} vs {currDate}". */
function parseTitle(title: string | null): { entity: string; form: string; previousDate: string | null; currentDate: string | null } | null {
    const match = title?.match(/^(.+?)\s+(\S+):\s+(.+?)\s+vs\.?\s+(.+)$/);
    if (!match) return null;
    return { entity: match[1].trim(), form: match[2], previousDate: toIsoDate(match[3]), currentDate: toIsoDate(match[4]) };
}


// ---------------------------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------------------------

/** Marks each case-insensitive occurrence of the keyword. */
function Highlight({ text, query }: { text: string; query: string }) {
    if (!query) return <>{text}</>;
    const lower = text.toLowerCase();
    const nodes: ReactNode[] = [];
    let from = 0;
    let at = lower.indexOf(query, from);
    while (at !== -1) {
        if (at > from) nodes.push(text.slice(from, at));
        nodes.push(
            <mark key={at} className="rounded-sm bg-caution/20 text-ink">
                {text.slice(at, at + query.length)}
            </mark>
        );
        from = at + query.length;
        at = lower.indexOf(query, from);
    }
    if (from < text.length) nodes.push(text.slice(from));
    return <>{nodes}</>;
}

function InlineDiff({ parts }: { parts: WordPart[] }) {
    return (
        <p className="font-serif text-base leading-7 text-ink">
            {parts.map((part, index) => (
                <span key={index} className={part.removed ? 'diff-del' : part.added ? 'diff-ins' : undefined}>
                    {part.value}
                </span>
            ))}
        </p>
    );
}

/** A titled list of changes, with a count and "Show all" past LIST_PREVIEW items. */
function ChangeList<T>({
    title,
    intro,
    items,
    total,
    filtering,
    empty,
    render,
}: {
    title: string;
    intro: ReactNode;
    items: T[];
    total: number;
    filtering: boolean;
    empty: string;
    render: (item: T) => ReactNode;
}) {
    const [showAll, setShowAll] = useState(false);
    const visible = showAll ? items : items.slice(0, LIST_PREVIEW);
    const countLabel = filtering ? `${formatNumber(items.length)} of ${formatNumber(total)}` : formatNumber(total);

    return (
        <section className="space-y-3">
            <SectionHeader
                level={3}
                title={
                    <>
                        {title} <span className="tabular font-normal text-ink-muted">({countLabel})</span>
                    </>
                }
                intro={intro}
            />
            {items.length === 0 ? (
                <p className="text-base text-ink-muted">{filtering && total > 0 ? 'None of these match the keyword.' : empty}</p>
            ) : (
                <Panel>
                    <ul className="divide-y divide-rule">
                        {visible.map((item, index) => (
                            <li key={index} className="px-4 py-4 sm:px-5">
                                {render(item)}
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}
            {items.length > LIST_PREVIEW && (
                <Button size="sm" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
                    {showAll ? 'Show fewer' : `Show all ${formatNumber(items.length)}`}
                </Button>
            )}
        </section>
    );
}

function FactorItem({ factor, kind, query }: { factor: HeadingChange; kind: 'new' | 'removed'; query: string }) {
    const [open, setOpen] = useState(false);
    const bodyId = useId();
    const lead = factor.body[0] ? firstSentence(factor.body[0]) : '';
    const hasMore = factor.body.length > 1 || (factor.body[0] ?? '') !== lead;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <ChangeBadge kind={kind === 'new' ? 'new' : 'exited'} label={kind === 'new' ? 'New' : 'Removed'} />
                <p className="min-w-0 flex-1 basis-60 text-base font-semibold text-ink">
                    <Highlight text={factor.heading} query={query} />
                </p>
            </div>
            {!open && lead && (
                <p className="font-serif text-base leading-7 text-ink-muted">
                    <Highlight text={lead} query={query} />
                </p>
            )}
            {open && (
                <div id={bodyId} className="space-y-3 font-serif text-base leading-7 text-ink">
                    {factor.body.map((text, index) => (
                        <p key={index}>
                            <Highlight text={text} query={query} />
                        </p>
                    ))}
                </div>
            )}
            {hasMore && (
                <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={bodyId}>
                    <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
                    {open ? 'Show less' : 'Show full text'}
                </Button>
            )}
        </div>
    );
}

function PassageItem({ paragraph, kind, query }: { paragraph: Paragraph; kind: 'added' | 'removed'; query: string }) {
    return (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <ChangeBadge kind={kind === 'added' ? 'new' : 'exited'} label={kind === 'added' ? 'Added' : 'Removed'} />
            <p className={cn('min-w-0 flex-1 basis-60 font-serif text-base leading-7 text-ink', paragraph.heading && 'font-sans font-semibold')}>
                <Highlight text={paragraph.text} query={query} />
            </p>
        </div>
    );
}

function ChangedItem({ change }: { change: ChangedParagraph }) {
    return (
        <div className="space-y-1">
            {change.after.heading && <p className="text-sm font-medium text-ink-muted">Reworded heading</p>}
            <InlineDiff parts={change.parts} />
        </div>
    );
}

function DiffText({ parts, pane, changesOnly }: { parts: WordPart[]; pane: Pane; changesOnly: boolean }) {
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

/** The previous and current text side by side (one at a time below lg). */
function SideBySide({ parts, idPrefix }: { parts: WordPart[]; idPrefix: string }) {
    const [pane, setPane] = useState<Pane>('current');
    const [changesOnly, setChangesOnly] = useState(false);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                        idPrefix={`${idPrefix}-pane`}
                        variant="segmented"
                    />
                </div>
                <label className="flex items-center gap-2 text-base text-ink">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} />
                    Show only changed passages
                </label>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                {(['previous', 'current'] as Pane[]).map((which) => (
                    <Panel key={which} as="section" className={cn('min-w-0', which !== pane && 'hidden lg:block')}>
                        <h3 className="border-b border-rule px-5 py-3 text-base font-semibold">
                            {which === 'previous' ? 'Previous filing' : 'Current filing'}
                            <span className="ml-2 text-sm font-normal text-ink-muted">
                                {which === 'previous' ? 'removed words struck through' : 'added words underlined'}
                            </span>
                        </h3>
                        <div className="max-h-[75vh] overflow-y-auto px-4 py-4 sm:px-5">
                            <DiffText parts={parts} pane={which} changesOnly={changesOnly} />
                        </div>
                    </Panel>
                ))}
            </div>
        </div>
    );
}

/** "Full text comparison", collapsed by default. */
function FullTextDisclosure({ parts, kind }: { parts: WordPart[]; kind: SectionKind }) {
    const [open, setOpen] = useState(false);
    const panelId = useId();
    return (
        <section className="space-y-4 border-t border-rule pt-6">
            <SectionHeader
                title="Full text comparison"
                intro={`Every word of ${SECTION_NAMES[kind]}, the previous filing beside the current one.`}
                actions={
                    <Button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={panelId}>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
                        {open ? 'Hide full text' : 'Show full text'}
                    </Button>
                }
            />
            {open && (
                <div id={panelId}>
                    <SideBySide parts={parts} idPrefix={`diff-${kind}`} />
                </div>
            )}
        </section>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// One section: takeaway, keyword filter, lists, full text
// ---------------------------------------------------------------------------------------------------------------

function SectionComparison({
    kind,
    summary,
    parts,
    sources,
    query,
    onQueryChange,
}: {
    kind: SectionKind;
    summary: SectionSummary;
    parts: WordPart[];
    sources: Citation[];
    query: string;
    onQueryChange: (value: string) => void;
}) {
    const comparable = summary.found.previous && summary.found.current;
    // Risk factors are listed by heading when the filings mark them; otherwise (and for MD&A) by paragraph.
    const byHeading = countsByHeading(kind, summary);
    const sentences = sectionTakeaway(kind, summary, byHeading);
    const needle = query.trim().toLowerCase();

    const lists = useMemo(() => {
        const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
        const factorMatches = (factor: HeadingChange) => matches(factor.heading) || factor.body.some(matches);
        const other = [
            ...summary.otherAdded.map((paragraph) => ({ paragraph, kind: 'added' as const })),
            ...summary.otherRemoved.map((paragraph) => ({ paragraph, kind: 'removed' as const })),
        ];
        return {
            newFactors: summary.newFactors.filter(factorMatches),
            removedFactors: summary.removedFactors.filter(factorMatches),
            added: summary.added.filter((paragraph) => matches(paragraph.text)),
            removed: summary.removed.filter((paragraph) => matches(paragraph.text)),
            changed: summary.changed.filter((change) => matches(change.before.text) || matches(change.after.text)),
            other: other.filter((item) => matches(item.paragraph.text)),
            otherTotal: other.length,
        };
    }, [summary, needle]);

    const matchCount = byHeading
        ? lists.newFactors.length + lists.removedFactors.length + lists.changed.length + lists.other.length
        : lists.added.length + lists.removed.length + lists.changed.length;
    const keyword = query.trim();

    const notes: string[] = [];
    if (comparable && kind === 'risk' && !byHeading) notes.push("Individual risk factors aren't marked as headings in these filings, so changes are counted by paragraph.");
    if (comparable && kind === 'risk' && summary.paragraphCount.current < 6) {
        notes.push("This section is short. Quarterly reports often refer back to the annual report's risk factors instead of repeating them.");
    }
    if (comparable && summary.tableRowsChanged > 0) {
        notes.push(`${count(summary.tableRowsChanged, 'row')} of figures changed; they appear only in the full text comparison.`);
    }

    return (
        <div className="space-y-8">
            <Takeaway copyText={sentences.join(' ')} sources={sources} note={notes.length > 0 ? <span>{notes.join(' ')}</span> : undefined}>
                {sentences.join(' ')}
            </Takeaway>

            {!comparable && (
                <Notice title="Try the Full text tab">
                    The section heading (&ldquo;{kind === 'risk' ? 'Item 1A. Risk Factors' : "Item 7. Management's Discussion and Analysis"}&rdquo;) couldn&apos;t be
                    located in one of the documents, so only a whole-document comparison is available.
                </Notice>
            )}

            {comparable && (
                <>
                    <div className="max-w-md space-y-2">
                        <Input
                            label="Filter by keyword"
                            type="search"
                            placeholder="For example, tariff or China"
                            value={query}
                            onChange={(event) => onQueryChange(event.target.value)}
                            hint="Filters every list below as you type."
                        />
                        {keyword && (
                            <p className="text-base font-medium text-ink" aria-live="polite">
                                {matchCount === 0
                                    ? `No passages mention “${keyword}”.`
                                    : `${count(matchCount, 'passage')} ${matchCount === 1 ? 'mentions' : 'mention'} “${keyword}”.`}
                            </p>
                        )}
                    </div>

                    {byHeading ? (
                        <>
                            <ChangeList
                                title="New risk factors"
                                intro="Risk-factor headings that appear only in the current filing, with the text under them."
                                items={lists.newFactors}
                                total={summary.newFactors.length}
                                filtering={Boolean(needle)}
                                empty="No new risk factors."
                                render={(factor) => <FactorItem factor={factor} kind="new" query={needle} />}
                            />
                            <ChangeList
                                title="Removed risk factors"
                                intro="Headings that were in the previous filing and are gone from the current one."
                                items={lists.removedFactors}
                                total={summary.removedFactors.length}
                                filtering={Boolean(needle)}
                                empty="No risk factors were removed."
                                render={(factor) => <FactorItem factor={factor} kind="removed" query={needle} />}
                            />
                        </>
                    ) : (
                        <>
                            <ChangeList
                                title="New passages"
                                intro="Paragraphs that appear only in the current filing."
                                items={lists.added}
                                total={summary.added.length}
                                filtering={Boolean(needle)}
                                empty="No new passages."
                                render={(paragraph) => <PassageItem paragraph={paragraph} kind="added" query={needle} />}
                            />
                            <ChangeList
                                title="Removed passages"
                                intro="Paragraphs that were in the previous filing and are gone from the current one."
                                items={lists.removed}
                                total={summary.removed.length}
                                filtering={Boolean(needle)}
                                empty="No passages were removed."
                                render={(paragraph) => <PassageItem paragraph={paragraph} kind="removed" query={needle} />}
                            />
                        </>
                    )}

                    <ChangeList
                        title="Reworded passages"
                        intro={
                            <>
                                Paragraphs in both filings whose wording changed. New words are <span className="diff-ins">underlined</span>; removed words are{' '}
                                <span className="diff-del">struck through</span>.
                            </>
                        }
                        items={lists.changed}
                        total={summary.changed.length}
                        filtering={Boolean(needle)}
                        empty="No passages were reworded."
                        render={(change) => <ChangedItem change={change} />}
                    />

                    {byHeading && lists.otherTotal > 0 && (
                        <ChangeList
                            title="Other added and removed paragraphs"
                            intro="New or deleted paragraphs within risk factors that appear in both filings, including the summary list."
                            items={lists.other}
                            total={lists.otherTotal}
                            filtering={Boolean(needle)}
                            empty="None."
                            render={(item) => <PassageItem paragraph={item.paragraph} kind={item.kind} query={needle} />}
                        />
                    )}

                    {parts.length > 0 && <FullTextDisclosure parts={parts} kind={kind} />}
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

function DiffViewerContent() {
    const searchParams = useSearchParams();
    const url1 = searchParams.get('url1');
    const url2 = searchParams.get('url2');
    const rawTitle = searchParams.get('title');
    const title = rawTitle || 'Compare two filings';

    const [data, setData] = useState<DiffData>({ parts: { risk: [], mda: [], all: [] }, summary: null, truncated: false });
    const [loading, setLoading] = useState(Boolean(url1 && url2));
    const [error, setError] = useState(url1 && url2 ? '' : 'This link is missing one of the two filings to compare.');
    const [section, setSection] = useState<SectionId>('risk');
    const [query, setQuery] = useState('');

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
                if (!cancelled) {
                    setData({
                        parts: { risk: json.riskDiff || [], mda: json.mdaDiff || [], all: json.diffs || [] },
                        summary: json.summary ?? null,
                        truncated: Boolean(json.truncated),
                    });
                }
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

    const sources = useMemo<Citation[]>(() => {
        if (!url1 || !url2) return [];
        const parsed = parseTitle(rawTitle);
        const form = parsed?.form ?? '10-K or 10-Q';
        return [
            citationFromUrl(url1, parsed?.entity ?? 'Previous filing', form, parsed?.previousDate ?? null),
            citationFromUrl(url2, parsed?.entity ?? 'Current filing', form, parsed?.currentDate ?? null),
        ];
    }, [url1, url2, rawTitle]);

    const allParts = data.parts.all;
    const added = useMemo(() => countWords(allParts, 'added'), [allParts]);
    const removed = useMemo(() => countWords(allParts, 'removed'), [allParts]);
    const fullTextSummary =
        allParts.length === 0
            ? 'The full text couldn’t be compared.'
            : added === 0 && removed === 0
                ? 'No words changed in the full text.'
                : `${formatNumber(added)} words added and ${formatNumber(removed)} removed in the full text${data.truncated ? ' shown below' : ''}.`;

    return (
        <div className="min-h-screen bg-paper">
            <AppHeader back={BACK} />
            <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-8 sm:px-8">
                <div className="max-w-4xl">
                    <h1 className="font-serif text-2xl font-semibold text-ink">{title}</h1>
                    <p className="mt-2 text-lg text-ink-muted">
                        What changed between the previous filing and the current one: new and removed <Term id="riskFactors">risk factors</Term>, reworded
                        passages in the risk factors and <Term id="mdna">MD&amp;A</Term>, and the full text side by side.
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
                        <div className="border-b border-rule">
                            <Tabs items={SECTION_TABS} value={section} onChange={setSection} label="Filing section" idPrefix="diff" />
                        </div>

                        <div {...tabPanelProps('diff', section)} className="outline-none">
                            {section !== 'all' && data.summary ? (
                                <SectionComparison
                                    key={section}
                                    kind={section}
                                    summary={data.summary[section]}
                                    parts={data.parts[section]}
                                    sources={sources}
                                    query={query}
                                    onQueryChange={setQuery}
                                />
                            ) : (
                                <div className="space-y-4">
                                    <Takeaway copyText={fullTextSummary} sources={sources}>
                                        {fullTextSummary}
                                    </Takeaway>
                                    {section === 'all' && data.truncated && (
                                        <Notice tone="caution" title="Only the first part of the full text is shown">
                                            These filings are long, so the whole-document comparison stops after {formatNumber(5000)} blocks of text. The Risk factors
                                            and MD&amp;A tabs compare those sections in full.
                                        </Notice>
                                    )}
                                    <SideBySide parts={section === 'all' ? allParts : data.parts[section]} idPrefix="diff-all" />
                                </div>
                            )}
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
