"use client";

import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

const SPLIT = /[\n,;]+/;

export function splitTokens(value: string): string[] {
    return value.split(SPLIT).map((item) => item.trim()).filter(Boolean);
}

/**
 * Type a value and press Enter (or a comma) to add it as a chip. Pasting a comma, semicolon or newline separated list
 * adds every item. Backspace in the empty box removes the last chip.
 */
export function TokenInput({
    label,
    hint,
    placeholder,
    values,
    onChange,
    error,
    uppercase = false,
}: {
    label: string;
    hint?: string;
    placeholder?: string;
    values: string[];
    onChange: (values: string[]) => void;
    error?: string;
    /** Upper-case tokens that look like tickers (no spaces). */
    uppercase?: boolean;
}) {
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const [draft, setDraft] = useState('');

    const normalize = (token: string) => (uppercase && !/\s/.test(token) ? token.toUpperCase() : token);

    const add = (tokens: string[]) => {
        const next = [...values];
        for (const raw of tokens) {
            const token = normalize(raw);
            if (token && !next.some((existing) => existing.toLowerCase() === token.toLowerCase())) next.push(token);
        }
        onChange(next);
    };

    const commitDraft = () => {
        const tokens = splitTokens(draft);
        if (tokens.length > 0) add(tokens);
        setDraft('');
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
            if (draft.trim()) {
                event.preventDefault();
                commitDraft();
            } else if (event.key !== 'Enter') {
                event.preventDefault();
            }
        } else if (event.key === 'Backspace' && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
        }
    };

    const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
        const text = event.clipboardData.getData('text');
        if (SPLIT.test(text)) {
            event.preventDefault();
            add(splitTokens(`${draft},${text}`));
            setDraft('');
        }
    };

    return (
        <div className="min-w-0">
            <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
            <div
                className={cn(
                    'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5 transition-colors',
                    'focus-within:border-accent focus-within:outline-2 focus-within:outline-accent hover:border-ink-muted',
                    error ? 'border-loss' : 'border-rule-strong'
                )}
            >
                {values.map((value) => (
                    <span key={value} className="inline-flex items-center gap-1 rounded bg-surface-2 py-0.5 pl-2 pr-1 text-base text-ink">
                        {value}
                        <button
                            type="button"
                            aria-label={`Remove ${value}`}
                            onClick={() => onChange(values.filter((item) => item !== value))}
                            className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:bg-rule hover:text-ink"
                        >
                            <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                    </span>
                ))}
                <input
                    id={id}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    onBlur={commitDraft}
                    placeholder={values.length === 0 ? placeholder : 'Add another'}
                    aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
                    aria-invalid={error ? true : undefined}
                    className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-base text-ink placeholder:text-ink-muted/80 focus:outline-none"
                />
            </div>
            {hint && !error && <p id={hintId} className="mt-1.5 text-sm text-ink-muted">{hint}</p>}
            {error && <p id={errorId} className="mt-1.5 text-sm font-medium text-loss">{error}</p>}
        </div>
    );
}
