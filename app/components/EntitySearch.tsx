"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { cikPath } from '@/lib/sec-urls';
import { IconButton, controlClass } from './ui';

interface EntityResult {
    type: 'company' | 'fund';
    cik: string;
    ticker?: string;
    name: string;
}

interface SearchResponse {
    query: string;
    results: EntityResult[];
    warnings: string[];
}

const DEBOUNCE_MS = 200;
const PLACEHOLDER = 'Search a company or fund';

function hrefFor(result: EntityResult): string {
    if (result.type === 'fund') return `/fund/${encodeURIComponent(result.cik)}`;
    return `/company/${encodeURIComponent(result.ticker || result.cik)}`;
}

/**
 * Header search for companies and funds. On md and up it is an inline box between the brand and the utilities; below
 * md it is a "Search" button that opens a full-width row under the first header row. Rendered inside AppHeader's first
 * row, which sits at the top of the sticky header (the mobile row is positioned against the header).
 */
export function EntitySearch() {
    const [mobileOpen, setMobileOpen] = useState(false);
    const panelId = useId();
    const toggleRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const mobileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!mobileOpen) return;
        mobileInputRef.current?.focus();
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
            setMobileOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [mobileOpen]);

    const closeMobile = (restoreFocus: boolean) => {
        setMobileOpen(false);
        if (restoreFocus) toggleRef.current?.querySelector('button')?.focus();
    };

    return (
        <>
            <div className="hidden min-w-[12rem] max-w-[320px] flex-1 md:block">
                <EntityCombobox />
            </div>

            <span ref={toggleRef} className="-mr-2 ml-auto md:hidden">
                <IconButton
                    label="Search"
                    aria-expanded={mobileOpen}
                    aria-controls={mobileOpen ? panelId : undefined}
                    onClick={() => (mobileOpen ? closeMobile(false) : setMobileOpen(true))}
                >
                    <Search className="h-5 w-5" aria-hidden />
                </IconButton>
            </span>

            {mobileOpen && (
                <div
                    id={panelId}
                    ref={panelRef}
                    className="absolute inset-x-0 top-14 z-50 border-b border-rule bg-surface px-4 py-2 shadow-lg md:hidden"
                >
                    <div className="flex items-center gap-2">
                        <EntityCombobox
                            className="flex-1"
                            inputRef={mobileInputRef}
                            onEscape={() => closeMobile(true)}
                            onNavigate={() => closeMobile(false)}
                        />
                        <IconButton label="Close search" onClick={() => closeMobile(true)}>
                            <X className="h-5 w-5" aria-hidden />
                        </IconButton>
                    </div>
                </div>
            )}
        </>
    );
}

interface EntityComboboxProps {
    className?: string;
    inputRef?: RefObject<HTMLInputElement | null>;
    /** Esc pressed while the suggestion list is already closed. */
    onEscape?: () => void;
    /** Called after a result (or free text) is opened. */
    onNavigate?: () => void;
}

/**
 * ARIA combobox (modelled on TickerSearch): arrow keys move through both groups, Enter opens the highlighted result
 * (or, with nothing highlighted, the company page for the typed text, which resolves names), Esc closes the list.
 */
