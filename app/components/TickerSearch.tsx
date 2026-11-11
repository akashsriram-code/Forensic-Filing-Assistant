"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { controlClass, Identifier } from './ui';

interface Suggestion {
    cik: string;
    ticker: string;
    title: string;
}

interface TickerSearchProps {
    value: string;
    onChange: (value: string) => void;
    /** Called with the chosen ticker when a suggestion is picked (click or Enter). */
    onSelect?: (ticker: string) => void;
    placeholder?: string;
    className?: string;
    /** Visible label. Without one, the placeholder becomes the accessible name. */
    label?: ReactNode;
    hideLabel?: boolean;
    hint?: ReactNode;
    error?: ReactNode;
    /** Upper-case what the user types (right for tickers; turn off for fund names). Default true. */
    uppercase?: boolean;
    /** @deprecated Ignored: colors follow the theme tokens. Kept so older callers still compile. */
    theme?: 'light' | 'dark';
}

/**
 * Ticker / company input with suggestions from /api/autocomplete, following the ARIA combobox pattern:
 * arrow keys move through suggestions, Enter picks the highlighted one (or submits the surrounding form when none is
 * highlighted), Esc closes the list.
 */
export function TickerSearch({
    value,
    onChange,
    onSelect,
    placeholder = 'Search ticker',
    className,
    label,
    hideLabel,
    hint,
    error,
    uppercase = true,
}: TickerSearchProps) {
    const baseId = useId();
    const inputId = `${baseId}-input`;
    const listId = `${baseId}-list`;
    const hintId = `${baseId}-hint`;
    const errorId = `${baseId}-error`;
    const optionId = (index: number) => `${baseId}-opt-${index}`;

    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [loading, setLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    /** The value we just filled in from a suggestion, so we don't immediately search for it again. */
    const pickedRef = useRef<string | null>(null);

    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, []);

    useEffect(() => {
        const query = value.trim();
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            if (query.length < 2 || pickedRef.current === value) {
                setSuggestions([]);
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                const response = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`, { signal: controller.signal });
                if (!response.ok) throw new Error(`Autocomplete failed (${response.status})`);
                const data = (await response.json()) as { results?: Suggestion[] };
                setSuggestions(Array.isArray(data.results) ? data.results : []);
                setActive(-1);
            } catch (fetchError) {
                if (!controller.signal.aborted) {
                    // Suggestions are a convenience; typing a value and searching still works without them.
                    console.warn('Autocomplete fetch failed', fetchError);
                    setSuggestions([]);
                }
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }, 250);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [value]);

    const listVisible = open && suggestions.length > 0 && value.trim().length >= 2;

    useEffect(() => {
        if (!listVisible || active < 0) return;
        document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
    }, [active, listVisible, baseId]);

    const pick = (suggestion: Suggestion) => {
        pickedRef.current = suggestion.ticker;
        onChange(suggestion.ticker);
        setOpen(false);
        setActive(-1);
        onSelect?.(suggestion.ticker);
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        const next = uppercase ? event.target.value.toUpperCase() : event.target.value;
        pickedRef.current = null;
        onChange(next);
        setOpen(true);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        const count = suggestions.length;
        if (event.key === 'ArrowDown') {
            if (count === 0) return;
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index + 1) % count);
        } else if (event.key === 'ArrowUp') {
            if (count === 0) return;
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index <= 0 ? count - 1 : index - 1));
        } else if (event.key === 'Enter') {
            if (listVisible && active >= 0 && suggestions[active]) {
                event.preventDefault();
                pick(suggestions[active]);
            } else {
                setOpen(false);
            }
        } else if (event.key === 'Escape') {
            if (listVisible) {
                event.preventDefault();
                setOpen(false);
                setActive(-1);
            }
        } else if (event.key === 'Tab') {
            setOpen(false);
        }
    };

    const describedBy = [hint && !error ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

    return (
        <div ref={wrapperRef} className={cn('relative min-w-0', className)}>
            {label && (
                <label htmlFor={inputId} className={cn('mb-1.5 block text-sm font-medium text-ink', hideLabel && 'sr-only')}>
                    {label}
                </label>
            )}
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                <input
                    id={inputId}
                    type="text"
                    role="combobox"
                    aria-label={label ? undefined : placeholder}
                    aria-autocomplete="list"
                    aria-expanded={listVisible}
                    aria-controls={listId}
                    aria-activedescendant={listVisible && active >= 0 ? optionId(active) : undefined}
                    aria-describedby={describedBy}
                    aria-invalid={error ? true : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={placeholder}
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setOpen(true)}
                    className={cn(controlClass, 'h-10 pl-9 pr-9')}
                />
                {loading && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-muted" aria-hidden />
                )}
            </div>

            <ul
                id={listId}
                role="listbox"
                aria-label="Suggestions"
                hidden={!listVisible}
                className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-rule bg-surface py-1 shadow-lg"
            >
                {suggestions.map((suggestion, index) => (
                    <li
                        key={`${suggestion.cik}-${suggestion.ticker}`}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === active}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pick(suggestion)}
                        onMouseEnter={() => setActive(index)}
                        className={cn(
                            'flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2',
                            index === active ? 'bg-surface-2' : 'bg-surface'
                        )}
                    >
                        <span className="min-w-0">
                            <span className="mr-2 font-semibold text-ink">{suggestion.ticker}</span>
                            <span className="text-sm text-ink-muted">{suggestion.title}</span>
                        </span>
                        <Identifier label="CIK" value={suggestion.cik} className="text-xs" />
                    </li>
                ))}
            </ul>
            <span className="sr-only" aria-live="polite">
                {listVisible ? `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}. Use the arrow keys to choose.` : ''}
            </span>

            {hint && !error && <p id={hintId} className="mt-1.5 text-sm text-ink-muted">{hint}</p>}
            {error && <p id={errorId} className="mt-1.5 text-sm font-medium text-loss">{error}</p>}
        </div>
    );
}
