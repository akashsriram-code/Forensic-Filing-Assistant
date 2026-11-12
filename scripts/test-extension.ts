import assert from 'node:assert/strict';
import { alertMessage, alertTiming, alertTitle, formDisplay, formLabel, lagText, shortCompanyName } from '../extension/src/core/copy';
import { decodeEntities, feedUrl, isBlockResponse, parseFeed } from '../extension/src/core/feed';
import { buildTracked, etDate, normalizeFollows, shouldNotify } from '../extension/src/core/match';
import { RateLimiter, backstopIntervalMs, edgarOpen, errorBackoffMs, feedIntervalMs, needsBackfill, OFF_HOURS_FEED_MS } from '../extension/src/core/schedule';
import { RingSet } from '../extension/src/core/seen';
import { padCik, recentFrom, submissionsUrl } from '../extension/src/core/submissions';
import { parseTickerMap, resolveCik } from '../extension/src/core/tickers';
import type { Follow } from '../extension/src/core/types';
import { ALERT_FORM_TYPES, formMatches as followsFormMatches } from '../lib/follows';
import { formMatches } from '../lib/sec-forms';

// Two real entries from EDGAR's live feed (2026-11-10): one Form 4, listed once for the issuer and once for the insider,
// plus a Schedule 13D/A pair and a company name with an escaped ampersand.
const FEED = `<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Latest Filings - Thu, 12 Nov 2026 05:12:05 EST</title>
<updated>2026-11-12T05:12:05-05:00</updated>
<entry>
<title>4 - LanzaTech Global, Inc. (0001843724) (Issuer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1843724/000119312526456010/0001193125-26-456010-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-11-10 &lt;b&gt;AccNo:&lt;/b&gt; 0001193125-26-456010 &lt;b&gt;Size:&lt;/b&gt; 6 KB</summary>
<updated>2026-11-10T21:59:02-05:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="4"/>
<id>urn:tag:sec.gov,2008:accession-number=0001193125-26-456010</id>
</entry>
<entry>
<title>4 - KHOSLA VINOD (0001032453) (Reporting)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1032453/000119312526456010/0001193125-26-456010-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-11-10 &lt;b&gt;AccNo:&lt;/b&gt; 0001193125-26-456010 &lt;b&gt;Size:&lt;/b&gt; 6 KB</summary>
<updated>2026-11-10T21:59:02-05:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="4"/>
<id>urn:tag:sec.gov,2008:accession-number=0001193125-26-456010</id>
</entry>
<entry>
<title>SCHEDULE 13D/A - Hoge Brett Widney (0001966393) (Filed by)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1966393/000149315226051080/0001493152-26-051080-index.htm"/>
<updated>2026-11-10T21:53:34-05:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="SCHEDULE 13D/A"/>
<id>urn:tag:sec.gov,2008:accession-number=0001493152-26-051080</id>
</entry>
<entry>
<title>SCHEDULE 13D/A - Newton Golf Company, Inc. (0001934245) (Subject)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1934245/000149315226051080/0001493152-26-051080-index.htm"/>
<updated>2026-11-10T21:53:34-05:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="SCHEDULE 13D/A"/>
<id>urn:tag:sec.gov,2008:accession-number=0001493152-26-051080</id>
</entry>
<entry>
<title>8-K - AT&amp;T INC. (0000732717) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/732717/000073271726000099/0000732717-26-000099-index.htm"/>
<updated>2026-11-10T16:05:00-05:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="8-K"/>
<id>urn:tag:sec.gov,2008:accession-number=0000732717-26-000099</id>
</entry>
<entry>
<title>garbage without the expected shape</title>
<updated>not a date</updated>
</entry>
</feed>`;

// ---- feed parsing ----

