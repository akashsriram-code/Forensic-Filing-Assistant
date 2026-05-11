import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
    DEFAULT_RADAR_WATCHLISTS,
    buildRadarAudit,
    buildRadarComparison,
    buildSecAccessionFolderUrl,
    buildSecSubmissionTextUrl,
    classifyMovement,
    issuerMatchesItem,
    selectLatestFilings,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from '../lib/thirteen-f-radar-core';
import { buildRadarAuditWorkbook, buildRadarExportFilename } from '../lib/thirteen-f-radar-export';
import { type ResolvedRadarRequest } from '../lib/thirteen-f-radar-data';

const filings: RadarFilingRow[] = [
    filing('A', 'Alpha Capital', 'A-prev', '2025-08-15', '2025-Q3'),
    filing('A', 'Alpha Capital', 'A-old', '2026-02-10', '2025-Q4'),
    filing('A', 'Alpha Capital', 'A-curr', '2026-02-17', '2025-Q4'),
    filing('B', 'Beta Partners', 'B-prev', '2025-08-15', '2025-Q3'),
    filing('B', 'Beta Partners', 'B-curr', '2026-02-14', '2025-Q4'),
    filing('C', 'Cobalt Advisors', 'C-prev', '2025-08-14', '2025-Q3'),
    filing('C', 'Cobalt Advisors', 'C-curr', '2026-02-13', '2025-Q4'),
    filing('D', 'Delta Fund', 'D-prev', '2025-08-14', '2025-Q3'),
    filing('D', 'Delta Fund', 'D-curr', '2026-02-13', '2025-Q4'),
];

const holdings: RadarHoldingRow[] = [
    holding('A', 'Alpha Capital', 'A-prev', '2025-08-15', '2025-Q3', 'SALESFORCE INC', '79466L302', 25000, 100),
    holding('A', 'Alpha Capital', 'A-curr', '2026-02-17', '2025-Q4', 'SALESFORCE INC', '79466L302', 12000, 50),
    holding('B', 'Beta Partners', 'B-curr', '2026-02-14', '2025-Q4', 'SALESFORCE INC', '79466L302', 2600, 10),
    holding('C', 'Cobalt Advisors', 'C-prev', '2025-08-14', '2025-Q3', 'SALESFORCE INC', '79466L302', 5300, 20),
    holding('A', 'Alpha Capital', 'A-prev', '2025-08-15', '2025-Q3', 'EXXON MOBIL CORP', '30231G102', 11000, 100),
    holding('A', 'Alpha Capital', 'A-curr', '2026-02-17', '2025-Q4', 'EXXON MOBIL CORP', '30231G102', 22000, 200),
    holding('B', 'Beta Partners', 'B-curr', '2026-02-14', '2025-Q4', 'EXXON MOBIL CORP', '30231G102', 4400, 40),
];

