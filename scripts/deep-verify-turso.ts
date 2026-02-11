
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function deepVerify() {
    console.log("--- DEEP VERIFICATION OF TURSO DB ---");

    // 1. Check Distinct Quarters
    console.log("\n1. DISTINCT Quarters found in 'filings' table:");
    const qRes = await turso.execute("SELECT quarter, COUNT(*) as count FROM filings GROUP BY quarter");
    console.table(qRes.rows);

    // 2. Check Raw Filing Dates (Year distribution)
    console.log("\n2. Filing Counts by Year (derived from filing_date):");
    const yRes = await turso.execute("SELECT substr(filing_date, 1, 4) as year, COUNT(*) as count FROM filings GROUP BY year");
    console.table(yRes.rows);

    // 3. Search specifically for 2025 dates
    console.log("\n3. Searching for ANY filing with date starting with '2025':");
    const sample2025 = await turso.execute("SELECT * FROM filings WHERE filing_date LIKE '2025%' LIMIT 5");
    if (sample2025.rows.length === 0) {
        console.log("   => NO filings found for 2025.");
    } else {
        console.log(`   => FOUND ${sample2025.rows.length} sample filings for 2025:`);
        console.table(sample2025.rows);
    }

    // 4. Total Counts
    const total = await turso.execute("SELECT COUNT(*) as total FROM filings");
    console.log(`\nTotal Filings in DB: ${total.rows[0].total}`);
}

deepVerify().catch(console.error);
