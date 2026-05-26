import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
    buildSecFullTextSearchUrl,
    dedupeSecSearchHits,
    parse13FXmlForSpaceX,
    parseHtmlOrTextForSpaceX,
    parseNPortXmlForSpaceX,
    normalizeFormsForSecFullText,
    normalizeSpaceXExposureRequest,
    runSpaceXExposureRadar,
} from '../lib/spacex-exposure-radar';
import {
    buildSpaceXExposureExportFilename,
    buildSpaceXExposureWorkbook,
} from '../lib/spacex-exposure-radar-export';

const NPORT_XML = `<?xml version="1.0"?>
<edgarSubmission>
  <formData>
    <genInfo>
      <regName>BARON SELECT FUNDS</regName>
      <seriesName>Baron Partners Fund</seriesName>
    </genInfo>
    <invstOrSecs>
      <invstOrSec>
        <name>Space Exploration Technologies</name>
        <title>SPACE EXPLORATION TECHNOLOGIES</title>
        <cusip>000000000</cusip>
        <balance>131657.00000000</balance>
        <units>NS</units>
        <valUSD>127707290.00000000</valUSD>
        <pctVal>2.110329151105</pctVal>
        <assetCat>EP</assetCat>
        <issuerCat>CORP</issuerCat>
        <invCountry>US</invCountry>
      </invstOrSec>
    </invstOrSecs>
  </formData>
</edgarSubmission>`;

const THIRTEEN_F_XML = `<?xml version="1.0"?>
<informationTable>
  <infoTable>
    <nameOfIssuer>SPACE EXPLORATION TECH CORP</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>000000000</cusip>
    <value>1200</value>
    <shrsOrPrnAmt>
      <sshPrnamt>100</sshPrnamt>
      <sshPrnamtType>SH</sshPrnamtType>
    </shrsOrPrnAmt>
  </infoTable>
</informationTable>`;

const COMMERCIAL_HTML = `
<html><body>
  <p>We entered into a satellite services agreement with SpaceX for launch and connectivity support.</p>
</body></html>`;

const HOLDING_HTML = `
<html><body>
  <table>
    <tr><td>Portfolio Company</td><td>Security</td><td>Fair Value</td></tr>
    <tr><td>SpaceX</td><td>Preferred shares</td><td>$12,500,000</td></tr>
  </table>
</body></html>`;

