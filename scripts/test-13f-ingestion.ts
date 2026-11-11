import assert from 'node:assert/strict';
import {
    expectedSecDatasetLabelForQuarter,
    filingDeadlineDateString,
    filingIndexQuarterForReportQuarter,
    liveRefreshModeForLatestStatus,
    missingRequiredHoldingIndexes,
    mostRecentCompletedReportQuarter,
    parseLive13FSubmissionText,
    parseLive13FXmlText,
    previousReportQuarter,
    quarterEndDateString,
    quarterFromReportDate,
    resolveIngestionSchedule,
    resolveIngestionTargetProvider,
    selectSecDatasetSubmissionsForQuarter,
    type TsvRow,
} from './13f-ingestion-utils';
import {
    dailyMasterIndexUrlsForRecentDays,
    mergeIndexEntries,
    parseCurrentFeedEntries,
    parseIndexContent,
    resolveLiveReportQuarter,
    type IndexEntry,
} from './ingest-live-13f';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDatasetFilingTotals, readDatasetFilings, selectDatasetFilings } from './sec-13f-dataset-reader';
import {
    amendmentLagQuarters,
    buildPeriodOverrideIndex,
    isLateAmendment,
    loadPeriodOverrides,
    parsePeriodOverrides,
} from '../lib/thirteen-f-period-overrides';

