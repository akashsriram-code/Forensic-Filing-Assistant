# Forensic Filing Assistant

A sophisticated, minimalist financial intelligence tool designed for investigating SEC filings and tracking institutional "whale" activity.

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
    git clone https://github.com/iamjohnwatson/Forensic-Filing-Assistant.git
    cd Forensic-Filing-Assistant
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

## ⚠️ Deployment Note

This application relies on **Server-Side API Routes** to proxy requests to the SEC (to handle User-Agent headers and CORS).

*   **Do NOT deploy to GitHub Pages** (Static hosting will break the API).
*   **Recommended:** Deploy to **Vercel** or any Node.js hosting.

### Deploying to Vercel
1.  Push your code to GitHub.
2.  Import the repo on [Vercel.com](https://vercel.com).
3.  Deploy (Zero configuration required).

### 13F Radar: Aiven + Cache-Only Reads

For production radar views, use PostgreSQL for ingestion/cache refresh and committed JSON for dashboard/export reads.

App environment:

```bash
THIRTEEN_F_DB_PROVIDER=postgres
DATABASE_URL=postgres://...aivencloud.com:PORT/defaultdb?sslmode=require
THIRTEEN_F_RADAR_CACHE_ONLY=true
```

Cache generation:

*   Add a GitHub secret named `AIVEN_DATABASE_URL` with the Aiven PostgreSQL URI.
*   Run the manual `13F Radar Cache` workflow after ingesting or refreshing a quarter.
*   The workflow writes `data/13f-radar-cache/*/matched-holdings.json` and commits it.

When `THIRTEEN_F_RADAR_CACHE_ONLY=true`, `/api/13f-radar` and `/api/13f-radar/export` read only matching JSON cache files. If the requested quarter pair, categories, or watchlist hash are not cached, the API returns an error instead of falling back to SQL.

The app normalizes `sslmode=require` for Node's Postgres driver, so the standard Aiven URI is acceptable.

---

## 📄 License

MIT License. Free to use for personal and forensic research.

**Disclaimer:** This tool is for informational purposes only. Data is sourced from the SEC but not guaranteed to be real-time. Always verify with official EDGAR filings.
