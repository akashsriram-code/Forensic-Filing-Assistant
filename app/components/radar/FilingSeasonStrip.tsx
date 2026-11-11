"use client";

import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber, formatShortDate, formatSignedMoney, plural } from '@/lib/format';
import { RECENT_FILER_WINDOW_DAYS, formatQuarterLabel, type FilerMove, type RadarApiResponse } from '@/lib/thirteen-f-radar-core';
import { Button, ChangeBadge, Table, TableFooter, THead, Th, Td, Term, changeKindFromAction, rowClass, signedClass } from '../ui';
import { FundCell } from './FundCell';
import { deadlineSentence, type FilingSeason } from './radar-takeaway';
import { actionWord } from './radar-format';
import { useShowMore } from './radar-hooks';

/**
 * One compact strip under the takeaway: deadline countdown, coverage against the last fully filed pair, a partial-data
 * warning with a way to the settled comparison, and a disclosure for who filed in the last week.
 */
export function FilingSeasonStrip({
    data,
    season,
    loading,
    onViewBaseline,
}: {
    data: RadarApiResponse;
    season: FilingSeason;
    loading: boolean;
    onViewBaseline: (quarter: string) => void;
}) {
    const [showRecent, setShowRecent] = useState(false);
    const recentFilers = data.recentFilers || [];
    const quarterLabel = formatQuarterLabel(data.coverage.currentQuarter);
    const previousLabel = formatQuarterLabel(data.coverage.previousQuarter);
    const deadline = deadlineSentence(season, formatDate);
    const pct = season.ratio !== null ? Math.round(season.ratio * 100) : null;

    if (!season.active && recentFilers.length === 0) return null;

    return (
        <div className="rounded-lg border border-rule bg-surface">
            {season.active && (
                <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    {deadline && (
                        <p className="flex items-start gap-2 text-base text-ink">
                            <CalendarClock className={cn('mt-1 h-4 w-4 shrink-0', season.daysLeft !== null && season.daysLeft >= 0 ? 'text-caution' : 'text-ink-muted')} aria-hidden />
                            <span>
                                {quarterLabel} <Term id="filingDeadline">filing season</Term>: {deadline}.
                            </span>
                        </p>
                    )}
                    {pct !== null && season.baselineComparableFilers !== null && (
                        <div className="w-full sm:w-72 sm:shrink-0">
                            <div className="flex items-baseline justify-between gap-3 text-sm text-ink-muted">
                                <span>
                                    <span className="tabular">{formatNumber(data.coverage.comparableFilers)}</span> of about{' '}
                                    <span className="tabular">{formatNumber(season.baselineComparableFilers)}</span> funds
                                </span>
                                <span className="tabular font-medium text-ink">{pct}%</span>
                            </div>
                            <div
                                className="mt-1 h-2 rounded-sm bg-surface-2"
                                role="meter"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={pct}
                                aria-label={`Filing coverage compared with a fully filed quarter: ${pct}%`}
                            >
                                <div className={cn('h-full rounded-r-[4px]', season.partial ? 'bg-caution' : 'bg-accent')} style={{ width: `${pct}%` }} />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {season.active && season.partial && season.baselineQuarter && (
                <div className="flex flex-col gap-3 border-t border-rule bg-caution/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-base text-ink">
                        Not every fund has filed yet, so the {quarterLabel} vs {previousLabel} counts will change as filings arrive.
                    </p>
                    <Button size="sm" onClick={() => onViewBaseline(season.baselineQuarter!)} disabled={loading} className="self-start sm:self-auto">
                        View fully filed {formatQuarterLabel(season.baselineQuarter)} comparison
                    </Button>
                </div>
            )}

            {recentFilers.length > 0 && (
                <div className={cn(season.active && 'border-t border-rule')}>
                    <button
                        type="button"
                        aria-expanded={showRecent}
                        aria-controls="radar-just-filed"
                        onClick={() => setShowRecent((open) => !open)}
                        className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base font-medium text-ink hover:text-accent"
                    >
                        <span>
                            Just filed: {plural(data.recentFilerCount ?? recentFilers.length, 'fund')} in the {RECENT_FILER_WINDOW_DAYS} days
                            {data.coverage.latestFilingDate ? ` through ${formatDate(data.coverage.latestFilingDate)}` : ''}
                        </span>
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:text-accent', showRecent && 'rotate-180')} aria-hidden />
                    </button>
                    {showRecent && (
                        <div id="radar-just-filed" className="border-t border-rule">
                            <JustFiledTable data={data} previousLabel={previousLabel} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function JustFiledTable({ data, previousLabel }: { data: RadarApiResponse; previousLabel: string }) {
    const recentFilers = useMemo(() => data.recentFilers || [], [data.recentFilers]);
    const { limit, showMore, showLess } = useShowMore(10, 20);
    const biggestMoveByCik = useMemo(() => {
        const map = new Map<string, FilerMove>();
        for (const move of data.topFilerMoves) {
            const existing = map.get(move.cik);
            if (!existing || Math.abs(move.valueDelta) > Math.abs(existing.valueDelta)) map.set(move.cik, move);
        }
        return map;
    }, [data.topFilerMoves]);
    const totalCount = data.recentFilerCount ?? recentFilers.length;

    return (
        <>
            <Table caption="Funds that filed in the last week">
                <THead>
                    <tr>
                        <Th>Fund</Th>
                        <Th>Filed</Th>
                        <Th>Biggest move in your watchlists</Th>
                    </tr>
                </THead>
                <tbody>
                    {recentFilers.slice(0, limit).map((filer) => {
                        const move = biggestMoveByCik.get(filer.cik);
                        return (
                            <tr key={filer.cik} className={rowClass}>
                                <Td>
                                    <FundCell cik={filer.cik} fundName={filer.fundName} accessionNumber={filer.accessionNumber} filingDate={filer.filingDate} />
                                </Td>
                                <Td className="whitespace-nowrap text-ink-muted">{formatShortDate(filer.filingDate)}</Td>
                                <Td>
                                    {move ? (
                                        <div className="space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-ink">{move.categoryLabel}</span>
                                                <ChangeBadge kind={changeKindFromAction(move.action)} />
                                                <span className={cn('tabular', signedClass(move.valueDelta))}>{formatSignedMoney(move.valueDelta)}</span>
                                            </div>
                                            {move.details[0] && (
                                                <div className="text-sm text-ink-muted">
                                                    Largest: {move.details[0].label} ({actionWord(move.details[0].action)})
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-ink-muted">
                                            {filer.comparable ? 'No changes in your watchlists' : `New filer: no ${previousLabel} filing to compare`}
                                        </span>
                                    )}
                                </Td>
                            </tr>
                        );
                    })}
                </tbody>
            </Table>
            <TableFooter
                shown={Math.min(limit, recentFilers.length)}
                total={recentFilers.length}
                noun="funds"
                onShowMore={showMore}
                onShowLess={showLess}
                note={totalCount > recentFilers.length ? `the ${formatNumber(recentFilers.length)} with the biggest watchlist moves out of ${formatNumber(totalCount)}` : undefined}
            />
        </>
    );
}