async function run() {
    // Daily indexes use 20261103 and quarterly ones 2026-11-03; both must come out as YYYY-MM-DD.
    const indexHeader = 'CIK|Company Name|Form Type|Date Filed|File Name\n--------------------------------------------------------------------------------\n';
    const dailyEntries = parseIndexContent(`${indexHeader}1652044|Alphabet Inc.|13F-HR|20261106|edgar/data/1652044/0001652044-26-000086.txt\n`);
    const quarterlyEntries = parseIndexContent(`${indexHeader}1652044|Alphabet Inc.|13F-HR|2026-11-06|edgar/data/1652044/0001652044-26-000086.txt\n`);
    assert.equal(dailyEntries[0].date, '2026-11-06');
    assert.equal(quarterlyEntries[0].date, '2026-11-06');

    assert.equal(quarterFromReportDate('2026-03-31'), '2026-Q1');
    assert.equal(quarterFromReportDate('20260331'), '2026-Q1');
    assert.equal(quarterEndDateString('2026-Q1'), '2026-03-31');
    assert.equal(previousReportQuarter('2026-Q1'), '2025-Q4');
    assert.equal(previousReportQuarter('2026-Q3'), '2026-Q2');
    assert.equal(filingDeadlineDateString('2026-Q1'), '2026-05-15');
    assert.deepEqual(filingIndexQuarterForReportQuarter('2026-Q1'), { year: 2026, quarter: 2 });
    assert.deepEqual(filingIndexQuarterForReportQuarter('2025-Q4'), { year: 2026, quarter: 1 });
    assert.equal(mostRecentCompletedReportQuarter(new Date('2026-05-11T12:00:00Z')), '2026-Q1');
    assert.equal(expectedSecDatasetLabelForQuarter('2026-Q1'), '2026 March April May 13F');
    assert.equal(expectedSecDatasetLabelForQuarter('2025-Q4'), '2025 December 2026 January February 13F');

    const schedule = resolveIngestionSchedule('2026-Q1', new Date('2026-05-16T12:00:00Z'));
    assert.equal(schedule.liveActive, true);
    assert.equal(schedule.bulkActive, true);
    assert.equal(schedule.liveWindowStart, '2026-03-31');
    assert.equal(schedule.liveWindowEnd, '2026-05-30');
    assert.equal(schedule.bulkWindowStart, '2026-05-15');
    assert.equal(schedule.bulkWindowEnd, '2026-06-14');
    const beforeWindow = resolveIngestionSchedule('2026-Q1', new Date('2026-03-30T12:00:00Z'));
    assert.equal(beforeWindow.liveActive, false);
    assert.equal(beforeWindow.bulkActive, false);
    const afterLiveWindow = resolveIngestionSchedule('2026-Q1', new Date('2026-05-31T12:00:00Z'));
    assert.equal(afterLiveWindow.liveActive, false);
    assert.equal(afterLiveWindow.bulkActive, true);
    const afterBulkWindow = resolveIngestionSchedule('2026-Q1', new Date('2026-06-15T12:00:00Z'));
    assert.equal(afterBulkWindow.liveActive, false);
    assert.equal(afterBulkWindow.bulkActive, false);

    assert.equal(liveRefreshModeForLatestStatus(null), 'full');
    assert.equal(liveRefreshModeForLatestStatus(''), 'full');
    assert.equal(liveRefreshModeForLatestStatus('success'), 'incremental');
    assert.equal(liveRefreshModeForLatestStatus('failed'), 'refresh-existing');
    assert.equal(liveRefreshModeForLatestStatus('interrupted'), 'refresh-existing');
    assert.equal(liveRefreshModeForLatestStatus('running'), 'refresh-existing');
    withTemporaryEnv({ THIRTEEN_F_DB_PROVIDER: undefined }, () => {
        assert.equal(resolveIngestionTargetProvider(null), 'turso');
    });
    withTemporaryEnv({ THIRTEEN_F_DB_PROVIDER: 'postgres' }, () => {
        assert.equal(resolveIngestionTargetProvider(null), 'postgres');
    });
    withTemporaryEnv({ THIRTEEN_F_DB_PROVIDER: 'turso' }, () => {
        assert.equal(resolveIngestionTargetProvider('postgres'), 'postgres');
    });
    assert.throws(() => resolveIngestionTargetProvider('sqlite'), /Invalid ingestion target/);

    assert.deepEqual(missingRequiredHoldingIndexes([
        'idx_holdings_accession',
        'idx_holdings_issuer',
        'idx_holdings_cusip',
    ]), []);
    assert.deepEqual(missingRequiredHoldingIndexes([
        'idx_holdings_accession',
        'idx_holdings_issuer',
    ]), ['idx_holdings_cusip']);

    const secRows: TsvRow[] = [
        submission('0001', '13F-HR', '2026-03-31'),
        submission('0002', '13F-HR/A', '2026-03-31'),
        submission('0003', '13F-HR/A', '2025-12-31'),
        submission('0004', '13F-NT', '2026-03-31'),
        submission('0005', '13F-HR', ''),
        submission('0006', '13F-HR', '2026-02-28'),
    ];
    assert.deepEqual(
        selectSecDatasetSubmissionsForQuarter(secRows, '2026-Q1').map((row) => row.ACCESSION_NUMBER),
        ['0001', '0002']
    );

    const parsed = await parseLive13FXmlText(`
        <edgarSubmission xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
            <formData>
                <coverPage>
                    <reportCalendarOrQuarter>03-31-2026</reportCalendarOrQuarter>
                </coverPage>
                <informationTable>
                    <ns1:infoTable>
                        <ns1:nameOfIssuer>Blue Owl Capital Corp</ns1:nameOfIssuer>
                        <ns1:cusip>09581B103</ns1:cusip>
                        <ns1:value>12345</ns1:value>
                        <ns1:shrsOrPrnAmt>
                            <ns1:sshPrnamt>1000</ns1:sshPrnamt>
                            <ns1:sshPrnamtType>SH</ns1:sshPrnamtType>
                        </ns1:shrsOrPrnAmt>
                    </ns1:infoTable>
                    <infoTable>
                        <nameOfIssuer>Example Put Row</nameOfIssuer>
                        <cusip>000000000</cusip>
                        <value>2,500</value>
                        <shrsOrPrnAmt>
                            <sshPrnamt>5</sshPrnamt>
                            <sshPrnamtType>SH</sshPrnamtType>
                        </shrsOrPrnAmt>
                        <putCall>Put</putCall>
                    </infoTable>
                </informationTable>
            </formData>
        </edgarSubmission>
    `);
    assert.equal(parsed.reportDate, '2026-03-31');
    assert.equal(parsed.holdings.length, 2);
    assert.equal(parsed.holdings[0].issuer, 'BLUE OWL CAPITAL CORP');
    assert.equal(parsed.holdings[0].cusip, '09581B103');
    assert.equal(parsed.holdings[0].value, 12345);
    assert.equal(parsed.holdings[0].shares, 1000);
    assert.equal(parsed.holdings[1].putcall, 'Put');

    const wrapped = await parseLive13FSubmissionText(`
        <SEC-DOCUMENT>test.txt</SEC-DOCUMENT>
        <DOCUMENT><TYPE>13F-HR</TYPE><TEXT>not xml</TEXT></DOCUMENT>
        <DOCUMENT>
            <TYPE>INFORMATION TABLE</TYPE>
            <TEXT>
                <XML>
                    <informationTable>
                        <infoTable>
                            <nameOfIssuer>Nvidia Corp</nameOfIssuer>
                            <cusip>67066G104</cusip>
                            <value>500</value>
                            <shrsOrPrnAmt>
                                <sshPrnamt>10</sshPrnamt>
                                <sshPrnamtType>SH</sshPrnamtType>
                            </shrsOrPrnAmt>
                        </infoTable>
                    </informationTable>
                </XML>
            </TEXT>
        </DOCUMENT>
        <DOCUMENT>
            <TYPE>PRIMARY DOCUMENT</TYPE>
            <TEXT>
                <XML>
                    <edgarSubmission>
                        <formData>
                            <coverPage>
                                <reportCalendarOrQuarter>2026-03-31</reportCalendarOrQuarter>
                            </coverPage>
                        </formData>
                    </edgarSubmission>
                </XML>
            </TEXT>
        </DOCUMENT>
    `);
    assert.equal(wrapped.reportDate, '2026-03-31');
    assert.equal(wrapped.holdings.length, 1);
    assert.equal(wrapped.holdings[0].issuer, 'NVIDIA CORP');

    const currentFeedEntries = parseCurrentFeedEntries(`
        <feed>
            <entry>
                <title>13F-HR - Example Advisors, LLC (0001234567) (Filer)</title>
                <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/0001234567-26-000001-index.htm"/>
                <summary type="html">&lt;b&gt;Filed:&lt;/b&gt; 2026-05-15 &lt;b&gt;AccNo:&lt;/b&gt; 0001234567-26-000001</summary>
            </entry>
            <entry>
                <title>13F-HR/A - Amended Capital LP (0000000100) (Filer)</title>
                <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/100/000000010026000002/0000000100-26-000002-index.htm"/>
                <summary type="html">&lt;b&gt;Filed:&lt;/b&gt; 2026-05-15 &lt;b&gt;AccNo:&lt;/b&gt; 0000000100-26-000002</summary>
            </entry>
        </feed>
    `);
    assert.equal(currentFeedEntries.length, 2);
    assert.deepEqual(currentFeedEntries[0], {
        cik: '1234567',
        name: 'Example Advisors, LLC',
        form: '13F-HR',
        date: '2026-05-15',
        filename: 'edgar/data/1234567/000123456726000001/0001234567-26-000001.txt',
    });
    assert.equal(currentFeedEntries[1].form, '13F-HR/A');

    const duplicateEntries: IndexEntry[] = [
        currentFeedEntries[0],
        {
            ...currentFeedEntries[0],
            name: 'Duplicate Should Lose',
        },
    ];
    assert.deepEqual(mergeIndexEntries(duplicateEntries), [currentFeedEntries[0]]);
    assert.deepEqual(
        dailyMasterIndexUrlsForRecentDays(2, new Date('2026-05-15T21:00:00.000Z')),
        [
            'https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/master.20260515.idx',
            'https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/master.20260514.idx',
        ]
    );

    await testDatasetSelection();
    testPeriodOverrides();

    console.log('13F ingestion unit tests passed.');
}

