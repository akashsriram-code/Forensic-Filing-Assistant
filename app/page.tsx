"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Search, FileText, Download, Calendar, Filter, Loader2, Sparkles, FolderDown, Activity, Split } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { InsiderTracker } from './components/InsiderTracker';
import { WhaleTracker } from './components/WhaleTracker';
import { FollowButton } from './components/FollowButton';
import { InfoModal } from './components/InfoModal';

interface FilingResult {
  accessionNumber: string;
  filingDate: string;
  form: string;
  size: number;
  primaryDocument: string;
  description: string;
  downloadUrl: string; // Direct SEC URL
}

export default function Home() {
  // I'm keeping track of which tab is active here.
  const [activeTab, setActiveTab] = useState<'downloader' | 'whale' | 'insider'>('downloader');

  // These are the state variables I need for the global filing downloader.
  const [ticker, setTicker] = useState("");
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [filingType, setFilingType] = useState('ALL');

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [results, setResults] = useState<FilingResult[] | null>(null);
  const [error, setError] = useState("");

  // Tracking the theme state (light/dark) so I can style components accordingly.
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // This handles switching the CSS class on the document root when I toggle the button.
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleSearch = async () => {
    if (!ticker) return;
    setLoading(true);
    setError("");
    setResults(null);

    try {
      const res = await fetch('/api/search-filings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, startDate, endDate, filingType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch filings");
      setResults(data.results);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (url: string, filename: string) => {
    // Ensure the filename uses .html instead of .htm for better compatibility.
    const safeFilename = filename.replace(/\.htm$/i, '.html');
    // I'm forcing the download through my proxy to avoid CORS issues with the SEC.
    window.location.href = `/api/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeFilename)}`;
  };

  const handleDownloadAll = async () => {
    if (!results || results.length === 0) return;
    setDownloading(true);

    try {
      const zip = new JSZip();
      const filesToDownload = results.slice(0, 20); // Limit to 20 to prevent browser freeze
      let processed = 0;

      for (const item of filesToDownload) {
        try {
          const response = await fetch(`/api/download-proxy?url=${encodeURIComponent(item.downloadUrl)}&filename=${item.primaryDocument}`);
          if (!response.ok) continue;

          let htmlContent = await response.text();

          // --- ENHANCEMENT: Make the HTML "Reader Ready" (looks like a PDF) ---
          // 1. Inject Reader CSS directly into the head
          const readerStyles = `
                        <style>
                            body { font-family: 'Times New Roman', Times, serif; line-height: 1.5; color: #333; max-width: 900px; margin: 40px auto; padding: 20px; }
                            table { width: 100% !important; border-collapse: collapse; margin-bottom: 20px; }
                            td, th { padding: 4px; vertical-align: top; }
                            img { max-width: 100%; height: auto; }
                            .sec-header { display: none; } /* Hide some junk if possible */
                            @media print { body { margin: 0; padding: 0; max-width: none; } }
                        </style>
                        <base href="https://www.sec.gov/Archives/edgar/data/"> <!-- Try to fix relative links -->
                    `;

          // Simple injection before </head> or just at top if missing
          if (htmlContent.includes('</head>')) {
            htmlContent = htmlContent.replace('</head>', `${readerStyles}</head>`);
          } else {
            htmlContent = `<!DOCTYPE html><html><head>${readerStyles}</head><body>${htmlContent}</body></html>`;
          }

          // 2. Fix Image URLs (Rough heuristic)
          // SEC images are often relative. We try to make them absolute based on the accession path.
          // (Note: <base> tag above handles many cases, but manual replace is safer for some clients)

          const ext = item.primaryDocument.split('.').pop() || 'htm';
          const filename = `${item.filingDate}_${item.form}_${item.accessionNumber}_Enhanced.html`;

          zip.file(filename, htmlContent);
          processed++;
        } catch (e) {
          console.error("Failed to zip file", item.accessionNumber);
        }
      }

      if (processed > 0) {
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${ticker}_SEC_Filings_Readable.zip`);
      } else {
        alert("Failed to download any files for zipping.");
      }

    } catch (e) {
      console.error("Zip Error", e);
      alert("Error creating zip file.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${theme === 'dark' ? 'bg-zinc-950 text-zinc-100' : 'bg-gray-50 text-gray-900'} font-sans selection:bg-gray-200 selection:text-gray-900 dark:selection:bg-zinc-800 dark:selection:text-white`}>

      {/* Minimal Header */}
      <header className={`sticky top-0 z-50 border-b transition-colors duration-300 ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950/80' : 'border-gray-200 bg-white/80'} backdrop-blur-md`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-md ${theme === 'dark' ? 'bg-zinc-800 text-white' : 'bg-gray-900 text-white'}`}>
              <Activity className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-sm font-bold tracking-tight uppercase">SEC Filings Assistant</h1>
              <span className="text-[10px] text-gray-500 font-medium tracking-wide">by Akash Sriram</span>
            </div>
            <div className="ml-2 border-l pl-3 border-gray-200 dark:border-zinc-800 h-6 flex items-center">
              <InfoModal theme={theme} />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className={`flex p-1 rounded-lg border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-200 bg-gray-100'}`}>
              <button
                onClick={() => setActiveTab('downloader')}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'downloader' ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm') : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
              >
                Downloader
              </button>
              <button
                onClick={() => setActiveTab('whale')}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'whale' ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm') : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
              >
                Whale Tracker
              </button>
              <button
                onClick={() => setActiveTab('insider')}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'insider' ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm') : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
              >
                Insider Analysis
              </button>
            </div>

            <button
              onClick={toggleTheme}
              className={`p-2 rounded-full border transition-all ${theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-900 text-zinc-400' : 'border-gray-200 hover:bg-gray-100 text-gray-500'}`}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        {activeTab === 'whale' ? (
          <WhaleTracker theme={theme} />
        ) : activeTab === 'insider' ? (
          <InsiderTracker theme={theme} />
        ) : (
          <div className="max-w-4xl mx-auto space-y-12">
            {/* Search Section */}
            <div className={`p-8 rounded-2xl border transition-all duration-300 ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 shadow-2xl' : 'bg-white border-gray-200 shadow-sm'}`}>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                <div className="col-span-1">
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Ticker</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="NVDA"
                      className={`w-full px-4 py-3 rounded-lg border transition-all outline-none font-mono text-sm ${theme === 'dark' ? 'bg-black/20 border-zinc-800 focus:border-white text-white' : 'bg-gray-50 border-gray-200 focus:border-black text-gray-900'}`}
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value)}
                    />
                    <FollowButton ticker={ticker} theme={theme} className={`p-3 rounded-lg border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-200 bg-white'}`} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Start Date</label>
                  <input
                    type="date"
                    className={`w-full px-4 py-3 rounded-lg border transition-all outline-none text-sm ${theme === 'dark' ? 'bg-black/20 border-zinc-800 focus:border-white text-white' : 'bg-gray-50 border-gray-200 focus:border-black text-gray-900'}`}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">End Date</label>
                  <input
                    type="date"
                    className={`w-full px-4 py-3 rounded-lg border transition-all outline-none text-sm ${theme === 'dark' ? 'bg-black/20 border-zinc-800 focus:border-white text-white' : 'bg-gray-50 border-gray-200 focus:border-black text-gray-900'}`}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Type</label>
                  <select
                    className={`w-full px-4 py-3 rounded-lg border transition-all outline-none text-sm appearance-none ${theme === 'dark' ? 'bg-black/20 border-zinc-800 focus:border-white text-white' : 'bg-gray-50 border-gray-200 focus:border-black text-gray-900'}`}
                    value={filingType}
                    onChange={(e) => setFilingType(e.target.value)}
                  >
                    <option value="ALL">All Filings</option>
                    <option value="10-K">10-K (Annual)</option>
                    <option value="10-Q">10-Q (Quarterly)</option>
                    <option value="8-K">8-K (Current)</option>
                    <option value="20-F">20-F (Foreign Annual)</option>
                    <option value="6-K">6-K (Foreign Current)</option>
                    <option value="S-1">S-1 (Registration)</option>
                    <option value="S-1/A">S-1/A (Amendment)</option>
                    <option value="DEF 14A">DEF 14A (Proxy)</option>
                    <option value="PRE 14A">PRE 14A (Prelim Proxy)</option>
                    <option value="NT 10-K">NT 10-K (Late Notice)</option>
                    <option value="NT 10-Q">NT 10-Q (Late Notice)</option>
                    <option value="424B">Prospectus (424B)</option>
                  </select>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  className={`px-8 py-3 rounded-lg text-sm font-medium transition-all ${theme === 'dark' ? 'bg-white text-black hover:bg-gray-200' : 'bg-gray-900 text-white hover:bg-black'}`}
                >
                  {loading ? "Searching..." : "Search Filings"}
                </button>
              </div>
            </div>

            {/* Results Table */}
            {results && (
              <div className={`rounded-xl border overflow-hidden ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-200 bg-white'}`}>
                <div className={`px-6 py-4 border-b flex justify-between items-center ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-100 bg-gray-50/50'}`}>
                  <span className={`text-xs font-medium uppercase tracking-wide ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>
                    Found <span className={theme === 'dark' ? 'text-zinc-300' : 'text-gray-900'}>{results.length}</span> filings
                  </span>
                  {results.length > 0 && (
                    <button
                      onClick={handleDownloadAll}
                      disabled={downloading}
                      className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-md transition-all ${theme === 'dark' ? 'bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700' : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300 shadow-sm'}`}
                    >
                      {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderDown className="h-3 w-3" />}
                      {downloading ? "Zipping..." : "Download All"}
                    </button>
                  )}
                </div>
                <table className="w-full text-sm text-left">
                  <thead className={`${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500'} text-xs uppercase font-medium`}>
                    <tr>
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Description</th>
                      <th className="px-6 py-4 text-right">Size</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700'}`}>
                    {results.map((item, idx) => (
                      <tr key={idx} className={`transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800/50' : 'hover:bg-gray-50'}`}>
                        <td className="px-6 py-4 font-mono text-xs opacity-70">{item.filingDate}</td>
                        <td className="px-6 py-4"><span className="font-medium">{item.form}</span></td>
                        <td className="px-6 py-4 truncate max-w-xs opacity-80">{item.description || item.primaryDocument}</td>
                        <td className="px-6 py-4 text-right font-mono text-xs opacity-60">{(item.size / 1024).toFixed(0)} KB</td>
                        <td className="px-6 py-4 text-right flex justify-end gap-3">
                          {/* DIFF ENGINE: Compare with previous if available */}
                          {['10-K', '10-Q'].some(t => item.form.includes(t)) && idx < results.length - 1 && (() => {
                            // Find previous filing of same type
                            const prev = results.slice(idx + 1).find(r => r.form === item.form);
                            if (prev) {
                              return (
                                <Link
                                  href={`/diff?url1=${encodeURIComponent(prev.downloadUrl)}&url2=${encodeURIComponent(item.downloadUrl)}&title=${encodeURIComponent(`Diff: ${item.form} (${prev.filingDate} vs ${item.filingDate})`)}`}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${theme === 'dark' ? 'bg-purple-900/30 hover:bg-purple-900/50 text-purple-300' : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200'}`}
                                  title={`Compare with ${prev.filingDate}`}
                                >
                                  <Split className="h-3 w-3" />
                                  Diff
                                </Link>
                              );
                            }
                            return null;
                          })()}

                          <Link
                            href={`/reader?url=${encodeURIComponent(item.downloadUrl)}`}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-white border border-gray-200 hover:bg-gray-50 text-gray-700'}`}
                          >
                            <FileText className="h-3 w-3" />
                            Read
                          </Link>
                          <button
                            onClick={() => downloadFile(item.downloadUrl, item.primaryDocument)}
                            className="hover:text-black opacity-60 hover:opacity-100 transition-opacity"
                            title="Download Raw HTML"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
