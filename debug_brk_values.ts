
import { fetchCIK, fetchSubmission, generateSecUrl, fetchFilingContent, parse13F } from './lib/sec-client';
import * as fs from 'fs';

async function debugBRK() {
    const ticker = "BRK-B";
    console.log(`Debugging ${ticker}...`);

    const cik = await fetchCIK(ticker);
    if (!cik) {
        console.error("CIK not found");
        return;
    }

    const submission = await fetchSubmission(cik);
    const recent = submission.filings.recent;
    const filingIndices: number[] = [];
    for (let i = 0; i < recent.form.length; i++) {
        if (recent.form[i] === '13F-HR') {
            filingIndices.push(i);
            if (filingIndices.length === 1) break;
        }
    }

    if (filingIndices.length === 0) { console.error("No 13F-HR"); return; }

    const idx = filingIndices[0];
    const accessionNumber = recent.accessionNumber[idx];
    const primaryDocument = recent.primaryDocument[idx];
    const accessionNoDash = accessionNumber.replace(/-/g, '');

    // Use fallback logic
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNoDash}/index.json`;
    const indexRes = await fetch(indexUrl, { headers: { "User-Agent": "ForensicAnalyzer contact@example.com" } });
    const indexData = await indexRes.json();
    const items = indexData.directory?.item || [];

    let targetFile = items.find((item: any) =>
        (item.type && item.type.includes('INFORMATION TABLE')) ||
        (item.name && item.name.includes('xml') && (item.name.toLowerCase().includes('information') || item.name.toLowerCase().includes('infotable')))
    );

    if (!targetFile) {
        targetFile = items.find((item: any) =>
            item.name.includes('.xml') && item.name !== primaryDocument && item.name !== 'primary_doc.xml'
        );
    }

    if (targetFile) {
        const targetUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNoDash}/${targetFile.name}`;

        const content = await fetchFilingContent(targetUrl);
        if (content) {
            const parsed = await parse13F(content);
            const infoRoot = Array.isArray(parsed?.informationTable) ? parsed.informationTable[0] : parsed?.informationTable;
            const rows = infoRoot?.infoTable || [];

            let output = `Extracted Rows: ${rows.length}\n`;
            output += "--- Holdings Sample ---\n";

            rows.slice(0, 20).forEach((r: any, i: number) => {
                const issuer = r.nameOfIssuer?.[0];
                const val = r.value?.[0];
                const shares = r.shrsOrPrnAmt?.[0]?.sshPrnamt?.[0];
                output += `#${i + 1} ${issuer} | Value (Raw): ${val} | Shares: ${shares}\n`;
            });

            fs.writeFileSync('brk_debug_output.txt', output);
            console.log("Wrote to brk_debug_output.txt");
        }
    }
}

debugBRK();