const NORGES_CIK = '1374170';
// Accessions below are made up (other than the format); see testDatasetSelection for the scenario.
const ACC = {
    aOriginal: '0000000100-26-000001',
    aNewHoldings: '0000000100-26-000002',
    bOriginal: '0000000200-26-000001',
    bRestatement: '0000000200-26-000002',
    cStub: '0000000300-26-000001',
    dStub: '0000000400-26-000001',
    dNewHoldings: '0000000400-26-000002',
    nStub: '0001374170-26-900023',
    nAmendment: '0001374170-26-900021',
};

/** Writes an extracted SEC 13F data set folder (SUBMISSION, COVERPAGE, INFOTABLE) with the given rows. */
async function writeDataset(dir: string) {
    const tsv = (header: string[], rows: string[][]) => [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n') + '\n';
    const submissions: string[][] = [
        [ACC.aOriginal, '15-MAY-2026', '13F-HR', '100', '31-MAR-2026'],
        [ACC.aNewHoldings, '20-MAY-2026', '13F-HR/A', '100', '31-MAR-2026'],
        [ACC.bOriginal, '14-MAY-2026', '13F-HR', '200', '31-MAR-2026'],
        [ACC.bRestatement, '01-JUN-2026', '13F-HR/A', '200', '31-MAR-2026'],
        [ACC.cStub, '15-MAY-2026', '13F-HR', '300', '31-MAR-2026'],
        [ACC.dStub, '15-MAY-2026', '13F-HR', '400', '31-MAR-2026'],
        [ACC.dNewHoldings, '10-JUN-2026', '13F-HR/A', '400', '31-MAR-2026'],
        // Norges-like: an empty Q1 2026 report, plus a NEW HOLDINGS amendment whose stated period is a year earlier.
        [ACC.nStub, '11-MAY-2026', '13F-HR', NORGES_CIK, '31-MAR-2026'],
        [ACC.nAmendment, '11-MAY-2026', '13F-HR/A', NORGES_CIK, '31-MAR-2025'],
    ];
    const cover: string[][] = [
        [ACC.aOriginal, '', 'FUND A'],
        [ACC.aNewHoldings, 'NEW HOLDINGS', 'FUND A'],
        [ACC.bOriginal, '', 'FUND B'],
        [ACC.bRestatement, 'RESTATEMENT', 'FUND B'],
        [ACC.cStub, '', 'FUND C'],
        [ACC.dStub, '', 'FUND D'],
        [ACC.dNewHoldings, 'NEW HOLDINGS', 'FUND D'],
        [ACC.nStub, '', 'NORGES BANK'],
        [ACC.nAmendment, 'NEW HOLDINGS', 'NORGES BANK'],
    ];
    const info: string[][] = [
        [ACC.aOriginal, 'APPLE INC', '037833100', '1000', '10', 'SH', ''],
        [ACC.aNewHoldings, 'NVIDIA CORP', '67066G104', '500', '5', 'SH', ''],
        [ACC.bOriginal, 'APPLE INC', '037833100', '1000', '10', 'SH', ''],
        [ACC.bRestatement, 'APPLE INC', '037833100', '2000', '20', 'SH', ''],
        [ACC.cStub, 'APPLE INC', '037833100', '0', '0', 'SH', ''],
        [ACC.dNewHoldings, 'MICROSOFT CORP', '594918104', '700', '7', 'SH', ''],
        [ACC.nAmendment, 'NVIDIA CORP', '67066G104', '9000', '90', 'SH', ''],
    ];
    await writeFile(path.join(dir, 'SUBMISSION.tsv'), tsv(['ACCESSION_NUMBER', 'FILING_DATE', 'SUBMISSIONTYPE', 'CIK', 'PERIODOFREPORT'], submissions));
    await writeFile(path.join(dir, 'COVERPAGE.tsv'), tsv(['ACCESSION_NUMBER', 'AMENDMENTTYPE', 'FILINGMANAGER_NAME'], cover));
    await writeFile(path.join(dir, 'INFOTABLE.tsv'), tsv(['ACCESSION_NUMBER', 'NAMEOFISSUER', 'CUSIP', 'VALUE', 'SSHPRNAMT', 'SSHPRNAMTTYPE', 'PUTCALL'], info));
}

async function testDatasetSelection() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'f13-dataset-'));
    try {
        await writeDataset(dir);
        const select = async (overrides: ReturnType<typeof buildPeriodOverrideIndex>) => {
            const logs: string[] = [];
            const filings = await readDatasetFilings([dir], ['2026-Q1'], { overrides, log: (m) => logs.push(m) });
            const totals = await readDatasetFilingTotals([dir], new Set(filings.map((f) => f.accessionNumber)));
            return { filings, logs, selected: selectDatasetFilings(filings, totals) };
        };

        // Without overrides: the mis-dated amendment stays in its stated quarter (2025-Q1) and is only logged.
        const plain = await select(buildPeriodOverrideIndex([]));
        assert.equal(plain.filings.some((f) => f.accessionNumber === ACC.nAmendment), false);
        assert.equal(plain.logs.filter((m) => m.includes('Review') && m.includes(ACC.nAmendment)).length, 1);
        assert.equal(plain.logs.some((m) => m.includes(ACC.bRestatement)), false, 'an on-time restatement is not flagged');
        const base = plain.selected.baseByFilerQuarter;

        // NEW HOLDINGS amendment added on top of the original.
        assert.equal(base.get('2026-Q1|100')?.accessionNumber, ACC.aOriginal);
        assert.equal(plain.selected.byAccession.has(ACC.aNewHoldings), true);
        // RESTATEMENT replaces the original.
        assert.equal(base.get('2026-Q1|200')?.accessionNumber, ACC.bRestatement);
        assert.equal(plain.selected.byAccession.has(ACC.bOriginal), false);
        // Zero-value stub dropped, not read as a liquidation.
        assert.equal(base.has('2026-Q1|300'), false);
        assert.equal(plain.selected.byAccession.has(ACC.cStub), false);
        assert.ok(plain.selected.zeroValueFilings.some((f) => f.accessionNumber === ACC.cStub));
        // A stub followed by a NEW HOLDINGS amendment: the amendment's holdings are the quarter's holdings.
        assert.equal(base.get('2026-Q1|400')?.accessionNumber, ACC.dNewHoldings);
        assert.equal(plain.selected.byAccession.has(ACC.dStub), false);
        // Norges' empty Q1 2026 report alone: no position at all for the quarter.
        assert.equal(base.has(`2026-Q1|${NORGES_CIK}`), false);

        // Override applied: the amendment counts toward 2026-Q1 whatever its stated period, replacing the empty stub.
        const overridden = await select(
            buildPeriodOverrideIndex(parsePeriodOverrides([{ cik: '0001374170', accession: '000137417026900021', quarter: '2026-Q1', note: 'Test.' }]))
        );
        const nFiling = overridden.filings.find((f) => f.accessionNumber === ACC.nAmendment);
        assert.equal(nFiling?.quarter, '2026-Q1');
        assert.equal(nFiling?.mode, 'add');
        assert.equal(overridden.selected.baseByFilerQuarter.get(`2026-Q1|${NORGES_CIK}`)?.accessionNumber, ACC.nAmendment);
        assert.equal(overridden.selected.byAccession.has(ACC.nStub), false);
        assert.equal(overridden.logs.some((m) => m.includes('Override') && m.includes(ACC.nAmendment)), true);
        assert.equal(overridden.logs.some((m) => m.includes('Review') && m.includes(ACC.nAmendment)), false, 'overridden filings are not re-flagged');
        // An override with the wrong CIK is ignored.
        const wrongCik = await select(buildPeriodOverrideIndex(parsePeriodOverrides([{ cik: '999', accession: ACC.nAmendment, quarter: '2026-Q1', note: '' }])));
        assert.equal(wrongCik.filings.some((f) => f.accessionNumber === ACC.nAmendment), false);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

function testPeriodOverrides() {
    // The checked-in file must always parse.
    assert.ok(loadPeriodOverrides() instanceof Map);
    assert.throws(() => parsePeriodOverrides({}), /array/);
    assert.throws(() => parsePeriodOverrides([{ cik: '1', accession: '123', quarter: '2026-Q1', note: '' }]), /accession/);
    assert.throws(() => parsePeriodOverrides([{ cik: '1', accession: '0000000001-26-000001', quarter: 'Q1 2026', note: '' }]), /quarter/);

    // Lag: quarters between the stated period and the newest quarter reportable on the filing date.
    assert.equal(amendmentLagQuarters('2026-Q1', '2026-05-15'), 0);
    assert.equal(amendmentLagQuarters('2025-Q4', '2026-05-15'), 1);
    assert.equal(amendmentLagQuarters('2025-Q1', '2026-05-11'), 4);
    assert.equal(isLateAmendment('13F-HR/A', '2025-Q1', '2026-05-11'), true);
    assert.equal(isLateAmendment('13F-HR/A', '2025-Q4', '20260515'), false);
    assert.equal(isLateAmendment('13F-HR/A', '2025-Q3', '2026-05-15'), true);
    assert.equal(isLateAmendment('13F-HR', '2025-Q1', '2026-05-11'), false, 'only amendments are flagged');

    // Live ingestion: override wins; late amendments are logged but keep their stated quarter.
    const logs: string[] = [];
    const overrides = buildPeriodOverrideIndex(parsePeriodOverrides([{ cik: NORGES_CIK, accession: ACC.nAmendment, quarter: '2026-Q1', note: 'Test.' }]));
    const live = (accessionNumber: string, statedQuarter: string) =>
        resolveLiveReportQuarter({ accessionNumber, cik: NORGES_CIK, form: '13F-HR/A', filingDate: '2026-05-11', statedQuarter }, overrides, (m) => logs.push(m));
    assert.deepEqual(live(ACC.nAmendment, '2025-Q1'), { reportQuarter: '2026-Q1', overridden: true });
    assert.deepEqual(live('0001374170-25-000102', '2024-Q3'), { reportQuarter: '2024-Q3', overridden: false });
    assert.equal(logs.length, 2);
    assert.ok(logs[0].includes('Override'));
    assert.ok(logs[1].includes('Review') && logs[1].includes('0001374170-25-000102'));
}

function submission(accession: string, form: string, period: string): TsvRow {
    return {
        ACCESSION_NUMBER: accession,
        SUBMISSIONTYPE: form,
        PERIODOFREPORT: period,
    };
}

function withTemporaryEnv(values: Record<string, string | undefined>, fn: () => void) {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
        previous.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }

    try {
        fn();
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
