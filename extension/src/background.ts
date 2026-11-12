/**
 * SCOUT Live background service worker.
 *
 * Two loops run while anything is followed:
 *  - the feed loop reads EDGAR's live "Latest Filings" feed every second (every 20s outside EDGAR hours) and alerts on
 *    any filing whose filer, issuer or subject is followed;
 *  - the backstop loop reads one followed filer's submissions file at a time, round-robin, so a filing the feed
 *    missed (a surge, or the computer was asleep) still arrives, and so alerts can link straight to the main document.
 * Each feed check writes a status record to chrome.storage.session; that extension API call is what keeps Chrome
 * from shutting the worker down, and a 30-second alarm restarts the loops if it does anyway.
 */
import { ALERT_FORM_TYPES as ALERT_TYPES } from '../../lib/follows';
import { alertMessage, alertTiming, alertTitle } from './core/copy';
import { feedUrl, isBlockResponse, parseFeed, FEED_PAGE_SIZE } from './core/feed';
import { buildTracked, etDate, normalizeFollows, shouldNotify, type Tracked } from './core/match';
import { BLOCK_BACKOFF_MS, RateLimiter, backstopIntervalMs, edgarOpen, errorBackoffMs, feedIntervalMs, needsBackfill } from './core/schedule';
import { RingSet } from './core/seen';
import { recentFrom, submissionsUrl } from './core/submissions';
import { TICKERS_MAX_AGE_MS, TICKERS_URL, parseTickerMap } from './core/tickers';
import { DEFAULT_SETTINGS, type Alert, type FeedEntry, type Follow, type LiveStatus, type Settings } from './core/types';
import { filingIndexUrl, primaryDocUrl } from '../../lib/sec-urls';

const UA_RULE_ID = 1;
const WATCHDOG = 'scout-live-watchdog';
const MAX_ALERTS_KEPT = 50;
const MAX_HANDLED = 5000;
const FETCH_TIMEOUT_MS = 10_000;
/** After this long without a feed check, the last feed page is too old to backfill from; the backstop covers it. */
const BACKFILL_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_BACKFILL_PAGES = 3;
/** After the computer was off or asleep, catch up on at most this much missed history per filer. */
const CATCH_UP_MS = 72 * 60 * 60 * 1000;

// ---- state (rebuilt from storage whenever the worker starts) ----

let settings: Settings = { ...DEFAULT_SETTINGS };
let follows: Follow[] = [];
let tickerMap: Record<string, string> = {};
let tickersFetchedAt = 0;
let tracked: Tracked = { byCik: new Map(), unresolved: [] };
/** CIK -> epoch ms when the extension started watching it. Filings accepted earlier never alert. */
let floors: Record<string, number> = {};
/** Accessions already alerted on (or deliberately skipped), so the feed and the backstop never double-alert. */
let handled = new RingSet(MAX_HANDLED);
let alerts: Alert[] = [];
let blockedUntil = 0;

let lastFeedAccessions: Set<string> | null = null;
let lastFeedAt = 0;
/** Start of the current unbroken run of feed checks; tells "EDGAR just released it" from "you were away". */
let watchingSince = 0;
/** A pause longer than this between feed checks (sleep, shutdown, SEC block) breaks the run. */
const WATCH_GAP_MS = 2 * 60 * 1000;
let lastLatencyMs: number | null = null;
let feedErrors = 0;
let backstopCursor = 0;
/**
 * Main-document lookups for fresh feed alerts, checked ahead of the rotation. The submissions file lists a filing
 * about 35 seconds after the feed does (measured 2026-11-12), so the first try waits 20s and retries follow.
 */
interface DocLookup {
    cik: string;
    accession: string;
    at: number;
    tries: number;
}
const docLookups: DocLookup[] = [];
const DOC_LOOKUP_FIRST_MS = 20_000;
const DOC_LOOKUP_RETRY_MS = 15_000;
const DOC_LOOKUP_MAX_TRIES = 6;

const limiter = new RateLimiter();
let ready: Promise<void> | null = null;
let feedRunning = false;
let backstopRunning = false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

// ---- storage ----

