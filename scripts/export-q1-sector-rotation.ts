/**
 * Export a Q1 2026 vs Q4 2025 sector-rotation pack (CSVs, XLSX audit workbook, SEC source links)
 * for upload to Google Pinpoint. Runs fully offline from extracted SEC Form 13F data set folders - no DB, no web app.
 * Pass every data-set window that holds filings for either quarter, comma-separated.
 *
 * Usage: npx tsx scripts/export-q1-sector-rotation.ts --sec-datasets <dir1>,<dir2> [--current 2026-Q1] [--previous 2025-Q4]
 *        [--top 25] [--out <dir>] [--xlsx [--audit-rows 50000]]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    buildRadarAudit,
    buildRadarComparison,
    buildSecAccessionFolderUrl,
    DEFAULT_RADAR_WATCHLISTS,
    type FilerSecurityAuditRow,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from '../lib/thirteen-f-radar-core';
import { buildRadarAuditWorkbook } from '../lib/thirteen-f-radar-export';
import { buildRadarRowsFromStore, createStoreDirectory, matchStoreSecurities } from '../lib/thirteen-f-store';
import { getArg, hasArg } from './13f-ingestion-utils';
import { buildStoreSnapshot } from './build-13f-store';

const SEC_DATASETS_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets';

type Cell = string | number | null | undefined;

interface FilerCategoryMove {
    cik: string;
    fundName: string;
    categoryKey: string;
    categoryLabel: string;
    previousValue: number;
    currentValue: number;
    valueDelta: number;
    previousAccessionNumber: string;
    currentAccessionNumber: string;
    previousFilingDate: string;
    currentFilingDate: string;
    securities: Set<string>;
}

async function main() {
    const currentQuarter = getArg('--current') || '2026-Q1';
    const previousQuarter = getArg('--previous') || '2025-Q4';
    const topN = Number(getArg('--top') || 25);
    const outDir = path.resolve(getArg('--out') || path.join('exports', `${currentQuarter.toLowerCase()}-sector-rotation`));

    const datasetDirs = getArg('--sec-datasets');
    if (!datasetDirs) throw new Error('--sec-datasets <dir1>,<dir2> is required (extracted SEC Form 13F data set folders).');
    const source = await loadFromSecDatasets(datasetDirs.split(',').map((dir) => path.resolve(dir)), currentQuarter, previousQuarter);
    console.log(`[Sector Rotation] ${source.filings.length} filings, ${source.holdings.length} watched holding rows`);

    const params = {
        currentQuarter,
        previousQuarter,
        filings: source.filings,
        holdings: source.holdings,
        watchlists: source.watchlists,
        selectedCategories: source.selectedCategories,
    };
    const comparison = buildRadarComparison(params);
    const audit = buildRadarAudit({ ...params, includeRawHoldings: false });
    const { coverage } = comparison;
    console.log(
        `[Sector Rotation] ${coverage.currentFilers} ${currentQuarter} filers, ${coverage.previousFilers} ${previousQuarter} filers, ${coverage.comparableFilers} comparable`
    );

    await fs.mkdir(outDir, { recursive: true });
    const q1 = currentQuarter;
    const q4 = previousQuarter;

    // 1. Watchlist category summary
    await writeCsv(outDir, 'sector-rotation-summary.csv', comparison.categorySummaries.map((s) => ({
        category: s.label,
        [`value_${q4}_usd`]: s.previousValue,
        [`value_${q1}_usd`]: s.currentValue,
        value_change_usd: s.currentValue - s.previousValue,
        value_change_pct: pctChange(s.previousValue, s.currentValue),
        [`holders_${q4}`]: s.previousHolders,
        [`holders_${q1}`]: s.currentHolders,
        buyers: s.buyers,
        sellers: s.sellers,
        initiated: s.initiatedFilers,
        liquidated: s.liquidatedFilers,
        net_buyers: s.buyers - s.sellers,
    })));

    // 2. Broad sector view (lib/sectors mapping)
    await writeCsv(outDir, 'broad-sector-movers.csv', comparison.sectorMovers.map((s) => ({
        sector: s.sector,
        [`value_${q4}_usd`]: s.previousValue,
        [`value_${q1}_usd`]: s.currentValue,
        value_change_usd: s.currentValue - s.previousValue,
        value_change_pct: pctChange(s.previousValue, s.currentValue),
        [`holders_${q4}`]: s.previousHolders,
        [`holders_${q1}`]: s.currentHolders,
        buyers: s.buyers,
        sellers: s.sellers,
        initiated: s.initiatedFilers,
        liquidated: s.liquidatedFilers,
        net_buyers: s.netBuyers,
    })));

    // 3. Per-security detail
    await writeCsv(outDir, 'sector-security-detail.csv', comparison.securityMovements.map((s) => ({
        category: s.categoryLabel,
        issuer: s.issuer,
        cusip: s.cusip,
        [`value_${q4}_usd`]: s.previousValue,
        [`value_${q1}_usd`]: s.currentValue,
        value_change_usd: s.currentValue - s.previousValue,
        value_change_pct: pctChange(s.previousValue, s.currentValue),
        [`holders_${q4}`]: s.previousHolders,
        [`holders_${q1}`]: s.currentHolders,
        buyers: s.buyers,
        sellers: s.sellers,
        initiated: s.initiatedFilers,
        liquidated: s.liquidatedFilers,
        net_buyers: s.netBuyers,
        sample_initiators: s.sampleInitiators.join('; '),
        sample_liquidators: s.sampleLiquidators.join('; '),
    })));

    // 4. Top filer movers per category, with SEC links
    const topMovers = buildTopMovers(audit.filerSecurityAuditRows, topN);
    await writeCsv(outDir, 'sector-top-movers.csv', topMovers.map((m, i) => ({
        category: m.categoryLabel,
        rank_in_category: rankInCategory(topMovers, i),
        filer: m.fundName,
        cik: m.cik,
        [`value_${q4}_usd`]: m.previousValue,
        [`value_${q1}_usd`]: m.currentValue,
        value_change_usd: m.valueDelta,
        securities: Array.from(m.securities).sort().join('; '),
        [`filing_${q1}_date`]: m.currentFilingDate,
        [`filing_${q1}_accession`]: m.currentAccessionNumber,
        [`filing_${q1}_sec_index`]: secIndexUrl(m.cik, m.currentAccessionNumber),
        [`filing_${q4}_date`]: m.previousFilingDate,
        [`filing_${q4}_accession`]: m.previousAccessionNumber,
        [`filing_${q4}_sec_index`]: secIndexUrl(m.cik, m.previousAccessionNumber),
    })));

    // 5. Deduplicated SEC source links for Pinpoint
    const links = buildSourceLinks(topMovers, q1, q4);
    await writeCsv(outDir, 'pinpoint-source-links.csv', links);
    await fs.writeFile(path.join(outDir, 'pinpoint-source-links.md'), buildLinksMarkdown(links, q1, q4), 'utf8');

    await fs.writeFile(path.join(outDir, 'README.md'), buildReadme(source, coverage, q1, q4, topN, links.length), 'utf8');
    console.log(`[Sector Rotation] ${topMovers.length} top-mover rows, ${links.length} SEC filing links`);
    if (!hasArg('--xlsx')) {
        console.log(`[Sector Rotation] Wrote pack to ${outDir} (add --xlsx for the audit workbook)`);
        return;
    }

    // 6. Audit workbook (same format as the web app's "Export Audit Workbook"), capped to the largest moves
    const auditRowLimit = Number(getArg('--audit-rows') || 50000);
    const workbookAudit = {
        ...audit,
        filerSecurityAuditRows: [...audit.filerSecurityAuditRows]
            .sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta))
            .slice(0, auditRowLimit),
    };
    const workbook = buildRadarAuditWorkbook({
        request: {
            currentQuarter,
            previousQuarter,
            availableQuarters: [currentQuarter, previousQuarter],
            watchlists: source.watchlists,
            selectedCategories: source.selectedCategories,
            movementBasis: 'filer-count',
            isDefault: true,
            inStore: false,
        },
        comparison,
        audit: workbookAudit,
        notes: [
            `Generated offline from ${source.description}.`,
            `Filer Security Audit sheet holds the ${workbookAudit.filerSecurityAuditRows.length} largest moves by absolute value change, out of ${audit.filerSecurityAuditRows.length}.`,
        ],
        generatedAt: new Date(),
        includeRawHoldings: false,
    });
    await fs.writeFile(path.join(outDir, `13f-radar-audit-${q1}-vs-${q4}.xlsx`), workbook);
    console.log(`[Sector Rotation] Wrote pack to ${outDir}`);
}

interface LoadedSource {
    filings: RadarFilingRow[];
    holdings: RadarHoldingRow[];
    watchlists: RadarWatchlist[];
    selectedCategories: string[];
    description: string;
    caveats: string[];
}

/**
 * Build radar rows from SEC Form 13F data set folders using the same rules as the app's store
 * (scripts/build-13f-store.ts): 13F-HR plus restatements, new-holdings amendments added on top, latest report per
 * filer, zero-value stubs dropped, option rows excluded; bond principal (PRN) rows are left out of the comparison.
 */
