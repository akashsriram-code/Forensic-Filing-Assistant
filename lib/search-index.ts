import { Index, type Id } from "flexsearch";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { SEC_USER_AGENT } from "./sec-http";

interface CompanyTicker {
    cik_str: number;
    ticker: string;
    title: string;
}

// Give up on the SEC ticker list after this, so autocomplete can't hang while EDGAR is slow.
const TICKERS_FETCH_TIMEOUT_MS = 10000;

let index: Index | null = null;
const tickerMap: Map<string, CompanyTicker> = new Map();

export async function initializeIndex() {
    if (index) return; // Already initialized

    console.log("[SearchIndex] Initializing FlexSearch index...");

    try {
        const response = await fetchWithTimeout("https://www.sec.gov/files/company_tickers.json", {
            headers: { "User-Agent": SEC_USER_AGENT },
            next: { revalidate: 86400 }
        }, TICKERS_FETCH_TIMEOUT_MS);

        if (!response.ok) throw new Error("Failed to fetch tickers");

        const data = await response.json();
        const entries = Object.values(data) as CompanyTicker[];

        // Configure FlexSearch for forward matching (autocomplete style)
        const nextIndex = new Index({
            tokenize: "forward",
            resolution: 9,
            cache: true // Cache results for speed
        });

        entries.forEach((entry) => {
            const id = entry.cik_str; // Use CIK as ID
            const text = `${entry.ticker} ${entry.title}`; // Index both ticker and name
            nextIndex.add(id, text);
            tickerMap.set(id.toString(), entry);
        });
        index = nextIndex;

        console.log(`[SearchIndex] Indexed ${entries.length} companies.`);

    } catch (error) {
        console.error("[SearchIndex] Initialization failed:", error);
    }
}

export async function searchTickers(query: string, limit: number = 10) {
    if (!index) await initializeIndex();

    if (!query || query.length < 1) return [];

    // Initialization logs its own error and leaves the index empty; the next call retries.
    if (!index) throw new Error("The SEC company list is unavailable right now.");

    // Search returns IDs (CIKs)
    const results = index.search(query, limit) as Id[];

    // Map IDs back to full objects
    return results.map(id => {
        const entry = tickerMap.get(id.toString());
        return entry ? {
            cik: entry.cik_str.toString().padStart(10, '0'),
            ticker: entry.ticker,
            title: entry.title
        } : null;
    }).filter(x => x !== null);
}
