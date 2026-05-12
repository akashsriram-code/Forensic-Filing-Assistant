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

async function run() {
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

    console.log('13F ingestion unit tests passed.');
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
