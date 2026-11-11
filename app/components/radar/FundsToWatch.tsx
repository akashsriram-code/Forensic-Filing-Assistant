"use client";

import { Fragment, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { classifyFiler } from '@/lib/filer-classification';
import { formatMoney, formatNumber, formatShares, formatSignedMoney, formatSignedPct } from '@/lib/format';
import type { FilerMove, FilerMoveDetail } from '@/lib/thirteen-f-radar-core';
import {
    ChangeBadge,
    Identifier,
    Panel,
    RowToggle,
    SectionHeader,
    Table,
    TableFooter,
    THead,
    Th,
    Td,
    Term,
    changeKindFromAction,
    rowClass,
    signedClass,
} from '../ui';
import { BarList } from './BarList';
import { secFilingsUrl } from './radar-format';
import { useShowMore } from './radar-hooks';

/** Well-known hedge funds and activists to check every filing season. Matched by name against the loaded fund moves. */
const WATCH_FUNDS = [
    { label: 'Citadel Advisors', patterns: ['citadel', 'citadel advisors'] },
    { label: 'Millennium Management', patterns: ['millennium', 'millennium management'] },
    { label: 'Point72', patterns: ['point72', 'point 72'] },
    { label: 'D.E. Shaw', patterns: ['d.e. shaw', 'de shaw', 'd e shaw'] },
    { label: 'Pershing Square', patterns: ['pershing square'] },
    { label: 'Third Point', patterns: ['third point'] },
    { label: 'Starboard Value', patterns: ['starboard'] },
    { label: 'Berkshire Hathaway', patterns: ['berkshire hathaway'] },
    { label: 'Carl Icahn', patterns: ['icahn', 'icahn capital', 'carl icahn'] },
    { label: 'Coatue Management', patterns: ['coatue'] },
    { label: 'Jana Partners', patterns: ['jana partners'] },
    { label: 'Lone Pine Capital', patterns: ['lone pine'] },
    { label: 'Tiger Global', patterns: ['tiger global'] },
    { label: 'Trian Fund Management', patterns: ['trian fund', 'trian partners'] },
    { label: 'ValueAct', patterns: ['valueact'] },
    { label: 'Viking Global', patterns: ['viking global'] },
    { label: 'Situational Awareness', patterns: ['situational awareness'] },
];

function matchesWatchFund(fundName: string, patterns: string[]): boolean {
    const normalizedName = fundName.toLowerCase();
    return patterns.some((pattern) => normalizedName.includes(pattern.toLowerCase()));
}

interface CategoryBreakdown {
    categoryKey: string;
    categoryLabel: string;
    totalValue: number;
    totalDelta: number;
}

type WatchSecurity = FilerMoveDetail & { categoryKey: string; categoryLabel: string };

interface WatchFundRow {
    label: string;
    found: boolean;
    filerType: string;
    cik: string;
    matches: FilerMove[];
    totalShares: number;
    previousValue: number;
    totalValue: number;
    totalDelta: number;
    pctChange: number;
    distinctSecurities: number;
    hasBuyer: boolean;
    hasSeller: boolean;
    categoryBreakdown: CategoryBreakdown[];
    securities: WatchSecurity[];
}

function buildRows(moves: FilerMove[]): WatchFundRow[] {
    const rows = WATCH_FUNDS.map((fund): WatchFundRow => {
        const matches = moves.filter((move) => matchesWatchFund(move.fundName, fund.patterns));
        const byCategory = new Map<string, CategoryBreakdown>();
        for (const move of matches) {
            const existing = byCategory.get(move.categoryKey) || { categoryKey: move.categoryKey, categoryLabel: move.categoryLabel, totalValue: 0, totalDelta: 0 };
            existing.totalValue += move.currentValue;
            existing.totalDelta += move.valueDelta;
            byCategory.set(move.categoryKey, existing);
        }
        const categoryBreakdown = Array.from(byCategory.values());
        const totalValue = categoryBreakdown.reduce((sum, c) => sum + c.totalValue, 0);
        const totalDelta = categoryBreakdown.reduce((sum, c) => sum + c.totalDelta, 0);
        const previousValue = matches.reduce((sum, m) => sum + m.previousValue, 0);
        const allDetails = matches.flatMap((m) => m.details || []);
        const actions = matches.map((m) => m.action);
        const first = matches[0];
        return {
            label: fund.label,
            found: matches.length > 0,
            filerType: first ? classifyFiler(first.cik, first.fundName).type : 'Unknown',
            cik: first?.cik || '',
            matches,
            totalShares: matches.reduce((sum, m) => sum + m.currentShares, 0),
            previousValue,
            totalValue,
            totalDelta,
            pctChange: previousValue > 0 ? (totalDelta / previousValue) * 100 : totalValue > 0 ? 100 : 0,
            distinctSecurities: new Set(allDetails.map((d) => (d.cusips && d.cusips[0]) || d.label)).size,
            hasBuyer: actions.includes('initiated') || actions.includes('increased'),
            hasSeller: actions.includes('liquidated') || actions.includes('decreased'),
            categoryBreakdown,
            securities: matches
                .flatMap((m) => (m.details || []).map((d) => ({ ...d, categoryKey: m.categoryKey, categoryLabel: m.categoryLabel })))
                .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0)),
        };
    });
    // Found funds first, then by number of matching moves.
    return rows.sort((a, b) => (a.found !== b.found ? (a.found ? -1 : 1) : b.matches.length - a.matches.length));
}

