"use client";

import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button, EmptyState, Notice, Skeleton, SkeletonRows } from '../ui';
import { errorMessage } from './model';

/** One search request's lifecycle, kept separately by each mode so loading and errors never leak across tabs. */
export interface RequestState<T> {
    loading: boolean;
    error: string | null;
    /** What the user searched for when the error or result was produced. */
    query: string | null;
    result: T | null;
}

/**
 * Runs a search and ignores responses that arrive after a newer search started. Keeps the previous result on screen
 * (dimmed) while the next one loads; clears it if the next one fails so stale numbers never sit under an error.
 */
export function useRequest<T, Q>(load: (query: Q) => Promise<T>) {
    const [state, setState] = useState<RequestState<T>>({ loading: false, error: null, query: null, result: null });
    const latest = useRef(0);

    const run = useCallback(
        async (query: Q, label: string) => {
            const id = ++latest.current;
            setState((prev) => ({ ...prev, loading: true, error: null, query: label }));
            try {
                const result = await load(query);
                if (id === latest.current) setState({ loading: false, error: null, query: label, result });
            } catch (error) {
                if (id === latest.current) setState({ loading: false, error: errorMessage(error), query: label, result: null });
            }
        },
        [load]
    );

    return [state, run] as const;
}

/** Inputs in one row with the submit button; wraps on mobile. Enter in any field submits. */
export function SearchForm({
    onSubmit,
    loading,
    submitLabel,
    children,
    className,
}: {
    onSubmit: () => void;
    loading: boolean;
    submitLabel: string;
    children: ReactNode;
    className?: string;
}) {
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
    };
    return (
        <form onSubmit={submit} className={cn('flex flex-col gap-3 sm:flex-row sm:items-start', className)} noValidate>
            {children}
            <Button type="submit" variant="primary" loading={loading} className="sm:mt-[1.625rem]">
                {submitLabel}
            </Button>
        </form>
    );
}

/** Pre-search state: what the mode answers, plus example searches that really run. */
export function ModeIntro({
    icon,
    title,
    children,
    examples,
}: {
    icon: ReactNode;
    title: string;
    children: ReactNode;
    examples: { id: string; label: string; run: () => void }[];
}) {
    return (
        <EmptyState
            icon={icon}
            title={title}
            actions={
                <>
                    <span className="sr-only">Try an example:</span>
                    {examples.map((example) => (
                        <Button key={example.id} size="sm" variant="secondary" onClick={example.run}>
                            {example.label}
                        </Button>
                    ))}
                </>
            }
        >
            {children}
        </EmptyState>
    );
}

export function RequestError({ title, message, advice, onRetry }: { title: string; message: string; advice: string; onRetry?: () => void }) {
    return (
        <Notice
            tone="error"
            title={title}
            action={onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button> : undefined}
        >
            <p>{message}</p>
            <p className="mt-1">{advice}</p>
        </Notice>
    );
}

/** First-load placeholder shaped like a result: takeaway lines, a stat row, a table. */
export function ResultSkeleton({ label }: { label: string }) {
    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <Skeleton className="h-7 w-full max-w-3xl" />
                <Skeleton className="h-7 w-2/3 max-w-2xl" />
                <Skeleton className="h-4 w-40" />
            </div>
            <div className="grid grid-cols-2 gap-6 border-y border-rule py-5 md:grid-cols-4">
                {['a', 'b', 'c', 'd'].map((key) => (
                    <div key={key} className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-8 w-20" />
                    </div>
                ))}
            </div>
            <SkeletonRows rows={6} label={label} />
        </div>
    );
}

/** Rows shown so far, starting at `step` and growing by `step`. Reset when the underlying list changes. */
export function useShowMore(step = 25) {
    const [limit, setLimit] = useState(step);
    return {
        limit,
        showMore: () => setLimit((value) => value + step),
        reset: () => setLimit(step),
    };
}

/** Wrapper that dims the previous result while a new one loads. */
export function Updating({ updating, children }: { updating: boolean; children: ReactNode }) {
    return (
        <div className={cn('space-y-10 transition-opacity', updating && 'pointer-events-none opacity-55')} aria-busy={updating || undefined}>
            {children}
        </div>
    );
}
