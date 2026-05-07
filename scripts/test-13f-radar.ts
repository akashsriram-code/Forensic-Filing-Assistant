import assert from 'node:assert/strict';
import {
    DEFAULT_RADAR_WATCHLISTS,
    buildRadarComparison,
    classifyMovement,
    issuerMatchesItem,
    selectLatestFilings,
    type RadarFilingRow,
    type RadarHoldingRow,
    type RadarWatchlist,
} from '../lib/thirteen-f-radar-core';

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

function run() {
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

run();