async function loadFromSecDatasets(dirs: string[], currentQuarter: string, previousQuarter: string): Promise<LoadedSource> {
    const watchlists = DEFAULT_RADAR_WATCHLISTS;
    const selectedCategories = watchlists.map((watchlist) => watchlist.key);
    const snapshot = await buildStoreSnapshot({ currentQuarter, previousQuarter, dirs });
    const meta = { ...snapshot.meta, updatedAt: snapshot.meta.builtAt };
    const directory = createStoreDirectory(snapshot.securities, snapshot.filers, meta.updatedAt);
    const ids = new Set(matchStoreSecurities(directory, watchlists, selectedCategories));
    const watched = snapshot.positions.filter((position) => ids.has(position.securityId));
    const { filings, holdings } = buildRadarRowsFromStore(meta, directory, watched);
    const { stats } = snapshot;

    return {
        filings,
        holdings,
        watchlists,
        selectedCategories,
        description: `SEC Form 13F data sets (${snapshot.meta.source.replace(/^sec-bulk:/, '')})`,
        caveats: [
            'Both quarters are matched against the same watchlist, built directly from SEC bulk data.',
            `Only share positions are counted. Options rows (puts and calls, ${stats.optionRowsExcluded} rows) are excluded, and so are bond principal (PRN) positions, which are mostly convertibles.`,
            'Values are used exactly as reported. Since January 2023 the SEC has required 13F values in whole dollars.',
            '"New holdings" amendments (13F-HR/A add-ons) are added to the filer\'s report. Restatement amendments replace it.',
            `${stats.zeroValueStubs} filings reporting $0 in total are excluded, because they would read as full liquidations (e.g. Norges Bank's Q1 2026 13F-HR stub).`,
            'Single-filer outliers still happen (mis-keyed share counts or values). Check any headline filer figure against its SEC filing link before publishing.',
            'Filings made after the end of each SEC data-set window are not included.',
        ],
    };
}

