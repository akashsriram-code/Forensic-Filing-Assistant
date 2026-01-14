
import { fetchCIK } from './lib/sec-client';

async function testCIK() {
    const queries = [
        "Berkshire Hathaway",
        "BERKSHIRE HATHAWAY",
        "BRK.A",
        "BRK-A",
        "BRK.B",
        "BRK-B",
        "0001067983" // Example CIK
    ];

    console.log("Testing CIK Lookup...");
    for (const q of queries) {
        try {
            const cik = await fetchCIK(q);
            console.log(`Query: "${q}" -> CIK: ${cik}`);
        } catch (e) {
            console.error(`Query: "${q}" -> Error:`, e);
        }
    }
}

testCIK();
