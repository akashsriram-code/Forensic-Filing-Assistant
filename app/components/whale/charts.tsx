"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/cn';
import { formatCompact, formatDate, formatMoney, formatShares } from '@/lib/format';
import { formatQuarter, type HistoryPoint } from './model';

/*
 * Whale Tracker charts. Bar lists are plain HTML so every value is printed as text (no tooltip needed to read them)
 * and they reflow at phone width. Colors are theme tokens: neutral ink for single-series magnitude, gain/loss only
 * where the bar means bought/sold, accent vs ink-muted for the two compared funds.
 */

const pctOf = (value: number, max: number) => (max > 0 ? `${Math.max((Math.abs(value) / max) * 100, 0.75)}%` : '0%');

export interface RankedItem {
    id: string;
    label: string;
    value: number;
    /** Printed value, e.g. "$1.2B". */
    display: string;
    /** Secondary figure, e.g. "12.4% of portfolio". */
    note?: string;
}

/** Ranked horizontal bars, largest first, label and value printed beside each bar. */
export function RankedBars({ items, label, className }: { items: RankedItem[]; label: string; className?: string }) {
    const max = items.reduce((m, item) => Math.max(m, item.value), 0);
    return (
        <ol aria-label={label} className={cn('space-y-3', className)}>
            {items.map((item) => (
                <li key={item.id}>
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 break-words text-base text-ink">{item.label}</span>
                        <span className="tabular shrink-0 text-right text-base text-ink">
                            {item.display}
                            {item.note && <span className="ml-2 text-sm text-ink-muted">{item.note}</span>}
                        </span>
                    </div>
                    <div className="mt-1.5 h-2" aria-hidden>
                        <div className="h-2 rounded-r bg-ink-muted" style={{ width: pctOf(item.value, max) }} />
                    </div>
                </li>
            ))}
        </ol>
    );
}

export interface DivergingItem {
    id: string;
    label: string;
    /** Signed: positive = bought/added, negative = cut. */
    value: number;
    display: string;
}

function LegendSwatch({ className }: { className: string }) {
    return <span className={cn('inline-block h-2.5 w-4 rounded-sm align-middle', className)} aria-hidden />;
}

