"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Download, FileText, FolderDown, Search, Split } from 'lucide-react';
import { formatDate, formatNumber, joinList, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { FollowButton } from './FollowButton';
import { TokenInput, splitTokens } from './TokenInput';
import { useRunFromUrlOnce, useUrlParams } from './useUrlState';
import {
    Button,
    EmptyState,
    FormMark,
    IconButton,
    Input,
    Notice,
    Panel,
    SectionHeader,
    Select,
    SelectControl,
    SkeletonRows,
    Table,
    TableFooter,
    Takeaway,
    Td,
    Th,
    THead,
    buttonClass,
    rowClass,
} from './ui';

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

interface SavedSearch {
    entities: string[];
    keywords: string[];
    startDate: string;
    endDate: string;
    filingType: string;
    results: FilingResult[] | null;
    warnings: string[];
    partial: boolean;
    /** The search the results belong to, for the takeaway sentence. */
    searched: { entities: string[]; keywords: string[]; startDate: string; endDate: string; filingType: string } | null;
}

const STORAGE_KEY = 'downloader-search';
const PAGE_SIZE = 50;

const FORM_OPTIONS: { value: string; label: string }[] = [
    { value: 'ALL', label: 'All filings' },
    { value: '10-K', label: '10-K: annual report' },
    { value: '10-Q', label: '10-Q: quarterly report' },
    { value: '8-K', label: '8-K: major event' },
    { value: '20-F', label: '20-F: foreign annual report' },
    { value: '6-K', label: '6-K: foreign current report' },
    { value: 'S-1', label: 'S-1: IPO registration' },
    { value: 'S-1/A', label: 'S-1/A: amended registration' },
    { value: 'DEF 14A', label: 'DEF 14A: proxy statement' },
    { value: 'PRE 14A', label: 'PRE 14A: preliminary proxy' },
    { value: 'NT 10-K', label: 'NT 10-K: late annual report notice' },
    { value: 'NT 10-Q', label: 'NT 10-Q: late quarterly report notice' },
    { value: '424B', label: '424B: prospectus' },
];

const today = () => new Date().toISOString().split('T')[0];

function defaultSearch(): SavedSearch {
    return {
        entities: [],
        keywords: [],
        startDate: '2023-01-01',
        endDate: today(),
        filingType: 'ALL',
        results: null,
        warnings: [],
        partial: false,
        searched: null,
    };
}

/** Restores the last search so coming back from Reader or Compare doesn't lose it. Client-only component. */
function loadSearch(): SavedSearch {
    if (typeof window === 'undefined') return defaultSearch();
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        return raw ? { ...defaultSearch(), ...(JSON.parse(raw) as Partial<SavedSearch>) } : defaultSearch();
    } catch {
        return defaultSearch();
    }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A shared link (?companies=NVDA,AAPL&keywords=going concern&from=2023-01-01&to=2026-11-11&form=10-K) wins over the
 * search saved in this tab. Returns the starting state and whether the link's search still needs to run.
 */
function initialSearch(params: URLSearchParams): { state: SavedSearch; runFromLink: boolean } {
    const saved = loadSearch();
    const companies = splitTokens(params.get('companies') || '');
    if (companies.length === 0) return { state: saved, runFromLink: false };

    const from = params.get('from') || '';
    const to = params.get('to') || '';
    const form = params.get('form') || 'ALL';
    const fromLink = {
        entities: companies,
        keywords: splitTokens(params.get('keywords') || ''),
        startDate: DATE_PATTERN.test(from) ? from : saved.startDate,
        endDate: DATE_PATTERN.test(to) ? to : saved.endDate,
        filingType: FORM_OPTIONS.some((option) => option.value === form) ? form : 'ALL',
    };
    // Coming back from Reader/Compare to the same search: keep the saved results instead of searching again.
    if (saved.searched && JSON.stringify(saved.searched) === JSON.stringify(fromLink)) return { state: saved, runFromLink: false };
    return { state: { ...defaultSearch(), ...fromLink }, runFromLink: true };
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlights keyword matches inside a snippet. */
function highlight(text: string, keywords: string[]): ReactNode {
    if (keywords.length === 0) return text;
    const pattern = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'gi');
    return text.split(pattern).map((part, index) =>
        index % 2 === 1 ? <mark key={index} className="rounded bg-caution/20 px-0.5 text-ink">{part}</mark> : part
    );
}

function quoteList(items: string[]): string {
    const quoted = items.map((item) => `“${item}”`);
    if (quoted.length <= 1) return quoted.join('');
    return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

function buildTakeaway(results: FilingResult[], searched: NonNullable<SavedSearch['searched']>): string {
    const formWord = searched.filingType === 'ALL' ? 'filings' : `${searched.filingType} filings`;
    const count = results.length === 1 ? `1 ${searched.filingType === 'ALL' ? 'filing' : `${searched.filingType} filing`}` : `${formatNumber(results.length)} ${formWord}`;
    const keywordClause = searched.keywords.length > 0 ? ` that mention ${quoteList(searched.keywords)}` : '';
    let sentence = `Found ${count} from ${joinList(searched.entities)}${keywordClause}, filed between ${formatDate(searched.startDate)} and ${formatDate(searched.endDate)}.`;
    const latest = results.reduce<FilingResult | null>((best, item) => (!best || item.filingDate > best.filingDate ? item : best), null);
    if (latest) sentence += ` The most recent is a ${latest.form} from ${latest.companyName || latest.companyTicker}, filed ${formatDate(latest.filingDate)}.`;
    return sentence;
}

/** The previous filing of the same form from the same company, if it is in the results (results are newest first). */
function findPrevious(results: FilingResult[], index: number): FilingResult | undefined {
    const item = results[index];
    return results.slice(index + 1).find((other) => other.form === item.form && other.companyCik === item.companyCik);
}

const canCompare = (form: string) => form === '10-K' || form === '10-Q' || form === '10-K/A' || form === '10-Q/A';

export function Downloader() {
    const { params, setParams } = useUrlParams();
    const [initial] = useState(() => initialSearch(new URLSearchParams(params.toString())));
    const [state, setState] = useState<SavedSearch>(initial.state);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [shown, setShown] = useState(PAGE_SIZE);
    const [downloadFormat, setDownloadFormat] = useState<'html' | 'pdf'>('html');
    const [download, setDownload] = useState<{ running: boolean; current: number; total: number; failed: string[]; finished: boolean }>({
        running: false,
        current: 0,
        total: 0,
        failed: [],
        finished: false,
    });
    const cancelRef = useRef(false);

    const { entities, keywords, startDate, endDate, filingType, results, warnings, partial, searched } = state;
    const update = (patch: Partial<SavedSearch>) => setState((current) => ({ ...current, ...patch }));

    useEffect(() => {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
            // Too large or blocked: the search just won't be restored.
        }
    }, [state]);

    const dateError = startDate && endDate && startDate > endDate ? 'The end date must be on or after the start date.' : '';
    const blockedReason = entities.length === 0 ? 'Add at least one company to search.' : dateError ? 'Fix the dates to search.' : '';

    const handleSearch = async () => {
        if (blockedReason) return;
        setLoading(true);
        setError('');
        setShown(PAGE_SIZE);
        setDownload({ running: false, current: 0, total: 0, failed: [], finished: false });
        try {
            const res = await fetch('/api/search-filings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entities, keywords, startDate, endDate, filingType }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'The SEC search did not respond.');
            update({
                results: data.results || [],
                warnings: data.warnings || [],
                partial: Boolean(data.partial),
                searched: { entities, keywords, startDate, endDate, filingType },
            });
            setParams({
                companies: entities.join(','),
                keywords: keywords.length > 0 ? keywords.join(',') : null,
                from: startDate,
                to: endDate,
                form: filingType === 'ALL' ? null : filingType,
            });
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'The search failed.');
        } finally {
            setLoading(false);
        }
    };

    // The form is already filled from the link (see initialSearch); run it once.
    useRunFromUrlOnce([initial.runFromLink ? 'run' : null], () => {
        void handleSearch();
    });

    const downloadFile = (url: string, filename: string) => {
        const safeFilename = filename.replace(/\.htm$/i, '.html');
        window.location.href = `/api/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeFilename)}`;
    };

    const handleDownloadAll = async () => {
        if (!results || results.length === 0) return;
        cancelRef.current = false;
        setDownload({ running: true, current: 0, total: results.length, failed: [], finished: false });
        const failed: string[] = [];
        let hiddenContainer: HTMLDivElement | null = null;

        try {
            const zip = new JSZip();
            let processed = 0;
            const html2pdf = downloadFormat === 'pdf' ? (await import('html2pdf.js')).default : null;
            if (downloadFormat === 'pdf') {
                hiddenContainer = document.createElement('div');
                hiddenContainer.style.cssText = 'position: fixed; left: 0; top: 0; width: 900px; background: white; color: black; z-index: -9999; visibility: hidden;';
                document.body.appendChild(hiddenContainer);
            }

            for (let i = 0; i < results.length; i++) {
                if (cancelRef.current) break;
                const item = results[i];
                const label = `${item.companyTicker || item.companyName} ${item.form} (${item.filingDate})`;
                setDownload((current) => ({ ...current, current: i + 1 }));

                try {
                    const response = await fetch(`/api/download-proxy?url=${encodeURIComponent(item.downloadUrl)}&filename=${item.primaryDocument}`);
                    if (!response.ok) {
                        failed.push(label);
                        continue;
                    }

                    let htmlContent = await response.text();
                    const readerStyles = `
            <style>
              body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.5; color: #222; max-width: 900px; margin: 40px auto; padding: 20px; background: white; }
              table { width: 100% !important; border-collapse: collapse; margin-bottom: 20px; }
              td, th { padding: 4px; vertical-align: top; }
              img { max-width: 100%; height: auto; }
              .sec-header { display: none; }
              @media print { body { margin: 0; padding: 0; max-width: none; } }
            </style>
            <base href="https://www.sec.gov/Archives/edgar/data/">
          `;
                    htmlContent = htmlContent.includes('</head>')
                        ? htmlContent.replace('</head>', `${readerStyles}</head>`)
                        : `<!DOCTYPE html><html><head>${readerStyles}</head><body>${htmlContent}</body></html>`;

                    const baseName = `${item.filingDate}_${item.companyTicker}_${item.form.replace(/\//g, '-')}_${item.accessionNumber}`;
                    if (downloadFormat === 'pdf' && html2pdf && hiddenContainer) {
                        hiddenContainer.innerHTML = htmlContent;
                        hiddenContainer.style.visibility = 'visible';
                        await new Promise((resolve) => setTimeout(resolve, 500));
                        const pdfBlob = await html2pdf()
                            .set({
                                margin: [10, 10, 10, 10],
                                image: { type: 'jpeg', quality: 0.85 },
                                html2canvas: { scale: 1.5, useCORS: true, allowTaint: true },
                                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                            })
                            .from(hiddenContainer)
                            .outputPdf('blob');
                        hiddenContainer.style.visibility = 'hidden';
                        zip.file(`${baseName}.pdf`, pdfBlob);
                    } else {
                        zip.file(`${baseName}.html`, htmlContent);
                    }
                    processed++;
                } catch {
                    failed.push(label);
                }
            }

            if (processed > 0 && !cancelRef.current) {
                const content = await zip.generateAsync({ type: 'blob' });
                const zipLabel = (searched?.entities.length === 1 ? searched.entities[0] : 'multiple-companies').replace(/[^\w-]+/g, '-');
                saveAs(content, `${zipLabel}-sec-filings-${downloadFormat}.zip`);
            } else if (processed === 0 && !cancelRef.current) {
                failed.splice(0, failed.length, ...results.map((item) => `${item.companyTicker || item.companyName} ${item.form} (${item.filingDate})`));
            }
        } catch {
            failed.push('the ZIP file');
        } finally {
            if (hiddenContainer) document.body.removeChild(hiddenContainer);
            setDownload((current) => ({ ...current, running: false, failed, finished: !cancelRef.current }));
        }
    };

    const takeaway = useMemo(() => (results && results.length > 0 && searched ? buildTakeaway(results, searched) : ''), [results, searched]);
    const visible = results ? results.slice(0, shown) : [];

    return (
        <div className="space-y-8">
            <div className="max-w-3xl">
                <h1 className="font-serif text-2xl font-semibold text-ink">Find and download SEC filings</h1>
                <p className="mt-2 text-lg text-ink-muted">
                    Search one or more companies at once. Add keywords to search inside every filing and see the passages that match.
                </p>
            </div>

            <Panel className="p-4 sm:p-6">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void handleSearch();
                    }}
                    className="space-y-5"
                >
                    <div className="grid gap-5 lg:grid-cols-2">
                        <div className="flex flex-col items-start gap-3 sm:flex-row">
                            <div className="w-full min-w-0 flex-1">
                                <TokenInput
                                    label="Companies"
                                    placeholder="NVDA, Apple, Bridgewater Associates"
                                    hint="Tickers, company names or fund names. Press Enter after each, or paste a list."
                                    values={entities}
                                    onChange={(values) => update({ entities: values })}
                                    uppercase
                                />
                            </div>
                            <FollowButton ticker={entities[0] || ''} className="sm:mt-[1.6rem]" />
                        </div>
                        <TokenInput
                            label="Keywords (optional)"
                            placeholder="going concern, material weakness"
                            hint="Finds filings that contain any of these words or phrases."
                            values={keywords}
                            onChange={(values) => update({ keywords: values })}
                        />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-3">
                        <Input label="From" type="date" value={startDate} max={endDate || undefined} onChange={(event) => update({ startDate: event.target.value })} />
                        <Input label="To" type="date" value={endDate} min={startDate || undefined} error={dateError || undefined} onChange={(event) => update({ endDate: event.target.value })} />
                        <Select label="Form type" value={filingType} onChange={(event) => update({ filingType: event.target.value })}>
                            {FORM_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                        {blockedReason && <p className="text-sm text-ink-muted">{blockedReason}</p>}
                        <Button type="submit" variant="primary" loading={loading} disabled={Boolean(blockedReason)} icon={<Search className="h-4 w-4" aria-hidden />}>
                            {loading ? (keywords.length > 0 ? 'Searching filing text…' : 'Searching…') : 'Search filings'}
                        </Button>
                    </div>
                </form>
            </Panel>

            {error && (
                <Notice tone="error" title="The search didn't finish" action={<Button size="sm" onClick={handleSearch}>Try again</Button>}>
                    {error} Check the company names and try again. The SEC sometimes limits requests for a minute.
                </Notice>
            )}

            {warnings.length > 0 && !loading && (
                <Notice tone="caution" title={partial ? 'Some results may be missing' : 'Search notes'}>
                    <ul className="list-disc space-y-1 pl-5">
                        {warnings.map((warning, index) => (
                            <li key={`${index}-${warning}`}>{warning}</li>
                        ))}
                    </ul>
                </Notice>
            )}

            {loading && (
                <Panel>
                    <SkeletonRows rows={8} label="Searching filings" />
                </Panel>
            )}

            {!loading && results && results.length === 0 && (
                <EmptyState icon={<Search className="h-5 w-5" aria-hidden />} title="No filings match this search">
                    Try a wider date range, choose <span className="font-medium text-ink">All filings</span>, remove a keyword, or check the
                    company name. Tickers usually work best.
                </EmptyState>
            )}

            {!loading && results && results.length > 0 && searched && (
                <section className="space-y-5" aria-labelledby="results-heading">
                    <Takeaway copyText={takeaway}>{takeaway}</Takeaway>

                    <SectionHeader
                        id="results-heading"
                        title={plural(results.length, 'filing')}
                        intro="Newest first. Read opens a clean, printable copy; Compare shows what changed since the previous 10-K or 10-Q."
                        actions={
                            <>
                                <label className="flex items-center gap-2 text-sm text-ink-muted">
                                    <span>Save as</span>
                                    <SelectControl
                                        value={downloadFormat}
                                        onChange={(event) => setDownloadFormat(event.target.value as 'html' | 'pdf')}
                                        disabled={download.running}
                                        className="h-8 w-36 text-sm"
                                    >
                                        <option value="html">HTML</option>
                                        <option value="pdf">PDF (slower)</option>
                                    </SelectControl>
                                </label>
                                {download.running ? (
                                    <Button size="sm" onClick={() => (cancelRef.current = true)}>
                                        Cancel ({download.current} of {download.total})
                                    </Button>
                                ) : (
                                    <Button size="sm" variant="primary" onClick={handleDownloadAll} icon={<FolderDown className="h-4 w-4" aria-hidden />}>
                                        Download all {formatNumber(results.length)}
                                    </Button>
                                )}
                            </>
                        }
                    />

                    {download.running && (
                        <p role="status" className="text-sm text-ink-muted">
                            {downloadFormat === 'pdf' ? 'Converting' : 'Downloading'} {download.current} of {download.total}…
                        </p>
                    )}
                    {!download.running && download.failed.length > 0 && (
                        <Notice tone="caution" title={`${plural(download.failed.length, 'filing')} couldn't be downloaded`}>
                            {joinList(download.failed, 5)}. The rest are in the ZIP file. Try those again individually with the download button.
                        </Notice>
                    )}

                    {/* Desktop: table */}
                    <Panel className="hidden md:block">
                        <Table caption="Search results">
                            <THead>
                                <tr>
                                    <Th>Filed</Th>
                                    <Th>Company</Th>
                                    <Th>Filing</Th>
                                    <Th numeric>Size</Th>
                                    <Th className="text-right">Actions</Th>
                                </tr>
                            </THead>
                            <tbody>
                                {visible.map((item, index) => (
                                    <tr key={`${item.companyCik}-${item.accessionNumber}`} className={rowClass}>
                                        <Td className="tabular whitespace-nowrap">{formatDate(item.filingDate)}</Td>
                                        <Td className="min-w-44">
                                            <div className="font-medium">{item.companyName}</div>
                                            {item.companyTicker && <div className="text-sm text-ink-muted">{item.companyTicker}</div>}
                                        </Td>
                                        <Td className="min-w-72">
                                            <FilingSummary item={item} keywords={searched.keywords} />
                                        </Td>
                                        <Td numeric className="text-ink-muted">{formatNumber(item.size / 1024)} KB</Td>
                                        <Td>
                                            <FilingActions item={item} previous={findPrevious(results, index)} onDownload={downloadFile} />
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                        <TableFooter shown={visible.length} total={results.length} noun="filings" onShowMore={() => setShown((value) => value + PAGE_SIZE)} />
                    </Panel>

                    {/* Mobile: stacked list */}
                    <div className="space-y-3 md:hidden">
                        {visible.map((item, index) => (
                            <Panel key={`${item.companyCik}-${item.accessionNumber}`} as="article" className="p-4">
                                <div className="flex items-baseline justify-between gap-3">
                                    <p className="font-medium">{item.companyName}{item.companyTicker && <span className="text-ink-muted"> ({item.companyTicker})</span>}</p>
                                    <p className="tabular shrink-0 text-sm text-ink-muted">{formatDate(item.filingDate)}</p>
                                </div>
                                <div className="mt-2">
                                    <FilingSummary item={item} keywords={searched.keywords} />
                                </div>
                                <div className="mt-3 border-t border-rule pt-3">
                                    <FilingActions item={item} previous={findPrevious(results, index)} onDownload={downloadFile} align="start" />
                                </div>
                            </Panel>
                        ))}
                        <TableFooter shown={visible.length} total={results.length} noun="filings" onShowMore={() => setShown((value) => value + PAGE_SIZE)} />
                    </div>
                </section>
            )}

            {!loading && !results && !error && (
                <EmptyState icon={<FileText className="h-5 w-5" aria-hidden />} title="Start with a company">
                    Try <span className="font-medium text-ink">NVDA</span> with the keyword <span className="font-medium text-ink">export controls</span>,
                    or compare a company&apos;s last two 10-Ks to see which risk factors changed.
                </EmptyState>
            )}
        </div>
    );
}

function FilingSummary({ item, keywords }: { item: FilingResult; keywords: string[] }) {
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
                <FormMark form={item.form} />
                <span className="text-ink">{item.description || item.primaryDocument}</span>
            </div>
            {item.matchedKeywords.length > 0 && (
                <p className="text-sm text-ink-muted">
                    {plural(item.matchCount, 'match', 'matches')} for {joinList(item.matchedKeywords.map((keyword) => `“${keyword}”`), 4)}
                </p>
            )}
            {item.matchSnippets.slice(0, 2).map((snippet, index) => (
                <p key={`${item.accessionNumber}-snippet-${index}`} className="border-l-2 border-rule-strong pl-3 font-serif text-base text-ink-muted">
                    {highlight(snippet, keywords)}
                </p>
            ))}
        </div>
    );
}

function FilingActions({
    item,
    previous,
    onDownload,
    align = 'end',
}: {
    item: FilingResult;
    previous: FilingResult | undefined;
    onDownload: (url: string, filename: string) => void;
    align?: 'start' | 'end';
}) {
    return (
        <div className={cn('flex flex-wrap items-center gap-2', align === 'end' ? 'justify-end' : 'justify-start')}>
            <Link href={`/reader?url=${encodeURIComponent(item.downloadUrl)}`} className={buttonClass('secondary', 'sm')}>
                <FileText className="h-4 w-4" aria-hidden />
                Read
            </Link>
            {canCompare(item.form) &&
                (previous ? (
                    <Link
                        href={`/diff?url1=${encodeURIComponent(previous.downloadUrl)}&url2=${encodeURIComponent(item.downloadUrl)}&title=${encodeURIComponent(
                            `${item.companyTicker || item.companyName} ${item.form}: ${formatDate(previous.filingDate)} vs ${formatDate(item.filingDate)}`
                        )}`}
                        className={buttonClass('secondary', 'sm')}
                        title={`Compare with the ${item.form} filed ${formatDate(previous.filingDate)}`}
                    >
                        <Split className="h-4 w-4" aria-hidden />
                        Compare with previous
                    </Link>
                ) : (
                    <span
                        className={cn(buttonClass('secondary', 'sm'), 'cursor-not-allowed border-rule text-ink-muted hover:bg-surface')}
                        title={`No earlier ${item.form} from this company in these results. Widen the date range to compare.`}
                        aria-disabled="true"
                    >
                        <Split className="h-4 w-4" aria-hidden />
                        Compare with previous
                    </span>
                ))}
            <IconButton label={`Download this ${item.form} as HTML`} size="sm" onClick={() => onDownload(item.downloadUrl, item.primaryDocument)}>
                <Download className="h-4 w-4" aria-hidden />
            </IconButton>
        </div>
    );
}
