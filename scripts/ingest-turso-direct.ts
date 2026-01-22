
const { createClient } = require('@libsql/client');
const dotenv = require('dotenv');
const { parseStringPromise } = require('xml2js');

dotenv.config();

// --- Configuration ---
const SEC_USER_AGENT = "ForensicAnalyzer contact@example.com";
const RATE_LIMIT_DELAY = 150; // ms
const CONCURRENCY = 20; // Parallel workers

// Quarters to ingest (User requested 2025 Q3 & Q4)
const QUARTERS = [
    { year: 2025, qtr: 4 },
    { year: 2025, qtr: 3 }
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

async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
            if (res.ok) return await res.text();
            if (res.status === 429) {
                await new Promise(r => setTimeout(r, 2000));
            } else if (res.status === 404) {
                return null;
            } else {
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return null;
}

async function fetchJsonWithRetry(url) {
    try {
        const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
        if (res.ok) return await res.json();
    } catch (e) { }
    return null;
}

async function parse13F(xmlContent) {
    try {
        const cleanXml = xmlContent.replace(/<([a-zA-Z0-9]+):/g, '<').replace(/<\/([a-zA-Z0-9]+):/g, '</');
        const result = await parseStringPromise(cleanXml, {
            explicitArray: true,
            ignoreAttrs: true,
            tagNameProcessors: [(name) => name.toLowerCase()]
        });
        return result;
    } catch (e) { return null; }
}

async function extractHoldingsFromXml(parsed) {
    let rows = [];
    const infoTable = parsed.informationtable || parsed.xml?.informationtable;
    if (infoTable && infoTable[0]?.infotable) {
        rows = infoTable[0].infotable;
    }
    if (!rows || rows.length === 0) {
        if (parsed.infotable) rows = parsed.infotable;
    }
    return rows;
}

async function downloadMasterIndex(year, qtr) {
    const url = `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${qtr}/master.idx`;
    console.log(`Downloading index: ${url}`);
    const content = await fetchWithRetry(url);
    if (!content) return [];

    const lines = content.split('\n');
    const entries = [];
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

async function processFiling(entry, quarter) {
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

    let holdings = [];
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

    const cleanHoldings = [];
    for (const h of holdings) {
        const issuer = (h.nameofissuer?.[0] || 'Unknown').toUpperCase();
        const cusip = h.cusip?.[0] || null;
        let valueStr = h.value?.[0];
        let shrsStr = h.shrsorprnamt?.[0]?.sshprnamt?.[0];
        if (!valueStr) continue;
        let value = parseFloat(valueStr);
        let shares = parseFloat(shrsStr || '0');
        if (value > 0) cleanHoldings.push({ issuer, cusip, value, shares });
    }

    if (cleanHoldings.length === 0) return 0;

    const ratios = cleanHoldings.map(h => h.shares > 0 ? h.value / h.shares : 0).filter(r => r > 0).sort((a, b) => a - b);
    const median = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : 0;
    const normalize = median > 4;

    const stmts = [];
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
        const existingSet = new Set(rs.rows.map(r => r.accession_number));
        console.log(`${existingSet.size} filings already exist.`);

        const toProcess = entries.filter(e => {
            const acc = e.filename.split('/').pop().replace('.txt', '');
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
            } catch (e) {
                console.error(`Failed ${entry.name}: ${e.message}`);
            } finally {
                active--;
                completed++;
                if (completed % 20 === 0) {
                    process.stdout.write(`\rProgress: ${completed}/${toProcess.length}`);
                }
                if (idx < toProcess.length) next();
            }
        };

        const workers = [];
        for (let i = 0; i < CONCURRENCY; i++) workers.push(next());
        await Promise.all(workers);
        console.log("\nQuarter Complete.");
    }
}

main().catch(console.error);
