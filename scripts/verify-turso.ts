
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
dotenv.config();

const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function verify() {
    console.log("Verifying Turso Data Counts...");

    const rs = await turso.execute("SELECT quarter, COUNT(*) as count FROM filings GROUP BY quarter ORDER BY quarter DESC");

    console.table(rs.rows);

    const rs2 = await turso.execute("SELECT COUNT(*) as total_holdings FROM holdings");
    console.log("Total Holdings Rows:", rs2.rows[0].total_holdings);
}

verify().catch(console.error);
