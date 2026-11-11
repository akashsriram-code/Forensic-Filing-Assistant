"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, History } from 'lucide-react';
import { getSector } from '@/lib/sectors';
import type { Citation } from '@/lib/citation';
import { formatDate, formatMoney, formatNumber, formatPct, formatShares, formatSignedMoney, formatSignedNumber, formatSignedPct, plural } from '@/lib/format';
import {
    Button,
    ChangeBadge,
    Chip,
    CopyCitation,
    Identifier,
    Notice,
    Panel,
    SectionHeader,
    Stat,
    StatStrip,
    Table,
    TableEmpty,
    TableFooter,
    Takeaway,
    Term,
    THead,
    Th,
    Td,
    rowClass,
    signedClass,
    type ChangeKind,
} from '../ui';
import { FollowButton } from '../FollowButton';
import { DivergingBars, RankedBars } from './charts';
import { PositionHistoryDialog, type HistoryTarget } from './PositionHistoryDialog';
import { Updating, useShowMore } from './shared';
import { downloadCsv, formatQuarter, quarterEndDate, slugify, toFundHoldings, type FundHolding, type FundHoldingsResponse } from './model';

type Filter = 'all' | ChangeKind;

const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'new', label: 'New' },
    { id: 'added', label: 'Added' },
    { id: 'cut', label: 'Cut' },
    { id: 'exited', label: 'Sold out' },
    { id: 'unchanged', label: 'No change' },
];

const KIND_LABEL: Record<ChangeKind, string> = { new: 'New', added: 'Added', cut: 'Cut', exited: 'Sold out', unchanged: 'No change' };

/** Story order: new positions, then sold-out positions, then the largest changes by estimated dollar size. */
const KIND_RANK: Record<ChangeKind, number> = { new: 0, exited: 1, added: 2, cut: 2, unchanged: 3 };

/** The fund's 13F-HR filings behind the figures, for "Copy citation" and the takeaway's sources. */
export function fundHoldingsSources(data: FundHoldingsResponse): Citation[] {
    const entity = data.filerName || data.ticker;
    const sources: Citation[] = [];
    if (data.accessionCurr) sources.push({ entity, form: '13F-HR', filingDate: data.filingDateCurr, accession: data.accessionCurr, cik: data.cik ?? null });
    if (data.accessionPrev) sources.push({ entity, form: '13F-HR', filingDate: data.filingDatePrev, accession: data.accessionPrev, cik: data.cik ?? null });
    return sources;
}

export function buildFundHoldingsView(data: FundHoldingsResponse) {
    const snapshotOnly = !data.filingDatePrev && !data.previousQuarter;
    const holdings = toFundHoldings(data, snapshotOnly);
    const held = holdings.filter((h) => h.sharesCurr > 0);
    const totalValue = held.reduce((sum, h) => sum + h.valueUsd, 0);
    const share = (value: number) => (totalValue > 0 ? (value / totalValue) * 100 : 0);

    const counts: Record<Filter, number> = { all: holdings.length, new: 0, added: 0, cut: 0, exited: 0, unchanged: 0 };
    for (const h of holdings) counts[h.kind] += 1;

    const byValue = [...held].sort((a, b) => b.valueUsd - a.valueUsd);
    const topHoldings = byValue.slice(0, 10).map((h) => ({
        id: h.id,
        label: h.issuer,
        value: h.valueUsd,
        display: formatPct(share(h.valueUsd)),
        note: formatMoney(h.valueUsd),
    }));

    const sectorTotals = new Map<string, number>();
    for (const h of held) {
        const sector = getSector(h.issuer);
        const label = sector === 'Other' ? 'Not classified' : sector;
        sectorTotals.set(label, (sectorTotals.get(label) || 0) + h.valueUsd);
    }
    const sectorsSorted = Array.from(sectorTotals.entries()).sort((a, b) => b[1] - a[1]);
    const sectorRows = sectorsSorted.length > 8
        ? [...sectorsSorted.slice(0, 7), ['All other sectors', sectorsSorted.slice(7).reduce((sum, [, v]) => sum + v, 0)] as [string, number]]
        : sectorsSorted;
    const sectors = sectorRows.map(([label, value]) => ({ id: label, label, value, display: formatPct(share(value)), note: formatMoney(value) }));

    const priced = holdings.filter((h) => h.tradeValueUsd !== null && h.tradeValueUsd !== 0);
    const biggestChanges = [...priced]
        .sort((a, b) => Math.abs(b.tradeValueUsd!) - Math.abs(a.tradeValueUsd!))
        .slice(0, 10)
        .sort((a, b) => b.tradeValueUsd! - a.tradeValueUsd!)
        .map((h) => ({ id: h.id, label: h.issuer, value: h.tradeValueUsd!, display: formatSignedMoney(h.tradeValueUsd) }));

    const biggestNew = holdings.filter((h) => h.kind === 'new').sort((a, b) => b.valueUsd - a.valueUsd)[0] ?? null;
    const biggestCut = holdings.filter((h) => h.kind === 'cut').sort((a, b) => (a.tradeValueUsd ?? 0) - (b.tradeValueUsd ?? 0))[0] ?? null;

    const ordered = snapshotOnly
        ? byValue
        : [...holdings].sort((a, b) =>
              KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
              Math.abs(b.tradeValueUsd ?? 0) - Math.abs(a.tradeValueUsd ?? 0) ||
              b.sharesPrev - a.sharesPrev ||
              b.valueUsd - a.valueUsd
          );

    const fundName = data.filerName || data.ticker;
    const period = data.currentQuarter ? `for ${formatQuarter(data.currentQuarter)}` : `in its filing of ${formatDate(data.filingDateCurr)}`;
    const sentences = [`${fundName} reported ${plural(held.length, 'holding')} worth ${formatMoney(totalValue)} ${period}.`];
    if (snapshotOnly) {
        sentences.push('Changes from the quarter before aren’t available for this filing.');
    } else {
        const newPart = biggestNew ? `Biggest new position: ${biggestNew.issuer} (${formatMoney(biggestNew.valueUsd)})` : 'No new positions';
        const cutPart = biggestCut
            ? `biggest cut: ${biggestCut.issuer} (shares down ${formatPct(Math.abs(biggestCut.pctChange ?? 0))})`
            : 'no holdings were cut';
        sentences.push(`${newPart}; ${cutPart}.`);
        if (counts.exited > 0) sentences.push(`It also sold out of ${plural(counts.exited, 'position')}.`);
    }
    const sentence = sentences.join(' ');

    return { snapshotOnly, holdings, held, totalValue, share, counts, topHoldings, sectors, biggestChanges, ordered, fundName, sentence };
}

