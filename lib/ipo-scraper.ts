
import { parseStringPromise } from 'xml2js';
import * as cheerio from 'cheerio';
import { fetchFilingContent, SecSubmission } from './sec-client';

const SEC_USER_AGENT = "ForensicAnalyzer contact@example.com";

export interface IpoFiling {
    cik: string;
    companyName: string;
    form: string;
    filingDate: string;
    accessionNumber: string;
    reportUrl: string; // The specific document URL (htm)
    pricing?: {
        sharesOffered?: string;
        priceRange?: string;
        proposedSymbol?: string;
        exchange?: string;
        underwriters?: string;
        estimatedValuation?: string; // Market Cap (Price * Outstanding)
        dealSize?: string; // Amount Raised (Price * Offered)
        sharesOutstanding?: string; // For calculation
        useOfProceeds?: string; // Extracted summary
    };
    isTrueIpo?: boolean; // false if likely a secondary/resale or uplisting
    offeringType?: 'IPO' | 'Uplisting' | 'Secondary'; // Classification
    financials?: {
        revenue?: string;
        netIncome?: string;
        totalAssets?: string;
    };
}

// Helper to clean text
function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Fetches recent filings of specific types using the SEC Browse EDGAR Atom feed.
 * This is more reliable for "latest by type" than EFTS in some cases.
 */