/** Bars growing right (gain) or left (loss) from a shared center line. The signed value is always printed. */
export function DivergingBars({
    items,
    label,
    positiveLabel,
    negativeLabel,
}: {
    items: DivergingItem[];
    label: string;
    positiveLabel: string;
    negativeLabel: string;
}) {
    const max = items.reduce((m, item) => Math.max(m, Math.abs(item.value)), 0);
    return (
        <div>
            <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted">
                <span className="inline-flex items-center gap-2"><LegendSwatch className="bg-gain" />{positiveLabel}</span>
                <span className="inline-flex items-center gap-2"><LegendSwatch className="bg-loss" />{negativeLabel}</span>
            </div>
            <ol aria-label={label} className="space-y-3">
                {items.map((item) => (
                    <li
                        key={item.id}
                        className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_6.5rem]"
                    >
                        <span className="col-span-2 min-w-0 break-words text-base text-ink sm:col-span-1">{item.label}</span>
                        <div className="relative grid h-4 grid-cols-2" aria-hidden>
                            <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
                            <div className="flex items-center justify-end pr-px">
                                {item.value < 0 && <div className="h-2.5 rounded-l bg-loss" style={{ width: pctOf(item.value, max) }} />}
                            </div>
                            <div className="flex items-center pl-px">
                                {item.value > 0 && <div className="h-2.5 rounded-r bg-gain" style={{ width: pctOf(item.value, max) }} />}
                            </div>
                        </div>
                        <span className="tabular text-right text-base text-ink">{item.display}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

export interface PairedItem {
    id: string;
    label: string;
    a: number;
    b: number;
    aDisplay: string;
    bDisplay: string;
}

/** Two thin bars per row: the first fund in accent, the second in ink-muted, on one shared scale. */
export function PairedBars({ items, label, aName, bName }: { items: PairedItem[]; label: string; aName: string; bName: string }) {
    const max = items.reduce((m, item) => Math.max(m, item.a, item.b), 0);
    return (
        <div>
            <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted">
                <span className="inline-flex items-center gap-2"><LegendSwatch className="bg-accent" />{aName}</span>
                <span className="inline-flex items-center gap-2"><LegendSwatch className="bg-ink-muted" />{bName}</span>
            </div>
            <ol aria-label={label} className="space-y-4">
                {items.map((item) => (
                    <li key={item.id}>
                        <p className="break-words text-base text-ink">{item.label}</p>
                        <div className="mt-1 grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-3 gap-y-1">
                            <div className="h-2" aria-hidden>
                                <div className="h-2 rounded-r bg-accent" style={{ width: pctOf(item.a, max) }} />
                            </div>
                            <span className="tabular text-right text-sm text-ink">
                                <span className="sr-only">{aName}: </span>{item.aDisplay}
                            </span>
                            <div className="h-2" aria-hidden>
                                <div className="h-2 rounded-r bg-ink-muted" style={{ width: pctOf(item.b, max) }} />
                            </div>
                            <span className="tabular text-right text-sm text-ink">
                                <span className="sr-only">{bName}: </span>{item.bDisplay}
                            </span>
                        </div>
                    </li>
                ))}
            </ol>
        </div>
    );
}

/** Tiny trend line for a table cell. Decorative: the numbers live in the history dialog. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
    if (values.length < 2) return null;
    const width = 56;
    const height = 18;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const points = values.map((value, index) => {
        const x = (index / (values.length - 1)) * (width - 4) + 2;
        const y = max === min ? height / 2 : height - 2 - ((value - min) / span) * (height - 4);
        return [x, y] as const;
    });
    const [lastX, lastY] = points[points.length - 1];
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('shrink-0', className)} aria-hidden>
            <polyline
                points={points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="var(--ink-muted)"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
            />
            <circle cx={lastX} cy={lastY} r={2.5} fill="var(--ink)" />
        </svg>
    );
}

export type HistoryMetric = 'shares' | 'value';

function monthYear(date: string): string {
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * One measure over time on one axis (shares held, or reported value). Recharts takes CSS variables for stroke/fill,
 * so the chart follows the theme without re-rendering.
 */
export function HistoryChart({ points, metric, summary }: { points: HistoryPoint[]; metric: HistoryMetric; summary: string }) {
    const data = points.map((point) => ({
        key: `${point.date}-${point.quarter ?? ''}`,
        x: point.quarter ? formatQuarter(point.quarter) : monthYear(point.date),
        date: point.date,
        y: metric === 'shares' ? point.shares : point.valueUsd,
    }));
    const formatY = metric === 'shares' ? (v: number) => formatCompact(v) : (v: number) => formatMoney(v);
    const formatTip = metric === 'shares' ? (v: number) => `${formatShares(v)} shares` : (v: number) => formatMoney(v);
    const axisText = { fill: 'var(--ink-muted)', fontSize: 12 };

    return (
        <div role="img" aria-label={summary} className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
                    <CartesianGrid vertical={false} stroke="var(--rule)" />
                    <XAxis dataKey="x" tick={axisText} tickLine={false} axisLine={{ stroke: 'var(--rule-strong)' }} minTickGap={16} />
                    <YAxis tick={axisText} tickLine={false} axisLine={false} width={60} tickFormatter={(value: number) => formatY(value)} />
                    <Tooltip
                        cursor={{ stroke: 'var(--rule-strong)', strokeWidth: 1 }}
                        contentStyle={{
                            background: 'var(--surface)',
                            border: '1px solid var(--rule)',
                            borderRadius: 6,
                            color: 'var(--ink)',
                            fontSize: 13,
                        }}
                        labelStyle={{ color: 'var(--ink-muted)', marginBottom: 2 }}
                        itemStyle={{ color: 'var(--ink)' }}
                        labelFormatter={(label, payload) => {
                            const date = payload?.[0]?.payload?.date as string | undefined;
                            return date ? `${label} · filed ${formatDate(date)}` : String(label);
                        }}
                        formatter={(value) => [formatTip(Number(value)), metric === 'shares' ? 'Shares held' : 'Value']}
                    />
                    <Line
                        type="linear"
                        dataKey="y"
                        stroke="var(--accent)"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        dot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }}
                        activeDot={{ r: 6, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
