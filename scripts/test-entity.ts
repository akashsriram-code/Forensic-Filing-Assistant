import assert from 'node:assert/strict';
import { buildEntityProfile, normalizeEntityId, padCik, RECENT_FILINGS_LIMIT } from '../lib/entity';
import type { SecSubmission } from '../lib/sec-client';

type Row = { accession: string; date: string; form: string; doc?: string; report?: string; desc?: string; size?: number };

function fakeSubmission(overrides: Partial<SecSubmission>, rows: Row[]): SecSubmission {
    const recent = {
        accessionNumber: rows.map((r) => r.accession),
        filingDate: rows.map((r) => r.date),
        reportDate: rows.map((r) => r.report ?? ''),
        acceptanceDateTime: rows.map((r) => `${r.date}T16:00:00.000Z`),
        act: rows.map(() => '34'),
        form: rows.map((r) => r.form),
        fileNumber: rows.map(() => ''),
        filmNumber: rows.map(() => ''),
        items: rows.map(() => ''),
        size: rows.map((r) => r.size ?? 1000),
        isXBRL: rows.map(() => 0),
        isInlineXBRL: rows.map(() => 0),
        primaryDocument: rows.map((r) => r.doc ?? ''),
        primaryDocDescription: rows.map((r) => r.desc ?? ''),
    };
    return {
        cik: '1067983',
        entityType: 'operating',
        sic: '6331',
        sicDescription: 'Fire, Marine & Casualty Insurance',
        name: 'BERKSHIRE HATHAWAY INC',
        tickers: ['BRK-B', 'BRK-A'],
        exchanges: ['NYSE', 'NYSE'],
        ein: '',
        description: '',
        website: '',
        investorWebsite: '',
        category: '',
        fiscalYearEnd: '1231',
        stateOfIncorporation: 'DE',
        stateOfIncorporationDescription: 'DE',
        addresses: {} as SecSubmission['addresses'],
        phone: '',
        flags: '',
        filings: { recent },
        ...overrides,
    } as SecSubmission;
}

// Out of order on purpose: the profile must sort newest first.
const rows: Row[] = [
    { accession: '0000950170-26-000100', date: '2026-08-04', form: '10-Q', doc: 'brka-20260630.htm', report: '2026-06-30', desc: '10-Q' },
    { accession: '0000950123-26-011111', date: '2026-11-14', form: '13F-HR', doc: 'xslForm13F_X02/primary_doc.xml', report: '2026-09-30' },
    { accession: '0000950170-26-000200', date: '2026-11-03', form: '10-Q', doc: 'brka-20260930.htm', report: '2026-09-30' },
    { accession: '0000950170-26-000050', date: '2026-02-28', form: '10-K', doc: 'brka-20251231.htm', report: '2025-12-31', size: 9_000_000 },
    { accession: '0000950170-25-000050', date: '2025-02-22', form: '10-K', doc: 'brka-20241231.htm', report: '2024-12-31' },
    { accession: '0000950170-26-000060', date: '2026-03-10', form: '10-K/A', doc: 'brka-amend.htm' },
    { accession: '0001193125-26-000001', date: '2026-05-01', form: '8-K', doc: '' },
];
// Pad with old 4s so the newest-40 cut matters and the second 10-K sits past it.
for (let i = 0; i < 50; i++) {
    rows.push({ accession: `0001067983-26-${String(1000 + i).padStart(6, '0')}`, date: '2025-06-01', form: '4', doc: 'form4.xml' });
}
rows.push({ accession: '0000950170-24-000050', date: '2024-02-24', form: '10-K', doc: 'brka-20231231.htm' });

const profile = buildEntityProfile(fakeSubmission({}, rows));

assert.equal(profile.cik, '0001067983');
assert.equal(profile.name, 'BERKSHIRE HATHAWAY INC');
assert.deepEqual(profile.tickers, ['BRK-B', 'BRK-A']);
assert.equal(profile.sicDescription, 'Fire, Marine & Casualty Insurance');
assert.equal(profile.fiscalYearEnd, '1231');
assert.equal(profile.entityType, 'operating');
assert.equal(profile.filesHoldings, true);
assert.equal(profile.isCompany, true);
assert.deepEqual(profile.latestHoldingsFiling, {
    accessionNumber: '0000950123-26-011111',
    filingDate: '2026-11-14',
    reportDate: '2026-09-30',
    form: '13F-HR',
});

