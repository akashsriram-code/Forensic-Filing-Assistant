"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';
import { cn } from '@/lib/cn';

/**
 * A word with a plain-English definition: dotted underline, definition on hover, keyboard focus or tap.
 * Text defaults to the glossary term; pass children to label it differently.
 */
export function Term({ id, children, className }: { id: GlossaryKey; children?: ReactNode; className?: string }) {
    const entry = GLOSSARY[id];
    const tipId = useId();
    const [pinned, setPinned] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!pinned) return;
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) {
                setPinned(false);
            }
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', close);
        };
    }, [pinned]);

    return (
        <span ref={ref} className={cn('group relative inline', className)}>
            <button
                type="button"
                aria-describedby={tipId}
                aria-expanded={pinned}
                onClick={() => setPinned((value) => !value)}
                className="cursor-help text-left underline decoration-ink-muted decoration-dotted underline-offset-4"
            >
                {children ?? entry.term}
            </button>
            <span
                id={tipId}
                role="tooltip"
                className={cn(
                    'pointer-events-none absolute left-0 top-full z-40 mt-2 w-72 max-w-[80vw] rounded-md border border-rule bg-surface p-3 text-left text-sm font-normal normal-case leading-relaxed tracking-normal text-ink shadow-lg',
                    'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100',
                    pinned && 'pointer-events-auto visible opacity-100'
                )}
            >
                <span className="block font-semibold">{entry.term}</span>
                <span className="mt-1 block text-ink-muted">{entry.definition}</span>
            </span>
        </span>
    );
}