function buildTopMovers(rows: FilerSecurityAuditRow[], topN: number): FilerCategoryMove[] {
    const byKey = new Map<string, FilerCategoryMove>();
    for (const row of rows) {
        const key = `${row.cik}|${row.categoryKey}`;
        const move = byKey.get(key) || {
            cik: row.cik,
            fundName: row.fundName,
            categoryKey: row.categoryKey,
            categoryLabel: row.categoryLabel,
            previousValue: 0,
            currentValue: 0,
            valueDelta: 0,
            previousAccessionNumber: row.previousAccessionNumber,
            currentAccessionNumber: row.currentAccessionNumber,
            previousFilingDate: row.previousFilingDate,
            currentFilingDate: row.currentFilingDate,
            securities: new Set<string>(),
        };
        move.previousValue += row.previousEstimatedValue;
        move.currentValue += row.currentEstimatedValue;
        move.valueDelta += row.valueDelta;
        row.matchedItems.forEach((item) => move.securities.add(item));
        byKey.set(key, move);
    }

    const byCategory = new Map<string, FilerCategoryMove[]>();
    for (const move of byKey.values()) {
        const list = byCategory.get(move.categoryLabel) || [];
        list.push(move);
        byCategory.set(move.categoryLabel, list);
    }

    return Array.from(byCategory.keys())
        .sort()
        .flatMap((label) =>
            byCategory.get(label)!
                .sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta))
                .slice(0, topN)
        );
}

function rankInCategory(moves: FilerCategoryMove[], index: number): number {
    let rank = 1;
    while (index - rank >= 0 && moves[index - rank].categoryKey === moves[index].categoryKey) rank++;
    return rank;
}

function buildSourceLinks(moves: FilerCategoryMove[], q1: string, q4: string) {
    const byAccession = new Map<string, { quarter: string; filer: string; cik: string; filing_date: string; accession: string; categories: Set<string> }>();
    const add = (quarter: string, move: FilerCategoryMove, accession: string, filingDate: string) => {
        if (!accession) return;
        const entry = byAccession.get(accession) || {
            quarter,
            filer: move.fundName,
            cik: move.cik,
            filing_date: filingDate,
            accession,
            categories: new Set<string>(),
        };
        entry.categories.add(move.categoryLabel);
        byAccession.set(accession, entry);
    };
    for (const move of moves) {
        add(q1, move, move.currentAccessionNumber, move.currentFilingDate);
        add(q4, move, move.previousAccessionNumber, move.previousFilingDate);
    }

    return Array.from(byAccession.values())
        .sort((a, b) => b.quarter.localeCompare(a.quarter) || a.filer.localeCompare(b.filer))
        .map((entry) => ({
            quarter: entry.quarter,
            filer: entry.filer,
            cik: entry.cik,
            filing_date: entry.filing_date,
            accession: entry.accession,
            categories: Array.from(entry.categories).sort().join('; '),
            sec_filing_index: secIndexUrl(entry.cik, entry.accession),
            sec_folder: buildSecAccessionFolderUrl(entry.cik, entry.accession),
        }));
}

