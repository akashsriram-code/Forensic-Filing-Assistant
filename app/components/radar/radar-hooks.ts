"use client";

import { useState, useSyncExternalStore } from 'react';

/**
 * Row limit for a table with a "Show more" footer. Returns how many rows to show plus handlers for TableFooter.
 */
export function useShowMore(initial: number, step = initial) {
    const [limit, setLimit] = useState(initial);
    return {
        limit,
        showMore: () => setLimit((value) => value + step),
        showLess: limit > initial ? () => setLimit(initial) : undefined,
    };
}

const SM = '(min-width: 640px)';
const LG = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
    const queries = [window.matchMedia(SM), window.matchMedia(LG)];
    queries.forEach((query) => query.addEventListener('change', onChange));
    return () => queries.forEach((query) => query.removeEventListener('change', onChange));
}

function columnsNow(): number {
    if (window.matchMedia(LG).matches) return 3;
    if (window.matchMedia(SM).matches) return 2;
    return 1;
}

/** Columns of a `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` grid, so inline detail can follow the selected row. */
export function useGridColumns(): number {
    return useSyncExternalStore(subscribe, columnsNow, () => 1);
}
