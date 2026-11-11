/**
 * Runs `fn` over `items` with at most `limit` calls in flight, keeping results in input order. Used to read several
 * SEC documents at once without going over EDGAR's fair-access rate (10 requests per second): `minIntervalMs` also
 * spaces out the start of each call.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
    options: { minIntervalMs?: number } = {}
): Promise<R[]> {
    const results = new Array<R>(items.length);
    const interval = Math.max(0, options.minIntervalMs ?? 0);
    let next = 0;
    let nextStartAt = 0;
    const waitForSlot = async () => {
        if (interval === 0) return;
        const now = Date.now();
        const startAt = Math.max(now, nextStartAt);
        nextStartAt = startAt + interval;
        if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now));
    };
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            await waitForSlot();
            results[index] = await fn(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
    return results;
}

/** Start spacing that keeps a route under EDGAR's 10 requests per second, with room for the submissions call. */
export const SEC_MIN_REQUEST_INTERVAL_MS = 125;
