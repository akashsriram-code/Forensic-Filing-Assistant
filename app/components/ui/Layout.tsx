"use client";

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { Term } from './Term';
import type { GlossaryKey } from '@/lib/glossary';

/** The one panel style: 8px radius, 1px rule border, surface background, no shadow. */
export function Panel({ className, children, as: Tag = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' }) {
    return <Tag className={cn('rounded-lg border border-rule bg-surface', className)}>{children}</Tag>;
}

/** Section title, a one-sentence plain-English intro, and optional actions on the right. */
export function SectionHeader({
    title,
    intro,
    actions,
    id,
    className,
    level = 2,
}: {
    title: ReactNode;
    intro?: ReactNode;
    actions?: ReactNode;
    id?: string;
    className?: string;
    level?: 2 | 3;
}) {
    const Heading = level === 2 ? 'h2' : 'h3';
    return (
        <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
            <div className="min-w-0 max-w-3xl">
                <Heading id={id} className={cn('font-semibold text-ink', level === 2 ? 'text-xl' : 'text-lg')}>
                    {title}
                </Heading>
                {intro && <p className="mt-1 text-base text-ink-muted">{intro}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

/** Top-of-screen page title in the serif face. */
export function PageTitle({ children, intro }: { children: ReactNode; intro?: ReactNode }) {
    return (
        <div className="max-w-3xl">
            <h1 className="font-serif text-2xl font-semibold text-ink">{children}</h1>
            {intro && <p className="mt-2 text-lg text-ink-muted">{intro}</p>}
        </div>
    );
}

/**
 * The plain-English takeaway that opens each screen: one or two serif sentences built from the data, an "as of" line,
 * and a copy button so reporters can paste it straight into notes.
 */
export function Takeaway({
    children,
    copyText,
    asOf,
    note,
    updating = false,
}: {
    children: ReactNode;
    /** Plain-text version of the sentence for the clipboard. */
    copyText?: string;
    /** YYYY-MM-DD or ISO date the numbers are current to. */
    asOf?: string | null;
    note?: ReactNode;
    /** Dims the sentence while fresh data loads. */
    updating?: boolean;
}) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        if (!copyText) return;
        try {
            await navigator.clipboard.writeText(copyText);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className={cn('max-w-4xl transition-opacity', updating && 'opacity-60')} aria-busy={updating || undefined}>
            <p className="font-serif text-xl leading-snug text-ink sm:text-2xl sm:leading-snug">{children}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
                {updating ? <span>Updating…</span> : asOf ? <span>As of {formatDate(asOf)}</span> : null}
                {note}
                {copyText && (
                    <button
                        type="button"
                        onClick={copy}
                        className="inline-flex items-center gap-1.5 rounded px-1 font-medium text-accent hover:underline"
                    >
                        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                        {copied ? 'Copied' : 'Copy sentence'}
                    </button>
                )}
            </div>
        </div>
    );
}

/** One figure in a stat strip: label (optionally a glossary term), large tabular value, optional note. */
export function Stat({
    label,
    term,
    value,
    note,
    tone,
}: {
    label: string;
    term?: GlossaryKey;
    value: ReactNode;
    note?: ReactNode;
    tone?: 'gain' | 'loss' | 'caution';
}) {
    return (
        <div className="min-w-0">
            <dt className="text-sm text-ink-muted">{term ? <Term id={term}>{label}</Term> : label}</dt>
            <dd
                className={cn(
                    'tabular mt-1 text-2xl font-semibold text-ink',
                    tone === 'gain' && 'text-gain',
                    tone === 'loss' && 'text-loss',
                    tone === 'caution' && 'text-caution'
                )}
            >
                {value}
            </dd>
            {note && <dd className="mt-1 text-sm text-ink-muted">{note}</dd>}
        </div>
    );
}

/** A row of Stats, divided by rules, wrapping to two columns on mobile. */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-5 border-y border-rule py-5 md:grid-cols-4', className)}>
            {children}
        </dl>
    );
}

/** A compact mark for an SEC form identifier: 10-K, 13F-HR, SC 13D. */
export function FormMark({ form, className }: { form: string; className?: string }) {
    return (
        <span className={cn('inline-flex items-center rounded border border-rule-strong px-1.5 py-px text-sm font-semibold text-ink tabular whitespace-nowrap', className)}>
            {form}
        </span>
    );
}

/** A real identifier (CIK, accession number, CUSIP): the only place monospace is used. */
export function Identifier({ label, value, className }: { label?: string; value: string; className?: string }) {
    return (
        <span className={cn('text-sm text-ink-muted', className)}>
            {label && <>{label} </>}
            <span className="font-mono">{value}</span>
        </span>
    );
}

/** Toggleable filter chip (aria-pressed). */
export function Chip({
    selected,
    onClick,
    children,
    count,
}: {
    selected: boolean;
    onClick: () => void;
    children: ReactNode;
    count?: number;
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onClick}
            className={cn(
                'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors',
                selected ? 'border-accent bg-accent text-accent-ink' : 'border-rule-strong bg-surface text-ink hover:bg-surface-2'
            )}
        >
            {children}
            {typeof count === 'number' && (
                <span className={cn('tabular text-xs', selected ? 'text-accent-ink/80' : 'text-ink-muted')}>{count.toLocaleString('en-US')}</span>
            )}
        </button>
    );
}
