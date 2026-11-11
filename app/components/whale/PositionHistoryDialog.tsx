"use client";

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney, formatShares, formatSignedNumber, formatSignedPct, plural } from '@/lib/format';
import { Button, Chip, Dialog, Notice, SkeletonRows, Table, THead, Th, Td, Term, signedClass } from '../ui';
import { HistoryChart, type HistoryMetric } from './charts';
import { downloadCsv, errorMessage, formatQuarter, historyPointFromApi, postJson, slugify, type HistoryPoint, type HistoryResponse } from './model';

/**
 * What to show in the dialog. "fetch" reads the fund's past 13F filings live (Fund holdings and Compare modes);
 * "points" already has the history from the reverse lookup (Who owns a stock).
 */
export type HistoryTarget =
    | {
          kind: 'fetch';
          /** Identifies the fund to /api/whale-history: a CIK when known, otherwise the fund's filed name. */
          fundRef: string;
          fundName: string;
          issuer: string;
          cusip: string | null;
      }
    | { kind: 'points'; fundName: string; issuer: string; points: HistoryPoint[] };

export function PositionHistoryDialog({ target, onClose }: { target: HistoryTarget | null; onClose: () => void }) {
    const [attempt, setAttempt] = useState(0);
    const key = target ? `${target.kind}|${target.fundName}|${target.issuer}|${attempt}` : 'none';

    return (
        <Dialog
            open={Boolean(target)}
            onClose={onClose}
            size="lg"
            title={target ? `${target.issuer} position history at ${target.fundName}` : 'Position history'}
            description={
                <>
                    <Term id="positionHistory">Position history</Term>: what the fund reported at each quarter end in its 13F filings.
                </>
            }
        >
            {target && <HistoryBody key={key} target={target} onRetry={() => setAttempt((n) => n + 1)} />}
        </Dialog>
    );
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; points: HistoryPoint[] };

function HistoryBody({ target, onRetry }: { target: HistoryTarget; onRetry: () => void }) {
    const [state, setState] = useState<LoadState>(() =>
        target.kind === 'points' ? { status: 'ready', points: target.points } : { status: 'loading' }
    );
    const [metric, setMetric] = useState<HistoryMetric>('shares');

    useEffect(() => {
        if (target.kind !== 'fetch') return;
        let cancelled = false;
        postJson<HistoryResponse>(
            '/api/whale-history',
            { ticker: target.fundRef, holdingInfo: { issuer: target.issuer, cusip: target.cusip ?? undefined } },
            65000 // The route reads up to 8 filings live from EDGAR (server limit 60s).
        )
            .then((response) => {
                if (cancelled) return;
                const points = (response.history || []).map(historyPointFromApi);
                setState({ status: 'ready', points });
            })
            .catch((error: unknown) => {
                if (!cancelled) setState({ status: 'error', message: errorMessage(error) });
            });
        return () => {
            cancelled = true;
        };
    }, [target]);

    if (state.status === 'loading') {
        return (
            <div>
                <p className="text-base text-ink-muted">Reading the fund’s recent 13F filings from EDGAR. This can take up to a minute.</p>
                <SkeletonRows rows={5} label="Loading position history" />
            </div>
        );
    }

    if (state.status === 'error') {
        return (
            <Notice
                tone="error"
                title="Couldn’t load the position history"
                action={<Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
            >
                <p>{state.message}</p>
                <p className="mt-1">EDGAR may be slow right now. Try again in a minute, or open the fund’s filings on EDGAR.</p>
            </Notice>
        );
    }

    const points = state.points;
    if (points.length === 0) {
        return (
            <Notice title="No past filings found">
                We couldn’t find earlier 13F holdings reports for this fund, so there is no history to show.
            </Notice>
        );
    }

    const newestFirst = [...points].reverse();
    const first = points[0];
    const last = points[points.length - 1];
    const summary = `${metric === 'shares' ? 'Shares held' : 'Reported value'} across ${plural(points.length, 'filing')}, from ${formatShares(first.shares)} shares to ${formatShares(last.shares)} shares.`;
    const matchWord = target.issuer.toUpperCase().split(' ')[0];

    const exportCsv = () =>
        downloadCsv(
            points.map((point) => ({
                'Filing date': point.date,
                Quarter: point.quarter ? formatQuarter(point.quarter) : '',
                Shares: point.shares,
                'Value (USD)': Math.round(point.valueUsd),
            })),
            `${slugify(target.issuer)}-at-${slugify(target.fundName)}-history.csv`
        );

    return (
        <div className="space-y-5">
            {target.kind === 'fetch' && (
                <Notice tone="caution">
                    Read live from the fund’s last {plural(points.length, '13F filing')}. Rows are matched by CUSIP and by any
                    company name containing “{matchWord}”, so other companies or share classes with that word can be added in.
                    Check the filing before citing these numbers.
                </Notice>
            )}

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Measure to chart">
                <Chip selected={metric === 'shares'} onClick={() => setMetric('shares')}>Shares held</Chip>
                <Chip selected={metric === 'value'} onClick={() => setMetric('value')}>Value</Chip>
            </div>

            <HistoryChart points={points} metric={metric} summary={summary} />

            <Table caption={`${target.issuer} position history at ${target.fundName}`}>
                <THead>
                    <tr>
                        <Th>Filed</Th>
                        <Th numeric>Shares</Th>
                        <Th numeric><Term id="estimatedValue">Value</Term></Th>
                        <Th numeric>Change in shares</Th>
                    </tr>
                </THead>
                <tbody>
                    {newestFirst.map((point, index) => {
                        const previous = newestFirst[index + 1];
                        const change = previous ? point.shares - previous.shares : 0;
                        const pct = previous && previous.shares > 0 ? (change / previous.shares) * 100 : null;
                        return (
                            <tr key={`${point.date}-${point.quarter ?? ''}-${index}`}>
                                <Td>
                                    <span className="whitespace-nowrap">{formatDate(point.date)}</span>
                                    {point.quarter && <span className="block text-sm text-ink-muted">{formatQuarter(point.quarter)}</span>}
                                </Td>
                                <Td numeric>{point.shares > 0 ? formatShares(point.shares) : <span className="text-ink-muted">Not held</span>}</Td>
                                <Td numeric>{point.shares > 0 ? formatMoney(point.valueUsd) : <span className="text-ink-muted">—</span>}</Td>
                                <Td numeric className={cn(previous ? signedClass(change) : 'text-ink-muted')}>
                                    {!previous
                                        ? 'First filing shown'
                                        : change === 0
                                          ? 'No change'
                                          : previous.shares === 0
                                            ? `${formatSignedNumber(change)} (new)`
                                            : `${formatSignedNumber(change)} (${formatSignedPct(pct)})`}
                                </Td>
                            </tr>
                        );
                    })}
                </tbody>
            </Table>

            <div className="flex justify-end">
                <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden />} onClick={exportCsv}>
                    Download CSV
                </Button>
            </div>
        </div>
    );
}
