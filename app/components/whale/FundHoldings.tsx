"use client";

import { useMemo, useState } from 'react';
import { Briefcase, Download, History } from 'lucide-react';
import { getSector } from '@/lib/sectors';
import { formatDate, formatMoney, formatNumber, formatPct, formatShares, formatSignedMoney, formatSignedNumber, formatSignedPct, plural } from '@/lib/format';
import {
    Button,
    ChangeBadge,
    Chip,
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
import { TickerSearch } from '../TickerSearch';
import { DivergingBars, RankedBars } from './charts';
import { PositionHistoryDialog, type HistoryTarget } from './PositionHistoryDialog';
import { ModeIntro, RequestError, ResultSkeleton, SearchForm, Updating, useRequest, useShowMore } from './shared';
import { downloadCsv, formatQuarter, postJson, quarterEndDate, slugify, toFundHoldings, type FundHolding, type FundHoldingsResponse } from './model';

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

// Names the store resolves by filer name; Berkshire also resolves through its ticker's CIK.
const EXAMPLES = [
    { id: 'berkshire', label: 'Berkshire Hathaway', query: 'Berkshire Hathaway' },
    { id: 'bridgewater', label: 'Bridgewater Associates', query: 'Bridgewater Associates' },
    { id: 'pershing', label: 'Pershing Square', query: 'Pershing Square' },
];

const loadFund = (query: string) => postJson<FundHoldingsResponse>('/api/whale-tracker', { ticker: query });

/** Story order: new positions, then sold-out positions, then the largest changes by estimated dollar size. */
const KIND_RANK: Record<ChangeKind, number> = { new: 0, exited: 1, added: 2, cut: 2, unchanged: 3 };

function buildView(data: FundHoldingsResponse) {
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

    return {
        snapshotOnly,
        holdings,
        held,
        totalValue,
        share,
        counts,
        topHoldings,
        sectors,
        biggestChanges,
        ordered,
        fundName,
        sentence,
        copyText: `${sentence} Source: SEC Form 13F filed ${formatDate(data.filingDateCurr)}.`,
    };
}

export function FundHoldings() {
    const [query, setQuery] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [state, run] = useRequest(loadFund);
    const [filter, setFilter] = useState<Filter>('all');
    const rows = useShowMore(25);
    const [history, setHistory] = useState<HistoryTarget | null>(null);

    const search = (value: string) => {
        const q = value.trim();
        if (!q) {
            setInputError('Enter a fund name, ticker or CIK.');
            return;
        }
        setInputError(null);
        setFilter('all');
        rows.reset();
        void run(q, q);
    };

    const data = state.result;
    const view = useMemo(() => (data ? buildView(data) : null), [data]);

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <SectionHeader
                    title="Fund holdings"
                    intro={<>See what a fund reported in its latest <Term id="form13f">13F filing</Term> and what changed from the quarter before.</>}
                />
                <SearchForm onSubmit={() => search(query)} loading={state.loading} submitLabel="Show holdings">
                    <TickerSearch
                        className="flex-1 sm:max-w-xl"
                        label="Fund"
                        value={query}
                        onChange={setQuery}
                        onSelect={search}
                        uppercase={false}
                        placeholder="e.g. Berkshire Hathaway"
                        hint="A fund name, its ticker or its CIK. Suggestions list only listed companies; for other funds, type the name and press Enter."
                        error={inputError}
                    />
                </SearchForm>
            </div>

            {state.error && (
                <RequestError
                    title={`Couldn’t load holdings for “${state.query}”`}
                    message={state.error}
                    advice="Check the spelling, try the fund’s full name as filed with the SEC, or search by its CIK number."
                    onRetry={state.query ? () => search(state.query!) : undefined}
                />
            )}

            {!data && state.loading && <ResultSkeleton label="Loading fund holdings" />}

            {!data && !state.loading && !state.error && (
                <ModeIntro
                    icon={<Briefcase className="h-5 w-5" aria-hidden />}
                    title="What does a fund own, and what did it change?"
                    examples={EXAMPLES.map((example) => ({
                        id: example.id,
                        label: example.label,
                        run: () => {
                            setQuery(example.query);
                            search(example.query);
                        },
                    }))}
                >
                    Search a fund to see its holdings at the end of the latest quarter, its biggest new positions and cuts, and how
                    any one holding changed over time.
                </ModeIntro>
            )}

            {data && view && (
                <>
                    <Takeaway
                        copyText={view.copyText}
                        asOf={quarterEndDate(data.currentQuarter) ?? data.filingDateCurr}
                        updating={state.loading}
                        note={
                            <span>
                                Filed {formatDate(data.filingDateCurr)}
                                {data.filingDatePrev && <> · compared with the filing of {formatDate(data.filingDatePrev)}</>}
                            </span>
                        }
                    >
                        {view.sentence}
                    </Takeaway>

                    <Updating updating={state.loading}>
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-lg font-semibold text-ink">{view.fundName}</p>
                                    {data.cik && <Identifier label="CIK" value={data.cik} />}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {/* Follow by CIK when we have it: a name can resolve to a different SEC entity. */}
                                    <FollowButton ticker={data.cik ? String(Number(data.cik)) : data.ticker} />
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
                                    intro={<>Share of the portfolio by <Term id="sectorGuess">estimated sector</Term>. Check before citing.</>}
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
                </>
            )}

            <PositionHistoryDialog target={history} onClose={() => setHistory(null)} />
        </div>
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
    view: ReturnType<typeof buildView>;
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
                        ? 'Every position in the filing, largest first.'
                        : 'New positions first, then sold-out positions, then the largest changes. Open History to see a holding over time.'
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
                                    <span className="font-medium text-ink">{h.issuer}</span>
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
