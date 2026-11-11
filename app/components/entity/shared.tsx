"use client";

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Notice, SectionHeader, SkeletonRows } from '../ui';

export interface Loadable<T> {
    data: T | null;
    error: string | null;
    loading: boolean;
    retry: () => void;
}

/**
 * Loads one block of an entity page. Each block loads on its own, so a slow or failing source (say, Form 4 parsing)
 * never holds up the rest of the page. Pass `null` to skip loading (e.g. while a prerequisite is unknown).
 */
export function useLoad<T>(load: (() => Promise<T>) | null, deps: unknown[]): Loadable<T> {
    const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: Boolean(load) });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!load) return;
        let cancelled = false;
        load()
            .then((data) => {
                if (!cancelled) setState({ data, error: null, loading: false });
            })
            .catch((error: unknown) => {
                if (!cancelled) setState({ data: null, error: error instanceof Error ? error.message : 'This section did not load.', loading: false });
            });
        return () => {
            cancelled = true;
        };
        // `load` is recreated every render; the caller's deps decide when to reload.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, attempt]);

    const retry = useCallback(() => {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        setAttempt((value) => value + 1);
    }, []);

    return { ...state, retry };
}

export async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok) throw new Error(body?.error || `The request failed (${response.status}).`);
    if (!body) throw new Error('The server sent an empty response.');
    return body;
}

/**
 * One section of a company or fund page: a heading with a one-line intro and actions, then a skeleton while loading,
 * an error with Try again, an empty message, or the content.
 */
export function PageBlock<T>({
    id,
    title,
    intro,
    actions,
    state,
    empty,
    isEmpty,
    children,
}: {
    id: string;
    title: string;
    intro?: ReactNode;
    actions?: ReactNode;
    state: Loadable<T>;
    /** Shown when the data loaded but there's nothing to show. */
    empty?: ReactNode;
    isEmpty?: (data: T) => boolean;
    children: (data: T) => ReactNode;
}) {
    return (
        <section aria-labelledby={id} className="space-y-5 border-t border-rule pt-8">
            <SectionHeader id={id} title={title} intro={intro} actions={actions} />
            {state.loading && !state.data && <SkeletonRows rows={5} label={`Loading ${title.toLowerCase()}`} />}
            {state.error && (
                <Notice
                    tone="error"
                    title={`${title} didn’t load`}
                    action={<Button size="sm" onClick={state.retry}>Try again</Button>}
                >
                    {state.error}
                </Notice>
            )}
            {state.data && (isEmpty?.(state.data) ? <p className="text-base text-ink-muted">{empty}</p> : children(state.data))}
        </section>
    );
}
