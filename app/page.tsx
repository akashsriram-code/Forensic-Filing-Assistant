"use client";

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Download, FileText, FolderDown, Loader2, Sparkles, Activity, Split } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { InsiderTracker } from './components/InsiderTracker';
import { WhaleTracker } from './components/WhaleTracker';
import { MarketPulse } from './components/MarketPulse';
import { FollowButton } from './components/FollowButton';
import { InfoModal } from './components/InfoModal';
import { IpoDashboard } from './components/IpoDashboard';
import { IntelligenceDashboard } from './components/IntelligenceDashboard';

interface FilingResult {
  accessionNumber: string;
  filingDate: string;
  form: string;
  size: number;
  primaryDocument: string;
  description: string;
  downloadUrl: string;
  companyQuery: string;
  companyName: string;
  companyTicker: string;
  companyCik: string;
  matchedKeywords: string[];
  matchCount: number;
  matchSnippets: string[];
}

const parseInputList = (value: string) =>
  value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export default function Home() {
  const [activeTab, setActiveTab] = useState<'downloader' | 'whale' | 'insider' | 'ipo' | 'intel' | 'market'>('market');
  const [entityInput, setEntityInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [filingType, setFilingType] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [results, setResults] = useState<FilingResult[] | null>(null);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [partialResults, setPartialResults] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const parsedEntities = parseInputList(entityInput);
  const parsedKeywords = parseInputList(keywordInput);
  const primaryEntity = parsedEntities[0] || "";

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
    if (parsedEntities.length === 0) return;
    setLoading(true);
    setError("");
    setWarnings([]);
    setPartialResults(false);
    setResults(null);

    try {
      const res = await fetch('/api/search-filings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entities: parsedEntities,
          keywords: parsedKeywords,
          startDate,
          endDate,
          filingType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch filings");
      setResults(data.results || []);
      setWarnings(data.warnings || []);
      setPartialResults(Boolean(data.partial));
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (url: string, filename: string) => {
    const safeFilename = filename.replace(/\.htm$/i, '.html');
    window.location.href = `/api/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeFilename)}`;
  };

  const handleDownloadAll = async () => {
    if (!results || results.length === 0) return;
    setDownloading(true);

    try {
      const zip = new JSZip();
      const filesToDownload = results.slice(0, 20);
      let processed = 0;

      for (const item of filesToDownload) {
        try {
          const response = await fetch(`/api/download-proxy?url=${encodeURIComponent(item.downloadUrl)}&filename=${item.primaryDocument}`);
          if (!response.ok) continue;

          let htmlContent = await response.text();
          const readerStyles = `
                        <style>
                            body { font-family: 'Times New Roman', Times, serif; line-height: 1.5; color: #333; max-width: 900px; margin: 40px auto; padding: 20px; }
                            table { width: 100% !important; border-collapse: collapse; margin-bottom: 20px; }
                            td, th { padding: 4px; vertical-align: top; }
                            img { max-width: 100%; height: auto; }
                            .sec-header { display: none; }
                            @media print { body { margin: 0; padding: 0; max-width: none; } }
                        </style>
                        <base href="https://www.sec.gov/Archives/edgar/data/">
                    `;

          if (htmlContent.includes('</head>')) {
            htmlContent = htmlContent.replace('</head>', `${readerStyles}</head>`);
          } else {
            htmlContent = `<!DOCTYPE html><html><head>${readerStyles}</head><body>${htmlContent}</body></html>`;
          }

          const filename = `${item.filingDate}_${item.companyTicker}_${item.form}_${item.accessionNumber}_Enhanced.html`;
          zip.file(filename, htmlContent);
          processed++;
        } catch {
          console.error("Failed to zip file", item.accessionNumber);
        }
      }

      if (processed > 0) {
        const content = await zip.generateAsync({ type: "blob" });
        const label = parsedEntities.length === 1 ? parsedEntities[0] : 'multi_entity';
        saveAs(content, `${label}_SEC_Filings_Readable.zip`);
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
              <button
                onClick={() => setActiveTab('ipo')}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'ipo' ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm') : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
              >
                IPO Watch <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-[10px]">BETA</span>
              </button>
              <button
                onClick={() => setActiveTab('intel')}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'intel' ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm') : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-purple-500" />
                  Intelligence
                </span>
              </button>
              <button
                onClick={() => setActiveTab('market')}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'market' ? (theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm') : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
              >
                Market Pulse
              </button>
            </div>

            <button
              onClick={toggleTheme}
              className={`p-2 rounded-full border transition-all ${theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-900 text-zinc-400' : 'border-gray-200 hover:bg-gray-100 text-gray-500'}`}
            >
              {theme === 'light' ? 'Night' : 'Day'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {activeTab === 'whale' ? (
          <WhaleTracker theme={theme} />
        ) : activeTab === 'insider' ? (
          <InsiderTracker theme={theme} />
        ) : activeTab === 'ipo' ? (
          <IpoDashboard theme={theme} />
        ) : activeTab === 'intel' ? (
          <IntelligenceDashboard ticker={primaryEntity} theme={theme} />
        ) : activeTab === 'market' ? (
          <MarketPulse theme={theme} />
        ) : (
          <div className="max-w-5xl mx-auto space-y-8">
            <div className={`p-8 rounded-2xl border transition-all duration-300 ${theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800 shadow-2xl' : 'bg-white border-gray-200 shadow-sm'}`}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">Entities</label>
                  <div className="flex gap-2 items-start">
                    <textarea
                      placeholder="NVDA, AAPL, Bridgewater Associates"
                      className={`min-h-28 w-full px-4 py-3 rounded-lg border transition-all outline-none font-mono text-sm resize-y ${theme === 'dark' ? 'bg-black/20 border-zinc-800 focus:border-white text-white' : 'bg-gray-50 border-gray-200 focus:border-black text-gray-900'}`}
                      value={entityInput}
                      onChange={(e) => setEntityInput(e.target.value)}
                    />
                    <FollowButton
                      ticker={primaryEntity}
                      theme={theme}
                      className={`p-3 rounded-lg border shrink-0 ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-200 bg-white'}`}
                    />
                  </div>
                  <p className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Enter tickers or company names separated by commas, semicolons, or new lines.</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">Keywords</label>
                  <textarea
                    placeholder="supply chain, material weakness, going concern"
                    className={`min-h-28 w-full px-4 py-3 rounded-lg border transition-all outline-none text-sm resize-y ${theme === 'dark' ? 'bg-black/20 border-zinc-800 focus:border-white text-white' : 'bg-gray-50 border-gray-200 focus:border-black text-gray-900'}`}
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                  />
                  <p className={`text-xs ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>Optional. Searches full filing text and returns filings containing any keyword.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end mt-6">
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
                  disabled={loading || parsedEntities.length === 0}
                  className={`px-8 py-3 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${theme === 'dark' ? 'bg-white text-black hover:bg-gray-200' : 'bg-gray-900 text-white hover:bg-black'}`}
                >
                  {loading ? (parsedKeywords.length > 0 ? "Searching Filing Text..." : "Searching Entities...") : "Search Filings"}
                </button>
              </div>
            </div>

            {error && (
              <div className={`rounded-xl border px-4 py-3 text-sm ${theme === 'dark' ? 'border-red-900/70 bg-red-950/30 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {error}
              </div>
            )}

            {warnings.length > 0 && (
              <div className={`rounded-xl border px-4 py-4 space-y-2 ${theme === 'dark' ? 'border-amber-900/70 bg-amber-950/20 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  {partialResults ? 'Partial results returned' : 'Search notes'}
                </div>
                <ul className="space-y-1 text-sm">
                  {warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className={`${theme === 'dark' ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-50 text-gray-500'} text-xs uppercase font-medium`}>
                      <tr>
                        <th className="px-6 py-4">Date</th>
                        <th className="px-6 py-4">Company</th>
                        <th className="px-6 py-4">Type</th>
                        <th className="px-6 py-4">Description</th>
                        <th className="px-6 py-4">Matches</th>
                        <th className="px-6 py-4 text-right">Size</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${theme === 'dark' ? 'divide-zinc-800 text-zinc-300' : 'divide-gray-100 text-gray-700'}`}>
                      {results.map((item, idx) => (
                        <tr key={`${item.companyCik}-${item.accessionNumber}-${idx}`} className={`transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800/50' : 'hover:bg-gray-50'}`}>
                          <td className="px-6 py-4 font-mono text-xs opacity-70 whitespace-nowrap">{item.filingDate}</td>
                          <td className="px-6 py-4 min-w-52">
                            <div className="font-medium">{item.companyName}</div>
                            <div className="text-xs opacity-60 font-mono">{item.companyTicker}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap"><span className="font-medium">{item.form}</span></td>
                          <td className="px-6 py-4 min-w-64">
                            <div className="opacity-80">{item.description || item.primaryDocument}</div>
                            {item.matchSnippets.length > 0 && (
                              <div className={`mt-2 text-xs leading-5 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'}`}>
                                {item.matchSnippets.slice(0, 2).map((snippet, snippetIndex) => (
                                  <p key={`${item.accessionNumber}-snippet-${snippetIndex}`}>{snippet}</p>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 min-w-40">
                            {item.matchedKeywords.length > 0 ? (
                              <div className="space-y-2">
                                <div className="text-xs font-medium">{item.matchCount} match{item.matchCount === 1 ? '' : 'es'}</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {item.matchedKeywords.map((keyword) => (
                                    <span
                                      key={`${item.accessionNumber}-${keyword}`}
                                      className={`px-2 py-1 rounded-full text-[11px] ${theme === 'dark' ? 'bg-zinc-800 text-zinc-200' : 'bg-gray-100 text-gray-700'}`}
                                    >
                                      {keyword}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs opacity-50">No keyword filter</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right font-mono text-xs opacity-60 whitespace-nowrap">{(item.size / 1024).toFixed(0)} KB</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-3">
                              {['10-K', '10-Q'].some((t) => item.form.includes(t)) && idx < results.length - 1 && (() => {
                                const prev = results
                                  .slice(idx + 1)
                                  .find((result) => result.form === item.form && result.companyCik === item.companyCik);

                                if (prev) {
                                  return (
                                    <Link
                                      href={`/diff?url1=${encodeURIComponent(prev.downloadUrl)}&url2=${encodeURIComponent(item.downloadUrl)}&title=${encodeURIComponent(`Diff: ${item.companyTicker} ${item.form} (${prev.filingDate} vs ${item.filingDate})`)}`}
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
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