async function fetchFilingsByType(type: string, count: number = 100): Promise<any[]> {
    // https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=S-1&owner=include&count=100&output=atom
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${type}&owner=include&count=${count}&output=atom`;

    console.log(`[IPO Scraper] Fetching ${type} from ${url}`);

    try {
        const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
        if (!res.ok) throw new Error(`Failed to fetch ${type}: ${res.status}`);

        const xml = await res.text();
        const result = await parseStringPromise(xml, { explicitArray: false });

        if (result.feed && result.feed.entry) {
            const entries = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];
            return entries;
        }
        return [];
    } catch (e) {
        console.error(`[IPO Scraper] Error fetching ${type}`, e);
        return [];
    }
}

export async function fetchRecentIpoFilings(startDate: string, endDate: string): Promise<IpoFiling[]> {
    const types = ['S-1', 'S-1/A', 'F-1', 'F-1/A'];
    let allFilings: IpoFiling[] = [];

    // 1. Fetch Lists
    for (const type of types) {
        const entries = await fetchFilingsByType(type, 100);

        for (const entry of entries) {
            // entry.updated is ISO date (e.g. 2026-01-15T15:00:00-05:00)
            const dateStr = entry.updated.split('T')[0];

            if (dateStr >= startDate && dateStr <= endDate) {
                // Parse Title for Company Name / CIK? 
                // Title format: "S-1 - Company Name (0000123456) (Filer)"
                const title = entry.title;
                const companyMatch = title.match(/- (.+) \(/);
                const cikMatch = title.match(/\((\d{10})\)/);

                const companyName = companyMatch ? companyMatch[1].trim() : "Unknown";
                // entry.link.$.href -> https://www.sec.gov/Archives/edgar/data/123456/000...-index.htm
                const link = entry.link.$.href;

                // Extract CIK/Acc from Link
                const urlParts = link.split('/');
                let cik = urlParts[urlParts.length - 2];
                let acc = urlParts[urlParts.length - 1].replace('-index.htm', '');

                // Check if we have the standard structure: data/{cik}/{acc_clean}/{file}
                // If the second to last part is the accession number (clean), then CIK is before that.
                if (cik.length > 10 && /^\d+$/.test(cik)) {
                    // The part before the file is the accession directory (clean)
                    acc = urlParts[urlParts.length - 1].replace('-index.htm', ''); // Keep dashed version for reference if needed, OR just use the directory
                    // Actually, we usually want the Dashed version for 'accessionNumber' field usually displayed to users?
                    // But strictly, we can derive dashboard from clean.
                    // IMPORTANT: 'accessionNumber' in my interface is implied to be dashed usually.
                    // But let's assume valid.

                    cik = urlParts[urlParts.length - 3];
                }

                console.log(`[IPO Scraper] Parsed Link: ${link} -> CIK: ${cik}, Acc: ${acc}`);

                // We need the PRIMARY DOCUMENT url. The atom feed gives the index page.
                // We'll construct the document URL best-effort or fetch index.
                // Standard convention: https://www.sec.gov/Archives/edgar/data/{cik}/{acc_no_dash}/{primary_doc}
                // But we don't know the primary doc name without fetching index.
                // WE WILL FETCH INDEX JSON to find the document.

                allFilings.push({
                    cik,
                    companyName,
                    form: type,
                    filingDate: dateStr,
                    accessionNumber: acc,
                    reportUrl: link // Temporary, will resolve later
                });
            }
        }
    }

    // Sort by date desc
    allFilings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

    // Deduplicate by Accession Number
    const uniqueFilings = Array.from(new Map(allFilings.map(item => [item.accessionNumber, item])).values());

    return uniqueFilings;
}

/**
 * Resolves the primary document URL (HTML) from the filing's index page.
 */
export async function resolvePrimaryDocument(filing: IpoFiling): Promise<string | null> {
    // Construct index.json URL
    // https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/index.json
    const accClean = filing.accessionNumber.replace(/-/g, '');
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(filing.cik)}/${accClean}/index.json`;
    console.log(`[resolvePrimaryDocument] Fetching index: ${indexUrl}`);

    try {
        const res = await fetch(indexUrl, { headers: { "User-Agent": SEC_USER_AGENT } });
        if (!res.ok) {
            console.error(`[resolvePrimaryDocument] Failed to fetch index options: ${res.status}`);
            return null;
        }

        const data = await res.json();
        // Look for the main html file. Usually type matching the form or 'S-1'
        // or just the first .htm file that isn't an exhibit?
        // best guess: look for document type 'S-1' or 'F-1'

        // Log items for debugging
        // console.log("Items:", data.directory.item.map((i: any) => `${i.name} (${i.type})`));

        // Priority 1: Exact form text match (e.g. "S-1")
        let item = data.directory.item.find((i: any) => i.type === filing.form);

        // Priority 2: "Complete Submission Text File" -- actually we want HTML usually.
        // But often the main doc has type like "S-1" or "S-1/A".

        // Priority 3: First non-exhibit, non-xsl HTML file that looks like the primary doc.
        // Avoid "R1.htm" (XBRL report)
        if (!item) {
            item = data.directory.item.find((i: any) =>
                i.name.endsWith('.htm') &&
                !i.name.includes('xsl') &&
                !i.name.startsWith('R') && // fast check for R1, R2...
                (i.type.includes(filing.form) || i.type === 'S-1' || i.type === 'F-1')
            );
        }

        // Priority 4: Search for largest HTM file?
        if (!item) {
            const htmFiles = data.directory.item.filter((i: any) => i.name.endsWith('.htm') && !i.name.includes('xsl'));
            if (htmFiles.length > 0) {
                // sort by size desc
                htmFiles.sort((a: any, b: any) => (b.size || 0) - (a.size || 0));
                item = htmFiles[0];
            }
        }

        if (item) {
            console.log(`[resolvePrimaryDocument] Selected: ${item.name} (${item.type}) Size: ${item.size}`);
            return `https://www.sec.gov/Archives/edgar/data/${parseInt(filing.cik)}/${accClean}/${item.name}`;
        }
        return null;
    } catch (e) {
        console.error("Error resolving doc", e);
        return null;
    }
}