/** A fixed list of closely followed funds, checked against the biggest fund moves in the loaded comparison. */
export function FundsToWatch({ moves, quarterLabel, previousLabel }: { moves: FilerMove[]; quarterLabel: string; previousLabel: string }) {
    const rows = useMemo(() => buildRows(moves), [moves]);
    const [open, setOpen] = useState<string | null>(null);
    const foundCount = rows.filter((row) => row.found).length;

    return (
        <section aria-labelledby="radar-watch" className="space-y-4">
            <SectionHeader
                id="radar-watch"
                title="Funds to watch"
                intro={`Closely followed hedge funds and activists. ${formatNumber(foundCount)} of ${formatNumber(WATCH_FUNDS.length)} appear among the biggest fund moves in your watchlist categories between ${previousLabel} and ${quarterLabel}.`}
            />
            <Panel>
                <Table caption="Funds to watch and their moves">
                    <THead>
                        <tr>
                            <Th>Fund</Th>
                            <Th>
                                <Term id="filerType">Fund type</Term>
                            </Th>
                            <Th>Activity</Th>
                            <Th numeric>Stocks</Th>
                            <Th numeric>Shares</Th>
                            <Th numeric>
                                <Term id="estimatedValue">Value</Term>
                            </Th>
                            <Th numeric>Change in value</Th>
                            <Th numeric>Change</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {rows.map((fund) => {
                            const isOpen = open === fund.label;
                            const detailId = `watch-${fund.label.replace(/\W+/g, '-').toLowerCase()}`;
                            return (
                                <Fragment key={fund.label}>
                                    <tr className={cn(rowClass, isOpen && 'bg-surface-2/60')}>
                                        <Td>
                                            {fund.found ? (
                                                <RowToggle expanded={isOpen} onToggle={() => setOpen(isOpen ? null : fund.label)} controls={isOpen ? detailId : undefined}>
                                                    {fund.label}
                                                </RowToggle>
                                            ) : (
                                                <div className="text-ink-muted">{fund.label}</div>
                                            )}
                                            {fund.found && fund.cik && (
                                                <div className="pl-[22px]">
                                                    <Identifier label="CIK" value={fund.cik} />
                                                </div>
                                            )}
                                        </Td>
                                        <Td className="text-ink-muted">{fund.found ? fund.filerType : '—'}</Td>
                                        <Td>
                                            {fund.found ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {fund.hasBuyer && <ChangeBadge kind="added" label="Bought" />}
                                                    {fund.hasSeller && <ChangeBadge kind="cut" label="Sold" />}
                                                    {!fund.hasBuyer && !fund.hasSeller && <ChangeBadge kind="unchanged" />}
                                                </div>
                                            ) : (
                                                <span className="text-sm text-ink-muted">Not among the biggest moves</span>
                                            )}
                                        </Td>
                                        <Td numeric>{fund.found ? formatNumber(fund.distinctSecurities) : '—'}</Td>
                                        <Td numeric>{fund.found ? formatShares(fund.totalShares) : '—'}</Td>
                                        <Td numeric className="font-semibold text-ink">{fund.found ? formatMoney(fund.totalValue) : '—'}</Td>
                                        <Td numeric className={fund.found ? signedClass(fund.totalDelta) : 'text-ink-muted'}>
                                            {fund.found ? formatSignedMoney(fund.totalDelta) : '—'}
                                        </Td>
                                        <Td numeric className={fund.found ? signedClass(fund.pctChange) : 'text-ink-muted'}>
                                            {fund.found ? formatSignedPct(fund.pctChange) : '—'}
                                        </Td>
                                    </tr>
                                    {isOpen && fund.found && (
                                        <tr id={detailId}>
                                            <td colSpan={8} className="border-b border-rule bg-surface-2/40 p-0">
                                                <FundDetail fund={fund} quarterLabel={quarterLabel} />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </Table>
                <p className="border-t border-rule px-4 py-3 text-sm text-ink-muted">
                    Funds are matched by name, so a fund that files under a different legal name may be missed. Only the 100 biggest fund
                    moves in this comparison are checked.
                </p>
            </Panel>
        </section>
    );
}

function FundDetail({ fund, quarterLabel }: { fund: WatchFundRow; quarterLabel: string }) {
    const { limit, showMore, showLess } = useShowMore(15, 25);

    return (
        <div className="space-y-5 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-base text-ink">
                    {fund.label} · {fund.filerType} · {quarterLabel}
                </p>
                {fund.cik && (
                    <a
                        href={secFilingsUrl(fund.cik)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                    >
                        13F filings on SEC.gov
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                    </a>
                )}
            </div>

            <div>
                <h4 className="text-base font-semibold text-ink">Value by category</h4>
                <p className="mt-0.5 mb-3 text-sm text-ink-muted">Share of this fund’s value in your watchlist categories, with the change in value.</p>
                <BarList
                    label={`${fund.label} value by category`}
                    max={100}
                    items={fund.categoryBreakdown.map((cat) => {
                        const pct = fund.totalValue > 0 ? (cat.totalValue / fund.totalValue) * 100 : 0;
                        return {
                            key: cat.categoryKey,
                            label: cat.categoryLabel,
                            value: pct,
                            valueLabel: `${pct.toFixed(1)}%`,
                            secondary: <span className={signedClass(cat.totalDelta)}>{formatSignedMoney(cat.totalDelta)}</span>,
                            title: `${cat.categoryLabel}: ${formatMoney(cat.totalValue)}, change ${formatSignedMoney(cat.totalDelta)}`,
                        };
                    })}
                />
            </div>

            {fund.securities.length > 0 && (
                <div>
                    <h4 className="mb-2 text-base font-semibold text-ink">Stocks held ({formatNumber(fund.securities.length)})</h4>
                    <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
                        <table className="w-full border-collapse text-left text-base">
                            <caption className="sr-only">{`Stocks held by ${fund.label}`}</caption>
                            <THead>
                                <tr>
                                    <Th className="lg:static">Stock</Th>
                                    <Th className="lg:static">Category</Th>
                                    <Th className="lg:static">Change</Th>
                                    <Th numeric className="lg:static">Shares</Th>
                                    <Th numeric className="lg:static">Last quarter</Th>
                                    <Th numeric className="lg:static">Value</Th>
                                </tr>
                            </THead>
                            <tbody>
                                {fund.securities.slice(0, limit).map((sec, idx) => (
                                    <tr key={`${sec.cusips[0] || sec.label}-${idx}`} className={rowClass}>
                                        <Td>
                                            <div className="text-ink">{sec.label}</div>
                                            {sec.cusips[0] && <Identifier label="CUSIP" value={sec.cusips[0]} />}
                                        </Td>
                                        <Td className="text-ink-muted">{sec.categoryLabel || '—'}</Td>
                                        <Td>
                                            <ChangeBadge kind={changeKindFromAction(sec.action)} />
                                        </Td>
                                        <Td numeric>{formatShares(sec.currentShares)}</Td>
                                        <Td numeric className="text-ink-muted">{formatShares(sec.previousShares)}</Td>
                                        <Td numeric>{sec.currentValue ? formatMoney(sec.currentValue) : '—'}</Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <TableFooter shown={Math.min(limit, fund.securities.length)} total={fund.securities.length} noun="stocks" onShowMore={showMore} onShowLess={showLess} />
                    </div>
                </div>
            )}
        </div>
    );
}
