

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import { parseStringPromise } from 'xml2js';

// Load environment variables
dotenv.config();

// --- Types ---

interface IndexEntry {
    cik: string;
    name: string;
    date: string;
    filename: string;
}

interface Holding {
    issuer: string;
    cusip: string | null;
    value: number;
    shares: number;
}

interface XmlHolding {
    nameofissuer?: string[];
    cusip?: string[];
    value?: string[];
    shrsorprnamt?: Array<{
        sshprnamt?: string[];
    }>;
}

interface ParsedXml {
    informationtable?: Array<{ infotable: XmlHolding[] }>;
    xml?: { informationtable: Array<{ infotable: XmlHolding[] }> };
    infotable?: XmlHolding[];
}

interface IndexItem {
    name: string;
    href: string;
}

interface DirectoryData {
    directory: {
        item: IndexItem[];
    };
}

// --- Configuration ---
const SEC_USER_AGENT = "ForensicAnalyzer contact@example.com";
const RATE_LIMIT_DELAY = 250; // ms (Values > 100ms help stay under 10reqs/sec)
const CONCURRENCY = 5; // Reduced from 20 to 5 to avoid triggering aggressive bans

// Quarters to ingest (Last two available: 2025 Q3 & Q2)
// Note: 2025 Q4 filings are not due until Feb 14, 2026
const QUARTERS = [
    { year: 2025, qtr: 3 },
    { year: 2025, qtr: 2 }
];

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
    console.error("Missing TURSO config");
    process.exit(1);
}

const turso = createClient({
    url: TURSO_URL,
    authToken: TURSO_TOKEN,
});

// --- Helper Functions ---

