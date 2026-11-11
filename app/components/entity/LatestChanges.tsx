"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Split } from 'lucide-react';
import type { EntityProfile, FilingPair } from '@/lib/entity';
import type { SectionSummary } from '@/lib/diff-engine';
import { countsByHeading, sectionTakeaway } from '@/lib/diff-summary';
import { formatDate, plural } from '@/lib/format';
import { Button, CopyCitation, Notice, SkeletonRows, buttonClass } from '../ui';
import { postJson } from '../whale/model';

interface DiffSummaryResponse {
    summary: { risk: SectionSummary; mda: SectionSummary };
}

const PREVIEW = 5;

function diffHref(pair: FilingPair, label: string): string {
    const title = `${label} ${pair.form}: ${formatDate(pair.previous.filingDate)} vs ${formatDate(pair.current.filingDate)}`;
    return `/diff?url1=${encodeURIComponent(pair.previous.url)}&url2=${encodeURIComponent(pair.current.url)}&title=${encodeURIComponent(title)}`;
}

/**
 * "What changed in the latest 10-K": compares the two newest annual reports on request (it downloads both documents,
 * so it isn't run automatically) and shows the same summary sentence as the full comparison page, plus new risk factors.
 */
export function LatestChanges({ profile }: { profile: EntityProfile }) {
    const pair = profile.latestPairs.find((p) => p.form === '10-K') ?? profile.latestPairs.find((p) => p.form === '20-F') ?? null;
    const [state, setState] = useState<{ loading: boolean; error: string | null; summary: SectionSummary | null }>({ loading: false, error: null, summary: null });
    const label = profile.tickers[0] || profile.name;

    if (!pair) {
        return <p className="text-base text-ink-muted">{profile.name} has fewer than two annual reports (10-K or 20-F) among its filings, so there is nothing to compare.</p>;
    }

    const run = async () => {
        setState({ loading: true, error: null, summary: null });
        try {
            const result = await postJson<DiffSummaryResponse>('/api/diff', { url1: pair.previous.url, url2: pair.current.url }, 120000);
            setState({ loading: false, error: null, summary: result.summary.risk });
        } catch (error) {
            setState({ loading: false, error: error instanceof Error ? error.message : 'The comparison failed.', summary: null });
        }
    };

    const summary = state.summary;
    const byHeading = summary ? countsByHeading('risk', summary) : false;
    const cite = (filing: FilingPair['current']) => ({
        entity: profile.name,
        form: pair.form,
        filingDate: filing.filingDate,
        accession: filing.accessionNumber,
        url: filing.indexUrl,
    });

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-base text-ink-muted">
                <span>
                    {pair.form} filed {formatDate(pair.current.filingDate)} compared with the one filed {formatDate(pair.previous.filingDate)}.
                </span>
                <span className="inline-flex items-center gap-1">
                    <CopyCitation citation={cite(pair.current)} />
                    <CopyCitation citation={cite(pair.previous)} />
                </span>
            </div>

            {!summary && !state.loading && (
                <div className="flex flex-wrap gap-2">
                    <Button variant="primary" icon={<Split className="h-4 w-4" aria-hidden />} onClick={run}>
                        Compare the risk factors
                    </Button>
                    <Link href={diffHref(pair, label)} className={buttonClass('secondary', 'md')}>
                        Open the full comparison
                    </Link>
                </div>
            )}

            {state.loading && (
                <div className="space-y-2">
                    <p className="text-sm text-ink-muted">Comparing the two annual reports. Long 10-Ks can take up to a minute.</p>
                    <SkeletonRows rows={4} label="Comparing annual reports" />
                </div>
            )}

            {state.error && (
                <Notice tone="error" title="The comparison didn’t finish" action={<Button size="sm" onClick={run}>Try again</Button>}>
                    {state.error}
                </Notice>
            )}

            {summary && (
                <div className="space-y-4">
                    <p className="font-serif text-lg text-ink">{sectionTakeaway('risk', summary, byHeading).join(' ')}</p>
                    {byHeading && summary.newFactors.length > 0 && (
                        <div>
                            <h3 className="text-base font-semibold text-ink">New risk factors</h3>
                            <ul className="mt-2 space-y-2">
                                {summary.newFactors.slice(0, PREVIEW).map((factor) => (
                                    <li key={factor.heading} className="border-l-2 border-gain pl-3 text-base text-ink">{factor.heading}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {byHeading && summary.removedFactors.length > 0 && (
                        <div>
                            <h3 className="text-base font-semibold text-ink">Removed risk factors</h3>
                            <ul className="mt-2 space-y-2">
                                {summary.removedFactors.slice(0, PREVIEW).map((factor) => (
                                    <li key={factor.heading} className="border-l-2 border-loss pl-3 text-base text-ink-muted">{factor.heading}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <Link href={diffHref(pair, label)} className={buttonClass('secondary', 'md')}>
                        {summary.changed.length > 0
                            ? `See every change, including ${plural(summary.changed.length, 'reworded paragraph')}`
                            : 'Open the full comparison'}
                    </Link>
                </div>
            )}
        </div>
    );
}
