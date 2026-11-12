/** Ticker -> CIK lookup from the SEC's company_tickers.json, the same source SCOUT's server uses. */
import { padCik } from './submissions';

export const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const TICKERS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, ... } -> { AAPL: "0000320193" } */
export function parseTickerMap(json: unknown): Record<string, string> {
    const map: Record<string, string> = {};
    if (!json || typeof json !== 'object') return map;
    for (const row of Object.values(json as Record<string, { cik_str?: number | string; ticker?: string }>)) {
        if (row?.ticker && row.cik_str != null) map[row.ticker.toUpperCase()] = padCik(row.cik_str);
    }
    return map;
}

/** A follow stores a ticker, or a bare CIK (all digits) for funds; SEC tickers use "-" where others use "." (BRK.B). */
export function resolveCik(ticker: string, map: Record<string, string>): string | null {
    const symbol = ticker.trim().toUpperCase();
    if (/^\d+$/.test(symbol)) return padCik(symbol);
    return map[symbol] ?? map[symbol.replace(/\./g, '-')] ?? null;
}
