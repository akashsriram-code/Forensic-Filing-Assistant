import { parseStringPromise } from 'xml2js';
import * as cheerio from 'cheerio';

const SEC_USER_AGENT = "ForensicAnalyzer contact@example.com"; // Replace with real info in prod

interface CompanyTicker {
    cik_str: number;
    ticker: string;
    title: string;
}

export interface SecSubmission {
    cik: string;
    entityType: string;
    sic: string;
    sicDescription: string;
    name: string;
    tickers: string[];
    exchanges: string[];
    ein: string;
    description: string;
    website: string;
    investorWebsite: string;
    category: string;
    fiscalYearEnd: string;
    stateOfIncorporation: string;
    stateOfIncorporationDescription: string;
    addresses: {
        mailing: {
            street1: string;
            city: string;
            stateOrCountry: string;
            zipCode: string;
            stateOfIncorporation: string;
        };
        business: {
            street1: string;
            city: string;
            stateOrCountry: string;
            zipCode: string;
            stateOfIncorporation: string;
        };
    };
    phone: string;
    flags: string;
    filings: {
        recent: {
            accessionNumber: string[];
            filingDate: string[];
            reportDate: string[];
            acceptanceDateTime: string[];
            act: string[];
            form: string[];
            fileNumber: string[];
            filmNumber: string[];
            items: string[];
            size: number[];
            isXBRL: number[];
            isInlineXBRL: number[];
            primaryDocument: string[];
            primaryDocDescription: string[];
        };
    };
}

export async function fetchCIK(query: string): Promise<string | null> {
    // 0. If I get a direct numeric CIK, I just pad it and return it immediately.
    if (/^\d{1,10}$/.test(query)) {
        return query.padStart(10, '0');
    }

    // 1. Try the standard company_tickers.json (Best for Public Companies / Tickers)
    try {
        const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
            headers: { "User-Agent": SEC_USER_AGENT },
            next: { revalidate: 86400 } // I'm caching this for a day because company tickers don't change that often.
        });

        if (response.ok) {
            const data = await response.json();
            const queryUpper = query.toUpperCase();
            const queryLower = query.toLowerCase();
            const entries = Object.values(data) as CompanyTicker[];

            // A. Exact Ticker Match
            let entry = entries.find((item) => item.ticker === queryUpper);

            // B. Exact Title Match (Case-insensitive)
            if (!entry) {
                entry = entries.find((item) => item.title.toLowerCase() === queryLower);
            }

            // C. Fuzzy Title Match (Contains)
            if (!entry) {
                const matches = entries.filter((item) => item.title.toLowerCase().includes(queryLower));
                if (matches.length > 0) {
                    matches.sort((a, b) => a.title.length - b.title.length);
                    entry = matches[0];
                }
            }

            if (entry && (entry as any).cik_str) {
                return (entry as any).cik_str.toString().padStart(10, '0');
            }
        }
    } catch (error) {
        console.warn("Standard CIK lookup failed, attempting text fallback...", error);
    }

    // 2. FALLBACK: cik-lookup-data.txt (Best for Private Funds / Non-Public Entities)
    // This file is huge (~37MB), so I stream it line-by-line to avoid memory explosions.
    console.log(`[CIK Lookup] Attempting fallback text search for: ${query}`);
    try {
        const response = await fetch("https://www.sec.gov/Archives/edgar/cik-lookup-data.txt", {
            headers: { "User-Agent": SEC_USER_AGENT },
            // No 'next: revalidate' here because 37MB is too big for Next.js Data Cache to handle reliably everywhere.
            // We rely on standard fetch.
        });

        if (!response.ok) return null;
        if (!response.body) return null;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const target = query.toUpperCase();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            let newlineIdx;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIdx);
                buffer = buffer.substring(newlineIdx + 1);

                // Format: COMPANY NAME:CIK:JUNK...
                // Example: BRIDGEWATER ASSOCIATES, LP:0001350694:
                // We use includes() because the name might be "PUBLIC INVESTMENT FUND - ... "
                if (line.includes(target)) {
                    const parts = line.split(':');
                    if (parts.length >= 2) {
                        const name = parts[0];
                        const cik = parts[1];

                        // Verify the name actually contains our query to avoid false positives in the junk data
                        if (name.includes(target)) {
                            console.log(`[CIK Lookup] Found match in text file: ${name} -> ${cik}`);
                            return cik.padEnd(10, '0').substring(0, 10); // Standardize CIK
                        }
                    }
                }
            }
        }

    } catch (error) {
        console.error("Error in fallback CIK search:", error);
    }

    return null;
}

export async function fetchSubmission(cik: string): Promise<SecSubmission | null> {
    try {
        const response = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
            headers: { "User-Agent": SEC_USER_AGENT },
            next: { revalidate: 3600 }
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error("Error fetching submission:", error);
        return null;
    }
}

export async function fetchFilingContent(url: string): Promise<string | null> {
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": SEC_USER_AGENT },
        });
        if (!response.ok) return null;
        return await response.text();
    } catch (error) {
        console.error("Error fetching filing content:", error);
        return null;
    }
}

export async function parse13F(xmlContent: string) {
    try {
        const result = await parseStringPromise(xmlContent, {
            tagNameProcessors: [(name) => name.split(':').pop() || name], // I'm stripping namespaces manually to make traversing the object easier.
            explicitArray: true
        });
        return result;
    } catch (e) {
        console.error("Error parsing 13F XML", e);
        return null;
    }
}

export function generateSecUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
    const accessionNoDash = accessionNumber.replace(/-/g, '');
    return `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNoDash}/${primaryDocument}`;
}
