
import Database from 'better-sqlite3';
import { parseStringPromise } from 'xml2js';

// --- Configuration ---
const DB_PATH = 'whale_data.db';
import { SEC_USER_AGENT } from '../lib/sec-http';
const QUARTERS = [
    { year: 2024, qtr: 4 },
    // { year: 2024, qtr: 3 } 
];
const RATE_LIMIT_DELAY = 150;

const db = new Database(DB_PATH);

// --- Reuse Helpers ---
async function fetchWithRetry(url: string, retries = 3): Promise<string | null> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
            if (res.ok) return await res.text();
            if (res.status === 429) {
                console.warn(`Rate limit 429 on ${url}. Waiting...`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                return null;
            }
        } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return null;
}

async function parse13F(xmlContent: string) {
    try {
        const result = await parseStringPromise(xmlContent, {
            tagNameProcessors: [(name) => name.split(':').pop() || name],
            explicitArray: true
        });
        return result;
    } catch (e) { return null; }
}

async function downloadMasterIndex(year: number, qtr: number) {
    const url = `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${qtr}/master.idx`;
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

// --- Agressive Retry Logic ---
async function processRetry(entry: any, quarter: string) {
    const filenameParts = entry.filename.split('/');
    const txtName = filenameParts[filenameParts.length - 1];
    const accessionNumber = txtName.replace('.txt', '');

    // CHECK IF EXISTS
    const checkFiling = db.prepare('SELECT 1 FROM filings WHERE accession_number = ?');
    if (checkFiling.get(accessionNumber)) {
        return; // Already done
    }

    console.log(`[RETRY] Attempting ${entry.name} (${accessionNumber})...`);

    const accessionNoDash = accessionNumber.replace(/-/g, '');
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(entry.cik)}/${accessionNoDash}/index.json`;

    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));

    const indexRes = await fetch(indexUrl, { headers: { "User-Agent": SEC_USER_AGENT } });
    if (!indexRes.ok) {
        console.warn(`[RETRY] Index not found for ${entry.name}`);
        return;
    }

    let items = [];
    try {
        const indexData = await indexRes.json();
        items = indexData.directory?.item || [];
    } catch (e) { return; }

    // STRATEGY: Find ALL items ending in .xml
    const xmlFiles = items.filter((item: any) => item.name && item.name.toLowerCase().endsWith('.xml'));

    if (xmlFiles.length === 0) {
        console.warn(`[RETRY] No XML files in index for ${entry.name}`);
        return;
    }

    let validParsed = null;

    // Try each XML file until we find one with holdings
    for (const file of xmlFiles) {
        // Skip obvious ones unless desperate? No, try all.
        // Except maybe ignore 'primary_doc.xml' if it failed before? 
        // Let's just try them all sorted by size maybe? Or priority names?
        // Priority: contains 'info', 'table' -> then other.

        const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(entry.cik)}/${accessionNoDash}/${file.name}`;
        // console.log(`   Checking ${file.name}...`);

        const content = await fetchWithRetry(url);
        if (!content) continue;

        const parsed = await parse13F(content);
        if (!parsed) continue;

        // Validation Check
        const infoRoot = Array.isArray(parsed?.informationTable) ? parsed.informationTable[0] : parsed?.informationTable;
        const submissionRoot = Array.isArray(parsed?.edgarSubmission) ? parsed.edgarSubmission[0] : parsed?.edgarSubmission;
        const infoTableData = infoRoot || submissionRoot?.formData?.[0]?.informationTable?.[0];
        const rows = infoTableData?.infoTable || [];

        if (rows.length > 0) {
            console.log(`   [SUCCESS] Found ${rows.length} holdings in ${file.name}`);
            validParsed = rows;
            break; // Found it!
        }
    }

    if (!validParsed) {
        console.warn(`[RETRY] Failed to find ANY holdings in ${xmlFiles.length} XML files for ${entry.name}`);
        return;
    }

    // Insert
    const rows = validParsed;
    const insertTransaction = db.transaction(() => {
        // Double check filing didn't appear (race condition?)
        if (checkFiling.get(accessionNumber)) return;

        // Ensure Fund exists (in case main script skipped it entirely?)
        const insertFund = db.prepare('INSERT OR IGNORE INTO funds (cik, name) VALUES (?, ?)');
        insertFund.run(entry.cik, entry.name);

        const insertFiling = db.prepare('INSERT INTO filings (accession_number, cik, filing_date, quarter) VALUES (?, ?, ?, ?)');
        insertFiling.run(accessionNumber, entry.cik, entry.date, quarter);

        const insertHolding = db.prepare('INSERT INTO holdings (accession_number, issuer, cusip, value, shares) VALUES (?, ?, ?, ?, ?)');

        const aggMap = new Map<string, any>();
        for (const r of rows) {
            const issuer = (r.nameOfIssuer?.[0] || "Unknown").toUpperCase();
            const cusip = r.cusip?.[0] || null;
            let val = parseFloat(r.value?.[0] || '0');
            const shrs = parseFloat(r.shrsOrPrnAmt?.[0]?.sshPrnamt?.[0] || '0');

            const key = cusip || issuer;
            if (!aggMap.has(key)) aggMap.set(key, { issuer, cusip, val, shrs });
            else {
                const ex = aggMap.get(key);
                ex.val += val;
                ex.shrs += shrs;
            }
        }

        const allHoldings = Array.from(aggMap.values());
        const ratios = allHoldings.map(h => h.shrs > 0 ? h.val / h.shrs : 0).filter(r => r > 0).sort((a, b) => a - b);
        const median = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : 0;
        const normalize = median > 4;

        for (const h of allHoldings) {
            const finalVal = normalize ? h.val / 1000 : h.val;
            insertHolding.run(accessionNumber, h.issuer, h.cusip, finalVal, h.shrs);
        }
    });

    insertTransaction();
}

async function main() {
    console.log("Starting RETRY pass for missing filings...");

    for (const q of QUARTERS) {
        const entries = await downloadMasterIndex(q.year, q.qtr);
        console.log(`Checking ${entries.length} filings for ${q.year} Q${q.qtr}...`);

        let missingCount = 0;
        for (const entry of entries) {
            await processRetry(entry, `${q.year}-Q${q.qtr}`);
        }
    }
    console.log("\nRetry Pass Complete.");
}

main();
