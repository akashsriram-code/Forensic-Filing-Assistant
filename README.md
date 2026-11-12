# SCOUT

**SEC Company & Ownership Update Tracker.** A tool for reporters investigating SEC filings: what big funds bought and sold, insider trades, activist stakes, and what changed in companies' annual reports.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/built%20with-Next.js-black)
![Tailwind](https://img.shields.io/badge/styled%20with-Tailwind-38bdf8)

## 🌟 Key Features

### 1. Advanced Filing Downloader
Search and retrieve filings for any US public company or private fund.
*   **Comprehensive Search:** Supports standard Tickers (AAPL, NVDA) and **names** (e.g., "Public Investment Fund", "Bridgewater") via a robust 37MB fallback index.
*   **Expanded Filing Support:** 10-K, 10-Q, 8-K, 20-F, 6-K, S-1, S-1/A, DEF 14A, PRE 14A, NT 10-K, NT 10-Q.
*   **Intelligent Filtering:** Smart logic ensures searching for "10-K" doesn't accidentally return "NT 10-K" (late notices).
*   **Reader Mode:** Click the "Read" button to view any filing in a clean, distraction-free, serif-font layout optimized for reading and printing to PDF.
*   **Enhanced Batch Download:** "Download All" zips up to 20 filings as **Enhanced HTML** files that render perfectly offline with injected CSS and absolute image paths.

### 2. Whale Tracker 🐳
Analyze institutional 13-F filings to see what the "smart money" is doing.
*   **Holdings Analysis:** Automatically parses 13F-HR XML data to display current holdings.
*   **Change Detection:** Compares the current quarter vs. previous quarter to highlight **Top Buys** and **Top Sells**.
*   **Visual Design:** Minimalist, editorial design with a dark mode that feels professional and data-rich.

### 3. Sophisticated UI/UX
*   **Design System:** Built with a "minimalist/editorial" aesthetic.
*   **Dark Mode:** Fully integrated toggle (☀️/🌙) with smooth transitions.
*   **Responsive:** Works seamlessly on desktop and tablet.

---

## 🛠️ Technical Stack

*   **Framework:** Next.js 15 (App Router)
*   **Styling:** Tailwind CSS v4
*   **Backend:** Next.js API Routes (Server-side proxying to bypass SEC CORS)
*   **Data Source:** SEC EDGAR API (`data.sec.gov`) & Full Index (`cik-lookup-data.txt`)
*   **Utilities:** `cheerio` (HTML parsing), `xml2js` (13F parsing), `jszip` (Batch downloading)

---

## 🚀 Getting Started

### Prerequisites
*   Node.js 18+
*   npm or yarn

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/akashsriram-code/SCOUT.git
    cd SCOUT
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Run the development server:
    ```bash
    npm run dev
    ```

4.  Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔔 SCOUT Live: filing alerts within seconds (Chrome / Edge extension)

The in-app Follow alerts check every 5 minutes, and only while a SCOUT tab is open, against data cached for up to an hour. **SCOUT Live** is a companion browser extension in [`extension/`](extension/). It checks EDGAR's live "Latest Filings" feed every second and pops up a desktop alert about a second after EDGAR publishes a filing there. It works whenever the browser is running, with or without SCOUT open. Clicking an alert opens the filing in SCOUT's Reader.

**How fast, measured 2026-11-12 (6:07–6:25 AM ET):**

| Source | Median delay after the SEC accepts a filing | Range |
|---|---|---|
| Live "Latest Filings" feed (main source) | 26–32 s | 17–124 s |
| Company submissions JSON (backstop) | 61 s | 30–79 s |

The feed beat the submissions file in 13 of 13 races. The ~25-second floor is EDGAR's own publishing delay, so no free source is faster. Only the SEC's paid PDS feed beats it.

**How it works**
*   **Feed:** the background worker reads `browse-edgar?action=getcurrent` (newest 100 entries) every second during EDGAR hours (6am–10pm ET on weekdays) and every 20 seconds otherwise. Any filing whose filer, issuer or subject you follow triggers an alert.
*   **Backstop:** it also reads each followed company's `data.sec.gov/submissions` file in turn (2 per second). This catches anything the feed missed during a surge, and catches up after the computer was asleep (up to 3 days back, marked "while you were away"). About a minute after an alert, it also swaps the alert's link from the filing index to the main document.
*   **Rate limit:** total traffic is capped at 4 requests a second, under the SEC's limit of 10. If the SEC's rate-limit page appears, the extension pauses for 11 minutes and says so.
*   **Follows:** it reads your follows straight from SCOUT, so you follow and unfollow on company pages as usual. While the extension is running, SCOUT's own 5-minute checker steps aside so you don't get every alert twice.

**Install (developer mode)**
1.  `npm run build:extension` builds the extension into `extension/dist/`. Add `-- --zip` to also write `exports/scout-live.zip` to share; CI uploads the same zip as an artifact.
2.  Open `edge://extensions` or `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick `extension/dist`.
3.  The Options page opens. Enter a contact email (the SEC requires one on automated requests; it's sent only to sec.gov), your SCOUT address, and the check speed.
4.  Open SCOUT once so the extension can read who you follow. The Following menu should say **Live alerts on: SCOUT Live**.
5.  On Windows, make sure notifications for Edge/Chrome are allowed and Focus Assist isn't hiding them. Options has a **Send a test alert** button. To keep alerts coming with every browser window closed, turn on "Continue running background extensions and apps when Microsoft Edge is closed" (Chrome: "Continue running background apps when Google Chrome is closed").

**Managed work laptops.** If Developer mode is blocked by policy (`ExtensionDeveloperModeSettings`), ask IT to allowlist or force-install the extension ID **`dcnpflhmkgkgdagdgdlghfjakeaafgba`**. The ID is fixed by the `key` in `extension/manifest.json`, and the matching private key lives in `extension/scout-live-key.pem`, which is git-ignored. Publishing a hidden Edge Add-ons listing is the other route.

**Limitations**
*   Nothing arrives while the computer is asleep or off; the backstop catches up when it wakes.
*   EDGAR holds filings sent after 5:30 PM ET (10 PM for Forms 3/4/5), plus anything sent at weekends or on federal holidays, and publishes them all at 6:00 AM on the next business day. Those alerts arrive at 6:00 marked "just released by EDGAR" with their original acceptance time, which can be many hours earlier.
*   It runs only in desktop Chrome and Edge. It uses the follows from SCOUT in the same browser profile.
*   The SEC's limit is per network. On a shared office connection, pick a slower check speed in Options if several colleagues run it.
*   An alert says who filed what and when. Open it to read the filing.

Tests: `npm run test:extension` covers the pure logic in `extension/src/core/` (feed parsing, matching, dedupe, EDGAR hours, rate limiting and alert wording). Typecheck with `npx tsc -p extension --noEmit`.

---

## ⚠️ Deployment Note

This application relies on **Server-Side API Routes** to proxy requests to the SEC (to handle User-Agent headers and CORS).

*   **Do NOT deploy to GitHub Pages** (Static hosting will break the API).
*   **Recommended:** Deploy to **Vercel** or any Node.js hosting.

### Deploying to Vercel
1.  Push your code to GitHub.
2.  Import the repo on [Vercel.com](https://vercel.com).
3.  Deploy (Zero configuration required).

### 13F data: compact Postgres store + precomputed JSON

The 13F features run inside a fixed **480 MB** Postgres budget (`POSTGRES_13F_SIZE_TARGET_BYTES`). No raw holdings rows are stored.

*   **Postgres** (`lib/thirteen-f-store.ts`) holds exactly two quarters. Each row of `f13_positions` is one filer x security with **both** quarters side by side (`prev_*` / `cur_*` shares and values). All ~8,900 filers and ~27,000 securities take about 290 MB with indexes.
    *   Option (put/call) rows are not stored. Bond principal (PRN) rows are stored but left out of the radar.
    *   Values are the reported dollars. The SEC has required whole dollars since 2023, so nothing is scaled.
*   **Precomputed JSON**, committed to git (no LFS), lives in `data/13f-precomputed/<current>-vs-<previous>/`. `radar.json` is the default-watchlist radar view, about 0.5 MB, refreshed by CI.
    *   When a pair leaves the database it is archived there with `holders/<category>.json`, so older pairs stay browsable from the quarter dropdown.

What reads what:

| Feature | Source |
|---|---|
| 13F Radar, built-in watchlists | `radar.json` (no DB) |
| 13F Radar, custom watchlists / audit XLSX / category holders | Postgres, latest pair only (archived holders come from git) |
| Stock search, Whale Tracker, fund overlap | Postgres, latest pair |
| Whale History (8 quarters) | Live SEC EDGAR |

During a filing season the radar's default view stays on the most complete pair until the new quarter has at least 80% of the previous pair's comparable filers.

App environment:

```bash
DATABASE_URL=postgres://...?sslmode=require   # or POSTGRES_URL
```

Pipeline (`.github/workflows/13f-ingestion.yml`, daily):

1.  `scripts/ingest-live-13f.ts --quarter <Q>` folds new 13F-HR/A filings from EDGAR into the store.
    *   Restatements replace the filer's report and "new holdings" amendments are added to it. $0 stub filings are ignored.
    *   When `<Q>` is the quarter after the stored current one, the store first archives its pair, then rolls forward. The rollover is batched and resumes if it is interrupted.
2.  `scripts/build-13f-store.ts` rebuilds the store from the SEC Form 13F bulk data sets once they are published for both quarters. `scripts/resolve-13f-store-datasets.ts` picks the windows to download and skips the rebuild if nothing has changed.
3.  `scripts/precompute-13f-radar.ts` refreshes `radar.json`. Then `scripts/size-13f-neon.ts --require-under-target` checks the size budget, and only `data/13f-precomputed/` is committed.

To build from scratch locally, download and extract the SEC data sets (e.g. into `downloads/sec-13f-datasets/<name>/extracted`), then run:

```bash
npm run build:13f-store -- --current 2026-Q2 --previous 2026-Q1 --datasets <dir1>,<dir2>
npm run precompute:13f-radar
```

Use the primary read-write URI for ingestion. A read-only replica URI fails with Postgres error `25006`. The app normalizes `sslmode=require` for Node's Postgres driver.

---

## 📄 License

MIT License. Free to use for personal and forensic research.

**Disclaimer:** This tool is for informational purposes only. Data is sourced from the SEC but not guaranteed to be real-time. Always verify with official EDGAR filings.
