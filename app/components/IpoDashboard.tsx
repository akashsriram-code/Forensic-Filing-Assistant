"use client";

import { useCallback, useEffect, useState } from 'react';
import {
    AlertCircle,
    BarChart3,
    BookOpen,
    Building,
    ExternalLink,
    FileText,
    Loader2,
    RefreshCw,
    Sparkles,
    Target,
    TrendingUp,
    X,
} from 'lucide-react';
import type { IpoFiling } from '@/lib/ipo-scraper';

interface IpoDashboardProps {
    theme: 'light' | 'dark';
}

interface IpoAnalysisResponse {
    filing: IpoFiling;
    report: Record<string, unknown> | null;
    rawAnswer: string;
    warning?: string;
    workflowId?: string;
}

export function IpoDashboard({ theme }: IpoDashboardProps) {
    const [filings, setFilings] = useState<IpoFiling[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [feedError, setFeedError] = useState('');
    const [selectedFiling, setSelectedFiling] = useState<IpoFiling | null>(null);
    const [analysisResults, setAnalysisResults] = useState<Record<string, IpoAnalysisResponse>>({});
    const [analyzingAccession, setAnalyzingAccession] = useState<string | null>(null);
    const [analysisError, setAnalysisError] = useState('');

    const isDark = theme === 'dark';
    const panelClass = isDark ? 'border-zinc-800 bg-zinc-900/45' : 'border-gray-200 bg-white';
    const softPanelClass = isDark ? 'border-zinc-800 bg-zinc-950/35' : 'border-gray-200 bg-gray-50/70';
    const textMain = isDark ? 'text-zinc-100' : 'text-gray-900';
    const textMuted = isDark ? 'text-zinc-400' : 'text-gray-500';

    const fetchData = useCallback(async (forceRefresh = false) => {
        if (forceRefresh) setRefreshing(true);
        else setLoading(true);
        setFeedError('');

        try {
            if (forceRefresh) {
                const refreshRes = await fetch('/api/ipo-filings', { method: 'POST' });
                const refreshData = await parseJsonResponse(refreshRes);
                if (!refreshRes.ok) {
                    throw new Error(stringField(refreshData, 'error') || 'IPO refresh failed');
                }
            }

            const res = await fetch('/api/ipo-filings');
            const data = await parseJsonResponse(res);
            if (!res.ok) {
                throw new Error(stringField(data, 'error') || 'Failed to fetch IPO filings');
            }

            setFilings(Array.isArray(data.filings) ? data.filings : []);
        } catch (error) {
            console.error('Failed to fetch IPO filings', error);
            setFeedError(error instanceof Error ? error.message : 'Failed to fetch IPO filings');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    const analyzeFiling = async (filing: IpoFiling) => {
        setSelectedFiling(filing);
        setAnalysisError('');

        if (analysisResults[filing.accessionNumber]) return;

        setAnalyzingAccession(filing.accessionNumber);
        try {
            const res = await fetch('/api/ipo-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessionNumber: filing.accessionNumber }),
            });
            const data = await parseJsonResponse(res);
            if (!res.ok) {
                throw new Error(stringField(data, 'error') || 'IPO analysis failed');
            }

            setAnalysisResults((current) => ({
                ...current,
                [filing.accessionNumber]: data as unknown as IpoAnalysisResponse,
            }));
        } catch (error) {
            console.error('IPO analysis failed', error);
            setAnalysisError(error instanceof Error ? error.message : 'IPO analysis failed');
        } finally {
            setAnalyzingAccession((current) => current === filing.accessionNumber ? null : current);
        }
    };

    const selectedAnalysis = selectedFiling ? analysisResults[selectedFiling.accessionNumber] : null;
    const selectedIsLoading = selectedFiling?.accessionNumber === analyzingAccession;

    return (
        <div className="space-y-6">
            <div className={`rounded-lg border px-4 py-4 ${isDark ? 'border-blue-900/60 bg-blue-950/20 text-blue-100' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 h-5 w-5 shrink-0" />
                        <div className="space-y-1 text-sm">
                            <p className="font-semibold">IPO Filing Intelligence</p>
                            <p className="max-w-4xl opacity-85">
                                Recent S-1 and F-1 registration statements, with OpenArena analysis for reportable facts,
                                risk factors, financial clues, offering structure, and story angles.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => void fetchData(true)}
                        disabled={refreshing}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                        {refreshing ? 'Scanning...' : 'Refresh Feed'}
                    </button>
                </div>
            </div>

            {feedError && (
                <div className={`rounded-lg border px-4 py-3 text-sm ${isDark ? 'border-red-900/70 bg-red-950/30 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {feedError}
                </div>
            )}

            <div className={`overflow-hidden rounded-xl border ${panelClass}`}>
                <div className={`flex items-center justify-between border-b px-6 py-4 ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-100 bg-gray-50/50'}`}>
                    <div>
                        <h3 className={`font-semibold ${textMain}`}>Recent IPO Filings</h3>
                        <p className={`mt-1 text-xs ${textMuted}`}>S-1, S-1/A, F-1, and F-1/A filings from the cached SEC feed.</p>
                    </div>
                    <div className={`text-xs ${textMuted}`}>
                        {filings.length.toLocaleString()} filings
                    </div>
                </div>

                {loading && filings.length === 0 ? (
                    <div className={`flex items-center justify-center gap-2 p-12 text-sm ${textMuted}`}>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading filings...
                    </div>
                ) : filings.length === 0 ? (
                    <div className={`p-12 text-center text-sm ${textMuted}`}>
                        No IPO filings are cached yet. Refresh the feed to scan recent SEC registration statements.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className={`${isDark ? 'bg-zinc-900/50 text-zinc-500' : 'bg-gray-50 text-gray-500'} text-xs font-medium uppercase`}>
                                <tr>
                                    <th className="px-6 py-3">Date</th>
                                    <th className="px-6 py-3">Company</th>
                                    <th className="px-6 py-3">Form</th>
                                    <th className="px-6 py-3">Offering</th>
                                    <th className="px-6 py-3">Symbol</th>
                                    <th className="px-6 py-3">Deal / Value</th>
                                    <th className="px-6 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${isDark ? 'divide-zinc-800' : 'divide-gray-100'}`}>
                                {filings.map((filing) => {
                                    const isAnalyzing = analyzingAccession === filing.accessionNumber;
                                    const hasAnalysis = Boolean(analysisResults[filing.accessionNumber]);

                                    return (
                                        <tr key={filing.accessionNumber} className={`transition-colors ${isDark ? 'hover:bg-zinc-800/50' : 'hover:bg-gray-50'}`}>
                                            <td className={`whitespace-nowrap px-6 py-4 font-mono text-xs ${textMuted}`}>{filing.filingDate}</td>
                                            <td className={`min-w-64 px-6 py-4 ${textMain}`}>
                                                <div className="font-medium">{filing.companyName}</div>
                                                <div className={`mt-1 font-mono text-[10px] ${textMuted}`}>CIK {filing.cik} - {filing.accessionNumber}</div>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${filing.form.includes('S-1') ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'}`}>
                                                    {filing.form}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                {filing.offeringType ? (
                                                    <span className={`inline-flex rounded border px-2 py-1 text-xs font-medium ${filing.offeringType === 'IPO'
                                                        ? 'border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                                        : 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                                                        }`}>
                                                        {filing.offeringType}
                                                    </span>
                                                ) : (
                                                    <span className={textMuted}>-</span>
                                                )}
                                            </td>
                                            <td className={`whitespace-nowrap px-6 py-4 font-mono text-xs ${textMuted}`}>
                                                {filing.pricing?.proposedSymbol || filing.pricing?.exchange || '-'}
                                            </td>
                                            <td className={`whitespace-nowrap px-6 py-4 font-mono text-xs ${textMuted}`}>
                                                {filing.pricing?.dealSize || filing.pricing?.estimatedValuation || '-'}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <a
                                                        href={filing.reportUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${isDark ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-white' : 'border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900'}`}
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                        SEC
                                                    </a>
                                                    <button
                                                        onClick={() => void analyzeFiling(filing)}
                                                        disabled={Boolean(analyzingAccession) && !isAnalyzing}
                                                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? 'bg-white text-black hover:bg-zinc-200' : 'bg-gray-900 text-white hover:bg-black'}`}
                                                    >
                                                        {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                                        {hasAnalysis ? 'View Report' : isAnalyzing ? 'Analyzing...' : 'Analyze'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {selectedFiling && (
                <AnalysisDrawer
                    theme={theme}
                    filing={selectedFiling}
                    result={selectedAnalysis}
                    loading={selectedIsLoading}
                    error={analysisError}
                    onClose={() => {
                        setSelectedFiling(null);
                        setAnalysisError('');
                    }}
                    panelClass={panelClass}
                    softPanelClass={softPanelClass}
                    textMain={textMain}
                    textMuted={textMuted}
                />
            )}
        </div>
    );
}

function AnalysisDrawer({
    theme,
    filing,
    result,
    loading,
    error,
    onClose,
    panelClass,
    softPanelClass,
    textMain,
    textMuted,
}: {
    theme: 'light' | 'dark';
    filing: IpoFiling;
    result: IpoAnalysisResponse | null;
    loading: boolean;
    error: string;
    onClose: () => void;
    panelClass: string;
    softPanelClass: string;
    textMain: string;
    textMuted: string;
}) {
    const isDark = theme === 'dark';
    const report = result?.report || null;

    return (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <aside
                className={`h-full w-full max-w-3xl overflow-y-auto border-l shadow-2xl ${isDark ? 'border-zinc-800 bg-zinc-950' : 'border-gray-200 bg-white'}`}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={`sticky top-0 z-10 border-b px-6 py-4 ${isDark ? 'border-zinc-800 bg-zinc-950/95' : 'border-gray-200 bg-white/95'} backdrop-blur`}>
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className={`truncate text-lg font-bold ${textMain}`}>{filing.companyName}</h2>
                                <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${isDark ? 'bg-zinc-800 text-zinc-200' : 'bg-gray-100 text-gray-700'}`}>
                                    {filing.form}
                                </span>
                            </div>
                            <p className={`mt-1 text-xs ${textMuted}`}>{filing.filingDate} - CIK {filing.cik} - {filing.accessionNumber}</p>
                        </div>
                        <button onClick={onClose} className={`rounded-full p-2 transition-colors ${isDark ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`} title="Close report">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="space-y-6 p-6">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <MetricTile icon={<TrendingUp className="h-4 w-4" />} label="Price" value={filing.pricing?.priceRange || 'N/A'} className={softPanelClass} mutedClass={textMuted} />
                        <MetricTile icon={<BarChart3 className="h-4 w-4" />} label="Deal" value={filing.pricing?.dealSize || 'N/A'} className={softPanelClass} mutedClass={textMuted} />
                        <MetricTile icon={<Building className="h-4 w-4" />} label="Exchange" value={filing.pricing?.exchange || 'N/A'} className={softPanelClass} mutedClass={textMuted} />
                        <MetricTile icon={<Target className="h-4 w-4" />} label="Symbol" value={filing.pricing?.proposedSymbol || 'N/A'} className={softPanelClass} mutedClass={textMuted} />
                    </div>

                    {loading && (
                        <div className={`rounded-lg border p-8 text-center ${panelClass}`}>
                            <Loader2 className={`mx-auto h-6 w-6 animate-spin ${isDark ? 'text-zinc-300' : 'text-gray-700'}`} />
                            <p className={`mt-3 text-sm font-medium ${textMain}`}>Running OpenArena IPO analysis...</p>
                            <p className={`mt-1 text-xs ${textMuted}`}>Uploading the filing, parsing it, and generating reportable findings.</p>
                        </div>
                    )}

                    {error && (
                        <div className={`rounded-lg border px-4 py-3 text-sm ${isDark ? 'border-red-900/70 bg-red-950/30 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                            <div className="flex items-start gap-2">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{error}</span>
                            </div>
                        </div>
                    )}

                    {result?.warning && (
                        <div className={`rounded-lg border px-4 py-3 text-sm ${isDark ? 'border-amber-900/70 bg-amber-950/20 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                            {result.warning}
                        </div>
                    )}

                    {report ? (
                        <StructuredReport report={report} panelClass={panelClass} softPanelClass={softPanelClass} textMain={textMain} textMuted={textMuted} />
                    ) : result?.rawAnswer ? (
                        <RawReport rawAnswer={result.rawAnswer} panelClass={panelClass} textMain={textMain} textMuted={textMuted} />
                    ) : !loading && !error ? (
                        <div className={`rounded-lg border p-8 text-center ${panelClass}`}>
                            <BookOpen className={`mx-auto h-6 w-6 ${textMuted}`} />
                            <p className={`mt-3 text-sm ${textMuted}`}>Select Analyze to generate an IPO intelligence report.</p>
                        </div>
                    ) : null}

                    <div className={`flex items-center justify-between border-t pt-4 ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
                        <span className={`text-xs ${textMuted}`}>Workflow: {result?.workflowId || 'c994c878-6dc4-482b-a711-9016ec373db'}</span>
                        <a
                            href={filing.reportUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${isDark ? 'bg-white text-black hover:bg-zinc-200' : 'bg-gray-900 text-white hover:bg-black'}`}
                        >
                            <ExternalLink className="h-4 w-4" />
                            View Filing
                        </a>
                    </div>
                </div>
            </aside>
        </div>
    );
}

function StructuredReport({
    report,
    panelClass,
    softPanelClass,
    textMain,
    textMuted,
}: {
    report: Record<string, unknown>;
    panelClass: string;
    softPanelClass: string;
    textMain: string;
    textMuted: string;
}) {
    const quickTake = asText(report.quickTake);
    const findings = toArray(report.mostReportableFindings);
    const risks = toArray(report.riskFactorReadout);
    const notes = toArray(report.financialAndOfferingNotes);
    const angles = toArray(report.bestStoryAngles);
    const questions = toArray(report.followUpDiligenceQuestions);
    const verdict = asText(report.plainEnglishVerdict);

    return (
        <div className="space-y-6">
            {quickTake && (
                <section className={`rounded-lg border p-5 ${panelClass}`}>
                    <h3 className={`text-sm font-semibold ${textMain}`}>Quick Take</h3>
                    <p className={`mt-3 text-sm leading-6 ${textMuted}`}>{quickTake}</p>
                </section>
            )}

            <ReportCardList title="Most Reportable Findings" icon={<Sparkles className="h-4 w-4" />} items={findings} panelClass={panelClass} softPanelClass={softPanelClass} textMain={textMain} textMuted={textMuted} />
            <ReportCardList title="Risk Factor Readout" icon={<AlertCircle className="h-4 w-4" />} items={risks} panelClass={panelClass} softPanelClass={softPanelClass} textMain={textMain} textMuted={textMuted} />
            <ReportCardList title="Financial and Offering Notes" icon={<FileText className="h-4 w-4" />} items={notes} panelClass={panelClass} softPanelClass={softPanelClass} textMain={textMain} textMuted={textMuted} />
            <ReportCardList title="Best Story Angles" icon={<BookOpen className="h-4 w-4" />} items={angles} panelClass={panelClass} softPanelClass={softPanelClass} textMain={textMain} textMuted={textMuted} />

            {questions.length > 0 && (
                <section className={`rounded-lg border p-5 ${panelClass}`}>
                    <h3 className={`text-sm font-semibold ${textMain}`}>Follow-Up Diligence Questions</h3>
                    <ul className={`mt-3 space-y-2 text-sm leading-6 ${textMuted}`}>
                        {questions.map((question, index) => (
                            <li key={index} className="flex gap-2">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                                <span>{asText(question) || JSON.stringify(question)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {verdict && (
                <section className={`rounded-lg border p-5 ${panelClass}`}>
                    <h3 className={`text-sm font-semibold ${textMain}`}>Plain-English Verdict</h3>
                    <p className={`mt-3 text-sm leading-6 ${textMuted}`}>{verdict}</p>
                </section>
            )}
        </div>
    );
}

function ReportCardList({
    title,
    icon,
    items,
    panelClass,
    softPanelClass,
    textMain,
    textMuted,
}: {
    title: string;
    icon: React.ReactNode;
    items: unknown[];
    panelClass: string;
    softPanelClass: string;
    textMain: string;
    textMuted: string;
}) {
    if (items.length === 0) return null;

    return (
        <section className={`rounded-lg border p-5 ${panelClass}`}>
            <h3 className={`flex items-center gap-2 text-sm font-semibold ${textMain}`}>
                {icon}
                {title}
            </h3>
            <div className="mt-4 space-y-3">
                {items.map((item, index) => (
                    <ReportItem key={index} item={item} className={softPanelClass} textMain={textMain} textMuted={textMuted} />
                ))}
            </div>
        </section>
    );
}

function ReportItem({
    item,
    className,
    textMain,
    textMuted,
}: {
    item: unknown;
    className: string;
    textMain: string;
    textMuted: string;
}) {
    if (typeof item === 'string') {
        return <p className={`rounded-lg border p-4 text-sm leading-6 ${className} ${textMuted}`}>{item}</p>;
    }

    const record = asRecord(item);
    if (!record) {
        return <p className={`rounded-lg border p-4 text-sm leading-6 ${className} ${textMuted}`}>{JSON.stringify(item)}</p>;
    }

    const heading = firstText(record, ['title', 'headline', 'risk', 'question']) || 'Report item';
    const body = firstText(record, ['whyItMatters', 'whyItWorks', 'note', 'evidence', 'filingEvidence', 'answer']);
    const evidence = firstText(record, ['filingEvidence', 'evidence']);
    const source = firstText(record, ['sectionSource', 'source']);
    const angleType = firstText(record, ['angleType', 'type']);
    const followUp = firstText(record, ['followUpQuestion']);
    const score = firstText(record, ['reportabilityScore', 'curiosityScore']);

    return (
        <article className={`rounded-lg border p-4 ${className}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <h4 className={`text-sm font-semibold ${textMain}`}>{heading}</h4>
                <div className="flex flex-wrap gap-2">
                    {angleType && <Pill>{angleType}</Pill>}
                    {score && <Pill>Score {score}</Pill>}
                </div>
            </div>
            {body && <p className={`mt-3 text-sm leading-6 ${textMuted}`}>{body}</p>}
            {evidence && evidence !== body && (
                <p className={`mt-3 border-l-2 pl-3 text-xs leading-5 ${textMuted}`}>
                    <span className="font-semibold">Evidence: </span>{evidence}
                </p>
            )}
            {(source || followUp) && (
                <div className={`mt-3 space-y-1 text-xs ${textMuted}`}>
                    {source && <p><span className="font-semibold">Source: </span>{source}</p>}
                    {followUp && <p><span className="font-semibold">Follow-up: </span>{followUp}</p>}
                </div>
            )}
        </article>
    );
}

function RawReport({
    rawAnswer,
    panelClass,
    textMain,
    textMuted,
}: {
    rawAnswer: string;
    panelClass: string;
    textMain: string;
    textMuted: string;
}) {
    return (
        <section className={`rounded-lg border p-5 ${panelClass}`}>
            <h3 className={`text-sm font-semibold ${textMain}`}>OpenArena Report</h3>
            <pre className={`mt-4 whitespace-pre-wrap text-sm leading-6 ${textMuted}`}>{rawAnswer}</pre>
        </section>
    );
}

function MetricTile({
    icon,
    label,
    value,
    className,
    mutedClass,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    className: string;
    mutedClass: string;
}) {
    return (
        <div className={`rounded-lg border p-3 ${className}`}>
            <div className={`flex items-center gap-2 text-[11px] font-medium uppercase ${mutedClass}`}>
                {icon}
                {label}
            </div>
            <div className="mt-2 truncate text-sm font-semibold">{value}</div>
        </div>
    );
}

function Pill({ children }: { children: React.ReactNode }) {
    return (
        <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200">
            {children}
        </span>
    );
}

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    if (!text.trim()) return {};

    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return { error: text.slice(0, 240) };
    }
}

function stringField(record: Record<string, unknown>, field: string) {
    const value = record[field];
    return typeof value === 'string' ? value : '';
}

function toArray(value: unknown) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === '') return [];
    return [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asText(value: unknown) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function firstText(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = asText(record[key]);
        if (value) return value;
    }
    return '';
}
