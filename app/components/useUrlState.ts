"use client";

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Read and update query parameters so a reporter can copy the address bar and send an editor the exact view.
 * Updates use router.replace (no new history entry per keystroke) and merge with the live URL, so several components
 * can each own their own parameters without overwriting one another.
 */
export function useUrlParams() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const setParams = useCallback(
        (patch: Record<string, string | null | undefined>) => {
            const params = new URLSearchParams(window.location.search);
            for (const [key, value] of Object.entries(patch)) {
                if (value === null || value === undefined || value === '') params.delete(key);
                else params.set(key, value);
            }
            const query = params.toString();
            const next = query ? `${pathname}?${query}` : pathname;
            if (next !== `${window.location.pathname}${window.location.search}`) router.replace(next, { scroll: false });
        },
        [pathname, router]
    );

    return { params: searchParams, setParams };
}

/**
 * Calls `run` once, after the first render, with the values a shared link carried. Does nothing when the link had none,
 * so ordinary visits still start on the empty "try an example" state.
 */
export function useRunFromUrlOnce(values: (string | null)[], run: (...values: string[]) => void) {
    const done = useRef(false);
    const initial = useRef(values);
    const runRef = useRef(run);

    useEffect(() => {
        runRef.current = run;
    });

    useEffect(() => {
        if (done.current) return;
        done.current = true;
        const start = initial.current;
        if (start.length > 0 && start.every((value) => value && value.trim())) {
            runRef.current(...(start as string[]));
        }
    }, []);
}
