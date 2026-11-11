"use client";

import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { Button } from './Button';

/**
 * Table building blocks. On large screens the header sticks below the app header (page scroll, no nested scroll box);
 * on small screens the table scrolls sideways inside its wrapper.
 *
 *   <Table>
 *     <THead><tr><Th>Fund</Th><Th numeric>Value</Th></tr></THead>
 *     <tbody>…<tr className={rowClass}><Td>…</Td><Td numeric>…</Td></tr></tbody>
 *   </Table>
 *   <TableFooter shown={20} total={312} onShowMore={…} />
 */
export function Table({ children, className, caption }: { children: ReactNode; className?: string; caption?: string }) {
    return (
        <div className={cn('overflow-x-auto lg:overflow-visible', className)}>
            <table className="w-full border-collapse text-left text-base">
                {caption && <caption className="sr-only">{caption}</caption>}
                {children}
            </table>
        </div>
    );
}

export function THead({ children }: { children: ReactNode }) {
    return <thead className="text-sm text-ink-muted">{children}</thead>;
}

export function Th({ numeric, className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
    return (
        <th
            scope="col"
            className={cn(
                'border-b border-rule-strong bg-surface px-3 py-2.5 font-medium whitespace-nowrap first:pl-4 last:pr-4',
                'lg:sticky lg:top-[var(--sticky-offset,0px)] lg:z-10',
                numeric && 'text-right',
                className
            )}
            {...rest}
        >
            {children}
        </th>
    );
}

export function Td({ numeric, className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
    return (
        <td
            className={cn('border-b border-rule px-3 py-3 align-top first:pl-4 last:pr-4', numeric && 'tabular text-right whitespace-nowrap', className)}
            {...rest}
        >
            {children}
        </td>
    );
}

/** Standard body-row hover. */
export const rowClass = 'transition-colors hover:bg-surface-2/60';

/** A full-width row explaining why there's nothing to show and what to try. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
    return (
        <tr>
            <td colSpan={colSpan} className="px-4 py-10 text-center text-base text-ink-muted">
                {children}
            </td>
        </tr>
    );
}

/**
 * Required whenever a table shows fewer rows than it has: "Showing 20 of 312". Offers "Show more" when possible.
 */
export function TableFooter({
    shown,
    total,
    noun = 'rows',
    onShowMore,
    onShowLess,
    note,
}: {
    shown: number;
    total: number;
    noun?: string;
    onShowMore?: () => void;
    onShowLess?: () => void;
    note?: ReactNode;
}) {
    if (total <= shown && !onShowLess && !note) return null;
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-ink-muted">
            <span className="tabular">
                {total > shown ? `Showing ${formatNumber(shown)} of ${formatNumber(total)} ${noun}` : `Showing all ${formatNumber(total)} ${noun}`}
                {note && <> · {note}</>}
            </span>
            <span className="flex gap-2">
                {onShowLess && shown > 0 && total <= shown && (
                    <Button size="sm" variant="ghost" onClick={onShowLess}>Show fewer</Button>
                )}
                {onShowMore && total > shown && (
                    <Button size="sm" variant="secondary" onClick={onShowMore}>Show more</Button>
                )}
            </span>
        </div>
    );
}

/**
 * Keyboard-reachable expand/collapse control for a table row. Put it in the row's first cell and render the detail
 * as the next <tr> when expanded.
 */
export function RowToggle({ expanded, onToggle, children, controls }: { expanded: boolean; onToggle: () => void; children: ReactNode; controls?: string }) {
    return (
        <button
            type="button"
            aria-expanded={expanded}
            aria-controls={controls}
            onClick={onToggle}
            className="group inline-flex items-start gap-1.5 text-left font-medium text-ink hover:text-accent"
        >
            <ChevronRight className={cn('mt-1 h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:text-accent', expanded && 'rotate-90')} aria-hidden />
            <span className="min-w-0">{children}</span>
        </button>
    );
}
