"use client";

import { useMemo, useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { classifyFiler } from '@/lib/filer-classification';
import { formatMoney, formatNumber, formatPct, formatShares } from '@/lib/format';
import { calculateHHI, type CategoryConcentration, type FilerMove } from '@/lib/thirteen-f-radar-core';
import { Button, IconButton, Notice, SkeletonRows, Stat, StatStrip, Term } from '../ui';
import { BarList } from './BarList';
import { HolderTable, type EnrichedFilerMove } from './HolderTable';
import { actionOrder, concentrationLevel, sharePctChange } from './radar-format';
import { saveBlob } from './radar-api';

/**
 * Deep-dive for one category: who owns it, how concentrated ownership is, which kinds of funds hold it, and the full
 * holder list. Loads the full holder list on demand; falls back to the biggest movers if that fails.
 */
export function CategoryStory({
    categoryKey,
    categoryLabel,
    moves,
    status,
    error,
    onRetry,
    onClose,
    concentration,
}: {
    categoryKey: string;
    categoryLabel: string;
    moves: FilerMove[];
    status: 'loading' | 'loaded' | 'error';
    error?: string;
    onRetry: () => void;
    onClose: () => void;
    concentration?: CategoryConcentration[];
}) {
    return (
        <div>
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
                <div className="min-w-0">
                    <h3 className="text-xl font-semibold text-ink">{categoryLabel}: who owns it</h3>
                    <p className="mt-1 text-base text-ink-muted">Every fund that reported holding these stocks at the end of the quarter, from 13F filings.</p>
                </div>
                <IconButton label={`Close ${categoryLabel}`} onClick={onClose} className="-mr-2">
                    <X className="h-4 w-4" aria-hidden />
                </IconButton>
            </div>
            {status === 'loading' ? (
                <SkeletonRows rows={8} label={`Loading every ${categoryLabel} holder`} />
            ) : (
                <>
                    {status === 'error' && (
                        <Notice
                            tone="caution"
                            className="mx-4 mt-4 sm:mx-5"
                            title="Showing the biggest movers only"
                            action={<Button size="sm" onClick={onRetry}>Try again</Button>}
                        >
                            The full holder list didn’t load{error ? `: ${error}` : '.'}
                        </Notice>
                    )}
                    <StoryBody categoryKey={categoryKey} categoryLabel={categoryLabel} moves={moves} concentration={concentration} />
                </>
            )}
        </div>
    );
}

function StoryBody({
    categoryKey,
    categoryLabel,
    moves,
    concentration,
}: {
    categoryKey: string;
    categoryLabel: string;
    moves: FilerMove[];
    concentration?: CategoryConcentration[];
}) {
    const [copied, setCopied] = useState(false);

    const enrichedMoves = useMemo<EnrichedFilerMove[]>(
        () =>
            moves
                .map((move) => ({
                    ...move,
                    filerType: classifyFiler(move.cik, move.fundName).type,
                    sharePctChange: sharePctChange(move.previousShares, move.currentShares),
                }))
                .sort((a, b) => b.currentShares - a.currentShares),
        [moves]
    );

    // Table order: new positions, sold out, added, cut, no change; by size within each.
    const sortedForTable = useMemo(
        () =>
            [...enrichedMoves].sort((a, b) => {
                const orderDiff = actionOrder(a.action) - actionOrder(b.action);
                if (orderDiff !== 0) return orderDiff;
                if (a.action === 'liquidated') return b.previousShares - a.previousShares;
                return b.currentShares - a.currentShares;
            }),
        [enrichedMoves]
    );

    const stats = useMemo(() => {
        const totalShares = enrichedMoves.reduce((sum, m) => sum + m.currentShares, 0);
        const totalValue = enrichedMoves.reduce((sum, m) => sum + m.currentValue, 0);
        const shareOf = (count: number) =>
            totalShares > 0 ? (enrichedMoves.slice(0, count).reduce((sum, m) => sum + m.currentShares, 0) / totalShares) * 100 : 0;

        const byType = new Map<string, { count: number; shares: number; value: number }>();
        for (const move of enrichedMoves) {
            const existing = byType.get(move.filerType) || { count: 0, shares: 0, value: 0 };
            existing.count++;
            existing.shares += move.currentShares;
            existing.value += move.currentValue;
            byType.set(move.filerType, existing);
        }
        const filerTypeBreakdown = Array.from(byType.entries())
            .map(([type, value]) => ({ type, ...value, pct: totalShares > 0 ? (value.shares / totalShares) * 100 : 0 }))
            .sort((a, b) => b.shares - a.shares);

        const hhi = calculateHHI(enrichedMoves.map((m) => m.currentShares));
        const cumulativeCurve = [1, 5, 10, 25, 50, 100].map((count) => ({ label: String(count), count, pct: shareOf(count) }));
        cumulativeCurve.push({ label: 'All', count: enrichedMoves.length, pct: totalShares > 0 ? 100 : 0 });

        return {
            totalShares,
            totalValue,
            holderCount: enrichedMoves.length,
            top5Pct: shareOf(5),
            top10Pct: shareOf(10),
            top25Pct: shareOf(25),
            filerTypeBreakdown,
            hhi,
            cumulativeCurve,
        };
    }, [enrichedMoves]);

    const peers = concentration || [];

    const storyText = () => {
        const lines: string[] = [
            `${categoryLabel}: institutional 13F ownership`,
            '',
            `Institutional holders: ${formatNumber(stats.holderCount)} funds`,
            `Total reported shares: ${formatNumber(stats.totalShares)}`,
            `Total estimated value: ${formatMoney(stats.totalValue)}`,
            '',
            'Top 10 holders',
        ];
        enrichedMoves.slice(0, 10).forEach((move, idx) => {
            const pct = stats.totalShares > 0 ? (move.currentShares / stats.totalShares) * 100 : 0;
            lines.push(`${idx + 1}. ${move.fundName}: ${formatNumber(move.currentShares)} shares (about ${formatMoney(move.currentValue)}, ${pct.toFixed(1)}% of reported shares)`);
        });
        lines.push('', 'Concentration');
        lines.push(`Top 5 funds: ${stats.top5Pct.toFixed(1)}% of reported institutional shares`);
        lines.push(`Top 10 funds: ${stats.top10Pct.toFixed(1)}%`);
        lines.push(`Top 25 funds: ${stats.top25Pct.toFixed(1)}%`);
        lines.push(`Ownership concentration (HHI): ${formatNumber(stats.hhi)} of 10,000 (${concentrationLevel(stats.hhi).toLowerCase()})`);
        lines.push('', 'By fund type');
        for (const breakdown of stats.filerTypeBreakdown.slice(0, 8)) {
            lines.push(`${breakdown.type} (${formatNumber(breakdown.count)} funds): ${breakdown.pct.toFixed(1)}% of shares`);
        }
        lines.push('', 'Source: SEC 13F filings, compiled with SCOUT. Dollar values are the market values the funds reported for the quarter end.');
        return lines.join('\n');
    };

    const copySummary = async () => {
        try {
            await navigator.clipboard.writeText(storyText());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    const downloadCSV = () => {
        const headers = ['Rank', 'Fund Name', 'CIK', 'Filer Type', 'Shares', 'Estimated Value', '% of Total'];
        const rows = enrichedMoves.map((move, idx) => {
            const pct = stats.totalShares > 0 ? (move.currentShares / stats.totalShares) * 100 : 0;
            return [idx + 1, `"${move.fundName.replace(/"/g, '""')}"`, move.cik, move.filerType, move.currentShares, move.currentValue, pct.toFixed(2)].join(',');
        });
        const csv = [headers.join(','), ...rows].join('\n');
        saveBlob(new Blob([csv], { type: 'text/csv' }), `${categoryKey}-institutional-holders.csv`);
    };

    const sectionClass = 'border-t border-rule px-4 py-5 sm:px-5';
    const topFive = stats.cumulativeCurve[1];

    return (
        <>
            <div className="flex flex-wrap gap-2 px-4 pt-3 sm:px-5">
                <Button size="sm" onClick={copySummary} icon={copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}>
                    {copied ? 'Copied' : 'Copy summary'}
                </Button>
                <Button size="sm" onClick={downloadCSV} icon={<Download className="h-4 w-4" aria-hidden />}>
                    Download CSV
                </Button>
            </div>

            <div className="px-4 pt-4 sm:px-5">
                <StatStrip>
                    <Stat label="Holders" value={formatNumber(stats.holderCount)} note="Funds reporting any shares" />
                    <Stat label="Total shares" value={formatShares(stats.totalShares)} note={formatNumber(stats.totalShares)} />
                    <Stat label="Total value" term="estimatedValue" value={formatMoney(stats.totalValue)} note="As reported at quarter end" />
                    <Stat
                        label="Ownership concentration"
                        term="concentration"
                        value={concentrationLevel(stats.hhi)}
                        note={`HHI ${formatNumber(stats.hhi)} of 10,000`}
                    />
                </StatStrip>
            </div>

            <div className={sectionClass}>
                <h4 className="text-lg font-semibold text-ink">
                    <Term id="cumulativeOwnership">Cumulative ownership curve</Term>
                </h4>
                <p className="mt-1 text-base text-ink-muted">
                    How to read this: each bar is the share of all reported shares held by the largest funds. The faster the bars reach 100%,
                    the more a few funds dominate. Here the largest 5 hold {formatPct(topFive?.pct ?? 0)}.
                </p>
                <CumulativeColumns points={stats.cumulativeCurve} />
            </div>

            <div className={`${sectionClass} grid gap-8 lg:grid-cols-2`}>
                {peers.length > 1 && (
                    <div>
                        <h4 className="text-lg font-semibold text-ink">Concentration compared with other categories</h4>
                        <p className="mt-1 mb-4 text-base text-ink-muted">
                            Higher means fewer funds hold most of the shares. Below 1,500 is low, 1,500 to 2,500 moderate, above 2,500 high.
                        </p>
                        <BarList
                            label="Ownership concentration by category"
                            emphasis="highlight"
                            items={peers.map((peer) => ({
                                key: peer.key,
                                label: peer.label,
                                value: peer.hhi,
                                valueLabel: formatNumber(peer.hhi),
                                secondary: concentrationLevel(peer.hhi),
                                highlight: peer.key === categoryKey,
                                title: `${peer.label}: HHI ${formatNumber(peer.hhi)}, ${formatNumber(peer.holders)} holders`,
                            }))}
                        />
                    </div>
                )}
                <div>
                    <h4 className="text-lg font-semibold text-ink">
                        By <Term id="filerType">fund type</Term>
                    </h4>
                    <p className="mt-1 mb-4 text-base text-ink-muted">Share of reported shares held by each kind of fund, with the number of funds.</p>
                    <BarList
                        label="Share of reported shares by fund type"
                        max={100}
                        items={stats.filerTypeBreakdown.map((breakdown) => ({
                            key: breakdown.type,
                            label: breakdown.type,
                            value: breakdown.pct,
                            valueLabel: formatPct(breakdown.pct),
                            secondary: `(${formatNumber(breakdown.count)})`,
                            title: `${breakdown.type}: ${formatPct(breakdown.pct)} of shares, ${formatNumber(breakdown.count)} funds, ${formatMoney(breakdown.value)}`,
                        }))}
                    />
                </div>
            </div>

            {enrichedMoves.length > 0 && (
                <div className={sectionClass}>
                    <h4 className="text-lg font-semibold text-ink">Largest {Math.min(25, enrichedMoves.length)} holders by shares</h4>
                    <p className="mt-1 mb-4 text-base text-ink-muted">Bar length is shares held; the figure is each fund’s share of all reported shares. Every holder is in the table below.</p>
                    <BarList
                        label={`Largest ${categoryLabel} holders by shares`}
                        items={enrichedMoves.slice(0, 25).map((move, idx) => {
                            const pct = stats.totalShares > 0 ? (move.currentShares / stats.totalShares) * 100 : 0;
                            return {
                                key: move.cik,
                                label: `${idx + 1}. ${move.fundName}`,
                                value: move.currentShares,
                                valueLabel: formatPct(pct),
                                secondary: formatShares(move.currentShares),
                                title: `${move.fundName}: ${formatNumber(move.currentShares)} shares, about ${formatMoney(move.currentValue)}`,
                            };
                        })}
                    />
                </div>
            )}

            <div className="border-t border-rule pt-5">
                <HolderTable moves={sortedForTable} />
            </div>
        </>
    );
}

/** Seven columns: share held by the largest 1, 5, 10, 25, 50, 100 funds and all funds. */
function CumulativeColumns({ points }: { points: { label: string; count: number; pct: number }[] }) {
    return (
        <figure className="mt-4 max-w-2xl">
            <ul className="grid grid-cols-7 gap-2" aria-label="Share of reported shares held by the largest funds">
                {points.map((point, idx) => {
                    const isAll = idx === points.length - 1;
                    const name = isAll ? 'All funds' : `Largest ${point.count}`;
                    return (
                        <li key={point.label} className="flex flex-col items-center" title={`${name}: ${formatPct(point.pct)} of reported shares`}>
                            <span className="sr-only">{name}: </span>
                            <span className="tabular text-sm font-medium text-ink">{Math.round(point.pct)}%</span>
                            <span className="mt-1 flex h-28 w-full items-end justify-center" aria-hidden>
                                <span
                                    className={isAll ? 'block w-full max-w-6 rounded-t-[4px] bg-rule-strong' : 'block w-full max-w-6 rounded-t-[4px] bg-accent'}
                                    style={{ height: `${Math.max(point.pct, 1.5)}%` }}
                                />
                            </span>
                            <span className="mt-1.5 text-sm text-ink-muted" aria-hidden>{point.label}</span>
                        </li>
                    );
                })}
            </ul>
            <figcaption className="mt-1 text-center text-sm text-ink-muted">Number of largest funds</figcaption>
        </figure>
    );
}