async function loadState(): Promise<void> {
    const stored = await chrome.storage.local.get(['settings', 'follows', 'tickers', 'floors', 'handled', 'alerts', 'blockedUntil']);
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
    follows = normalizeFollows(stored.follows, ALERT_TYPES, etDate(Date.now()));
    const tickers = stored.tickers as { fetchedAt: number; map: Record<string, string> } | undefined;
    tickerMap = tickers?.map ?? {};
    tickersFetchedAt = tickers?.fetchedAt ?? 0;
    floors = (stored.floors as Record<string, number> | undefined) ?? {};
    handled = new RingSet(MAX_HANDLED, (stored.handled as string[] | undefined) ?? []);
    alerts = (stored.alerts as Alert[] | undefined) ?? [];
    blockedUntil = (stored.blockedUntil as number | undefined) ?? 0;

    const session = await chrome.storage.session.get(['lastFeed']);
    const lastFeed = session.lastFeed as { at: number; accessions: string[]; watchingSince?: number } | undefined;
    if (lastFeed && Date.now() - lastFeed.at < BACKFILL_MAX_AGE_MS) {
        lastFeedAccessions = new Set(lastFeed.accessions);
        lastFeedAt = lastFeed.at;
        watchingSince = lastFeed.watchingSince ?? 0;
    }
    rebuildTracked();
}

function rebuildTracked(): void {
    tracked = buildTracked(follows, tickerMap);
    const now = Date.now();
    const next: Record<string, number> = {};
    // Keep the start time for filers still followed; a newly followed filer starts now. Unfollowing forgets it, so
    // following again later doesn't replay what was filed in between.
    for (const cik of tracked.byCik.keys()) next[cik] = floors[cik] ?? now;
    const changed = JSON.stringify(next) !== JSON.stringify(floors);
    floors = next;
    if (changed) void chrome.storage.local.set({ floors });
}