type View = ReturnType<typeof buildFundHoldingsView>;

/**
 * Everything shown for one fund's holdings: takeaway with sources, stats, charts, and the holdings table with
 * position history. Used by Whale Tracker's Fund holdings mode and by the fund page.
 */
export function FundHoldingsView({
    data,
    updating = false,
    linkFundPage = false,
    showIdentity = true,
}: {
    data: FundHoldingsResponse;
    updating?: boolean;
    /** Link the fund's name to its /fund page (off on the fund page itself). */
    linkFundPage?: boolean;
    /** Show the fund name, CIK and Follow button (the fund page has its own header); citation and CSV always show. */
    showIdentity?: boolean;
}) {
    const view = useMemo(() => buildFundHoldingsView(data), [data]);
    const sources = useMemo(() => fundHoldingsSources(data), [data]);
    // Filters and paging start fresh for each fund or filing.
    return <FundHoldingsBody key={`${data.cik}-${data.filingDateCurr}`} data={data} view={view} sources={sources} updating={updating} linkFundPage={linkFundPage} showIdentity={showIdentity} />;
}

function FundHoldingsBody({
    data,
    view,
    sources,
    updating,
    linkFundPage,
    showIdentity,
}: {
    data: FundHoldingsResponse;
    view: View;
    sources: Citation[];
    updating: boolean;
    linkFundPage: boolean;
    showIdentity: boolean;
}) {
    const [filter, setFilter] = useState<Filter>('all');
    const rows = useShowMore(25);
    const [history, setHistory] = useState<HistoryTarget | null>(null);
    const fundCik = data.cik ? String(Number(data.cik)) : null;

    return (
        <>
            <Takeaway
                copyText={view.sentence}
                sources={sources}
                asOf={quarterEndDate(data.currentQuarter) ?? data.filingDateCurr}
                updating={updating}
                note={
                    <span>
                        Filed {formatDate(data.filingDateCurr)}
                        {data.filingDatePrev && <>, compared with the filing of {formatDate(data.filingDatePrev)}</>}
                    </span>
                }
            >
                {view.sentence}
            </Takeaway>

            <Updating updating={updating}>
                <div className="space-y-4">
                    {(
                        <div className={showIdentity ? 'flex flex-wrap items-center justify-between gap-3' : 'flex flex-wrap items-center justify-end gap-3'}>
                            {showIdentity && (
                                <div className="min-w-0">
                                    {linkFundPage && fundCik ? (
                                        <Link href={`/fund/${fundCik}`} className="text-lg font-semibold text-accent hover:underline">
                                            {view.fundName}
                                        </Link>
                                    ) : (
                                        <p className="text-lg font-semibold text-ink">{view.fundName}</p>
                                    )}
                                    {data.cik && <Identifier label="CIK" value={data.cik} className="block" />}
                                </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                                {/* Follow by CIK when we have it: a name can resolve to a different SEC entity. The fund page's header has its own. */}
                                {showIdentity && <FollowButton ticker={fundCik ?? data.ticker} />}
                                {sources[0] && <CopyCitation citation={sources[0]} withLabel />}
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    icon={<Download className="h-4 w-4" aria-hidden />}
                                    onClick={() => exportHoldings(data, view.holdings, view.share)}
                                >
                                    Download CSV
                                </Button>
                            </div>
                        </div>
                    )}
                    {data.note && <Notice tone="caution">{data.note}</Notice>}
                    <StatStrip>
                        <Stat label="Holdings" value={formatNumber(view.held.length)} />
                        <Stat label="Total value" term="estimatedValue" value={formatMoney(view.totalValue)} />
                        <Stat
                            label="New positions"
                            term="newPosition"
                            value={view.snapshotOnly ? '—' : formatNumber(view.counts.new)}
                            tone={!view.snapshotOnly && view.counts.new > 0 ? 'gain' : undefined}
                            note={view.snapshotOnly ? 'No earlier quarter to compare' : undefined}
                        />
                        <Stat
                            label="Sold out"
                            term="soldOut"
                            value={view.snapshotOnly ? '—' : formatNumber(view.counts.exited)}
                            tone={!view.snapshotOnly && view.counts.exited > 0 ? 'loss' : undefined}
                        />
                    </StatStrip>
                </div>

                <div className="grid gap-10 md:grid-cols-2">
                    <section className="space-y-4">
                        <SectionHeader level={3} title="Top holdings" intro="The ten largest positions, as a share of the reported portfolio." />
                        <RankedBars items={view.topHoldings} label="Top holdings by share of portfolio" />
                    </section>
                    <section className="space-y-4">
                        <SectionHeader
                            level={3}
                            title="Sector exposure"
                            intro={<>Share of the portfolio by <Term id="sectorGuess">estimated sector</Term>. Sectors are assigned from company names, so check before citing.</>}
                        />
                        <RankedBars items={view.sectors} label="Sector exposure by share of portfolio" />
                    </section>
                </div>

                {!view.snapshotOnly && (
                    <section className="space-y-4">
                        <SectionHeader
                            level={3}
                            title="Biggest changes"
                            intro={<>The largest buys and cuts by <Term id="tradeValue">estimated value bought or sold</Term>.</>}
                        />
                        {view.biggestChanges.length > 0 ? (
                            <DivergingBars
                                items={view.biggestChanges}
                                label="Biggest changes by estimated value bought or sold"
                                positiveLabel="Bought or added"
                                negativeLabel="Cut"
                            />
                        ) : (
                            <p className="text-base text-ink-muted">No share counts changed between these two filings.</p>
                        )}
                        {view.counts.exited > 0 && (
                            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                                {plural(view.counts.exited, 'sold-out position')} {view.counts.exited === 1 ? 'isn’t' : 'aren’t'} charted because
                                there is no current price.
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setFilter('exited');
                                        rows.reset();
                                        document.getElementById('fund-holdings-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }}
                                >
                                    Show sold-out positions
                                </Button>
                            </p>
                        )}
                    </section>
                )}

                <HoldingsTable
                    view={view}
                    filter={filter}
                    onFilter={(next) => {
                        setFilter(next);
                        rows.reset();
                    }}
                    limit={rows.limit}
                    onShowMore={rows.showMore}
                    onHistory={(h) =>
                        setHistory({
                            kind: 'fetch',
                            // whale-history resolves this with fetchCIK; the CIK is exact, a name is a fallback.
                            fundRef: data.cik || view.fundName,
                            fundName: view.fundName,
                            issuer: h.issuer,
                            cusip: h.cusip,
                        })
                    }
                />
            </Updating>

            <PositionHistoryDialog target={history} onClose={() => setHistory(null)} />
        </>
    );
}

function HoldingsTable({
    view,
    filter,
    onFilter,
    limit,
    onShowMore,
    onHistory,
}: {
    view: View;
    filter: Filter;
    onFilter: (filter: Filter) => void;
    limit: number;
    onShowMore: () => void;
    onHistory: (holding: FundHolding) => void;
}) {
    const filtered = filter === 'all' ? view.ordered : view.ordered.filter((h) => h.kind === filter);
    const visible = filtered.slice(0, limit);
    const columns = view.snapshotOnly ? 5 : 7;

    return (
        <section className="space-y-4">
            <SectionHeader
                id="fund-holdings-table"
                level={3}
                title={view.snapshotOnly ? 'All holdings' : 'All holdings and changes'}
                intro={
                    view.snapshotOnly
                        ? 'Every position in the filing, largest first. Choose a company to see which other funds own it.'
                        : 'New positions first, then sold-out positions, then the largest changes. Choose a company to see which other funds own it, or History to see this position over time.'
                }
            />
            {!view.snapshotOnly && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter holdings by change">
                    {FILTERS.filter((f) => f.id === 'all' || view.counts[f.id] > 0).map((f) => (
                        <Chip key={f.id} selected={filter === f.id} onClick={() => onFilter(f.id)} count={view.counts[f.id]}>
                            {f.label}
                        </Chip>
                    ))}
                </div>
            )}
            <Panel>
                <Table caption={`Holdings of ${view.fundName}`}>
                    <THead>
                        <tr>
                            <Th>Company</Th>
                            {!view.snapshotOnly && <Th>Change</Th>}
                            {!view.snapshotOnly && <Th numeric>Shares before</Th>}
                            <Th numeric>{view.snapshotOnly ? 'Shares' : 'Shares now'}</Th>
                            {!view.snapshotOnly && <Th numeric>Change in shares</Th>}
                            <Th numeric><Term id="estimatedValue">Value</Term></Th>
                            {view.snapshotOnly && <Th numeric>Of portfolio</Th>}
                            <Th><span className="sr-only">Position history</span></Th>
                        </tr>
                    </THead>
                    <tbody>
                        {visible.map((h) => (
                            <tr key={h.id} className={rowClass}>
                                <Td>
                                    {h.cusip ? (
                                        <Link
                                            href={`/?tab=whale&mode=owners&stock=${encodeURIComponent(h.cusip)}`}
                                            className="font-medium text-ink hover:text-accent hover:underline"
                                            title={`See which funds own ${h.issuer}`}
                                        >
                                            {h.issuer}
                                        </Link>
                                    ) : (
                                        <span className="font-medium text-ink">{h.issuer}</span>
                                    )}
                                    {h.cusip && <Identifier label="CUSIP" value={h.cusip} className="block text-xs" />}
                                </Td>
                                {!view.snapshotOnly && (
                                    <Td><ChangeBadge kind={h.kind} /></Td>
                                )}
                                {!view.snapshotOnly && <Td numeric>{formatShares(h.sharesPrev)}</Td>}
                                <Td numeric>{formatShares(h.sharesCurr)}</Td>
                                {!view.snapshotOnly && (
                                    <Td numeric className={signedClass(h.change)}>
                                        {h.change === 0 ? '—' : formatSignedNumber(h.change)}
                                        {h.pctChange !== null && <span className="block text-sm">{formatSignedPct(h.pctChange)}</span>}
                                    </Td>
                                )}
                                <Td numeric>{h.sharesCurr > 0 ? formatMoney(h.valueUsd) : <span className="text-ink-muted">—</span>}</Td>
                                {view.snapshotOnly && <Td numeric>{formatPct(view.share(h.valueUsd))}</Td>}
                                <Td className="text-right">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={<History className="h-4 w-4" aria-hidden />}
                                        aria-label={`Position history for ${h.issuer}`}
                                        onClick={() => onHistory(h)}
                                    >
                                        History
                                    </Button>
                                </Td>
                            </tr>
                        ))}
                        {visible.length === 0 && (
                            <TableEmpty colSpan={columns}>
                                No holdings match this filter. Choose All to see every position.
                            </TableEmpty>
                        )}
                    </tbody>
                </Table>
                <TableFooter shown={visible.length} total={filtered.length} noun="holdings" onShowMore={onShowMore} />
            </Panel>
        </section>
    );
}

function exportHoldings(data: FundHoldingsResponse, holdings: FundHolding[], share: (value: number) => number) {
    const fund = data.filerName || data.ticker;
    downloadCsv(
        holdings.map((h) => ({
            Company: h.issuer,
            CUSIP: h.cusip ?? '',
            Change: KIND_LABEL[h.kind],
            'Shares before': h.sharesPrev,
            'Shares now': h.sharesCurr,
            'Change in shares': h.change,
            'Change in shares (%)': h.pctChange === null ? '' : Number(h.pctChange.toFixed(2)),
            'Value (USD)': Math.round(h.valueUsd),
            'Share of portfolio (%)': Number(share(h.valueUsd).toFixed(2)),
        })),
        `${slugify(fund)}-holdings-${slugify(data.currentQuarter || data.filingDateCurr)}.csv`
    );
}
