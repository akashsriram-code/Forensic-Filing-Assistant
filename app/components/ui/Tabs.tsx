"use client";

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
    id: T;
    label: ReactNode;
    icon?: ReactNode;
}

/**
 * Accessible tab list (arrow keys, Home/End). Panels should use tabPanelProps(idPrefix, id).
 * variant "underline" for primary navigation, "segmented" for switching modes inside a screen.
 */
export function Tabs<T extends string>({
    items,
    value,
    onChange,
    label,
    idPrefix,
    variant = 'underline',
    className,
}: {
    items: TabItem<T>[];
    value: T;
    onChange: (id: T) => void;
    /** Accessible name for the tab list. */
    label: string;
    idPrefix: string;
    variant?: 'underline' | 'segmented';
    className?: string;
}) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % items.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else return;
        event.preventDefault();
        refs.current[next]?.focus();
        onChange(items[next].id);
    };

    return (
        <div
            role="tablist"
            aria-label={label}
            className={cn(
                variant === 'underline'
                    ? 'flex gap-1 overflow-x-auto [scrollbar-width:none]'
                    : 'inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-rule bg-surface-2 p-1 [scrollbar-width:none]',
                className
            )}
        >
            {items.map((item, index) => {
                const selected = item.id === value;
                return (
                    <button
                        key={item.id}
                        ref={(node) => {
                            refs.current[index] = node;
                        }}
                        type="button"
                        role="tab"
                        id={`${idPrefix}-tab-${item.id}`}
                        aria-selected={selected}
                        aria-controls={`${idPrefix}-panel-${item.id}`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(item.id)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={cn(
                            'inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-medium transition-colors',
                            variant === 'underline'
                                ? cn(
                                    'h-11 border-b-2 px-3 text-base',
                                    selected ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'
                                )
                                : cn(
                                    'h-9 rounded-md px-3 text-sm',
                                    selected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                                )
                        )}
                    >
                        {item.icon}
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}

export function tabPanelProps(idPrefix: string, id: string) {
    return {
        role: 'tabpanel' as const,
        id: `${idPrefix}-panel-${id}`,
        'aria-labelledby': `${idPrefix}-tab-${id}`,
        tabIndex: -1,
    };
}