async function run() {
    const url = buildSecFullTextSearchUrl({
        query: '"Space Exploration Technologies"',
        forms: ['NPORT-P', '8-K'],
        startDate: '2021-01-01',
        endDate: '2026-05-26',
        from: 100,
    });
    assert.equal(url.includes('q=%22Space+Exploration+Technologies%22'), true);
    assert.equal(url.includes('forms=NPORT-P%2C8-K'), true);
    assert.equal(url.includes('from=100'), true);
    assert.deepEqual(normalizeFormsForSecFullText(['13F-HR', '13F-HR/A', 'S-1/A', '8-K']), ['13F-HR', 'S-1', '8-K']);

    const amendmentSafeUrl = buildSecFullTextSearchUrl({
        query: 'SpaceX',
        forms: ['NPORT-P', '13F-HR', '13F-HR/A', '8-K'],
        startDate: '2021-01-01',
        endDate: '2026-05-26',
    });
    assert.equal(amendmentSafeUrl.includes('13F-HR%2FA'), false);
    assert.equal(amendmentSafeUrl.includes('forms=NPORT-P%2C13F-HR%2C8-K'), true);
    const normalizedLargeRun = normalizeSpaceXExposureRequest({ maxFilings: 2000 }, new Date('2026-05-26T12:00:00.000Z'));
    assert.equal(normalizedLargeRun.maxFilings, 8);
    assert.equal(normalizedLargeRun.requestedMaxFilings, 2000);

    const deduped = dedupeSecSearchHits([
        searchHit('SpaceX'),
        { ...searchHit('Space Exploration Technologies'), matchedTerms: ['Space Exploration Technologies'] },
    ]);
    assert.equal(deduped.length, 1);
    assert.deepEqual(deduped[0].matchedTerms.sort(), ['Space Exploration Technologies', 'SpaceX'].sort());
    const prioritizedHits = dedupeSecSearchHits([
        searchHit('SpaceX', {
            form: '8-K',
            filingDate: '2026-05-26',
            accessionNumber: '0000000000-26-000001',
            documentName: 'narrative.htm',
        }),
        searchHit('Space Exploration Technologies', {
            form: 'NPORT-P',
            filingDate: '2024-05-29',
            accessionNumber: '0001752724-24-124763',
            documentName: 'primary_doc.xml',
        }),
    ]);
    assert.equal(prioritizedHits[0].form, 'NPORT-P');

    const nportRows = await parseNPortXmlForSpaceX(NPORT_XML);
    assert.equal(nportRows.length, 1);
    assert.equal(nportRows[0].relationshipType, 'direct_holding');
    assert.equal(nportRows[0].issuerName, 'Space Exploration Technologies');
    assert.equal(nportRows[0].sharesOrBalance, 131657);
    assert.equal(nportRows[0].valueUsd, 127707290);
    assert.equal(nportRows[0].pctValue, 2.110329151105);
    assert.equal(nportRows[0].assetCategory, 'EP');

    const thirteenFRows = await parse13FXmlForSpaceX(THIRTEEN_F_XML);
    assert.equal(thirteenFRows.length, 1);
    assert.equal(thirteenFRows[0].relationshipType, 'direct_holding');
    assert.equal(thirteenFRows[0].valueUsd, 1200000);
    assert.equal(thirteenFRows[0].sharesOrBalance, 100);

    const commercial = parseHtmlOrTextForSpaceX(COMMERCIAL_HTML);
    assert.equal(commercial.length, 1);
    assert.equal(commercial[0].relationshipType, 'commercial_context');

    const schedule = parseHtmlOrTextForSpaceX(HOLDING_HTML);
    assert.equal(schedule.length, 1);
    assert.equal(schedule[0].relationshipType, 'portfolio_schedule_holding');
    assert.equal(schedule[0].valueUsd, 12500000);

    const envSnapshot = snapshotEnv([
        'SEC_REQUEST_SPACING_MS',
        'OPENARENA_BEARER_TOKEN',
        'OPENARENA_SPACEX_EXPOSURE_WORKFLOW_ID',
        'OPENARENA_BASE_URL',
        'OPENARENA_SPACEX_EXPOSURE_TIMEOUT_SECONDS',
    ]);
    try {
        process.env.SEC_REQUEST_SPACING_MS = '0';
        process.env.OPENARENA_BEARER_TOKEN = 'test-token';
        process.env.OPENARENA_SPACEX_EXPOSURE_WORKFLOW_ID = 'workflow-id';
        process.env.OPENARENA_BASE_URL = 'https://openarena.test';
        process.env.OPENARENA_SPACEX_EXPOSURE_TIMEOUT_SECONDS = '2';

        const result = await runSpaceXExposureRadar(
            {
                startDate: '2024-01-01',
                endDate: '2026-05-26',
                forms: ['NPORT-P'],
                maxFilings: 5,
                aiVerify: false,
            },
            { fetchImpl: fakeFetch(NPORT_XML), now: new Date('2026-05-26T12:00:00.000Z'), requestSpacingMs: 0 }
        );
        assert.equal(result.summary.searchHitsDiscovered, 1);
        assert.equal(result.summary.filingsFetched, 1);
        assert.equal(result.summary.holdingRows, 1);
        assert.equal(result.rows[0].secDocumentUrl, 'https://www.sec.gov/Archives/edgar/data/1217673/000175272424124763/primary_doc.xml');

        const aiResult = await runSpaceXExposureRadar(
            {
                startDate: '2024-01-01',
                endDate: '2026-05-26',
                forms: ['8-K'],
                maxFilings: 1,
                aiVerify: true,
            },
            { fetchImpl: fakeFetch('<html><body><p>SpaceX appears in a portfolio update.</p></body></html>'), now: new Date('2026-05-26T12:00:00.000Z'), requestSpacingMs: 0 }
        );
        assert.equal(aiResult.summary.openArenaReviewed, 1);
        assert.equal(aiResult.rows[0].openArenaStatus, 'verified');
        assert.equal(aiResult.rows[0].relationshipType, 'portfolio_schedule_holding');

        const workbook = XLSX.read(buildSpaceXExposureWorkbook(result), { type: 'buffer' });
        assert.deepEqual(workbook.SheetNames, [
            'SpaceX Holdings',
            'Narrative Mentions',
            '13F Check',
            'OpenArena Review',
            'Run Summary',
            'Methodology',
        ]);
        assert.equal(
            buildSpaceXExposureExportFilename('2024-01-01', '2026-05-26'),
            'spacex-exposure-radar-2024-01-01-to-2026-05-26.xlsx'
        );

        const routeModule = await import('../app/api/spacex-exposure-radar/route');
        const previousFetch = globalThis.fetch;
        globalThis.fetch = fakeFetch(NPORT_XML);
        try {
            const response = await routeModule.POST(new Request('http://localhost/api/spacex-exposure-radar', {
                method: 'POST',
                body: JSON.stringify({ startDate: '2024-01-01', endDate: '2026-05-26', forms: ['NPORT-P'], maxFilings: 1 }),
                headers: { 'Content-Type': 'application/json' },
            }));
            assert.equal(response.status, 200);
            const json = await response.json();
            assert.equal(json.summary.holdingRows, 1);
        } finally {
            globalThis.fetch = previousFetch;
        }
    } finally {
        restoreEnv(envSnapshot);
    }

    console.log('SpaceX Exposure Radar unit tests passed.');
}