function buildLinksMarkdown(links: ReturnType<typeof buildSourceLinks>, q1: string, q4: string): string {
    const lines = [
        `# SEC source filings: 13F sector rotation, ${q1} vs ${q4}`,
        '',
        'Each link is the SEC EDGAR filing index for an original Form 13F-HR. The index lists the primary document and the information table.',
        '',
        `Bulk source: [SEC Form 13F data sets](${SEC_DATASETS_PAGE})`,
        '',
    ];
    for (const quarter of [q1, q4]) {
        lines.push(`## ${quarter} filings`, '');
        for (const link of links.filter((l) => l.quarter === quarter)) {
            lines.push(`- [${link.filer}](${link.sec_filing_index}) (CIK ${link.cik}, filed ${link.filing_date}, ${link.categories})`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

function buildReadme(
    source: LoadedSource,
    coverage: { currentFilers: number; previousFilers: number; comparableFilers: number },
    q1: string,
    q4: string,
    topN: number,
    linkCount: number
): string {
    return [
        `# 13F sector rotation pack: ${q1} vs ${q4}`,
        '',
        `Generated ${new Date().toISOString()} by \`scripts/export-q1-sector-rotation.ts\` from ${source.description}.`,
        '',
        '## Files',
        '- `sector-rotation-summary.csv`: one row per watchlist theme (Mag 7, semis, AI infra, software, data centres, utilities/power, energy, BDCs, etc.). Gives aggregate value and holder counts in each quarter, plus buyers and sellers.',
        '- `broad-sector-movers.csv`: the same comparison, grouped by broad sector.',
        '- `sector-security-detail.csv`: one row per security within each theme.',
        `- \`sector-top-movers.csv\`: the top ${topN} filers per theme by absolute change in dollar value, with SEC filing links for both quarters.`,
        `- \`pinpoint-source-links.csv\` / \`.md\`: ${linkCount} unique SEC EDGAR filing-index URLs behind the top movers. Upload these to Pinpoint as source documents.`,
        `- \`13f-radar-audit-${q1}-vs-${q4}.xlsx\` (only with \`--xlsx\`; large): the audit workbook. Its Filer Security Audit sheet keeps the largest filer-security moves by absolute dollar change (default 50,000; change with \`--audit-rows\`).`,
        '',
        '## Method and caveats',
        `- Quarters are by period of report: ${q1} means holdings as of the end of that quarter.`,
        `- Coverage: ${coverage.currentFilers} ${q1} filers and ${coverage.previousFilers} ${q4} filers. Movement figures (buyers, sellers, value change) only cover the **${coverage.comparableFilers} filers that filed for both quarters**. Each filer's latest filing per quarter is used, so amendments supersede originals.`,
        '- Values are 13F reported market values in USD. Value changes mix price moves with buying and selling. Use the share-based buyer/seller counts as the cleaner rotation signal.',
        '- Theme membership is matched on issuer name aliases defined in `lib/thirteen-f-radar-core.ts` (DEFAULT_RADAR_WATCHLISTS).',
        ...source.caveats.map((caveat) => `- ${caveat}`),
        `- Primary source: [SEC Form 13F data sets](${SEC_DATASETS_PAGE}).`,
        '',
    ].join('\n');
}

function secIndexUrl(cik: string, accession: string): string | null {
    const folder = buildSecAccessionFolderUrl(cik, accession);
    return folder ? `${folder}${accession}-index.htm` : null;
}

function pctChange(previous: number, current: number): number | null {
    if (previous <= 0) return null;
    return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function writeCsv(outDir: string, fileName: string, rows: Record<string, Cell>[]) {
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
    ];
    await fs.writeFile(path.join(outDir, fileName), `${lines.join('\n')}\n`, 'utf8');
    console.log(`[Sector Rotation] ${fileName}: ${rows.length} rows`);
}

function csvCell(value: Cell) {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
