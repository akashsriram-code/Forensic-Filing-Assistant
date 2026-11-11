import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface BarListItem {
    key: string;
    label: ReactNode;
    /** Drives the bar length relative to the largest value (or `max`). */
    value: number;
    /** Text shown at the end of the row, e.g. "12.4%". */
    valueLabel: ReactNode;
    /** Muted text after the value, e.g. a count. */
    secondary?: ReactNode;
    /** Hover tooltip with the full figures. */
    title?: string;
    /** Draw this bar in the accent color and the rest in a neutral tone. */
    highlight?: boolean;
}

/**
 * Ranked horizontal bars: one series, so no legend. Bars are thin with a rounded data end and a square baseline;
 * values sit beside the bar in text colors, never inside it. On narrow screens the label and value stack above the bar.
 */
export function BarList({
    items,
    max,
    label,
    emphasis = 'all',
    className,
}: {
    items: BarListItem[];
    max?: number;
    /** Accessible name for the list. */
    label: string;
    /** 'all' paints every bar in the accent; 'highlight' paints only highlighted bars. */
    emphasis?: 'all' | 'highlight';
    className?: string;
}) {
    const top = max ?? Math.max(1, ...items.map((item) => item.value));

    return (
        <ul aria-label={label} className={cn('space-y-2.5 sm:space-y-1.5', className)}>
            {items.map((item) => {
                const width = top > 0 ? Math.max(0, Math.min(item.value / top, 1)) * 100 : 0;
                const accent = emphasis === 'all' || item.highlight;
                return (
                    <li
                        key={item.key}
                        title={item.title}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_7.5rem]"
                    >
                        <span className={cn('min-w-0 truncate text-sm text-ink sm:order-1', item.highlight && 'font-semibold')}>{item.label}</span>
                        <span className="tabular text-right text-sm whitespace-nowrap text-ink sm:order-3">
                            {item.valueLabel}
                            {item.secondary !== undefined && <span className="ml-1.5 text-ink-muted">{item.secondary}</span>}
                        </span>
                        <span className="col-span-2 block h-3 rounded-sm bg-surface-2 sm:order-2 sm:col-span-1" aria-hidden>
                            <span
                                className={cn('block h-full rounded-r-[4px]', accent ? 'bg-accent' : 'bg-rule-strong')}
                                style={{ width: `${width}%`, minWidth: item.value > 0 ? 2 : 0 }}
                            />
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}