const entries = parseFeed(FEED);
assert.equal(entries.length, 5, 'malformed entries are skipped');
assert.deepEqual(entries[0], {
    accession: '0001193125-26-456010',
    cik: '0001843724',
    role: 'Issuer',
    form: '4',
    company: 'LanzaTech Global, Inc.',
    acceptedAt: Date.parse('2026-11-11T02:59:02.000Z'),
    indexUrl: 'https://www.sec.gov/Archives/edgar/data/1843724/000119312526456010/0001193125-26-456010-index.htm',
});
assert.equal(entries[1].accession, entries[0].accession, 'issuer and insider rows share one accession');
assert.equal(entries[1].cik, '0001032453');
assert.equal(entries[1].role, 'Reporting');
assert.equal(entries[2].role, 'Filed by');
assert.equal(entries[3].role, 'Subject');
assert.equal(entries[3].form, 'SCHEDULE 13D/A');
assert.equal(entries[4].company, 'AT&T INC.', 'entities decoded');
assert.equal(decodeEntities('A &#38; B &#x26; C &lt;D&gt; &unknown;'), 'A & B & C <D> &unknown;');
assert.match(feedUrl(100), /action=getcurrent.*start=100&count=100&output=atom/);

assert.ok(isBlockResponse(403, ''));
assert.ok(isBlockResponse(429, ''));
assert.ok(isBlockResponse(200, '<html><title>SEC.gov | Request Rate Threshold Exceeded</title>'));
assert.ok(!isBlockResponse(200, FEED));

// ---- submissions ----

const submissions = {
    cik: '1934245',
    name: 'Newton Golf Company, Inc.',
    filings: {
        recent: {
            accessionNumber: ['0001493152-26-051085', '0001493152-26-051080', '0001493152-26-050000'],
            form: ['4', 'SCHEDULE 13D/A', '8-K'],
            acceptanceDateTime: ['2026-11-11T02:56:20.000Z', '2026-11-11T02:53:34.000Z', ''],
            filingDate: ['2026-11-10', '2026-11-10', '2026-11-02'],
            primaryDocument: ['xslF345X06/ownership.xml', 'xslSCHEDULE_13D_X01/primary_doc.xml', 'ngc-8k.htm'],
        },
    },
};
const rows = recentFrom(submissions);
assert.equal(rows.length, 2, 'rows without an acceptance time are skipped');
assert.equal(rows[0].cik, '0001934245');
assert.equal(rows[0].primaryDocument, 'xslF345X06/ownership.xml');
assert.equal(rows[0].acceptedAt, Date.parse('2026-11-11T02:56:20.000Z'));
assert.deepEqual(recentFrom(null), []);
assert.equal(recentFrom(submissions, 1).length, 1);
assert.equal(submissionsUrl('320193'), 'https://data.sec.gov/submissions/CIK0000320193.json');
assert.equal(padCik(1234), '0000001234');

// ---- tickers ----

const tickerMap = parseTickerMap({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 1067983, ticker: 'BRK-B', title: 'Berkshire' } });
assert.equal(resolveCik('aapl', tickerMap), '0000320193');
assert.equal(resolveCik('BRK.B', tickerMap), '0001067983', 'dot tickers map to the SEC dash form');
assert.equal(resolveCik('1067983', tickerMap), '0001067983', 'a bare CIK (fund follow) needs no lookup');
assert.equal(resolveCik('NOPE', tickerMap), null);

// ---- matching ----

assert.equal(followsFormMatches, formMatches, 'lib/follows re-exports the shared matcher');
assert.ok(formMatches('SCHEDULE 13D/A', ['SC 13D']), 'new schedule names match old-style follows');
assert.ok(formMatches('SC 13G', ['SC 13G']));
assert.ok(formMatches('4', ['4']) && formMatches('4/A', ['4']));
assert.ok(!formMatches('424B4', ['4']), 'a Form 4 follow ignores prospectuses');
assert.ok(formMatches('13F-HR', ['13F']));
assert.ok(formMatches('10-K/A', ['10-K']));
assert.ok(!formMatches('8-K', ['10-K', '10-Q']));

const follows: Follow[] = [
    { ticker: 'LNZA', types: ['4', '8-K'], since: '2026-11-01' },
    { ticker: '1966393', types: ['SC 13D'], since: '2026-11-10' },
    { ticker: 'GONE', types: ['8-K'], since: '2026-11-01' },
];
const tracked = buildTracked(follows, { LNZA: '0001843724' });
assert.deepEqual([...tracked.byCik.keys()], ['0001843724', '0001966393']);
assert.deepEqual(tracked.unresolved, ['GONE']);