assert.equal(profile.recentFilings.length, RECENT_FILINGS_LIMIT);
assert.equal(profile.recentFilings[0].form, '13F-HR');
assert.equal(profile.recentFilings[1].accessionNumber, '0000950170-26-000200');
const dates = profile.recentFilings.map((f) => f.filingDate);
assert.deepEqual(dates, [...dates].sort().reverse(), 'recent filings are newest first');

const tenK = profile.recentFilings.find((f) => f.accessionNumber === '0000950170-26-000050');
assert.ok(tenK);
assert.equal(tenK.url, 'https://www.sec.gov/Archives/edgar/data/1067983/000095017026000050/brka-20251231.htm');
assert.equal(tenK.indexUrl, 'https://www.sec.gov/Archives/edgar/data/1067983/000095017026000050/0000950170-26-000050-index.htm');
assert.equal(tenK.reportDate, '2025-12-31');
assert.equal(tenK.size, 9_000_000);

// No primary document: the link falls back to the filing index; empty strings become null.
const eightK = profile.recentFilings.find((f) => f.form === '8-K');
assert.ok(eightK);
assert.equal(eightK.url, eightK.indexUrl);
assert.equal(eightK.reportDate, null);
assert.equal(eightK.description, null);

// Pairs: newest two of each exact form, amendments skipped, searched beyond the newest 40.
assert.deepEqual(
    profile.latestPairs.map((p) => [p.form, p.current.accessionNumber, p.previous.accessionNumber]),
    [
        ['10-K', '0000950170-26-000050', '0000950170-25-000050'],
        ['10-Q', '0000950170-26-000200', '0000950170-26-000100'],
    ]
);
assert.equal(profile.edgarUrl, 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1067983&owner=include&count=40');

// A pure 13F filer: no tickers, no annual reports.
const fund = buildEntityProfile(
    fakeSubmission(
        { cik: '0001364742', name: 'BlackRock Inc.', tickers: [], exchanges: [], sicDescription: '', stateOfIncorporation: '', fiscalYearEnd: '' },
        [
            { accession: '0001086364-26-000010', date: '2026-08-12', form: '13F-HR/A', doc: 'primary_doc.xml' },
            { accession: '0001086364-26-000009', date: '2026-08-10', form: '13F-HR', doc: 'primary_doc.xml' },
            { accession: '0001086364-26-000008', date: '2026-07-01', form: 'SC 13G/A', doc: 'doc.htm' },
        ]
    )
);
assert.equal(fund.cik, '0001364742');
assert.equal(fund.filesHoldings, true);
assert.equal(fund.isCompany, false);
assert.equal(fund.sicDescription, null);
assert.equal(fund.stateOfIncorporation, null);
assert.equal(fund.fiscalYearEnd, null);
assert.equal(fund.latestHoldingsFiling?.form, '13F-HR/A');
assert.deepEqual(fund.latestPairs, []);

// A foreign issuer with no ticker still counts as a company through its 20-F.
const foreign = buildEntityProfile(
    fakeSubmission({ tickers: [], exchanges: [] }, [
        { accession: '0000000001-26-000001', date: '2026-04-01', form: '20-F', doc: 'a.htm' },
        { accession: '0000000001-25-000001', date: '2025-04-01', form: '20-F', doc: 'b.htm' },
    ])
);
assert.equal(foreign.isCompany, true);
assert.equal(foreign.filesHoldings, false);
assert.equal(foreign.latestHoldingsFiling, null);
assert.deepEqual(foreign.latestPairs.map((p) => p.form), ['20-F']);

// Empty or missing filings don't crash.
const empty = buildEntityProfile(fakeSubmission({ filings: { recent: undefined } } as unknown as Partial<SecSubmission>, []));
assert.deepEqual(empty.recentFilings, []);
assert.deepEqual(empty.latestPairs, []);

// Ids.
assert.equal(padCik('1045810'), '0001045810');
assert.equal(normalizeEntityId(' nvda '), 'NVDA');
assert.equal(normalizeEntityId('brk.a'), 'BRK-A');
assert.equal(normalizeEntityId('BRK-B'), 'BRK-B');
assert.equal(normalizeEntityId('0001045810'), '0001045810');
assert.equal(normalizeEntityId('CIK0001045810'), '1045810');
assert.equal(normalizeEntityId(1045810), '1045810');
assert.equal(normalizeEntityId('  berkshire   hathaway '), 'berkshire hathaway');
assert.equal(normalizeEntityId(''), null);
assert.equal(normalizeEntityId(undefined), null);
assert.equal(normalizeEntityId({}), null);

console.log('test-entity: all assertions passed');
