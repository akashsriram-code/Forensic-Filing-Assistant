import { Index } from "flexsearch";

const SEC_USER_AGENT = "ForensicAnalyzer contact@example.com";

interface CompanyTicker {
    cik_str: number;
    ticker: string;
    title: string;
}

let index: any = null;
let tickerMap: Map<string, CompanyTicker> = new Map();

export async function initializeIndex() {
    if (index) return; // Already initialized

    console.log("[SearchIndex] Initializing FlexSearch index...");

    try {
        const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
            headers: { "User-Agent": SEC_USER_AGENT },
            next: { revalidate: 86400 }
        });

        if (!response.ok) throw new Error("Failed to fetch tickers");

        const data = await response.json();
        const entries = Object.values(data) as CompanyTicker[];

        // Configure FlexSearch for forward matching (autocomplete style)
        index = new Index({
            tokenize: "forward",
            resolution: 9,
            cache: true // Cache results for speed
        });

        entries.forEach((entry) => {
            const id = entry.cik_str; // Use CIK as ID
            const text = `${entry.ticker} ${entry.title}`; // Index both ticker and name
            index.add(id, text);
            tickerMap.set(id.toString(), entry);
        });

        console.log(`[SearchIndex] Indexed ${entries.length} companies.`);

    } catch (error) {
        console.error("[SearchIndex] Initialization failed:", error);
    }
}

export async function searchTickers(query: string, limit: number = 10) {
    if (!index) await initializeIndex();

    if (!query || query.length < 1) return [];

    // Search returns IDs (CIKs)
    const results: number[] = index.search(query, limit);

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