async function writeStatus(partial?: Partial<LiveStatus>): Promise<void> {
    const now = Date.now();
    const setupNeeded = !settings.email;
    const paused = blockedUntil > now;
    let state: LiveStatus['state'];
    let message: string;
    if (setupNeeded) {
        state = 'setup';
        message = 'Add your email in Options to start. The SEC requires a contact address on automated requests.';
    } else if (paused) {
        state = 'paused';
        message = `Paused: the SEC asked us to slow down. Resumes at ${new Date(blockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
    } else if (follows.length === 0) {
        state = 'idle';
        message = 'Not following anyone yet. Follow a company in SCOUT to get live alerts.';
    } else if (feedErrors > 0) {
        state = 'error';
        message = "Can't reach the SEC right now. Retrying automatically.";
    } else if (!edgarOpen(now)) {
        state = 'offhours';
        message = 'EDGAR is closed (it publishes 6am–10pm ET on weekdays). Checking every 20 seconds.';
    } else {
        state = 'live';
        const seconds = settings.pollMs / 1000;
        message = `Live: checking EDGAR every ${seconds === 1 ? 'second' : `${seconds} seconds`}.`;
    }
    const status: LiveStatus = {
        state,
        message,
        lastPollAt: lastFeedAt || null,
        lastLatencyMs,
        followCount: follows.length,
        unresolved: tracked.unresolved,
        blockedUntil: paused ? blockedUntil : null,
        ...partial,
    };
    await chrome.storage.session.set({ status });
    await updateBadge(state);
}

async function updateBadge(state: LiveStatus['state']): Promise<void> {
    const unread = alerts.filter((alert) => !alert.read).length;
    let text = unread > 0 ? String(Math.min(unread, 99)) : '';
    let color = '#b45309';
    if (state === 'paused' || state === 'error') {
        text = '!';
        color = '#b91c1c';
    } else if (state === 'setup') {
        text = '?';
        color = '#6b7280';
    }
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
}

// ---- network ----

/** User-Agent with the reader's contact address, as the SEC's fair-access policy requires. Only touches our own requests. */
async function applyUserAgentRule(): Promise<void> {
    const rules: chrome.declarativeNetRequest.Rule[] = settings.email
        ? [
              {
                  id: UA_RULE_ID,
                  priority: 1,
                  action: {
                      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
                      requestHeaders: [
                          {
                              header: 'user-agent',
                              operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
                              value: `SCOUT Live newsroom alerts ${settings.email}`,
                          },
                      ],
                  },
                  condition: {
                      requestDomains: ['sec.gov'],
                      tabIds: [chrome.tabs.TAB_ID_NONE],
                      resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType],
                  },
              },
          ]
        : [];
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [UA_RULE_ID], addRules: rules });
}

class BlockedError extends Error {}

async function secFetch(url: string): Promise<{ status: number; body: string; ms: number }> {
    for (;;) {
        const wait = limiter.waitMs(Date.now());
        if (wait === 0 && limiter.tryAcquire(Date.now())) break;
        await sleep(wait || 50);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const started = Date.now();
    try {
        const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        // The feed is ISO-8859-1; the JSON is ASCII, so this decoder is safe for both.
        const body = new TextDecoder('windows-1252').decode(await response.arrayBuffer());
        if (isBlockResponse(response.status, body)) {
            blockedUntil = Date.now() + BLOCK_BACKOFF_MS;
            await chrome.storage.local.set({ blockedUntil });
            throw new BlockedError('SEC rate limit');
        }
        return { status: response.status, body, ms: Date.now() - started };
    } finally {
        clearTimeout(timer);
    }
}

async function refreshTickers(): Promise<void> {
    if (Date.now() - tickersFetchedAt < TICKERS_MAX_AGE_MS && Object.keys(tickerMap).length > 0) return;
    const needed = follows.some((follow) => !/^\d+$/.test(follow.ticker));
    if (!needed) return;
    const { status, body } = await secFetch(TICKERS_URL);
    if (status !== 200) return;
    tickerMap = parseTickerMap(JSON.parse(body));
    tickersFetchedAt = Date.now();
    await chrome.storage.local.set({ tickers: { fetchedAt: tickersFetchedAt, map: tickerMap } });
    rebuildTracked();
}

// ---- alerts ----

function readerUrl(docUrl: string): string {
    return `${settings.scoutUrl}/reader?url=${encodeURIComponent(docUrl)}`;
}

function companyUrl(alert: Alert): string {
    const id = encodeURIComponent(alert.follow);
    return /^13F/i.test(alert.form) ? `${settings.scoutUrl}/fund/${id}` : `${settings.scoutUrl}/company/${id}`;
}

let handledDirty = false;

function markHandled(accession: string): void {
    if (handled.add(accession)) handledDirty = true;
}

async function persistHandled(): Promise<void> {
    if (!handledDirty) return;
    handledDirty = false;
    await chrome.storage.local.set({ handled: handled.toJSON() });
}

async function saveAlerts(): Promise<void> {
    alerts = alerts.slice(0, MAX_ALERTS_KEPT);
    await chrome.storage.local.set({ alerts });
    await persistHandled();
}

/** Never alert on filings from before the extension watched this filer, or from more than three days back. */
function floorFor(cik: string, now: number): number {
    return Math.max(floors[cik] ?? now, now - CATCH_UP_MS);
}

async function raiseAlert(alert: Alert): Promise<void> {
    alert.timing = alertTiming(alert.acceptedAt, alert.caughtAt, watchingSince);
    alerts.unshift(alert);
    try {
        await chrome.notifications.create(alert.id, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: alertTitle(alert.company, alert.form),
            message: alertMessage(alert.acceptedAt, alert.caughtAt, alert.role, alert.timing),
            contextMessage: 'SCOUT Live',
            priority: 2,
            requireInteraction: true,
            buttons: [{ title: 'Open in SCOUT Reader' }, { title: 'Company page' }],
        });
    } catch {
        // Notifications switched off for the browser: the alert still shows in the popup and on the badge.
    }
    await saveAlerts();
}

/** Every feed entry about a followed filer that is new, recent enough and of a followed form type. */
async function handleFeedEntries(entries: FeedEntry[], caughtAt: number): Promise<void> {
    for (const entry of entries) {
        const follow = tracked.byCik.get(entry.cik);
        if (!follow || handled.has(entry.accession)) continue;
        const floor = floorFor(entry.cik, caughtAt);
        if (entry.acceptedAt <= floor) continue;
        markHandled(entry.accession);
        if (!shouldNotify(follow, entry.form, entry.acceptedAt, floor)) continue;
        // Alert straight away with the filing index; the backstop then looks up the main document for the click.
        docLookups.push({ cik: entry.cik, accession: entry.accession, at: caughtAt + DOC_LOOKUP_FIRST_MS, tries: 0 });
        await raiseAlert({
            id: entry.accession,
            cik: entry.cik,
            follow: follow.ticker,
            company: entry.company,
            form: entry.form,
            role: entry.role,
            acceptedAt: entry.acceptedAt,
            caughtAt,
            docUrl: entry.indexUrl || filingIndexUrl(entry.cik, entry.accession) || '',
            source: 'feed',
            read: false,
        });
    }
    await persistHandled();
}

async function checkFeed(): Promise<void> {
    const first = await secFetch(feedUrl(0));
    lastLatencyMs = first.ms;
    if (first.status !== 200) throw new Error(`feed HTTP ${first.status}`);
    const caughtAt = Date.now();
    let entries = parseFeed(first.body);
    const pageOne = entries.map((entry) => entry.accession);

    // More than a page arrived since the last check: read back until we overlap with it.
    let pages = 1;
    let older = entries;
    while (needsBackfill(lastFeedAccessions, older.map((entry) => entry.accession)) && pages < MAX_BACKFILL_PAGES && older.length > 0) {
        const page = await secFetch(feedUrl(pages * FEED_PAGE_SIZE));
        if (page.status !== 200) break;
        older = parseFeed(page.body);
        entries = entries.concat(older);
        pages += 1;
    }

    if (!lastFeedAt || !watchingSince || caughtAt - lastFeedAt > WATCH_GAP_MS) watchingSince = caughtAt;
    lastFeedAccessions = new Set(pageOne);
    lastFeedAt = caughtAt;
    await chrome.storage.session.set({ lastFeed: { at: caughtAt, accessions: pageOne, watchingSince } });
    await handleFeedEntries(entries, caughtAt);
}

/** One followed filer's submissions file: catches anything the feed missed and fills in main-document links. */
async function checkSubmissions(cik: string): Promise<void> {
    const follow = tracked.byCik.get(cik);
    if (!follow) return;
    const { status, body } = await secFetch(submissionsUrl(cik));
    if (status !== 200) return;
    const rows = recentFrom(JSON.parse(body), 40);
    const caughtAt = Date.now();
    const floor = floorFor(cik, caughtAt);
    let alertsChanged = false;

    for (const row of rows) {
        const existing = alerts.find((alert) => alert.id === row.accession);
        if (existing && row.primaryDocument) {
            const doc = primaryDocUrl(row.cik, row.accession, row.primaryDocument);
            if (doc && doc !== existing.docUrl) {
                existing.docUrl = doc;
                alertsChanged = true;
            }
        }
        if (row.acceptedAt <= floor || handled.has(row.accession)) continue;
        markHandled(row.accession);
        if (!shouldNotify(follow, row.form, row.acceptedAt, floor)) continue;
        await raiseAlert({
            id: row.accession,
            cik,
            follow: follow.ticker,
            company: row.company,
            form: row.form,
            role: null,
            acceptedAt: row.acceptedAt,
            caughtAt,
            docUrl: primaryDocUrl(row.cik, row.accession, row.primaryDocument) || filingIndexUrl(row.cik, row.accession) || '',
            source: 'backstop',
            read: false,
        });
        alertsChanged = true;
    }
    if (alertsChanged) await saveAlerts();
    else await persistHandled();
}

// ---- loops ----

/** Polling needs the SEC contact email and at least one follow. Tickers are matched to CIKs inside the feed loop. */
function canPoll(): boolean {
    return Boolean(settings.email) && follows.length > 0;
}

async function feedLoop(): Promise<void> {
    if (feedRunning) return;
    feedRunning = true;
    try {
        while (canPoll()) {
            const started = Date.now();
            if (blockedUntil > started) {
                await writeStatus();
                await sleep(Math.min(blockedUntil - started, 25_000));
                continue;
            }
            try {
                await refreshTickers();
                await checkFeed();
                feedErrors = 0;
            } catch (error) {
                if (!(error instanceof BlockedError)) feedErrors += 1;
            }
            await writeStatus();
            const delay = feedErrors > 0 ? errorBackoffMs(feedErrors) : feedIntervalMs(Date.now(), settings.pollMs);
            await sleep(delay - (Date.now() - started));
        }
        await writeStatus();
    } finally {
        feedRunning = false;
    }
}

async function backstopLoop(): Promise<void> {
    if (backstopRunning) return;
    backstopRunning = true;
    try {
        while (canPoll()) {
            const started = Date.now();
            const ciks = [...tracked.byCik.keys()];
            if (blockedUntil <= started && ciks.length > 0) {
                const due = docLookups.findIndex((lookup) => lookup.at <= started);
                const lookup = due >= 0 ? docLookups.splice(due, 1)[0] : null;
                const cik = lookup?.cik ?? ciks[backstopCursor++ % ciks.length];
                try {
                    await checkSubmissions(cik);
                } catch {
                    // The feed loop reports connection problems; the backstop just moves on.
                }
                // Not listed yet: try again shortly.
                const alert = lookup && alerts.find((item) => item.id === lookup.accession);
                if (lookup && alert && /-index\.htm$/.test(alert.docUrl) && lookup.tries + 1 < DOC_LOOKUP_MAX_TRIES) {
                    docLookups.push({ ...lookup, at: Date.now() + DOC_LOOKUP_RETRY_MS, tries: lookup.tries + 1 });
                }
            }
            await sleep(backstopIntervalMs(Date.now(), settings.pollMs) - (Date.now() - started));
        }
    } finally {
        backstopRunning = false;
    }
}

/** Loads state once per worker start. A failed start is forgotten so the next event or watchdog alarm retries it. */
function whenReady(): Promise<void> {
    ready ??= init().catch((error: unknown) => {
        ready = null;
        throw error;
    });
    return ready;
}

function ensureLoops(): void {
    whenReady().then(
        () => {
            void feedLoop();
            void backstopLoop();
        },
        () => undefined,
    );
}

async function init(): Promise<void> {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
    await loadState();
    await applyUserAgentRule();
    await registerSiteScript();
    await chrome.alarms.create(WATCHDOG, { periodInMinutes: 0.5 });
    await writeStatus();
}

// ---- SCOUT site content script for a custom address ----

const SITE_SCRIPT_ID = 'scout-site';

async function registerSiteScript(): Promise<void> {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SITE_SCRIPT_ID] });
    if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [SITE_SCRIPT_ID] });
    let origin: string;
    try {
        origin = new URL(settings.scoutUrl).origin;
    } catch {
        return;
    }
    if (origin === 'http://localhost:3000') return; // covered by the manifest
    const pattern = `${origin}/*`;
    if (!(await chrome.permissions.contains({ origins: [pattern] }))) return;
    await chrome.scripting.registerContentScripts([{ id: SITE_SCRIPT_ID, matches: [pattern], js: ['content.js'], runAt: 'document_start' }]);
}

// ---- events ----

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void chrome.runtime.openOptionsPage();
    ensureLoops();
});
chrome.runtime.onStartup.addListener(ensureLoops);
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCHDOG) ensureLoops();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    void whenReady().then(async () => {
        if (changes.follows) {
            follows = normalizeFollows(changes.follows.newValue, ALERT_TYPES, etDate(Date.now()));
            rebuildTracked();
            await writeStatus();
        }
        if (changes.settings) {
            settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<Settings> | undefined) };
            await applyUserAgentRule();
            await registerSiteScript();
            await writeStatus();
        }
        if (changes.alerts && !changes.alerts.newValue) {
            alerts = [];
            await writeStatus();
        }
        if (changes.follows || changes.settings) {
            void feedLoop();
            void backstopLoop();
        }
    });
});

async function openAlert(id: string, target: 'reader' | 'company'): Promise<void> {
    await whenReady();
    const alert = alerts.find((item) => item.id === id);
    if (!alert) return;
    alert.read = true;
    await chrome.tabs.create({ url: target === 'reader' ? readerUrl(alert.docUrl) : companyUrl(alert) });
    await chrome.notifications.clear(id);
    await saveAlerts();
    await writeStatus();
}

chrome.notifications.onClicked.addListener((id) => void openAlert(id, 'reader'));
chrome.notifications.onButtonClicked.addListener((id, index) => void openAlert(id, index === 0 ? 'reader' : 'company'));

/** Messages from the popup. */
chrome.runtime.onMessage.addListener((message: { type?: string; id?: string }, _sender, sendResponse) => {
    void whenReady().then(async () => {
        if (message.type === 'open' && message.id) await openAlert(message.id, 'reader');
        if (message.type === 'markAllRead') {
            for (const alert of alerts) alert.read = true;
            await saveAlerts();
            await writeStatus();
        }
        if (message.type === 'settingsSaved') {
            // Pick up the new settings even if the storage event below raced the worker start.
            const stored = await chrome.storage.local.get('settings');
            settings = { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
            await applyUserAgentRule();
            await registerSiteScript();
            await writeStatus();
            // An explicit nudge from Options, in case storage events were missed while the worker restarted.
            ensureLoops();
        }
        sendResponse({ ok: true });
    });
    return true;
});

ensureLoops();
