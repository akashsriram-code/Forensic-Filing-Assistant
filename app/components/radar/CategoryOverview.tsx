"use client";

import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { formatNumber, formatPct, formatSignedNumber } from '@/lib/format';
import type { CategorySummary, FilerMove, RadarApiResponse } from '@/lib/thirteen-f-radar-core';
import { SectionHeader, Term } from '../ui';
import { CategoryStory } from './CategoryStory';
import { RADAR_REQUEST_TIMEOUT_MS, errorMessage, parseRadarErrorResponse, type RadarPayload } from './radar-api';
import { useGridColumns } from './radar-hooks';

type HolderEntry = { holders: FilerMove[]; error?: undefined } | { holders?: undefined; error: string };

/**
 * One card per watchlist category. Selecting a card opens that category's deep-dive inline, right after the row the
 * card sits in, so reading order and visual order stay the same.
 */
export function CategoryOverview({ data, payload, version }: { data: RadarApiResponse; payload: RadarPayload; version: string }) {
    const columns = useGridColumns();
    const [selected, setSelected] = useState<string | null>(null);
    // Full holder lists are too large to ship with the comparison; fetched per category when its panel opens.
    const [holders, setHolders] = useState<Record<string, HolderEntry>>({});
    const [retryToken, setRetryToken] = useState(0);
    const loadedRef = useRef(new Set<string>());

    const cacheKey = selected ? `${version}|${selected}` : null;
    const entry = cacheKey ? holders[cacheKey] : undefined;
    const requestBody = selected
        ? JSON.stringify({ ...payload, currentQuarter: data.coverage.currentQuarter, previousQuarter: data.coverage.previousQuarter, category: selected })
        : null;

    useEffect(() => {
        if (!cacheKey || !requestBody || loadedRef.current.has(cacheKey)) return;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await fetchWithTimeout('/api/13f-radar/holders', {
                    method: 'POST',
                    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                    body: requestBody,
                    signal: controller.signal,
                }, RADAR_REQUEST_TIMEOUT_MS);
                if (!res.ok) throw new Error(await parseRadarErrorResponse(res));
                const result = (await res.json()) as { holders: FilerMove[] };
                if (controller.signal.aborted) return;
                loadedRef.current.add(cacheKey);
                setHolders((prev) => ({ ...prev, [cacheKey]: { holders: result.holders || [] } }));
            } catch (err) {
                if (controller.signal.aborted) return;
                setHolders((prev) => ({ ...prev, [cacheKey]: { error: errorMessage(err, 'The holder list did not load.') } }));
            }
        })();
        return () => controller.abort();
    }, [cacheKey, requestBody, retryToken]);

    const retryHolders = () => {
        if (!cacheKey) return;
        setHolders((prev) => {
            const next = { ...prev };
            delete next[cacheKey];
            return next;
        });
        setRetryToken((value) => value + 1);
    };

    const close = (key: string) => {
        setSelected(null);
        document.getElementById(cardId(key))?.focus();
    };

    const summaries = data.categorySummaries;
    const rows: CategorySummary[][] = [];
    for (let index = 0; index < summaries.length; index += columns) rows.push(summaries.slice(index, index + columns));

    return (
        <section aria-labelledby="radar-overview" className="space-y-4">
            <SectionHeader
                id="radar-overview"
                title="Overview by category"
                intro={
                    <>
                        How many funds bought or sold the stocks in each watchlist category. Counts cover only{' '}
                        <Term id="comparableFilers">funds that filed in both quarters</Term>. Select a category to see who owns it.
                    </>
                }
            />
            {summaries.length === 0 ? (
                <p className="text-base text-ink-muted">No categories are selected. Turn one on in the category filters above.</p>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((row) => {
                        const open = row.find((summary) => summary.key === selected);
                        return (
                            <Fragment key={row.map((summary) => summary.key).join('|')}>
                                {row.map((summary) => (
                                    <CategoryCard
                                        key={summary.key}
                                        summary={summary}
                                        selected={summary.key === selected}
                                        onToggle={() => setSelected((current) => (current === summary.key ? null : summary.key))}
                                    />
                                ))}
                                {open && (
                                    <div id={storyId(open.key)} className="col-span-full rounded-lg border border-accent/50 bg-surface">
                                        <CategoryStory
                                            categoryKey={open.key}
                                            categoryLabel={open.label}
                                            moves={entry?.holders || data.topFilerMoves.filter((move) => move.categoryKey === open.key)}
                                            status={entry?.holders ? 'loaded' : entry?.error ? 'error' : 'loading'}
                                            error={entry?.error}
                                            onRetry={retryHolders}
                                            onClose={() => close(open.key)}
                                            concentration={data.categoryConcentration}
                                        />
                                    </div>
                                )}
                            </Fragment>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

const cardId = (key: string) => `radar-category-${key}`;
const storyId = (key: string) => `radar-category-${key}-story`;

function CategoryCard({ summary, selected, onToggle }: { summary: CategorySummary; selected: boolean; onToggle: () => void }) {
    const net = summary.buyers - summary.sellers;
    return (
        <button
            type="button"
            id={cardId(summary.key)}
            aria-expanded={selected}
            aria-controls={selected ? storyId(summary.key) : undefined}
            onClick={onToggle}
            className={cn(
                'group flex h-full flex-col rounded-lg border bg-surface p-4 text-left transition-colors hover:bg-surface-2/60',
                selected ? 'border-accent' : 'border-rule'
            )}
        >
            <span className="flex items-start justify-between gap-3">
                <span className="text-lg font-semibold text-ink group-hover:text-accent">{summary.label}</span>
                <ChevronDown className={cn('mt-1.5 h-4 w-4 shrink-0 text-ink-muted transition-transform', selected && 'rotate-180')} aria-hidden />
            </span>
            <span className="mt-0.5 block text-sm text-ink-muted">
                <span className="tabular">{formatNumber(summary.exposedFilers)}</span> funds holding ({formatPct(summary.exposedPctOfComparable)} of funds filed
                in both quarters)
            </span>

            <span className="mt-4 grid grid-cols-2 gap-3">
                <span className="block">
                    <span className="flex items-center gap-1 text-sm font-medium text-gain">
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                        Buyers
                    </span>
                    <span className="tabular block text-xl font-semibold text-ink">{formatNumber(summary.buyers)}</span>
                    <span className="block text-sm text-ink-muted">{formatPct(summary.buyerPctOfExposed)} of funds holding</span>
                </span>
                <span className="block">
                    <span className="flex items-center gap-1 text-sm font-medium text-loss">
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                        Sellers
                    </span>
                    <span className="tabular block text-xl font-semibold text-ink">{formatNumber(summary.sellers)}</span>
                    <span className="block text-sm text-ink-muted">{formatPct(summary.sellerPctOfExposed)} of funds holding</span>
                </span>
            </span>

            <span className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-rule pt-3 text-sm text-ink-muted">
                <CardLine label="New positions" value={formatNumber(summary.initiatedFilers)} />
                <CardLine label="Sold out" value={formatNumber(summary.liquidatedFilers)} />
                <CardLine label="Holders now" value={formatNumber(summary.currentHolders)} />
                <CardLine label="Last quarter" value={formatNumber(summary.previousHolders)} />
                <CardLine label="No change" value={formatNumber(summary.unchangedFilers)} />
                <CardLine label="Net buyers" value={formatSignedNumber(net)} />
            </span>
        </button>
    );
}

function CardLine({ label, value }: { label: string; value: string }) {
    return (
        <span className="flex items-baseline justify-between gap-2">
            <span>{label}</span>
            <span className="tabular text-ink">{value}</span>
        </span>
    );
}