const lanza = follows[0];
const accepted = entries[0].acceptedAt;
assert.ok(shouldNotify(lanza, '4', accepted, accepted - 1));
assert.ok(!shouldNotify(lanza, '4', accepted, accepted), 'filings accepted before watching started never alert');
assert.ok(!shouldNotify(lanza, '10-K', accepted, 0), 'unfollowed form types never alert');
assert.ok(!shouldNotify({ ...lanza, since: '2026-11-11' }, '4', accepted, 0), 'filings before the follow date never alert');
assert.equal(etDate(accepted), '2026-11-10', 'a 9:59 PM ET filing is dated by the Eastern calendar, not UTC');

assert.deepEqual(normalizeFollows(['aapl', { ticker: 'msft' }, { nope: 1 }], ALERT_FORM_TYPES, '2026-11-12'), [
    { ticker: 'AAPL', types: [...ALERT_FORM_TYPES], since: '2026-11-12' },
    { ticker: 'MSFT', types: [...ALERT_FORM_TYPES], since: '2026-11-12' },
]);
assert.deepEqual(normalizeFollows('not an array', ALERT_FORM_TYPES, '2026-11-12'), []);

// ---- dedupe ----

const handled = new RingSet(3);
const alerted: string[] = [];
const offer = (accession: string) => {
    if (handled.add(accession)) alerted.push(accession);
};
offer(entries[0].accession); // feed: issuer row
offer(entries[1].accession); // feed: insider row, same filing
offer(rows[0].accession); // backstop
offer(rows[0].accession); // backstop again on the next rotation
assert.deepEqual(alerted, [entries[0].accession, rows[0].accession], 'one alert per filing, whichever source sees it first');
handled.add('a');
handled.add('b');
assert.ok(!handled.has(entries[0].accession), 'the oldest entries are forgotten past the cap');
assert.equal(handled.size, 3);
assert.deepEqual(new RingSet(2, ['x', 'y', 'z']).toJSON(), ['y', 'z']);

// ---- schedule and rate ----

const et = (iso: string) => Date.parse(iso);
assert.ok(edgarOpen(et('2026-11-12T06:00:00-05:00')), 'opens 6:00 ET (winter, EST)');
assert.ok(!edgarOpen(et('2026-11-12T05:59:00-05:00')));
assert.ok(edgarOpen(et('2026-11-12T21:59:00-05:00')));
assert.ok(!edgarOpen(et('2026-11-12T22:00:00-05:00')), 'closes 22:00 ET');
assert.ok(edgarOpen(et('2026-07-14T06:30:00-04:00')), 'summer time (EDT)');
assert.ok(!edgarOpen(et('2026-07-14T05:30:00-04:00')));
assert.ok(!edgarOpen(et('2026-11-14T12:00:00-05:00')), 'Saturday');
assert.ok(!edgarOpen(et('2026-11-15T12:00:00-05:00')), 'Sunday');
assert.ok(edgarOpen(et('2026-03-09T10:00:00-04:00')), 'Monday after the DST change');
assert.ok(!edgarOpen(et('2026-11-13T03:30:00Z')), '10:30 PM Thursday ET is a different UTC day but still closed');

const open = et('2026-11-12T10:00:00-05:00');
const closed = et('2026-11-12T23:00:00-05:00');
assert.equal(feedIntervalMs(open, 1000), 1000);
assert.equal(feedIntervalMs(closed, 1000), OFF_HOURS_FEED_MS);
assert.equal(backstopIntervalMs(open, 1000), 500, 'backstop runs at twice the feed pace');
assert.ok(backstopIntervalMs(closed, 1000) > 1000);

const limiter = new RateLimiter(4, 1000);
const sent: number[] = [];
for (let t = 0; t < 5000; t += 10) if (limiter.tryAcquire(t)) sent.push(t);
for (const start of sent) {
    assert.ok(sent.filter((t) => t >= start && t < start + 1000).length <= 4, 'never more than 4 requests in any second');
}
assert.equal(sent.length, 20, 'and uses the full budget');
const busy = new RateLimiter(1, 1000);
busy.tryAcquire(0);
assert.equal(busy.waitMs(300), 700);
assert.equal(busy.waitMs(1000), 0);

