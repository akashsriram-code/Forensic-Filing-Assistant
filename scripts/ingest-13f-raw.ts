
import Database from 'better-sqlite3';
import fs from 'fs';
import https from 'https';
import { parseStringPromise } from 'xml2js';

// --- Configuration ---
const DB_PATH = 'whale_data.db';
import { SEC_USER_AGENT } from '../lib/sec-http';
// We only support recent quarters for now
const QUARTERS = [
    { year: 2024, qtr: 4 },
    // { year: 2024, qtr: 3 } // Uncomment to go back further
];
const RATE_LIMIT_DELAY = 150; // ~6-7 requests per second (safe under 10)

// --- Database Setup ---
const db = new Database(DB_PATH);

function initDB() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS funds (
            cik TEXT PRIMARY KEY,
            name TEXT,
            ticker TEXT
        );
        CREATE TABLE IF NOT EXISTS filings (
            accession_number TEXT PRIMARY KEY,
            cik TEXT,
            filing_date TEXT,
            quarter TEXT,
            FOREIGN KEY(cik) REFERENCES funds(cik)
        );
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            accession_number TEXT,
            issuer TEXT,
            cusip TEXT,
            value REAL,
            shares REAL,
            FOREIGN KEY(accession_number) REFERENCES filings(accession_number)
        );
        CREATE INDEX IF NOT EXISTS idx_holdings_issuer ON holdings(issuer);
        CREATE INDEX IF NOT EXISTS idx_holdings_cusip ON holdings(cusip);
    `);
    console.log("Database initialized.");
}

// --- SEC Helpers ---
function generateSecUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
    const accessionNoDash = accessionNumber.replace(/-/g, '');
    return `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNoDash}/${primaryDocument}`;
}

async function fetchWithRetry(url: string, retries = 3): Promise<string | null> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
            if (res.ok) return await res.text();
            if (res.status === 429) {
                console.warn(`Rate limit 429 on ${url}. Waiting...`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                console.error(`Error ${res.status} fetching ${url}`); // 404 is common for malformed index entries
                return null;
            }
        } catch (e) {
            console.error(`Attempt ${i + 1} failed for ${url}:`, e);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return null;
}

// Reuse parsing logic
async function parse13F(xmlContent: string) {
    try {
        const result = await parseStringPromise(xmlContent, {
            tagNameProcessors: [(name) => name.split(':').pop() || name],
            explicitArray: true
        });
        return result;
    } catch (e) { return null; }
}

// --- Main Ingestion Logic ---

async function downloadMasterIndex(year: number, qtr: number) {
    const url = `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${qtr}/master.idx`;
    console.log(`Downloading index: ${url}`);

    // We use a stream for the large index file locally if we want, but keeping it in memory (buffer) is okay for <50MB
    // Actually, master.idx can be large. Let's stream it line by line?
    // For simplicity in this script, fetching text is fine (~30MB).
    const content = await fetchWithRetry(url);
    if (!content) return [];

    const lines = content.split('\n');
    const entries: any[] = [];

    let processing = false;
    for (const line of lines) {
        if (line.startsWith('-----------')) {
            processing = true;
            continue;
        }
        if (!processing) continue;

        // CIK | Company Name | Form Type | Date | Filename
        const parts = line.split('|');
        if (parts.length < 5) continue;

        const formType = parts[2];
        if (formType === '13F-HR') { // Only focused on 13F-HR (Holdings Report), not amendments (13F-HR/A) for simplicity first
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

async function processEntry(entry: any, quarter: string) {
    // 1. Insert Fund
    const insertFund = db.prepare('INSERT OR IGNORE INTO funds (cik, name) VALUES (?, ?)');
    insertFund.run(entry.cik, entry.name);

    // 2. Check if filing exists
    const filenameParts = entry.filename.split('/');
    // edgar/data/1000045/0000950170-24-125803.txt
    // We need accession number. It's the filename without path and extension usually? 
    // Actually master.idx gives the .txt path which is the full submission wrapper.
    // We want the *Accession Number* for consistency.
    // The filename usually is like .../0000950170-24-125803.txt -> 0000950170-24-125803
    const txtName = filenameParts[filenameParts.length - 1];
    const accessionNumber = txtName.replace('.txt', '');

    const checkFiling = db.prepare('SELECT 1 FROM filings WHERE accession_number = ?');
    if (checkFiling.get(accessionNumber)) {
        // Already processed
        return;
    }

    console.log(`Processing ${entry.name} (${accessionNumber})...`);

    // 3. Fetch the submission text file to find the XML
    // The .txt file is the SGML header + documents. 
    // OR we can guess the XML path if we are lucky?
    // Safer: Look at the index.json or parsing the .txt is hard.
    // Optimized: Most modern 13Fs have a `primary_doc.xml` at consistent URL?
    // NO, the XML name varies.
    // Best Approach used in lib/sec-client: fetch index.json or txt.
    // For bulk speed, let's try to fetch `index.json` first as it's cleaner.

    const accessionNoDash = accessionNumber.replace(/-/g, '');
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(entry.cik)}/${accessionNoDash}/index.json`;

    // Throttle
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));

    const indexRes = await fetch(indexUrl, { headers: { "User-Agent": SEC_USER_AGENT } });
    if (!indexRes.ok) {
        console.warn(`Failed to get index for ${entry.name}`);
        return;
    }

    let items;
    try {
        const indexData = await indexRes.json();
        items = indexData.directory?.item || [];
    } catch (e) { return; }

    const infoTableFile = items.find((item: any) =>
        (item.type && item.type.includes('INFORMATION TABLE')) ||
        (item.name && item.name.includes('xml') && (item.name.toLowerCase().includes('information') || item.name.toLowerCase().includes('infotable')))
    );

    if (!infoTableFile) {
        console.warn(`No info table found for ${entry.name}`);
        return;
    }

    const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(entry.cik)}/${accessionNoDash}/${infoTableFile.name}`;
    const xmlContent = await fetchWithRetry(xmlUrl);
    if (!xmlContent) return;

    const parsed = await parse13F(xmlContent);
    if (!parsed) return;

    // Extract Holdings
    const infoRoot = Array.isArray(parsed?.informationTable) ? parsed.informationTable[0] : parsed?.informationTable;
    const submissionRoot = Array.isArray(parsed?.edgarSubmission) ? parsed.edgarSubmission[0] : parsed?.edgarSubmission;
    const infoTableData = infoRoot || submissionRoot?.formData?.[0]?.informationTable?.[0];
    const rows = infoTableData?.infoTable || [];

    // Transaction
    const insertTransaction = db.transaction(() => {
        const insertFiling = db.prepare('INSERT INTO filings (accession_number, cik, filing_date, quarter) VALUES (?, ?, ?, ?)');
        insertFiling.run(accessionNumber, entry.cik, entry.date, quarter);

        const insertHolding = db.prepare('INSERT INTO holdings (accession_number, issuer, cusip, value, shares) VALUES (?, ?, ?, ?, ?)');

        // Simple Aggregation to reduce row count
        const aggMap = new Map<string, any>();

        for (const r of rows) {
            const issuer = (r.nameOfIssuer?.[0] || "Unknown").toUpperCase();
            const cusip = r.cusip?.[0] || null;
            let val = parseFloat(r.value?.[0] || '0');
            const shrs = parseFloat(r.shrsOrPrnAmt?.[0]?.sshPrnamt?.[0] || '0');

            const key = cusip || issuer;
            if (!aggMap.has(key)) {
                aggMap.set(key, { issuer, cusip, val, shrs });
            } else {
                const ex = aggMap.get(key);
                ex.val += val;
                ex.shrs += shrs;
            }
        }

        // Heuristic: Normalize Value
        // If median price > 4, divide by 1000.
        const allHoldings = Array.from(aggMap.values());
        const ratios = allHoldings.map(h => h.shrs > 0 ? h.val / h.shrs : 0).filter(r => r > 0).sort((a, b) => a - b);
        const median = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : 0;
        const normalize = median > 4;

        for (const h of allHoldings) {
            const finalVal = normalize ? h.val / 1000 : h.val; // Store in Thousands (standard) or Millions? Let's use Thousands consistently.
            insertHolding.run(accessionNumber, h.issuer, h.cusip, finalVal, h.shrs);
        }
    });

    insertTransaction();
    process.stdout.write('.'); // Progress dot
}

async function main() {
    initDB();

    for (const q of QUARTERS) {
        console.log(`\nStarting ingestion for ${q.year} Q${q.qtr}...`);
        const entries = await downloadMasterIndex(q.year, q.qtr);
        console.log(`Found ${entries.length} 13F-HR filings.`);

        let count = 0;
        // Process in chunks or just sequential to be nice to rate limits
        // Sequential is best for rate limit control
        for (const entry of entries) {
            await processEntry(entry, `${q.year}-Q${q.qtr}`);
            count++;
            if (count % 50 === 0) console.log(`\nProcessed ${count}/${entries.length}`);

            // Temporary Limit for Demo/Dev: Stop after 500 filings?
            // User asked for "5000+ database", but downloading 5000 * 2s = 10000s = 3 hours.
            // I should cap this or make it resumable.
            // The logic supports resume (checks `checkFiling`).
            // I will set a soft limit for this initial run to demonstrate, then user can run `npm run ingest:13f` fully?
            // Or I let it run for a bit in the background?
            // "WaitDurationSeconds" in tool calling suggests I need to return.
            // I'll cap at 100 for verification, then instruct user to run the script for full ingest.

        }
    }
    console.log("\nIngestion Complete.");
}

main();