function EntityCombobox({ className, inputRef, onEscape, onNavigate }: EntityComboboxProps) {
    const router = useRouter();
    const baseId = useId();
    const inputId = `${baseId}-input`;
    const listId = `${baseId}-list`;
    const statusId = `${baseId}-status`;
    const optionId = (index: number) => `${baseId}-opt-${index}`;

    const [value, setValue] = useState('');
    const [response, setResponse] = useState<SearchResponse | null>(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [loading, setLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const query = value.trim();

    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, []);

    useEffect(() => {
        if (query.length < 2) return;
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/entity-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
                if (!res.ok) throw new Error(`Search failed (${res.status})`);
                const data = (await res.json()) as { results?: EntityResult[]; warnings?: string[] };
                setResponse({
                    query,
                    results: Array.isArray(data.results) ? data.results : [],
                    warnings: Array.isArray(data.warnings) ? data.warnings : [],
                });
                setActive(-1);
            } catch (error) {
                if (!controller.signal.aborted) {
                    // Suggestions are a convenience: Enter still opens the company page for the typed text.
                    console.warn('Entity search failed', error);
                    setResponse({ query, results: [], warnings: ['Suggestions are unavailable right now. Press Enter to search anyway.'] });
                    setActive(-1);
                }
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }, DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    // Companies first, then funds; `active` indexes this flat list so the arrow keys cross both groups.
    const results = response?.results ?? [];
    const companies = results.filter((result) => result.type === 'company');
    const funds = results.filter((result) => result.type === 'fund');
    const options = [...companies, ...funds];
    const answered = response !== null && response.query === query;
    const popupVisible = open && query.length >= 2 && (options.length > 0 || answered);
    const listVisible = popupVisible && options.length > 0;

    useEffect(() => {
        if (!listVisible || active < 0) return;
        document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
    }, [active, listVisible, baseId]);

    const go = (href: string) => {
        setOpen(false);
        setActive(-1);
        setValue('');
        router.push(href);
        onNavigate?.();
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        setValue(event.target.value);
        setOpen(true);
        setActive(-1);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        const count = options.length;
        if (event.key === 'ArrowDown') {
            if (count === 0) return;
            event.preventDefault();
            setOpen(true);
            setActive((index) => (!listVisible ? 0 : (index + 1) % count));
        } else if (event.key === 'ArrowUp') {
            if (count === 0) return;
            event.preventDefault();
            setOpen(true);
            setActive((index) => (!listVisible || index <= 0 ? count - 1 : index - 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (listVisible && active >= 0 && options[active]) go(hrefFor(options[active]));
            else if (query) go(`/company/${encodeURIComponent(query)}`);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            if (popupVisible) {
                setOpen(false);
                setActive(-1);
            } else if (onEscape) {
                onEscape();
            } else if (value) {
                setValue('');
            }
        } else if (event.key === 'Tab') {
            setOpen(false);
        }
    };

    const status = !popupVisible
        ? ''
        : options.length === 0
          ? `No matches. Press Enter to look up ${query}.`
          : `${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} and ${funds.length} fund${funds.length === 1 ? '' : 's'}. Use the arrow keys to choose.`;

    const renderOption = (result: EntityResult, index: number) => (
        <div
            key={`${result.type}-${result.cik}-${result.ticker ?? ''}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => go(hrefFor(result))}
            onMouseEnter={() => setActive(index)}
            className={cn('flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2', index === active ? 'bg-surface-2' : 'bg-surface')}
        >
            <span className="min-w-0 truncate text-base text-ink">{result.name}</span>
            {result.type === 'company' ? (
                <span className="shrink-0 font-mono text-sm font-semibold text-ink-muted">{result.ticker || `CIK ${cikPath(result.cik)}`}</span>
            ) : (
                <span className="shrink-0 text-sm text-ink-muted">
                    Fund · CIK <span className="font-mono">{cikPath(result.cik)}</span>
                </span>
            )}
        </div>
    );

    return (
        <div ref={wrapperRef} className={cn('relative min-w-0', className)}>
            <label htmlFor={inputId} className="sr-only">
                {PLACEHOLDER}
            </label>
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                <input
                    ref={inputRef}
                    id={inputId}
                    type="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={listVisible}
                    aria-controls={listId}
                    aria-activedescendant={listVisible && active >= 0 ? optionId(active) : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    placeholder={PLACEHOLDER}
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setOpen(true)}
                    className={cn(controlClass, 'h-10 pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden')}
                />
                {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-muted" aria-hidden />}
            </div>

            <div
                hidden={!popupVisible}
                className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-rule bg-surface shadow-lg md:min-w-[22rem]"
            >
                <div id={listId} role="listbox" aria-label="Search results" className="max-h-[min(26rem,70vh)] overflow-y-auto py-1">
                    {companies.length > 0 && (
                        <div role="group" aria-label="Companies">
                            <div aria-hidden className="px-3 pb-1 pt-2 text-sm font-semibold text-ink-muted">Companies</div>
                            {companies.map((result, index) => renderOption(result, index))}
                        </div>
                    )}
                    {funds.length > 0 && (
                        <div role="group" aria-label="Funds" className={cn(companies.length > 0 && 'mt-1 border-t border-rule')}>
                            <div aria-hidden className="px-3 pb-1 pt-2 text-sm font-semibold text-ink-muted">Funds</div>
                            {funds.map((result, index) => renderOption(result, companies.length + index))}
                        </div>
                    )}
                </div>
                {answered && options.length === 0 && (
                    <p className="px-3 py-2 text-sm text-ink-muted">
                        No matches. Press Enter to look up &ldquo;{query}&rdquo;.
                    </p>
                )}
                {answered && response.warnings.length > 0 && (
                    <p className="border-t border-rule px-3 py-2 text-sm text-ink-muted">{response.warnings.join(' ')}</p>
                )}
            </div>
            <span id={statusId} className="sr-only" aria-live="polite">
                {status}
            </span>
        </div>
    );
}