function baseSearchHit(term: string) {
    return {
        cik: '1217673',
        filerName: 'BARON SELECT FUNDS',
        form: 'NPORT-P',
        filingDate: '2024-05-29',
        periodEnd: '2024-03-31',
        accessionNumber: '0001752724-24-124763',
        documentName: 'primary_doc.xml',
        fileDescription: 'PRIMARY DOC',
        secDocumentUrl: 'https://www.sec.gov/Archives/edgar/data/1217673/000175272424124763/primary_doc.xml',
        secFilingUrl: 'https://www.sec.gov/Archives/edgar/data/1217673/000175272424124763/0001752724-24-124763-index.html',
        matchedTerms: [term],
    };
}

type TestSearchHit = ReturnType<typeof baseSearchHit>;

function searchHit(term: string, overrides: Partial<TestSearchHit> = {}) {
    return {
        ...baseSearchHit(term),
        ...overrides,
        matchedTerms: overrides.matchedTerms || [term],
    };
}

function fakeFetch(sourceDocument: string): typeof fetch {
    return async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;

        if (url.includes('openarena.test')) {
            assert.equal(url, 'https://openarena.test/v3/inference');
            const body = JSON.parse(String(init?.body || '{}'));
            assert.equal(body.workflow_id, 'workflow-id');
            assert.equal(typeof body.query, 'string');
            assert.equal(body.query.includes('Compact SEC facts JSON'), true);
            return new Response(JSON.stringify({
                result: {
                    answer: JSON.stringify({
                        relationship_type: 'portfolio_schedule_holding',
                        verification_status: 'verified',
                        confidence: 0.81,
                        notes: 'Looks like portfolio context.',
                        evidence_terms: ['SpaceX'],
                    }),
                },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (url.includes('search-index')) {
            return new Response(JSON.stringify({
                hits: {
                    total: { value: 1, relation: 'eq' },
                    hits: [{
                        _id: '0001752724-24-124763:primary_doc.xml',
                        _source: {
                            ciks: ['0001217673'],
                            display_names: ['BARON SELECT FUNDS  (CIK 0001217673)'],
                            form: 'NPORT-P',
                            root_forms: ['NPORT-P'],
                            file_date: '2024-05-29',
                            period_ending: '2024-03-31',
                            adsh: '0001752724-24-124763',
                            file_description: 'PRIMARY DOC',
                        },
                    }],
                },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (url.includes('/primary_doc.xml')) {
            return new Response(sourceDocument, { status: 200 });
        }

        return new Response('not found', { status: 404 });
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