async function run() {
    assert.equal(classifyMovement(0, 10), 'initiated');
    assert.equal(classifyMovement(10, 0), 'liquidated');
    assert.equal(classifyMovement(10, 11), 'increased');
    assert.equal(classifyMovement(10, 9), 'decreased');
    assert.equal(classifyMovement(10, 10), 'unchanged');

    const palantir = DEFAULT_RADAR_WATCHLISTS
        .find((watchlist) => watchlist.key === 'palantir')!
        .items[0];
    assert.equal(issuerMatchesItem('PALANTIR TECHNOLOGIES INC', palantir), true);

    const latest = selectLatestFilings(filings, '2025-Q4').find((row) => row.cik === 'A');
    assert.equal(latest?.accessionNumber, 'A-curr');

    const comparison = buildRadarComparison({
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        filings,
        holdings,
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['software', 'energy'],
    });

    assert.equal(comparison.coverage.comparableFilers, 4);

    const software = comparison.categorySummaries.find((summary) => summary.key === 'software');
    assert.ok(software);
    assert.equal(software.exposedFilers, 3);
    assert.equal(software.buyers, 1);
    assert.equal(software.sellers, 2);
    assert.equal(software.initiatedFilers, 1);
    assert.equal(software.liquidatedFilers, 1);
    assert.equal(software.sellerPctOfExposed, 66.7);
    assert.equal(software.sellerPctOfComparable, 50);

    const energy = comparison.categorySummaries.find((summary) => summary.key === 'energy');
    assert.ok(energy);
    assert.equal(energy.buyers, 2);
    assert.equal(energy.buyerPctOfComparable, 50);

    const salesforceInitiation = comparison.initiations.find((movement) => movement.issuer === 'SALESFORCE INC');
    assert.equal(salesforceInitiation?.initiatedFilers, 1);
    const salesforceLiquidation = comparison.liquidations.find((movement) => movement.issuer === 'SALESFORCE INC');
    assert.equal(salesforceLiquidation?.liquidatedFilers, 1);

    const missingPrior = buildRadarComparison({
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        filings: filings.filter((row) => !(row.cik === 'D' && row.quarter === '2025-Q3')),
        holdings,
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['software'],
    });
    assert.equal(missingPrior.coverage.comparableFilers, 3);

    const emptyWatchlist: RadarWatchlist[] = [{
        key: 'empty',
        label: 'Empty',
        description: '',
        items: [],
    }];
    const empty = buildRadarComparison({
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        filings,
        holdings,
        watchlists: emptyWatchlist,
        selectedCategories: ['empty'],
    });
    assert.equal(empty.categorySummaries[0].exposedFilers, 0);

    const auditFilings = [
        ...filings,
        filing('E', 'Echo Fund', 'E-curr', '2026-02-12', '2025-Q4'),
    ];
    const auditHoldings = [
        ...holdings,
        holding('A', 'Alpha Capital', 'A-old', '2026-02-10', '2025-Q4', 'SALESFORCE INC', '79466L302', 999000, 999),
        holding('D', 'Delta Fund', 'D-prev', '2025-08-14', '2025-Q3', 'ADOBE INC', '00724F101', 4000, 10),
        holding('D', 'Delta Fund', 'D-curr', '2026-02-13', '2025-Q4', 'ADOBE INC', '00724F101', 4000, 10),
        holding('E', 'Echo Fund', 'E-curr', '2026-02-12', '2025-Q4', 'SALESFORCE INC', '79466L302', 3000, 10),
    ];
    const audit = buildRadarAudit({
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        filings: auditFilings,
        holdings: auditHoldings,
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['software', 'energy'],
    });

    assert.equal(audit.rawCurrentHoldings.some((row) => row.accessionNumber === 'A-old'), false);
    assert.equal(audit.rawCurrentHoldings.some((row) => row.cik === 'E'), false);
    assert.equal(audit.rawCurrentHoldings.some((row) => row.accessionNumber === 'B-curr'), true);

    const auditInitiation = audit.filerSecurityAuditRows.find((row) => row.cik === 'B' && row.issuer === 'SALESFORCE INC');
    assert.equal(auditInitiation?.action, 'initiated');
    assert.equal(auditInitiation?.matchedItems.includes('Salesforce'), true);

    const auditLiquidation = audit.filerSecurityAuditRows.find((row) => row.cik === 'C' && row.issuer === 'SALESFORCE INC');
    assert.equal(auditLiquidation?.action, 'liquidated');

    const auditUnchanged = audit.filerSecurityAuditRows.find((row) => row.cik === 'D' && row.issuer === 'ADOBE INC');
    assert.equal(auditUnchanged?.action, 'unchanged');
    assert.equal(auditUnchanged?.currentRawValue, 4000);
    assert.equal(auditUnchanged?.currentEstimatedValue, 4000);

    assert.equal(
        buildSecAccessionFolderUrl('0001067983', '0000950123-26-000001'),
        'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/'
    );
    assert.equal(
        buildSecSubmissionTextUrl('0001067983', '0000950123-26-000001'),
        'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/0000950123-26-000001.txt'
    );

    const request: ResolvedRadarRequest = {
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        availableQuarters: ['2025-Q4', '2025-Q3'],
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['software', 'energy'],
        movementBasis: 'filer-count',
        dbShape: { holdingsColumns: ['putcall'], putCallColumn: 'putcall' },
    };
    const workbookBuffer = buildRadarAuditWorkbook({
        request,
        comparison,
        audit,
        filerSideMatches: [],
        notes: ['Test note'],
        generatedAt: new Date('2026-05-11T12:00:00.000Z'),
    });
    const workbook = XLSX.read(workbookBuffer, { type: 'buffer' });
    assert.deepEqual(workbook.SheetNames, [
        'Read Me',
        'Coverage',
        'Category Trends',
        'Security Movements',
        'Filer Security Audit',
        'Raw Current Holdings',
        'Raw Previous Holdings',
        'Filer Side Matches',
    ]);
    assert.equal(buildRadarExportFilename('2025-Q4', '2025-Q3'), '13f-radar-audit-2025-Q4-vs-2025-Q3.xlsx');

    const exportRouteModule = await import('../app/api/13f-radar/export/route');
    const exportPost = exportRouteModule.POST || (
        exportRouteModule as unknown as { default: { POST: (req: Request) => Promise<Response> } }
    ).default.POST;
    const previousUrl = process.env.TURSO_DATABASE_URL;
    const previousToken = process.env.TURSO_AUTH_TOKEN;
    const previousConsoleError = console.error;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    console.error = () => undefined;
    try {
        const response = await exportPost(new Request('http://localhost/api/13f-radar/export', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' },
        }));
        assert.equal(response.status, 500);
        assert.match(response.headers.get('content-type') || '', /application\/json/);
        const json = await response.json() as { error?: string };
        assert.match(json.error || '', /Missing TURSO_DATABASE_URL/);
    } finally {
        console.error = previousConsoleError;
        if (previousUrl === undefined) {
            delete process.env.TURSO_DATABASE_URL;
        } else {
            process.env.TURSO_DATABASE_URL = previousUrl;
        }
        if (previousToken === undefined) {
            delete process.env.TURSO_AUTH_TOKEN;
        } else {
            process.env.TURSO_AUTH_TOKEN = previousToken;
        }
    }

    console.log('13F Radar unit tests passed.');
}

function filing(
    cik: string,
    fundName: string,
    accessionNumber: string,
    filingDate: string,
    quarter: string
): RadarFilingRow {
    return { cik, fundName, accessionNumber, filingDate, quarter };
}

function holding(
    cik: string,
    fundName: string,
    accessionNumber: string,
    filingDate: string,
    quarter: string,
    issuer: string,
    cusip: string,
    value: number,
    shares: number
): RadarHoldingRow {
    return { cik, fundName, accessionNumber, filingDate, quarter, issuer, cusip, value, shares };
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
