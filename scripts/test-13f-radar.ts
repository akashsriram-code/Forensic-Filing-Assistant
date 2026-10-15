import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
    DEFAULT_RADAR_WATCHLISTS,
    buildCategoryConcentration,
    buildRadarAudit,
    buildRadarComparison,
    buildSecAccessionFolderUrl,
    buildSecSubmissionTextUrl,
    calculateHHI,
    classifyMovement,
    compareHoldersForTable,
    estimateActualValue,
    issuerMatchesItem,
    normalizeCik,
    selectLatestFilings,
    type FilerMove,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from '../lib/thirteen-f-radar-core';
import { classifyFiler } from '../lib/filer-classification';
import { getSector } from '../lib/sectors';
import { buildRadarAuditWorkbook, buildRadarExportFilename } from '../lib/thirteen-f-radar-export';
import { resolveRadarRequest, toRadarApiResponse, type ResolvedRadarRequest } from '../lib/thirteen-f-radar-data';
import {
    getRadarWatchlistHash,
    listPrecomputedPairs,
    readPrecomputedHolders,
    readPrecomputedRadar,
    writePrecomputedHolders,
    writePrecomputedRadar,
} from '../lib/thirteen-f-precomputed';
import { findSecuritiesForCompany } from '../lib/thirteen-f-lookup';
import {
    buildRadarRowsFromStore,
    buildStoreSecurityKey,
    createStoreDirectory,
    matchStoreSecurities,
    type StoreFiler,
    type StoreMeta,
    type StoreSecurity,
} from '../lib/thirteen-f-store';

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
    assert.equal(normalizeCik('0001001011'), '1001011');
    assert.equal(normalizeCik('1001011'), '1001011');
    assert.equal(normalizeCik('A'), 'A');
    assert.equal(buildStoreSecurityKey('79466l302', 'Salesforce Inc'), '79466L302');
    assert.equal(buildStoreSecurityKey(null, '  Salesforce   Inc  '), 'NO_CUSIP|SALESFORCE INC');
    assert.equal(buildStoreSecurityKey('000000000', 'Salesforce Inc'), 'NO_CUSIP|SALESFORCE INC');
    // Post-2023 13F values are whole dollars: no "thousands" scaling, even for bond principal or sub-$4 shares.
    assert.equal(estimateActualValue(1000), 1000);
    assert.equal(estimateActualValue(25000), 25000);
    assert.equal(estimateActualValue(-5), 0);

    const reverseRouteModule = await import('../app/api/whale-reverse-lookup/route');
    const buildReverseLookupFunds = reverseRouteModule.buildReverseLookupFunds || (
        reverseRouteModule as unknown as { default: typeof reverseRouteModule }
    ).default.buildReverseLookupFunds;
    const reverseLookup = buildReverseLookupFunds({
        filings: [
            reverseFiling('A', 'Alpha Fund', 'A-prev', '2026-02-14', '2025-Q4'),
            reverseFiling('A', 'Alpha Fund', 'A-curr', '2026-05-15', '2026-Q1'),
            reverseFiling('B', 'Beta Fund', 'B-prev', '2026-02-14', '2025-Q4'),
            reverseFiling('B', 'Beta Fund', 'B-curr', '2026-05-15', '2026-Q1'),
            reverseFiling('C', 'Core Fund', 'C-prev', '2026-02-14', '2025-Q4'),
            reverseFiling('C', 'Core Fund', 'C-curr-old', '2026-05-14', '2026-Q1'),
            reverseFiling('C', 'Core Fund', 'C-curr', '2026-05-15', '2026-Q1'),
            reverseFiling('D', 'Delta Fund', 'D-prev', '2026-02-14', '2025-Q4'),
            reverseFiling('D', 'Delta Fund', 'D-curr', '2026-05-15', '2026-Q1'),
            reverseFiling('E', 'Echo Fund', 'E-prev', '2026-02-14', '2025-Q4'),
            reverseFiling('E', 'Echo Fund', 'E-curr', '2026-05-15', '2026-Q1'),
            reverseFiling('G', 'Gamma Fund', 'G-curr', '2026-05-14', '2026-Q1'),
        ],
        matchedHoldings: [
            reverseHolding('A', 'Alpha Fund', 'A-curr', '2026-05-15', '2026-Q1', 1000, 100),
            reverseHolding('B', 'Beta Fund', 'B-prev', '2026-02-14', '2025-Q4', 1000, 100),
            reverseHolding('C', 'Core Fund', 'C-prev', '2026-02-14', '2025-Q4', 1000, 100),
            reverseHolding('C', 'Core Fund', 'C-curr-old', '2026-05-14', '2026-Q1', 1300, 130),
            reverseHolding('C', 'Core Fund', 'C-curr', '2026-05-15', '2026-Q1', 1500, 150),
            reverseHolding('D', 'Delta Fund', 'D-prev', '2026-02-14', '2025-Q4', 1000, 100),
            reverseHolding('D', 'Delta Fund', 'D-curr', '2026-05-15', '2026-Q1', 500, 50),
            reverseHolding('E', 'Echo Fund', 'E-prev', '2026-02-14', '2025-Q4', 1000, 100),
            reverseHolding('E', 'Echo Fund', 'E-curr', '2026-05-15', '2026-Q1', 1000, 100),
            reverseHolding('G', 'Gamma Fund', 'G-curr', '2026-05-14', '2026-Q1', 1000, 100),
        ],
        limit: 10,
    });
    assert.equal(reverseLookup.matchCount, 6);
    assert.deepEqual(reverseLookup.funds.map((fund) => fund.cik), ['A', 'B', 'C', 'D', 'E', 'G']);
    assert.deepEqual(reverseLookup.funds.map((fund) => fund.action), ['initiated', 'liquidated', 'increased', 'decreased', 'unchanged', 'no_prior']);
    assert.equal(reverseLookup.funds.find((fund) => fund.cik === 'B')?.currentShares, 0);
    assert.equal(reverseLookup.funds.find((fund) => fund.cik === 'B')?.previousShares, 100);
    assert.equal(reverseLookup.funds.find((fund) => fund.cik === 'C')?.currentShares, 150);
    assert.equal(reverseLookup.funds.find((fund) => fund.cik === 'C')?.shareDelta, 50);
    assert.equal(reverseLookup.funds.find((fund) => fund.cik === 'G')?.previousFilingDate, null);

    const palantir = DEFAULT_RADAR_WATCHLISTS
        .find((watchlist) => watchlist.key === 'palantir')!
        .items[0];
    assert.equal(issuerMatchesItem('PALANTIR TECHNOLOGIES INC', palantir), true);
    const taiwanSemi = DEFAULT_RADAR_WATCHLISTS
        .find((watchlist) => watchlist.key === 'semiconductors')!
        .items.find((item) => item.ticker === 'TSM')!;
    assert.equal(issuerMatchesItem('TAIWAN SEMICONDUCTOR MFG CO LTD', taiwanSemi), true);
    const alphabetClassC = DEFAULT_RADAR_WATCHLISTS
        .find((watchlist) => watchlist.key === 'mag7')!
        .items.find((item) => item.ticker === 'GOOG')!;
    const alphabetClassA = DEFAULT_RADAR_WATCHLISTS
        .find((watchlist) => watchlist.key === 'mag7')!
        .items.find((item) => item.ticker === 'GOOGL')!;
    assert.equal(issuerMatchesItem('ALPHABET INC CL C CAP STK', alphabetClassC), true);
    assert.equal(issuerMatchesItem('ALPHABET INC CL A CAP STK', alphabetClassC), false);
    assert.equal(issuerMatchesItem('ALPHABET INC CL A CAP STK', alphabetClassA), true);
    assert.equal(issuerMatchesItem('ALPHABET INC', alphabetClassC), true);
    assert.equal(issuerMatchesItem('ALPHABET INC', alphabetClassA), false);

    const bdcItems = DEFAULT_RADAR_WATCHLISTS
        .find((watchlist) => watchlist.key === 'bdc')!
        .items;
    const findBdcItem = (ticker: string) => bdcItems.find((item) => item.ticker === ticker)!;
    const blueOwlItems = DEFAULT_RADAR_WATCHLISTS
        .find((watchlist) => watchlist.key === 'blue-owl')!
        .items;
    const findBlueOwlItem = (ticker: string) => blueOwlItems.find((item) => item.ticker === ticker)!;
    assert.equal(bdcItems.some((item) => item.ticker === 'W'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'OWL'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'OBDC'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'OTF'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'OCIC'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'OTIC'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'ARES'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'GOLUB'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'HPS'), false);
    assert.equal(bdcItems.some((item) => item.ticker === 'CLIFFWATER'), true);
    assert.equal(issuerMatchesItem('WHITEHORSE FINANCE INC', findBdcItem('WHF')), true);
    assert.equal(issuerMatchesItem('ARES MANAGEMENT CORP', findBdcItem('ARCC')), false);
    assert.equal(issuerMatchesItem('BLACKSTONE PRIVATE CREDIT FUND', findBdcItem('BCRED')), true);
    assert.equal(issuerMatchesItem('T ROWE PRICE OHA SELECT PRIVATE CREDIT FUND', findBdcItem('OCREDIT')), true);
    assert.equal(issuerMatchesItem('CLIFFWATER CORPORATE LENDING FUND', findBdcItem('CCLFX')), true);
    assert.equal(issuerMatchesItem('CLIFFWATER LLC', findBdcItem('CLIFFWATER')), true);
    assert.equal(issuerMatchesItem('BLUE OWL CAPITAL INC COM CL A', findBlueOwlItem('OWL')), true);
    assert.equal(issuerMatchesItem('BLUE OWL CAPITAL CORP', findBlueOwlItem('OWL')), false);
    assert.equal(issuerMatchesItem('BLUE OWL CAPITAL CORP', findBlueOwlItem('OBDC')), true);
    assert.equal(issuerMatchesItem('BLUE OWL CAPITAL INC', findBlueOwlItem('OBDC')), false);
    assert.equal(issuerMatchesItem('BLUE OWL TECHNOLOGY FINANCE CORP', findBlueOwlItem('OTF')), true);
    assert.equal(issuerMatchesItem('BLUE OWL CREDIT INCOME CORP', findBlueOwlItem('OCIC')), true);
    assert.equal(issuerMatchesItem('BLUE OWL TECHNOLOGY INCOME CORP', findBlueOwlItem('OTIC')), true);

    assert.equal(getSector('NVIDIA CORP'), 'Information Technology');
    assert.equal(getSector('CONSTELLATION ENERGY CORP'), 'Utilities');
    assert.equal(classifyFiler('0001350694', 'Example Teachers Retirement System').type, 'Hedge Fund');
    assert.equal(classifyFiler('999', 'Teachers Retirement System of Example').type, 'Pension / Public Fund');
    assert.equal(classifyFiler('998', 'Regents of Example University').type, 'University / Endowment');
    assert.equal(classifyFiler('997', 'Mystery Holdings').type, 'Other');

    const latest = selectLatestFilings(filings, '2025-Q4').find((row) => row.cik === 'A');
    assert.equal(latest?.accessionNumber, 'A-curr');
    const paddedLatest = selectLatestFilings([
        filing('0001001011', 'Padded Fund', 'pad-old', '2026-02-10', '2025-Q4'),
        filing('1001011', 'Padded Fund', 'pad-new', '2026-02-11', '2025-Q4'),
    ], '2025-Q4');
    assert.equal(paddedLatest.length, 1);
    assert.equal(paddedLatest[0].cik, '1001011');
    assert.equal(paddedLatest[0].accessionNumber, 'pad-new');

    const comparison = buildRadarComparison({
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        filings,
        holdings,
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['software', 'energy'],
    });

    assert.equal(comparison.coverage.comparableFilers, 4);

    const mixedCikComparison = buildRadarComparison({
        currentQuarter: '2026-Q1',
        previousQuarter: '2025-Q4',
        filings: [
            filing('0001001011', 'Mixed CIK Fund', 'mixed-prev', '2026-02-14', '2025-Q4'),
            filing('1001011', 'Mixed CIK Fund', 'mixed-curr', '2026-05-10', '2026-Q1'),
        ],
        holdings: [
            holding('0001001011', 'Mixed CIK Fund', 'mixed-prev', '2026-02-14', '2025-Q4', 'SALESFORCE INC', '79466L302', 1000, 10),
            holding('1001011', 'Mixed CIK Fund', 'mixed-curr', '2026-05-10', '2026-Q1', 'SALESFORCE INC', '79466L302', 2000, 20),
        ],
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['software'],
    });
    assert.equal(mixedCikComparison.coverage.comparableFilers, 1);
    assert.equal(mixedCikComparison.categorySummaries[0].buyers, 1);

    const software = comparison.categorySummaries.find((summary) => summary.key === 'software');
    assert.ok(software);
    assert.equal(software.exposedFilers, 3);
    assert.equal(software.exposedPctOfComparable, 75);
    assert.equal(software.currentHolders, 2);
    assert.equal(software.previousHolders, 2);
    assert.equal(software.buyers, 1);
    assert.equal(software.sellers, 2);
    assert.equal(software.initiatedFilers, 1);
    assert.equal(software.liquidatedFilers, 1);
    assert.equal(software.currentHolderPctOfComparable, 50);
    assert.equal(software.previousHolderPctOfComparable, 50);
    assert.equal(software.buyerPctOfExposed, 33.3);
    assert.equal(software.sellerPctOfExposed, 66.7);
    assert.equal(software.initiatedPctOfExposed, 33.3);
    assert.equal(software.liquidatedPctOfExposed, 33.3);
    assert.equal(software.initiatedPctOfComparable, 25);
    assert.equal(software.liquidatedPctOfComparable, 25);
    assert.equal(software.sellerPctOfComparable, 50);

    const energy = comparison.categorySummaries.find((summary) => summary.key === 'energy');
    assert.ok(energy);
    assert.equal(energy.buyers, 2);
    assert.equal(energy.buyerPctOfComparable, 50);
    assert.equal(energy.currentHolders, 2);
    assert.equal(energy.previousHolders, 1);

    const energySector = comparison.sectorMovers.find((summary) => summary.sector === 'Energy');
    assert.ok(energySector);
    assert.equal(energySector.buyers, 2);
    assert.equal(energySector.netBuyers, 2);
    const technologySector = comparison.sectorMovers.find((summary) => summary.sector === 'Information Technology');
    assert.ok(technologySector);
    assert.equal(technologySector.sellers, 2);

    const adviserSoftware = comparison.filerTypeSummaries.find(
        (summary) => summary.filerType === 'Asset Manager' && summary.categoryKey === 'software'
    );
    assert.ok(adviserSoftware);
    assert.equal(adviserSoftware.sellers, 1);

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

    const dedupeComparison = buildRadarComparison({
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        filings: [
            filing('M', 'Sculptor Capital Management', 'M-prev', '2025-08-14', '2025-Q3'),
            filing('M', 'Sculptor Capital Management', 'M-curr', '2026-02-13', '2025-Q4'),
        ],
        holdings: [
            holding('M', 'Sculptor Capital Management', 'M-curr', '2026-02-13', '2025-Q4', 'MICROSTRATEGY INC CL A', '594972408', 1000, 10),
            holding('M', 'Sculptor Capital Management', 'M-curr', '2026-02-13', '2025-Q4', 'STRATEGY INC', '594972999', 2000, 20),
        ],
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['strategy'],
    });
    const strategyMove = dedupeComparison.topFilerMoves.find((move) => move.categoryKey === 'strategy');
    assert.ok(strategyMove);
    assert.equal(strategyMove.securityCount, 1);
    assert.equal(strategyMove.initiatedCount, 1);
    assert.equal(strategyMove.details[0].label, 'Strategy');

    const privateCreditComparison = buildRadarComparison({
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        filings: [
            filing('P', 'Teachers Retirement System of Blue State', 'P-prev', '2025-08-14', '2025-Q3'),
            filing('P', 'Teachers Retirement System of Blue State', 'P-curr', '2026-02-13', '2025-Q4'),
            filing('U', 'Regents of Example University', 'U-prev', '2025-08-14', '2025-Q3'),
            filing('U', 'Regents of Example University', 'U-curr', '2026-02-13', '2025-Q4'),
        ],
        holdings: [
            holding('P', 'Teachers Retirement System of Blue State', 'P-curr', '2026-02-13', '2025-Q4', 'BLACKSTONE PRIVATE CREDIT FUND', '09261H108', 5000, 50),
            holding('U', 'Regents of Example University', 'U-prev', '2025-08-14', '2025-Q3', 'ARES CAPITAL CORP', '04010L103', 3000, 30),
        ],
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['bdc'],
    });
    assert.equal(privateCreditComparison.privateCreditInstitutionSummaries.length, 2);
    assert.equal(
        privateCreditComparison.privateCreditInstitutionSummaries.some((summary) =>
            summary.filerType === 'Pension / Public Fund' && summary.initiatedItems.includes('Blackstone Private Credit Fund')
        ),
        true
    );
    assert.equal(
        privateCreditComparison.privateCreditInstitutionSummaries.some((summary) =>
            summary.filerType === 'University / Endowment' && summary.liquidatedItems.includes('Ares Capital')
        ),
        true
    );

    const blueOwlComparison = buildRadarComparison({
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        filings: [
            filing('P', 'Teachers Retirement System of Blue State', 'P-prev', '2025-08-14', '2025-Q3'),
            filing('P', 'Teachers Retirement System of Blue State', 'P-curr', '2026-02-13', '2025-Q4'),
            filing('U', 'Regents of Example University', 'U-prev', '2025-08-14', '2025-Q3'),
            filing('U', 'Regents of Example University', 'U-curr', '2026-02-13', '2025-Q4'),
        ],
        holdings: [
            holding('P', 'Teachers Retirement System of Blue State', 'P-curr', '2026-02-13', '2025-Q4', 'BLUE OWL CAPITAL INC COM CL A', '09581B103', 5000, 50),
            holding('U', 'Regents of Example University', 'U-prev', '2025-08-14', '2025-Q3', 'BLUE OWL CAPITAL CORP', '09581B108', 3000, 30),
        ],
        watchlists: DEFAULT_RADAR_WATCHLISTS,
        selectedCategories: ['blue-owl'],
    });
    const blueOwlSummary = blueOwlComparison.categorySummaries.find((summary) => summary.key === 'blue-owl');
    assert.ok(blueOwlSummary);
    assert.equal(blueOwlSummary.initiatedFilers, 1);
    assert.equal(blueOwlSummary.liquidatedFilers, 1);
    assert.equal(blueOwlComparison.privateCreditInstitutionSummaries.length, 0);

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
        isDefault: false,
        inStore: true,
    };

    // Store rows map onto the radar core and reproduce the direct comparison; PRN (bond principal) rows are left out.
    const storeMeta: StoreMeta = {
        currentQuarter: '2025-Q4',
        previousQuarter: '2025-Q3',
        builtAt: '2026-05-11T00:00:00.000Z',
        source: 'test',
        updatedAt: '2026-05-11T00:00:00.000Z',
    };
    const storeSecurities: StoreSecurity[] = [
        { id: 1, securityKey: '79466L302', cusip: '79466L302', issuer: 'SALESFORCE INC' },
        { id: 2, securityKey: '30231G102', cusip: '30231G102', issuer: 'EXXON MOBIL CORP' },
        { id: 3, securityKey: '79466LAA2', cusip: '79466LAA2', issuer: 'SALESFORCE INC' },
    ];
    const storeFiler = (id: number, cik: string, name: string, cur: string | null, prev: string | null): StoreFiler => ({
        id, cik, name,
        curAccession: cur, curFilingDate: cur ? '2026-02-14' : null,
        prevAccession: prev, prevFilingDate: prev ? '2025-08-14' : null,
    });
    const storeFilers = [
        storeFiler(1, 'A', 'Alpha Capital', 'A-curr', 'A-prev'),
        storeFiler(2, 'B', 'Beta Partners', 'B-curr', 'B-prev'),
        storeFiler(3, 'C', 'Cobalt Advisors', 'C-curr', 'C-prev'),
        storeFiler(4, 'D', 'Delta Fund', 'D-curr', 'D-prev'),
    ];
    const directory = createStoreDirectory(storeSecurities, storeFilers, storeMeta.updatedAt);
    const storeRows = buildRadarRowsFromStore(storeMeta, directory, [
        { securityId: 1, filerId: 1, prevShares: 100, prevValue: 25000, curShares: 50, curValue: 12000, isPrn: false },
        { securityId: 1, filerId: 2, prevShares: 0, prevValue: 0, curShares: 10, curValue: 2600, isPrn: false },
        { securityId: 1, filerId: 3, prevShares: 20, prevValue: 5300, curShares: 0, curValue: 0, isPrn: false },
        { securityId: 2, filerId: 1, prevShares: 100, prevValue: 11000, curShares: 200, curValue: 22000, isPrn: false },
        { securityId: 2, filerId: 2, prevShares: 0, prevValue: 0, curShares: 40, curValue: 4400, isPrn: false },
        { securityId: 3, filerId: 4, prevShares: 0, prevValue: 0, curShares: 5000000, curValue: 5000000, isPrn: true },
    ]);
    assert.equal(storeRows.holdings.some((row) => row.cik === 'D'), false);
    assert.equal(storeRows.filings.length, 8);
    const storeComparison = buildRadarComparison({ ...request, filings: storeRows.filings, holdings: storeRows.holdings });
    assert.deepEqual(storeComparison.categorySummaries, comparison.categorySummaries);
    assert.deepEqual(storeComparison.topFilerMoves, comparison.topFilerMoves);
    assert.deepEqual(matchStoreSecurities(directory, DEFAULT_RADAR_WATCHLISTS, ['energy']), [2]);

    // Ticker -> issuer lines: share-class suffixes match, other companies sharing the first word do not.
    const lookupDirectory = createStoreDirectory([
        { id: 1, securityKey: '037833100', cusip: '037833100', issuer: 'APPLE INC' },
        { id: 2, securityKey: '03784Y200', cusip: '03784Y200', issuer: 'APPLE HOSPITALITY REIT INC' },
        { id: 3, securityKey: '02079K305', cusip: '02079K305', issuer: 'ALPHABET INC CL A' },
        { id: 4, securityKey: '02079K107', cusip: '02079K107', issuer: 'ALPHABET INC CAP STK CL C' },
        { id: 5, securityKey: '67066G104', cusip: '67066G104', issuer: 'NVIDIA CORPORATION' },
    ], [], 'x');
    assert.deepEqual(findSecuritiesForCompany(lookupDirectory, 'Apple Inc.').map((s) => s.id), [1]);
    assert.deepEqual(findSecuritiesForCompany(lookupDirectory, 'Alphabet Inc.').map((s) => s.id), [3, 4]);
    assert.deepEqual(findSecuritiesForCompany(lookupDirectory, 'NVIDIA CORP').map((s) => s.id), [5]);

    // Holder table order and concentration.
    const holderMove = (cik: string, action: FilerMove['action'], currentShares: number, previousShares: number) =>
        ({ cik, action, currentShares, previousShares } as FilerMove);
    assert.deepEqual(
        [holderMove('u', 'unchanged', 9, 9), holderMove('l', 'liquidated', 0, 5), holderMove('i', 'initiated', 3, 0), holderMove('i2', 'initiated', 7, 0)]
            .sort(compareHoldersForTable).map((m) => m.cik),
        ['i2', 'i', 'l', 'u']
    );
    assert.equal(calculateHHI([50, 50]), 5000);
    assert.deepEqual(
        buildCategoryConcentration({ software: [holderMove('a', 'unchanged', 100, 100)], energy: [] }, DEFAULT_RADAR_WATCHLISTS),
        [{ key: 'software', label: 'Software / SaaS', hhi: 10000, holders: 1 }]
    );

    // Precomputed files: round trip, response trimming, and the filing-season default pair.
    const precomputedRoot = await mkdtemp(path.join(os.tmpdir(), '13f-precomputed-'));
    const previousPrecomputedDir = process.env.THIRTEEN_F_PRECOMPUTED_DIR;
    process.env.THIRTEEN_F_PRECOMPUTED_DIR = precomputedRoot;
    try {
        const response = toRadarApiResponse(comparison, request);
        assert.deepEqual(response.currentHoldersByCategory, {});
        assert.ok(Array.isArray(response.categoryConcentration));
        const writeCoverage = async (currentQuarter: string, previousQuarter: string, comparableFilers: number) => {
            await writePrecomputedRadar({
                schemaVersion: 1,
                generatedAt: '2026-05-11T00:00:00.000Z',
                watchlistHash: getRadarWatchlistHash(DEFAULT_RADAR_WATCHLISTS),
                storeUpdatedAt: null,
                response: { ...response, coverage: { ...response.coverage, currentQuarter, previousQuarter, comparableFilers } },
            });
        };
        await writeCoverage('2026-Q2', '2026-Q1', 8600);
        await writeCoverage('2026-Q3', '2026-Q2', 1200);
        assert.deepEqual(await listPrecomputedPairs(), [
            { currentQuarter: '2026-Q3', previousQuarter: '2026-Q2' },
            { currentQuarter: '2026-Q2', previousQuarter: '2026-Q1' },
        ]);
        assert.equal((await readPrecomputedRadar('2026-Q2', '2026-Q1'))?.response.coverage.comparableFilers, 8600);

        // Early in the Q3 filing season (1,200 of ~8,600 filers) the default stays on Q2 vs Q1...
        const early = await resolveRadarRequest({}, null);
        assert.equal(early.currentQuarter, '2026-Q2');
        assert.equal(early.isDefault, true);
        assert.equal(early.inStore, false);
        assert.deepEqual(early.availableQuarters, ['2026-Q3', '2026-Q2', '2026-Q1']);
        // ...an explicit request still gets the newer pair...
        assert.equal((await resolveRadarRequest({ currentQuarter: '2026-Q3' }, null)).previousQuarter, '2026-Q2');
        // ...and once coverage catches up the default moves forward.
        await writeCoverage('2026-Q3', '2026-Q2', 8000);
        assert.equal((await resolveRadarRequest({}, null)).currentQuarter, '2026-Q3');
        await assert.rejects(() => resolveRadarRequest({ currentQuarter: '2024-Q1' }, null), /No stored comparison/);

        const customRequest = await resolveRadarRequest({ watchlists: [{ key: 'x', label: 'X', items: [{ ticker: 'X', label: 'X', aliases: ['X'] }] }] }, null);
        assert.equal(customRequest.isDefault, false);

        await writePrecomputedHolders('2026-Q2', '2026-Q1', 'software', [holderMove('a', 'unchanged', 1, 1)]);
        assert.equal((await readPrecomputedHolders('2026-Q2', '2026-Q1', 'software'))?.length, 1);
        assert.equal(await readPrecomputedHolders('2026-Q2', '2026-Q1', 'energy'), null);
    } finally {
        if (previousPrecomputedDir === undefined) delete process.env.THIRTEEN_F_PRECOMPUTED_DIR;
        else process.env.THIRTEEN_F_PRECOMPUTED_DIR = previousPrecomputedDir;
        await rm(precomputedRoot, { recursive: true, force: true });
    }

    const workbookBuffer = buildRadarAuditWorkbook({
        request,
        comparison,
        audit,
        notes: ['Test note'],
        generatedAt: new Date('2026-05-11T12:00:00.000Z'),
    });
    const workbook = XLSX.read(workbookBuffer, { type: 'buffer' });
    assert.deepEqual(workbook.SheetNames, [
        'Read Me',
        'Coverage',
        'Category Trends',
        'Security Movements',
        'Sector Movers',
        'Filer Type Trends',
        'Private Credit Institutions',
        'Top Filer Move Details',
        'Filer Security Audit',
        'Raw Current Holdings',
        'Raw Previous Holdings',
    ]);
    assert.equal(workbook.SheetNames.includes('Filer Side Matches'), false);
    assert.equal(buildRadarExportFilename('2025-Q4', '2025-Q3'), '13f-radar-audit-2025-Q4-vs-2025-Q3.xlsx');

    // Without a database, exports fail fast with a JSON error instead of hanging.
    const exportRouteModule = await import('../app/api/13f-radar/export/route');
    const exportPost = exportRouteModule.POST || (
        exportRouteModule as unknown as { default: { POST: (req: Request) => Promise<Response> } }
    ).default.POST;
    const routeEnvSnapshot = snapshotEnv(['DATABASE_URL', 'POSTGRES_URL']);
    const previousConsoleError = console.error;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    console.error = () => undefined;
    try {
        const response = await exportPost(new Request('http://localhost/api/13f-radar/export', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' },
        }));
        assert.equal(response.status, 503);
        assert.match(response.headers.get('content-type') || '', /application\/json/);
        const json = await response.json() as { error?: string };
        assert.match(json.error || '', /not been built/);
    } finally {
        console.error = previousConsoleError;
        restoreEnv(routeEnvSnapshot);
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

function reverseFiling(
    cik: string,
    fundName: string,
    accessionNumber: string,
    filingDate: string,
    quarter: string
) {
    return { cik, fundName, accessionNumber, filingDate, quarter };
}

function reverseHolding(
    cik: string,
    fundName: string,
    accessionNumber: string,
    filingDate: string,
    quarter: string,
    value: number,
    shares: number
) {
    return {
        cik,
        fundName,
        accessionNumber,
        filingDate,
        quarter,
        issuer: 'TEST ISSUER INC',
        cusip: '123456789',
        value,
        shares,
    };
}

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
    return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Map<string, string | undefined>) {
    for (const [key, value] of snapshot.entries()) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
