import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
    DEFAULT_RADAR_WATCHLISTS,
    buildRadarAudit,
    buildRadarComparison,
    buildSecAccessionFolderUrl,
    buildSecSubmissionTextUrl,
    classifyMovement,
    issuerMatchesItem,
    normalizeCik,
    selectLatestFilings,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from '../lib/thirteen-f-radar-core';
import { classifyFiler } from '../lib/filer-classification';
import { getSector } from '../lib/sectors';
import {
    buildRadarMatchedRowsCache,
    getRadarWatchlistHash,
    listRadarMatchedRowsCaches,
    readRadarMatchedRowsCache,
    writeRadarMatchedRowsCache,
} from '../lib/thirteen-f-radar-cache';
import { buildRadarAuditWorkbook, buildRadarExportFilename } from '../lib/thirteen-f-radar-export';
import {
    RadarDataError,
    isRadarCacheOnlyEnabled,
    loadRadarComparison,
    loadRadarComparisonFromCache,
    resolveRadarDbProviderFromEnv,
    resolveRadarRequestFromCache,
    type ResolvedRadarRequest,
} from '../lib/thirteen-f-radar-data';
import {
    buildPostgresSecurityKey,
    normalizePostgresIssuer,
    postgresValuePlaceholders,
    toPostgresSql,
} from '../lib/thirteen-f-radar-postgres';

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
    assert.equal(normalizePostgresIssuer('  Salesforce   Inc  '), 'SALESFORCE INC');
    assert.equal(buildPostgresSecurityKey('Salesforce Inc', '79466l302'), '79466L302|SALESFORCE INC');
    assert.equal(buildPostgresSecurityKey('Salesforce Inc', null), 'NO_CUSIP|SALESFORCE INC');
    assert.equal(toPostgresSql('a = ? AND b IN (?, ?)'), 'a = $1 AND b IN ($2, $3)');
    assert.equal(postgresValuePlaceholders(2, 3), '($1, $2, $3), ($4, $5, $6)');
    withTemporaryEnv({
        TURSO_DATABASE_URL: undefined,
        TURSO_AUTH_TOKEN: undefined,
        DATABASE_URL: undefined,
        POSTGRES_URL: undefined,
        THIRTEEN_F_DB_PROVIDER: undefined,
    }, () => {
        assert.equal(resolveRadarDbProviderFromEnv(), 'turso');
    });
    withTemporaryEnv({
        TURSO_DATABASE_URL: undefined,
        TURSO_AUTH_TOKEN: undefined,
        DATABASE_URL: 'postgres://example',
        POSTGRES_URL: undefined,
        THIRTEEN_F_DB_PROVIDER: undefined,
    }, () => {
        assert.equal(resolveRadarDbProviderFromEnv(), 'postgres');
    });
    withTemporaryEnv({
        TURSO_DATABASE_URL: 'libsql://example',
        TURSO_AUTH_TOKEN: 'token',
        DATABASE_URL: 'postgres://example',
        POSTGRES_URL: undefined,
        THIRTEEN_F_DB_PROVIDER: undefined,
    }, () => {
        assert.equal(resolveRadarDbProviderFromEnv(), 'postgres');
    });
    withTemporaryEnv({
        TURSO_DATABASE_URL: 'libsql://example',
        TURSO_AUTH_TOKEN: 'token',
        DATABASE_URL: 'postgres://example',
        POSTGRES_URL: undefined,
        THIRTEEN_F_DB_PROVIDER: 'turso',
    }, () => {
        assert.equal(resolveRadarDbProviderFromEnv(), 'turso');
    });
    withTemporaryEnv({
        TURSO_DATABASE_URL: 'libsql://example',
        TURSO_AUTH_TOKEN: 'token',
        DATABASE_URL: undefined,
        POSTGRES_URL: undefined,
        THIRTEEN_F_DB_PROVIDER: 'postgres',
    }, () => {
        assert.equal(resolveRadarDbProviderFromEnv(), 'postgres');
    });
    withTemporaryEnv({ THIRTEEN_F_RADAR_CACHE_ONLY: 'true' }, () => {
        assert.equal(isRadarCacheOnlyEnabled(), true);
    });
    withTemporaryEnv({ THIRTEEN_F_RADAR_CACHE_ONLY: undefined }, () => {
        assert.equal(isRadarCacheOnlyEnabled(), false);
    });

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
        dbShape: { holdingsColumns: ['putcall'], putCallColumn: 'putcall' },
    };

    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), '13f-radar-cache-'));
    try {
        const directAudit = buildRadarAudit({
            currentQuarter: request.currentQuarter,
            previousQuarter: request.previousQuarter,
            filings,
            holdings,
            watchlists: request.watchlists,
            selectedCategories: request.selectedCategories,
        });
        const cache = buildRadarMatchedRowsCache({
            request,
            filings,
            holdings: [
                ...holdings,
                holding('A', 'Alpha Capital', 'A-curr', '2026-02-17', '2025-Q4', 'UNWATCHED INDUSTRIAL CO', '999999999', 100, 1),
            ],
            generatedAt: new Date('2026-05-11T12:00:00.000Z'),
        });

        assert.equal(cache.watchlistHash, getRadarWatchlistHash(DEFAULT_RADAR_WATCHLISTS));
        assert.equal(cache.holdings.some((row) => row.issuer === 'UNWATCHED INDUSTRIAL CO'), false);
        await writeRadarMatchedRowsCache(cache, { cacheRoot });
        const listedCaches = await listRadarMatchedRowsCaches({ cacheRoot });
        assert.equal(listedCaches.length, 1);
        assert.equal(listedCaches[0].currentQuarter, request.currentQuarter);
        assert.deepEqual(listedCaches[0].dbShape, request.dbShape);

        const cachedRows = await readRadarMatchedRowsCache(request, { cacheRoot });
        assert.ok(cachedRows);
        const resolvedFromCache = await resolveRadarRequestFromCache({
            categories: request.selectedCategories,
            watchlists: request.watchlists,
        }, { cacheRoot });
        assert.equal(resolvedFromCache.currentQuarter, request.currentQuarter);
        assert.equal(resolvedFromCache.previousQuarter, request.previousQuarter);
        assert.deepEqual(resolvedFromCache.dbShape, request.dbShape);
        const cachedComparison = buildRadarComparison({
            currentQuarter: request.currentQuarter,
            previousQuarter: request.previousQuarter,
            filings: cachedRows.filings,
            holdings: cachedRows.holdings,
            watchlists: request.watchlists,
            selectedCategories: request.selectedCategories,
        });
        const cachedAudit = buildRadarAudit({
            currentQuarter: request.currentQuarter,
            previousQuarter: request.previousQuarter,
            filings: cachedRows.filings,
            holdings: cachedRows.holdings,
            watchlists: request.watchlists,
            selectedCategories: request.selectedCategories,
        });

        assert.deepEqual(cachedComparison.categorySummaries, comparison.categorySummaries);
        assert.deepEqual(cachedComparison.initiations, comparison.initiations);
        assert.deepEqual(cachedComparison.liquidations, comparison.liquidations);
        assert.deepEqual(cachedComparison.topFilerMoves, comparison.topFilerMoves);
        assert.deepEqual(cachedAudit.filerSecurityAuditRows, directAudit.filerSecurityAuditRows);
        const loadedDirectlyFromCache = await loadRadarComparisonFromCache(resolvedFromCache, { cacheRoot });
        assert.deepEqual(loadedDirectlyFromCache.comparison.categorySummaries, comparison.categorySummaries);

        const noDb = {
            provider: 'turso',
            client: {
                execute: async () => {
                    throw new Error('DB should not be queried on cache hit');
                },
            },
        } as unknown as Parameters<typeof loadRadarComparison>[0];
        const loadedFromCache = await loadRadarComparison(noDb, request, { cacheRoot });
        assert.deepEqual(loadedFromCache.comparison.categorySummaries, comparison.categorySummaries);

        await writeRadarMatchedRowsCache({ ...cache, watchlistHash: 'stale' }, { cacheRoot });
        assert.equal(await readRadarMatchedRowsCache(request, { cacheRoot }), null);
        await assert.rejects(
            () => resolveRadarRequestFromCache({
                categories: request.selectedCategories,
                watchlists: request.watchlists,
            }, { cacheRoot }),
            (error) => error instanceof RadarDataError && error.status === 503
        );

        const softwareOnlyCache = buildRadarMatchedRowsCache({
            request: { ...request, selectedCategories: ['software'] },
            filings,
            holdings,
        });
        await writeRadarMatchedRowsCache(softwareOnlyCache, { cacheRoot });
        assert.equal(await readRadarMatchedRowsCache(request, { cacheRoot }), null);

        const missingCacheRoot = await mkdtemp(path.join(os.tmpdir(), '13f-radar-cache-missing-'));
        try {
            assert.equal(await readRadarMatchedRowsCache(request, { cacheRoot: missingCacheRoot }), null);
            await assert.rejects(
                () => resolveRadarRequestFromCache({
                    categories: request.selectedCategories,
                    watchlists: request.watchlists,
                }, { cacheRoot: missingCacheRoot }),
                (error) => error instanceof RadarDataError && error.status === 503
            );
        } finally {
            await rm(missingCacheRoot, { recursive: true, force: true });
        }
    } finally {
        await rm(cacheRoot, { recursive: true, force: true });
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

    const exportRouteModule = await import('../app/api/13f-radar/export/route');
    const exportPost = exportRouteModule.POST || (
        exportRouteModule as unknown as { default: { POST: (req: Request) => Promise<Response> } }
    ).default.POST;
    const routeCacheRoot = await mkdtemp(path.join(os.tmpdir(), '13f-radar-route-cache-'));
    const routeEnvSnapshot = snapshotEnv([
        'TURSO_DATABASE_URL',
        'TURSO_AUTH_TOKEN',
        'DATABASE_URL',
        'POSTGRES_URL',
        'THIRTEEN_F_DB_PROVIDER',
        'THIRTEEN_F_RADAR_CACHE_ONLY',
        'THIRTEEN_F_RADAR_CACHE_DIR',
    ]);
    try {
        await writeRadarMatchedRowsCache(buildRadarMatchedRowsCache({ request, filings, holdings }), {
            cacheRoot: routeCacheRoot,
        });
        delete process.env.TURSO_DATABASE_URL;
        delete process.env.TURSO_AUTH_TOKEN;
        delete process.env.DATABASE_URL;
        delete process.env.POSTGRES_URL;
        delete process.env.THIRTEEN_F_DB_PROVIDER;
        process.env.THIRTEEN_F_RADAR_CACHE_ONLY = 'true';
        process.env.THIRTEEN_F_RADAR_CACHE_DIR = routeCacheRoot;

        const cachedExportResponse = await exportPost(new Request('http://localhost/api/13f-radar/export', {
            method: 'POST',
            body: JSON.stringify({
                currentQuarter: request.currentQuarter,
                previousQuarter: request.previousQuarter,
                categories: request.selectedCategories,
                watchlists: request.watchlists,
            }),
            headers: { 'Content-Type': 'application/json' },
        }));
        assert.equal(cachedExportResponse.status, 200);
        assert.match(cachedExportResponse.headers.get('content-type') || '', /spreadsheetml\.sheet/);
    } finally {
        restoreEnv(routeEnvSnapshot);
        await rm(routeCacheRoot, { recursive: true, force: true });
    }

    const previousUrl = process.env.TURSO_DATABASE_URL;
    const previousToken = process.env.TURSO_AUTH_TOKEN;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousPostgresUrl = process.env.POSTGRES_URL;
    const previousProvider = process.env.THIRTEEN_F_DB_PROVIDER;
    const previousCacheOnly = process.env.THIRTEEN_F_RADAR_CACHE_ONLY;
    const previousCacheDir = process.env.THIRTEEN_F_RADAR_CACHE_DIR;
    const previousConsoleError = console.error;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.THIRTEEN_F_DB_PROVIDER;
    delete process.env.THIRTEEN_F_RADAR_CACHE_ONLY;
    delete process.env.THIRTEEN_F_RADAR_CACHE_DIR;
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
        if (previousDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = previousDatabaseUrl;
        }
        if (previousPostgresUrl === undefined) {
            delete process.env.POSTGRES_URL;
        } else {
            process.env.POSTGRES_URL = previousPostgresUrl;
        }
        if (previousProvider === undefined) {
            delete process.env.THIRTEEN_F_DB_PROVIDER;
        } else {
            process.env.THIRTEEN_F_DB_PROVIDER = previousProvider;
        }
        if (previousCacheOnly === undefined) {
            delete process.env.THIRTEEN_F_RADAR_CACHE_ONLY;
        } else {
            process.env.THIRTEEN_F_RADAR_CACHE_ONLY = previousCacheOnly;
        }
        if (previousCacheDir === undefined) {
            delete process.env.THIRTEEN_F_RADAR_CACHE_DIR;
        } else {
            process.env.THIRTEEN_F_RADAR_CACHE_DIR = previousCacheDir;
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

function withTemporaryEnv(values: Record<string, string | undefined>, fn: () => void) {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
        previous.set(key, process.env[key]);
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        fn();
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
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