const previous = new Set(['A', 'B']);
assert.ok(!needsBackfill(previous, ['C', 'B']), 'overlap with the last check: nothing missed');
assert.ok(needsBackfill(previous, ['D', 'C']), 'no overlap: more than a page arrived, read older pages');
assert.ok(!needsBackfill(null, ['D']), 'first check after start: nothing to compare');
assert.equal(errorBackoffMs(1), 2000);
assert.equal(errorBackoffMs(3), 8000);
assert.equal(errorBackoffMs(20), 60000);

// ---- cold start: what is already in the feed never alerts ----

{
    const now = Date.parse('2026-11-11T03:00:00.000Z');
    const floor = now; // the extension starts watching now
    const cold = parseFeed(FEED).filter((entry) => entry.cik === '0001843724' && shouldNotify(lanza, entry.form, entry.acceptedAt, floor));
    assert.equal(cold.length, 0);
}

// ---- wording ----

assert.equal(alertTitle('LanzaTech Global, Inc.', '4'), 'LanzaTech Global filed a Form 4 (insider trade)');
assert.equal(alertTitle('STARBUCKS CORP', '8-K'), 'Starbucks filed an 8-K (major event)');
assert.equal(alertTitle('Apple Inc.', '10-K'), 'Apple filed a 10-K (annual report)');
assert.equal(alertTitle('Newton Golf Company, Inc.', 'SCHEDULE 13D/A'), 'Newton Golf Company filed an amended Schedule 13D (activist stake)');
assert.equal(alertTitle('Acme Corp', 'S-1'), 'Acme filed an S-1 (IPO registration)');
assert.equal(alertTitle('Big Fund LLC', '13F-HR'), 'Big Fund filed a 13F-HR (fund holdings)');
assert.equal(alertTitle('Acme Corp', 'CORRESP'), 'Acme filed a CORRESP');
assert.equal(formDisplay('SC 13G'), 'Schedule 13G');
assert.equal(formLabel('424B2'), 'prospectus');
assert.equal(shortCompanyName('KHOSLA VINOD'), 'Khosla Vinod');
assert.equal(shortCompanyName('Paul R. Ried Financial Group, LLC'), 'Paul R. Ried Financial Group');
assert.equal(lagText(400), 'under 1s');
assert.equal(lagText(2400), '2s');
assert.equal(lagText(4 * 60_000), '4 min');

const acceptedAt = Date.parse('2026-11-11T02:59:02.000Z');
assert.equal(alertMessage(acceptedAt, acceptedAt + 2000, 'Issuer'), 'Accepted 9:59:02 PM ET · caught 2s later');
assert.equal(alertMessage(acceptedAt, acceptedAt + 1500, 'Reporting'), 'Accepted 9:59:02 PM ET · caught 2s later · as reporting owner (insider)');
assert.equal(alertMessage(acceptedAt, acceptedAt + 3 * 3_600_000, null), 'Accepted Tue 9:59 PM ET · while you were away');

// Timing: EDGAR holds evening, weekend and holiday filings until 6 AM. Seen live on 2026-11-12, when filings accepted
// Tuesday night (before the Veterans Day holiday) were published at 6:00 Thursday, 33 hours after acceptance.
const sixAm = Date.parse('2026-11-12T11:00:30.000Z');
assert.equal(alertTiming(sixAm - 3000, sixAm, sixAm - 3_600_000), 'live');
assert.equal(alertTiming(acceptedAt, sixAm, acceptedAt - 1000), 'released', 'watching all night: a held filing was just published');
assert.equal(alertTiming(acceptedAt, sixAm, sixAm - 60_000), 'away', 'only just started watching: it may have been public a while');
assert.equal(alertTiming(acceptedAt, sixAm, 0), 'away', 'no feed check yet');
assert.equal(
    alertMessage(acceptedAt, sixAm, 'Issuer', 'released'),
    'Accepted Tue 9:59 PM ET · just released by EDGAR',
);

console.log('extension tests passed');