async function fetchWithRetry(url: string, maxRetries: number = 5): Promise<string | null> {
    let backoff = 5000; // Start with 5s wait
    let attempts = 0;

    // Infinite loop for 429s, limited loop for other errors
    while (true) {
        try {
            attempts++;
            const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });

            if (res.ok) return await res.text();

            if (res.status === 429) {
                console.warn(`[WARN] 429 Rate Limited on ${url}. Waiting ${backoff / 1000}s...`);
                await new Promise(r => setTimeout(r, backoff));
                // Cap backoff to 2 mins, but keep retrying forever
                backoff = Math.min(backoff * 2, 120000);
                continue;
            } else if (res.status === 404) {
                return null;
            } else {
                if (attempts > maxRetries) break;
                console.warn(`[WARN] HTTP ${res.status} on ${url}. Retrying in 2s...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            if (attempts > maxRetries) break;
            console.warn(`[WARN] Network error on ${url}: ${(e as Error).message}. Retrying in ${backoff / 1000}s...`);
            await new Promise(r => setTimeout(r, backoff));
            backoff = Math.min(backoff * 2, 60000);
        }
    }
    console.error(`[ERROR] Failed to fetch ${url} after ${attempts} attempts.`);
    return null;
}

async function fetchJsonWithRetry(url: string): Promise<DirectoryData | null> {
    try {
        const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
        if (res.ok) return await res.json() as unknown as DirectoryData;
    } catch (e) { }
    return null;
}

async function parse13F(xmlContent: string): Promise<ParsedXml | null> {
    try {
        const cleanXml = xmlContent.replace(/<([a-zA-Z0-9]+):/g, '<').replace(/<\/([a-zA-Z0-9]+):/g, '</');
        const result = await parseStringPromise(cleanXml, {
            explicitArray: true,
            ignoreAttrs: true,
            tagNameProcessors: [(name: string) => name.toLowerCase()]
        });
        return result as ParsedXml;
    } catch (e) { return null; }
}

async function extractHoldingsFromXml(parsed: ParsedXml): Promise<XmlHolding[]> {
    let rows: XmlHolding[] = [];
    const infoTable = parsed.informationtable || parsed.xml?.informationtable;
    if (infoTable && infoTable[0]?.infotable) {
        rows = infoTable[0].infotable;
    }
    if (!rows || rows.length === 0) {
        if (parsed.infotable) rows = parsed.infotable;
    }
    return rows;
}

async function downloadMasterIndex(year: number, qtr: number): Promise<IndexEntry[]> {
    const url = `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${qtr}/master.idx`;
    console.log(`Downloading index: ${url}`);
    const content = await fetchWithRetry(url);
    if (!content) return [];

    const lines = content.split('\n');
    const entries: IndexEntry[] = [];
    let processing = false;
    for (const line of lines) {
        if (line.startsWith('-----------')) {
            processing = true;
            continue;
        }
        if (!processing) continue;
        const parts = line.split('|');
        if (parts.length < 5) continue;
        if (parts[2] === '13F-HR') {
            entries.push({
                cik: parts[0],
                name: parts[1],
                date: parts[3],
                filename: parts[4].trim()
            });
        }
    }
    return entries;
}

async function processFiling(entry: IndexEntry, quarter: string): Promise<number> {
    const filenameParts = entry.filename.split('/');
    const txtName = filenameParts[filenameParts.length - 1];
    const accessionNumber = txtName.replace('.txt', '');
    const accessionNoDash = accessionNumber.replace(/-/g, '');

    // Check index.json
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(entry.cik)}/${accessionNoDash}/index.json`;
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));

    const indexData = await fetchJsonWithRetry(indexUrl);
    if (!indexData) return 0;

    const items = indexData.directory?.item || [];
    const xmlFiles = items.filter(i => i.name && i.name.toLowerCase().endsWith('.xml'));

    let holdings: XmlHolding[] = [];
    for (const file of xmlFiles) {
        const fileUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(entry.cik)}/${accessionNoDash}/${file.name}`;
        const xmlContent = await fetchWithRetry(fileUrl);
        if (!xmlContent) continue;

        const parsed = await parse13F(xmlContent);
        if (parsed) {
            const rows = await extractHoldingsFromXml(parsed);
            if (rows && rows.length > 0) {
                holdings = rows;
                break;
            }
        }
    }

    if (holdings.length === 0) return 0;

    const cleanHoldings: Holding[] = [];
    for (const h of holdings) {
        // Safe navigation for array access
        const nameNode = h.nameofissuer;
        const cusipNode = h.cusip;
        const valueNode = h.value;
        const shrsNode = h.shrsorprnamt;

        const issuer = (nameNode && nameNode[0] ? nameNode[0] : 'Unknown').toUpperCase();
        const cusip = cusipNode && cusipNode[0] ? cusipNode[0] : null;

        if (!valueNode || !valueNode[0]) continue;
        let valueStr = valueNode[0];

        // Handle nested shrsorprnamt structure which can vary
        let shrsStr = '0';
        if (shrsNode && shrsNode[0] && shrsNode[0].sshprnamt && shrsNode[0].sshprnamt[0]) {
            shrsStr = shrsNode[0].sshprnamt[0];
        }

        let value = parseFloat(valueStr);
        let shares = parseFloat(shrsStr);

        if (value > 0) cleanHoldings.push({ issuer, cusip, value, shares });
    }

    if (cleanHoldings.length === 0) return 0;

    const ratios = cleanHoldings.map(h => h.shares > 0 ? h.value / h.shares : 0).filter(r => r > 0).sort((a, b) => a - b);
    const median = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : 0;
    const normalize = median > 4;

    const stmts: { sql: string; args: any[] }[] = [];
    stmts.push({
        sql: 'INSERT OR IGNORE INTO funds (cik, name, ticker) VALUES (?, ?, ?)',
        args: [entry.cik, entry.name, null]
    });
    stmts.push({
        sql: 'INSERT OR IGNORE INTO filings (accession_number, cik, filing_date, quarter) VALUES (?, ?, ?, ?)',
        args: [accessionNumber, entry.cik, entry.date, quarter]
    });

    await turso.batch(stmts, "write");

    const BATCH_SIZE = 50;
    for (let i = 0; i < cleanHoldings.length; i += BATCH_SIZE) {
        const chunk = cleanHoldings.slice(i, i + BATCH_SIZE);
        const holdStmts = chunk.map(h => ({
            sql: 'INSERT INTO holdings (accession_number, issuer, cusip, value, shares) VALUES (?, ?, ?, ?, ?)',
            args: [
                accessionNumber,
                h.issuer,
                h.cusip,
                normalize ? h.value / 1000 : h.value,
                h.shares
            ]
        }));
        await turso.batch(holdStmts, "write");
    }
    return cleanHoldings.length;
}

async function main() {
    console.log("Starting DIRECT Turso Ingestion...");

    for (const q of QUARTERS) {
        console.log(`\n--- Processing ${q.year} Q${q.qtr} ---`);
        const entries = await downloadMasterIndex(q.year, q.qtr);
        console.log(`Found ${entries.length} 13F-HR filings.`);

        console.log("Checking existing filings...");
        const rs = await turso.execute({
            sql: "SELECT accession_number FROM filings WHERE quarter = ?",
            args: [`${q.year}-Q${q.qtr}`]
        });
        const existingSet = new Set(rs.rows.map((r: any) => r.accession_number as string));
        console.log(`${existingSet.size} filings already exist.`);

        const toProcess = entries.filter((e: IndexEntry) => {
            const acc = e.filename.split('/').pop()?.replace('.txt', '') || '';
            return !existingSet.has(acc);
        });

        console.log(`New filings to ingest: ${toProcess.length}`);

        let idx = 0;
        let active = 0;
        let completed = 0;

        const next = async () => {
            if (idx >= toProcess.length) return;
            const entry = toProcess[idx++];
            active++;

            try {
                await processFiling(entry, `${q.year}-Q${q.qtr}`);
            } catch (e: any) {
                console.error(`Failed ${entry.name}: ${e.message}`);
            } finally {
                active--;
                completed++;
                if (completed % 20 === 0) {
                    process.stdout.write(`\rProgress: ${completed}/${toProcess.length}`);
                }
                if (idx < toProcess.length) await next();
            }
        };

        const workers = [];
        for (let i = 0; i < CONCURRENCY; i++) workers.push(next());
        await Promise.all(workers);
        console.log("\nQuarter Complete.");
    }
}

main().catch(console.error);