export async function parseIpoData(html: string): Promise<Partial<IpoFiling>> {
    const $ = cheerio.load(html);
    const data: Partial<IpoFiling> = { pricing: {}, financials: {} };

    const text = $('body').text().replace(/\s+/g, ' '); // Normalized whitespace

    // --- Heuristics ---


    // 0. Primary Offering Check (IPO or Uplisting/New Shares)
    // User wants:
    // 1. True IPOs ("This is the initial public offering")
    // 2. Uplistings/New Shares ("The company is increasing the number of shares")
    // Filter OUT: Pure secondaries (Selling shareholders only)

    const lowerText = text.toLowerCase().slice(0, 50000); // Check first 50k chars (headers can be long)

    // Check 1: Explicit IPO ("This is the initial public offering")
    const isStrictIpo = /this\s+is\s+(?:the|an|our)\s+initial\s+public\s+offering/i.test(lowerText);

    // Check 2: Primary Offering (We/The Company are selling shares)
    // keywords: "we are offering", "shares offered by us", "shares to be sold by us", "the company is offering"
    const isPrimaryOffering = /we\s+are\s+offering|shares\s+offered\s+by\s+us|shares\s+to\s+be\s+sold\s+by\s+us|the\s+company\s+is\s+offering|shares\s+offered\s+by\s+the\s+company/i.test(lowerText);

    // Decision: Keep if either is true.
    data.isTrueIpo = isStrictIpo || isPrimaryOffering;

    if (isStrictIpo) {
        data.offeringType = 'IPO';
    } else if (isPrimaryOffering) {
        data.offeringType = 'Uplisting';
    } else {
        data.offeringType = 'Secondary';
    }

    // 1. Proposed Symbol
    // Priority: Ordinary Shares / Class A / Common Stock > Units (fallback)
    // Users want the actual stock symbol, not the unit symbol
    const symbolBlacklist = new Set(["OUR", "THE", "AND", "COM", "STK", "INC", "CORP", "LTD", "PLC", "CLASS", "SHARES", "STOCK", "OVER", "WILL", "HAVE", "BEEN", "UNITS", "WARRA"]);

    let symbolFound = "";

    // Attempt 1: "Ordinary Shares: 'PAAC'" or "Class A ... : 'HIFI'"
    const ordinaryMatch = text.match(/(?:Ordinary\s+Shares?|Class\s+[A-C]\s+(?:common\s+)?(?:stock|shares?))[:\s]*["'\u201c]?([A-Z]{3,5})["'\u201d]?/i);
    if (ordinaryMatch && !symbolBlacklist.has(ordinaryMatch[1].toUpperCase())) {
        symbolFound = ordinaryMatch[1].toUpperCase();
    }

    // Attempt 2: "Proposed ticker symbol" or "Proposed trading symbol: 'HIFI'"
    if (!symbolFound) {
        const tickerMatch = text.match(/Proposed\s+(?:ticker|trading)?\s*symbol[s]?[:\s]+["'“]?([A-Z]{3,5})["'”]?/i);
        if (tickerMatch && !symbolBlacklist.has(tickerMatch[1].toUpperCase())) {
            symbolFound = tickerMatch[1].toUpperCase();
        }
    }

    // Attempt 3: "Trading Symbol" fallback
    if (!symbolFound) {
        const fallbackSymbol = text.match(/trading\s+symbol[:\s]+["'\u201c]?([A-Z]{3,5})["'\u201d]?/i);
        if (fallbackSymbol && !symbolBlacklist.has(fallbackSymbol[1].toUpperCase())) {
            symbolFound = fallbackSymbol[1].toUpperCase();
        }
    }

    // Attempt 4: Units symbol as last resort (for SPACs that only list units)
    if (!symbolFound) {
        const unitsMatch = text.match(/Units[:\s]+["'\u201c]?([A-Z]{3,5}U?)["'\u201d]?/i);
        if (unitsMatch && !symbolBlacklist.has(unitsMatch[1].toUpperCase())) {
            symbolFound = unitsMatch[1].toUpperCase();
        }
    }

    if (symbolFound) {
        data.pricing!.proposedSymbol = symbolFound;
    }

    // 1b. Exchange Listing
    // Pattern: "list our ... on the Nasdaq Capital Market" or "NYSE American"
    const exchangePatterns = [
        /list(?:ed|ing)?[\s\S]{0,50}?(?:on\s+)?(?:the\s+)?(Nasdaq\s+(?:Capital\s+Market|Global\s+(?:Select\s+)?Market)|NYSE\s+(?:American)?|New\s+York\s+Stock\s+Exchange)/i,
        /(?:Nasdaq\s+(?:Capital\s+Market|Global\s+(?:Select\s+)?Market)|NYSE\s+(?:American)?)[\s\S]{0,30}?(?:under\s+the\s+symbol)/i
    ];

    for (const pattern of exchangePatterns) {
        const exchangeMatch = text.match(pattern);
        if (exchangeMatch) {
            let exchange = exchangeMatch[1] || exchangeMatch[0];
            // Clean up
            exchange = exchange.replace(/under\s+the\s+symbol.*/i, '').trim();
            if (exchange.length > 5 && exchange.length < 40) {
                data.pricing!.exchange = exchange;
                break;
            }
        }
    }

    // 1c. Underwriters
    // Priority 1: Look for known underwriter names NEAR underwriting keywords
    // This avoids false positives from executive bios ("worked at Goldman Sachs")
    const knownUnderwriters = [
        'Clear Street', 'Goldman Sachs', 'Morgan Stanley', 'J.P. Morgan', 'JPMorgan',
        'Credit Suisse', 'Citigroup', 'Bank of America', 'Barclays', 'UBS',
        'Deutsche Bank', 'Jefferies', 'Cantor Fitzgerald', 'Maxim Group',
        'Roth Capital', 'EF Hutton', 'ThinkEquity', 'Aegis Capital',
        'Chardan Capital', 'Boustead Securities', 'B. Riley', 'Ladenburg Thalmann',
        'Kingswood Capital', 'Alexander Capital', 'Network 1', 'WestPark Capital',
        'Revere Securities', 'Univest Securities', 'Brookline Capital',
        'Dawson James', 'Katalyst Securities', 'Joseph Gunnar'
    ];
    const foundUnderwriters: string[] = [];

    // Find all positions of underwriting-related keywords
    const underwriterKeywords = /(?:underwriter|book-running\s+manager|lead\s+manager)/gi;
    const keywordMatches = [...text.matchAll(underwriterKeywords)];

    for (const uw of knownUnderwriters) {
        // Check if this underwriter name appears within 300 chars of any underwriting keyword
        const uwIndex = text.indexOf(uw);
        if (uwIndex !== -1) {
            for (const kwMatch of keywordMatches) {
                const kwIndex = kwMatch.index!;
                // Check proximity: name should be within 300 chars before or after keyword
                if (Math.abs(uwIndex - kwIndex) < 300) {
                    if (!foundUnderwriters.includes(uw)) {
                        foundUnderwriters.push(uw);
                    }
                    break;
                }
            }
        }
    }

    if (foundUnderwriters.length > 0) {
        data.pricing!.underwriters = foundUnderwriters.slice(0, 2).join(', ');
    }

    // Priority 2: Regex fallback (only if no known underwriters found)
    if (!data.pricing!.underwriters) {
        // Look for "Underwriter: [Name]" or "[Name] is acting as ... underwriter"
        const underwriterPatterns = [
            /(?:sole\s+)?(?:book-running\s+)?(?:underwriter|manager)[s]?\s+(?:is|are)\s+([A-Z][A-Za-z\s&,.]+?(?:LLC|Inc|LP|LLP|Capital|Securities|Group|Partners))/i,
            /([A-Z][A-Za-z\s&]+?(?:LLC|Inc|LP|LLP|Capital|Securities|Group|Partners))\s+(?:is|are)\s+(?:acting\s+as\s+)?(?:the\s+)?(?:sole\s+)?underwriter/i
        ];

        for (const pattern of underwriterPatterns) {
            const underwriterMatch = text.match(pattern);
            if (underwriterMatch) {
                let underwriters = underwriterMatch[1].trim();
                // Clean up and validate - must look like a company name
                underwriters = underwriters.replace(/[,.]$/, '').trim();
                // Reject if it contains common non-name words
                if (!/^(offering|the|a|an|to|for|on|in|with|as)\s/i.test(underwriters) &&
                    underwriters.length > 5 && underwriters.length < 80) {
                    data.pricing!.underwriters = underwriters;
                    break;
                }
            }
        }
    }

    // Capture Use of Proceeds (Snippet)
    // Strategy: Find ALL "Use of Proceeds" headers that look like headers.
    // 1. Skip TOCs.
    // 2. Skip embedded phrases ("the use of proceeds").
    // 3. If we have > 1 valid candidate, pick the second (skip Summary).

    const validProceedsCandidates: string[] = [];
    const potentialHeaders = [...text.matchAll(/Use of proceeds/gi)];

    for (const match of potentialHeaders) {
        const contextAfter = text.slice(match.index! + 15, match.index! + 300);
        const contextBefore = text.slice(Math.max(0, match.index! - 50), match.index!);

        // 1. Skip if embedded in a sentence (preceded by word character)
        // e.g. "regarding use of proceeds"
        if (/[a-z]$/i.test(contextBefore.trim())) continue;

        // 2. Cross-reference detection: "See 'Use of Proceeds'"
        if (/(?:see|captioned|entitled|section)\s+["']?$/i.test(contextBefore.trim())) continue;

        // 3. TOC Detection:
        if (/^[\s.]*\d+/.test(contextAfter)) continue; // Dots/Digits
        if (/^\s*\d+\s+[A-Z]/.test(contextAfter)) continue; // Immediate Header "89 DIVIDEND"
        const tocPatternCount = (contextAfter.slice(0, 100).match(/\d+\s+[A-Z]{3,}/g) || []).length;
        if (tocPatternCount > 1) continue;

        // This looks like a valid header.
        let snippet = contextAfter.trim();

        // 4. Garbage Check: Starts with quote or "for additional info" (tail of cross-ref)
        if (/^["'”]/.test(snippet) || /^for\s+additional\s+information/i.test(snippet)) continue;

        validProceedsCandidates.push(snippet);
    }

    // Selection Logic
    if (validProceedsCandidates.length > 0) {
        // If we have at least 2, candidates[0] is Summary, candidates[1] is Main.
        // Prefer the second one.
        const bestCandidate = validProceedsCandidates.length > 1 ? validProceedsCandidates[1] : validProceedsCandidates[0];

        // Clean it up
        let snippet = bestCandidate;
        snippet = snippet.split(/(?:See|The info|In accordance|Pending)/)[0];
        if (snippet.length > 300) snippet = snippet.slice(0, 300) + "...";

        data.pricing!.useOfProceeds = snippet;
    } else {
        // Fallback: Sentence Search "We intend/expect to use..."
        const useOfProceedsSentence = text.match(/(?:We|The company)\s+intend(?:s|ed)?\s+to\s+use\s+(?:the|our)\s+(?:net\s+)?proceeds/i);
        if (useOfProceedsSentence) {
            const idx = useOfProceedsSentence.index!;
            let snippet = text.slice(idx, idx + 300).split('See "')[0];
            data.pricing!.useOfProceeds = snippet.trim() + "...";
        }
    }

    // 2. Shares Offered
    // Priority 1: Look for "THE OFFERING" section table (most accurate for IPOs)
    // Pattern: "Shares of ... common stock offered" followed by a number
    const offeringSectionMatch = text.match(/(?:THE OFFERING|Summary of the Offering)[\s\S]{0,2000}?(?:Shares of[\w\s]+(?:common stock|ordinary shares)\s+offered[^\d]*)(\d{1,3}(?:,\d{3})+)/i);

    // Priority 2: Direct "X shares of Class A common stock" pattern
    const classAMatch = text.match(/(\d{1,3}(?:,\d{3})+)\s+shares\s+of\s+Class\s+A\s+common\s+stock(?!\s+outstanding)/i);

    // Priority 3: Units for SPACs
    const unitsMatch = text.match(/(\d{1,3}(?:,\d{3})*)\s+units/i);

    // Priority 4: Fallback loose match
    const sharesMatch = text.match(/(?:Number of shares|Shares(?: of .*?)? offered).*?(\d{1,3}(?:,\d{3})*)\s+shares/i);

    if (offeringSectionMatch) {
        data.pricing!.sharesOffered = offeringSectionMatch[1];
    } else if (classAMatch) {
        data.pricing!.sharesOffered = classAMatch[1];
    } else if (unitsMatch && text.includes("per unit")) {
        data.pricing!.sharesOffered = unitsMatch[1] + " Units";
    } else if (sharesMatch) {
        data.pricing!.sharesOffered = sharesMatch[1];
    }

    // 3. Price Range
    // SPAC Logic: "$10.00 per unit"
    let lowPrice = 0;
    let highPrice = 0;

    const unitPriceMatch = text.match(/at\s+\$(\d+\.\d{2})\s+per\s+unit/i);
    // Exclude "par value" from price matching by checking negative lookbehind or just avoiding the phrase?
    // Regex: Price of $X.XX ... (but NOT par value)
    const priceRangeMatch = text.match(/(?:between|range of)\s*\$(\d+\.?\d*)\s+and\s+\$(\d+\.?\d*)/i);
    const offeringPriceMatch = text.match(/offering\s+price\s+of\s+\$(\d+\.\d{2})/i);
    const closingPriceMatch = text.match(/closing\s+price\s+(?:of|is|was)\s+\$(\d+\.\d{2})/i); // Explicit closing price logic

    // "Assumed offering price"
    const singlePriceMatch = text.match(/(?:assumed|proposed).*?price of\s+\$(\d+\.?\d*)/i);

    if (unitPriceMatch) {
        data.pricing!.priceRange = `$${unitPriceMatch[1]} / Unit`;
        lowPrice = parseFloat(unitPriceMatch[1]);
        highPrice = lowPrice;
    } else if (priceRangeMatch) {
        data.pricing!.priceRange = `$${priceRangeMatch[1]} - $${priceRangeMatch[2]}`;
        lowPrice = parseFloat(priceRangeMatch[1]);
        highPrice = parseFloat(priceRangeMatch[2]);
    } else if (offeringPriceMatch) {
        data.pricing!.priceRange = `$${offeringPriceMatch[1]}`;
        lowPrice = parseFloat(offeringPriceMatch[1]);
        highPrice = lowPrice;
    } else if (singlePriceMatch) {
        data.pricing!.priceRange = `$${singlePriceMatch[1]}`;
        lowPrice = parseFloat(singlePriceMatch[1]);
        highPrice = lowPrice;
    } else if (closingPriceMatch) {
        // It's a reference to closing price (Uplisting/Follow-on)
        data.pricing!.priceRange = `$${closingPriceMatch[1]} (Last Close)`;
        lowPrice = parseFloat(closingPriceMatch[1]);
        highPrice = lowPrice;
    } else {
        // Broad match fallback (Risky for par value)
        const broadPriceMatch = text.match(/price of\s+\$(\d+\.?\d*)/i);
        if (broadPriceMatch && parseFloat(broadPriceMatch[1]) > 0.05) {
            data.pricing!.priceRange = `$${broadPriceMatch[1]}`;
            lowPrice = parseFloat(broadPriceMatch[1]);
            highPrice = lowPrice;
        }
    }

    // 4. Shares Outstanding (Post-Offering)
    // Priority 1: "THE OFFERING" section - "Shares outstanding immediately after this offering: 23,750,000"
    const outstandingSectionMatch = text.match(/(?:THE OFFERING|Summary of the Offering)[\s\S]{0,3000}?(?:Shares of[\w\s]+(?:common stock|ordinary shares)\s+outstanding[^\d]*)(\d{1,3}(?:,\d{3})+)/i);

    // Priority 2: Direct match with "after this offering"
    const outstandingAfterMatch = text.match(/(\d{1,3}(?:,\d{3})+)\s+shares(?:\s+of[^,]+)?\s+(?:to be\s+)?outstanding(?:\s+immediately)?\s+after\s+(?:this|the)\s+offering/i);

    let sharesOutstanding = 0;

    if (outstandingSectionMatch) {
        const valStr = outstandingSectionMatch[1];
        data.pricing!.sharesOutstanding = valStr;
        sharesOutstanding = parseFloat(valStr.replace(/,/g, ''));
    } else if (outstandingAfterMatch) {
        const valStr = outstandingAfterMatch[1];
        // Basic sanity check: > 3 digits and < 15 chars
        if (valStr.length >= 3 && valStr.length < 15) {
            data.pricing!.sharesOutstanding = valStr;
            sharesOutstanding = parseFloat(valStr.replace(/,/g, ''));
        }
    }

    // Fallback: SPAC/Founder Share Logic
    // "founder shares would represent 20% of the outstanding shares after this offering"
    if (sharesOutstanding === 0 && data.pricing!.sharesOffered) {
        const founderMatch = text.match(/founder\s+shares\s+(?:would|will|represent)\s+represent\s+(\d+(?:\.\d+)?)%\s+of\s+(?:the\s+)?outstanding\s+shares/i);
        if (founderMatch) {
            const founderPercent = parseFloat(founderMatch[1]); // e.g. 20 or 25
            const publicPercent = 100 - founderPercent; // e.g. 75 or 80

            // Get Offered Count
            const cleanOffered = data.pricing!.sharesOffered.replace(/,/g, '').replace(' Units', '').replace(' Shares', '');
            const offeredNum = parseFloat(cleanOffered);

            if (offeredNum > 0 && publicPercent > 0) {
                // Total = Offered / (Public% / 100)
                const total = Math.floor(offeredNum / (publicPercent / 100));
                sharesOutstanding = total;
                data.pricing!.sharesOutstanding = total.toLocaleString(); // Store as string with commas
            }
        }
    }

    // 5. Calculate Deal Size (Raise) & Valuation (Market Cap)
    if (lowPrice > 0) {
        const formatVal = (v: number) => {
            if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
            return `$${(v / 1e6).toFixed(1)}M`;
        };

        // A. Deal Size (Amount Raised = Price * Shares Offered)
        let sharesOfferedNum = 0;
        if (data.pricing!.sharesOffered) {
            const clean = data.pricing!.sharesOffered.replace(/,/g, '').replace(' Units', '');
            sharesOfferedNum = parseInt(clean);
        }

        if (sharesOfferedNum > 0) {
            const lowRaise = (lowPrice * sharesOfferedNum);
            const highRaise = (highPrice * sharesOfferedNum);

            if (lowPrice === highPrice) {
                data.pricing!.dealSize = formatVal(lowRaise);
            } else {
                data.pricing!.dealSize = `${formatVal(lowRaise)} - ${formatVal(highRaise)}`;
            }
        }

        // B. Market Cap (Valuation = Price * Shares Outstanding)
        if (sharesOutstanding > 0) {
            const lowVal = (lowPrice * sharesOutstanding);
            const highVal = (highPrice * sharesOutstanding);

            if (lowPrice === highPrice) {
                data.pricing!.estimatedValuation = formatVal(lowVal);
            } else {
                data.pricing!.estimatedValuation = `${formatVal(lowVal)} - ${formatVal(highVal)}`;
            }
        }
    }

    // 4. Financials (Revenue, Net Income, Total Assets)
    // We look for tables containing specific keywords.

    // Helper to extract value from a table row
    const extractValue = (keyword: RegExp, $table: any): string | undefined => {
        let val: string | undefined;
        $table.find('tr').each((_: any, tr: any) => {
            const $tr = $(tr);
            const rowText = $tr.text().replace(/\s+/g, ' ').trim();
            if (keyword.test(rowText)) {
                // Find the first numeric cell
                $tr.find('td').each((_: any, td: any) => {
                    const cellText = $(td).text().trim();
                    // Match ($123,456) or 123,456 or $123
                    const numMatch = cellText.match(/^\(?\$?[\d,]+(?:\.\d+)?\)?$/);
                    // Use the last valid number in the row (usually current period) or first?
                    // Often the first numeric column is the most recent.
                    if (numMatch && !val) {
                        val = cellText;
                    }
                });
            }
        });
        return val;
    };

    // Find Income Statement Table
    // Look for header "Statement of Operations" or "Statement of Comprehensive Income"
    // Then find the next table.
    // Loop through all tables is easier: find table with "Revenue" or "Net Income"
    $('table').each((i, table) => {
        const $table = $(table);
        const tableText = $table.text();

        // Income Statement Heuristic
        if (!data.financials?.revenue && (tableText.includes('Revenue') || tableText.includes('Sales')) && (tableText.includes('Net loss') || tableText.includes('Net income'))) {
            data.financials!.revenue = extractValue(/Total revenues?|Net sales?|Total net sales?/i, $table);
            data.financials!.netIncome = extractValue(/Net (loss|income)/i, $table);
        }

        // Balance Sheet Heuristic
        if (!data.financials?.totalAssets && tableText.includes('Total assets') && tableText.includes('Total liabilities')) {
            data.financials!.totalAssets = extractValue(/Total assets/i, $table);
        }
    });

    return data;
}
