"use client";

import { useMemo, useState } from 'react';
import { Download, GitCompare, History } from 'lucide-react';
import { formatDate, formatMoney, formatNumber, formatShares, plural } from '@/lib/format';
import {
    Button,
    Identifier,
    Panel,
    RowToggle,
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
} from '../ui';
import { TickerSearch } from '../TickerSearch';
import { PairedBars } from './charts';
import { PositionHistoryDialog, type HistoryTarget } from './PositionHistoryDialog';
import { ModeIntro, RequestError, ResultSkeleton, SearchForm, Updating, useRequest, useShowMore } from './shared';
import {
    downloadCsv,
    formatQuarter,
    postJson,
    quarterEndDate,
    shortFundName,
    slugify,
    thousandsToDollars,
    type ClusterFund,
    type ClusterResponse,
} from './model';

const EXAMPLES = [
    { id: 'berkshire-pershing', a: 'Berkshire Hathaway', b: 'Pershing Square' },
    { id: 'bridgewater-renaissance', a: 'Bridgewater Associates', b: 'Renaissance Technologies' },
    { id: 'tiger-coatue', a: 'Tiger Global Management', b: 'Coatue Management' },
];

interface Pair {
    a: string;
    b: string;
}

const loadPair = (pair: Pair) => postJson<ClusterResponse>('/api/whale-cluster', { ticker1: pair.a, ticker2: pair.b });

interface SharedHolding {
    id: string;
    issuer: string;
    cusip: string;
    valueA: number;
    valueB: number;
    combined: number;
    sharesA: number;
    sharesB: number;
}

function fundLabel(fund: ClusterFund) {
    return fund.name || fund.ticker;
}

/** What /api/whale-history should look the fund up by: a typed CIK as-is, otherwise the fund's filed name, not the search text. */
function fundRef(fund: ClusterFund) {
    return /^\d{1,10}$/.test(fund.ticker.trim()) ? fund.ticker.trim() : fund.name || fund.ticker;
}

function buildView(data: ClusterResponse) {
    // /api/whale-cluster returns values in $ thousands.
    const holdings: SharedHolding[] = data.overlap.holdings.map((h) => ({
        id: h.cusip || h.issuer,
        issuer: h.issuer,
        cusip: h.cusip,
        valueA: thousandsToDollars(h.valueA),
        valueB: thousandsToDollars(h.valueB),
        combined: thousandsToDollars(h.combinedValue),
        sharesA: h.sharesA,
        sharesB: h.sharesB,
    }));
    const nameA = fundLabel(data.fundA);
    const nameB = fundLabel(data.fundB);
    // Short labels for headers and the legend; fall back to full names if the short forms would collide.
    const collide = shortFundName(nameA) === shortFundName(nameB);
    const shortA = collide ? nameA : shortFundName(nameA);
    const shortB = collide ? nameB : shortFundName(nameB);
    const count = data.overlap.count;
    const largest = holdings[0];

    const sentences = [
        count === 0
            ? `${nameA} and ${nameB} hold no stocks in common.`
            : `${nameA} and ${nameB} both hold ${plural(count, 'stock')}, out of ${formatNumber(data.fundA.totalHoldings)} and ${formatNumber(data.fundB.totalHoldings)} holdings respectively.`,
    ];
    if (largest) {
        sentences.push(
            `The largest shared holding is ${largest.issuer}: ${formatMoney(largest.valueA)} at ${shortA} and ${formatMoney(largest.valueB)} at ${shortB}.`
        );
    }
    const quarterA = formatQuarter(data.fundA.quarter);
    const quarterB = formatQuarter(data.fundB.quarter);
    if (quarterA && quarterB && quarterA !== quarterB) {
        sentences.push(`${shortA}’s figures are for ${quarterA} and ${shortB}’s for ${quarterB}.`);
    }
    const sentence = sentences.join(' ');
    const latestDate = [data.fundA.date, data.fundB.date].filter(Boolean).sort().pop() ?? null;
    const asOf = quarterA === quarterB ? quarterEndDate(data.fundA.quarter) : latestDate;

    return {
        holdings,
        nameA,
        nameB,
        shortA,
        shortB,
        count,
        sentence,
        asOf,
        copyText: `${sentence} Source: SEC Form 13F filings of ${formatDate(data.fundA.date)} and ${formatDate(data.fundB.date)}.`,
        chart: holdings.slice(0, 10).map((h) => ({
            id: h.id,
            label: h.issuer,
            a: h.valueA,
            b: h.valueB,
            aDisplay: formatMoney(h.valueA),
            bDisplay: formatMoney(h.valueB),
        })),
    };
}

export function CompareFunds() {
    const [fundA, setFundA] = useState('');
    const [fundB, setFundB] = useState('');
    const [errors, setErrors] = useState<{ a?: string; b?: string }>({});
    const [state, run] = useRequest(loadPair);
    const rows = useShowMore(25);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [history, setHistory] = useState<HistoryTarget | null>(null);

    const compare = (a: string, b: string) => {
        const next = { a: a.trim() ? undefined : 'Enter the first fund.', b: b.trim() ? undefined : 'Enter the second fund.' };
        setErrors(next);
        if (next.a || next.b) return;
        rows.reset();
        setExpanded(new Set());
        void run({ a: a.trim(), b: b.trim() }, `${a.trim()} and ${b.trim()}`);
    };

    const data = state.result;
    const view = useMemo(() => (data ? buildView(data) : null), [data]);

    const toggle = (id: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <SectionHeader
                    title="Compare funds"
                    intro="See which stocks two funds both hold, based on each fund’s latest 13F filing."
                />
                <SearchForm onSubmit={() => compare(fundA, fundB)} loading={state.loading} submitLabel="Compare">
                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                        <TickerSearch
                            label="First fund"
                            value={fundA}
                            onChange={setFundA}
                            uppercase={false}
                            placeholder="e.g. Berkshire Hathaway"
                            hint="Fund name, ticker or CIK"
                            error={errors.a}
                        />
                        <TickerSearch
                            label="Second fund"
                            value={fundB}
                            onChange={setFundB}
                            uppercase={false}
                            placeholder="e.g. Pershing Square"
                            hint="Fund name, ticker or CIK"
                            error={errors.b}
                        />
                    </div>
                </SearchForm>
            </div>

            {state.error && (
                <RequestError
                    title={`Couldn’t compare ${state.query}`}
                    message={state.error}
                    advice="Check both names, or use each fund’s full name as filed with the SEC or its CIK."
                    onRetry={() => compare(fundA, fundB)}
                />
            )}

            {!data && state.loading && <ResultSkeleton label="Comparing funds" />}

            {!data && !state.loading && !state.error && (
                <ModeIntro
                    icon={<GitCompare className="h-5 w-5" aria-hidden />}
                    title="Which stocks do two funds both own?"
                    examples={EXAMPLES.map((example) => ({
                        id: example.id,
                        label: `${example.a} and ${example.b}`,
                        run: () => {
                            setFundA(example.a);
                            setFundB(example.b);
                            compare(example.a, example.b);
                        },
                    }))}
                >
                    Enter two funds to see the stocks they have in common, how much each holds, and what each owns alone.
                </ModeIntro>
            )}

            {data && view && (
                <>
                    <Takeaway
                        copyText={view.copyText}
                        asOf={view.asOf}
                        updating={state.loading}
                        note={<span>Filed {formatDate(data.fundA.date)} and {formatDate(data.fundB.date)}</span>}
                    >
                        {view.sentence}
                    </Takeaway>

                    <Updating updating={state.loading}>
                        <StatStrip className="md:grid-cols-3">
                            <Stat label="Held by both" value={formatNumber(view.count)} note={`${view.count === 1 ? 'Stock' : 'Stocks'} in both portfolios`} />
                            <Stat
                                label={`Only in ${view.shortA}`}
                                value={formatNumber(data.fundA.uniqueCount)}
                                note={`of ${plural(data.fundA.totalHoldings, 'holding')}${data.fundA.quarter ? `, ${formatQuarter(data.fundA.quarter)}` : ''}`}
                            />
                            <Stat
                                label={`Only in ${view.shortB}`}
                                value={formatNumber(data.fundB.uniqueCount)}
                                note={`of ${plural(data.fundB.totalHoldings, 'holding')}${data.fundB.quarter ? `, ${formatQuarter(data.fundB.quarter)}` : ''}`}
                            />
                        </StatStrip>

                        {view.chart.length > 0 && (
                            <section className="space-y-4">
                                <SectionHeader
                                    level={3}
                                    title="Largest shared holdings"
                                    intro={<>How much each fund holds of the stocks they share, by reported <Term id="estimatedValue">value</Term>.</>}
                                />
                                <PairedBars items={view.chart} label="Largest shared holdings by value at each fund" aName={view.shortA} bName={view.shortB} />
                            </section>
                        )}

                        <section className="space-y-4">
                            <SectionHeader
                                level={3}
                                title="Held by both"
                                intro="Sorted by the two funds’ combined value. Open a row for share counts and each fund’s position history."
                                actions={
                                    view.holdings.length > 0 && (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            icon={<Download className="h-4 w-4" aria-hidden />}
                                            onClick={() =>
                                                downloadCsv(
                                                    view.holdings.map((h) => ({
                                                        Company: h.issuer,
                                                        CUSIP: h.cusip,
                                                        [`Shares at ${view.nameA}`]: h.sharesA,
                                                        [`Value at ${view.nameA} (USD)`]: Math.round(h.valueA),
                                                        [`Shares at ${view.nameB}`]: h.sharesB,
                                                        [`Value at ${view.nameB} (USD)`]: Math.round(h.valueB),
                                                        'Combined value (USD)': Math.round(h.combined),
                                                    })),
                                                    `${slugify(view.shortA)}-and-${slugify(view.shortB)}-shared-holdings.csv`
                                                )
                                            }
                                        >
                                            Download CSV
                                        </Button>
                                    )
                                }
                            />
                            <Panel>
                                <Table caption={`Stocks held by both ${view.nameA} and ${view.nameB}`}>
                                    <THead>
                                        <tr>
                                            <Th>Company</Th>
                                            <Th numeric>Value at {view.shortA}</Th>
                                            <Th numeric>Value at {view.shortB}</Th>
                                            <Th numeric>Combined</Th>
                                        </tr>
                                    </THead>
                                    <tbody>
                                        {view.holdings.slice(0, rows.limit).map((h, index) => {
                                            const open = expanded.has(h.id);
                                            const detailId = `compare-detail-${slugify(h.id)}`;
                                            return (
                                                <SharedRow
                                                    key={h.id}
                                                    holding={h}
                                                    open={open}
                                                    detailId={detailId}
                                                    largest={index === 0}
                                                    onToggle={() => toggle(h.id)}
                                                    nameA={view.nameA}
                                                    nameB={view.nameB}
                                                    shortA={view.shortA}
                                                    shortB={view.shortB}
                                                    onHistoryA={() =>
                                                        setHistory({ kind: 'fetch', fundRef: fundRef(data.fundA), fundName: view.nameA, issuer: h.issuer, cusip: h.cusip })
                                                    }
                                                    onHistoryB={() =>
                                                        setHistory({ kind: 'fetch', fundRef: fundRef(data.fundB), fundName: view.nameB, issuer: h.issuer, cusip: h.cusip })
                                                    }
                                                />
                                            );
                                        })}
                                        {view.holdings.length === 0 && (
                                            <TableEmpty colSpan={4}>
                                                These funds have no holdings in common. Try two funds with a similar style, such as two large value investors.
                                            </TableEmpty>
                                        )}
                                    </tbody>
                                </Table>
                                <TableFooter
                                    shown={Math.min(rows.limit, view.holdings.length)}
                                    total={view.holdings.length}
                                    noun="shared holdings"
                                    onShowMore={rows.showMore}
                                    note={view.count > view.holdings.length ? `the ${formatNumber(view.holdings.length)} largest of ${formatNumber(view.count)} are available` : undefined}
                                />
                            </Panel>
                        </section>
                    </Updating>
                </>
            )}

            <PositionHistoryDialog target={history} onClose={() => setHistory(null)} />
        </div>
    );
}

function SharedRow({
    holding: h,
    open,
    detailId,
    largest,
    onToggle,
    nameA,
    nameB,
    shortA,
    shortB,
    onHistoryA,
    onHistoryB,
}: {
    holding: SharedHolding;
    open: boolean;
    detailId: string;
    largest: boolean;
    onToggle: () => void;
    nameA: string;
    nameB: string;
    shortA: string;
    shortB: string;
    onHistoryA: () => void;
    onHistoryB: () => void;
}) {
    return (
        <>
            <tr className={rowClass}>
                <Td className={open ? 'border-b-0' : undefined}>
                    <RowToggle expanded={open} onToggle={onToggle} controls={detailId}>
                        {h.issuer}
                    </RowToggle>
                    {largest && <span className="mt-0.5 block pl-5 text-sm text-ink-muted">Largest shared holding</span>}
                </Td>
                <Td numeric className={open ? 'border-b-0' : undefined}>{formatMoney(h.valueA)}</Td>
                <Td numeric className={open ? 'border-b-0' : undefined}>{formatMoney(h.valueB)}</Td>
                <Td numeric className={open ? 'border-b-0 font-semibold' : 'font-semibold'}>{formatMoney(h.combined)}</Td>
            </tr>
            {open && (
                <tr id={detailId}>
                    <Td colSpan={4} className="bg-surface-2/50">
                        <dl className="grid gap-x-8 gap-y-3 text-base sm:grid-cols-2">
                            <div>
                                <dt className="text-sm text-ink-muted">Shares at {nameA}</dt>
                                <dd className="tabular text-ink">{formatShares(h.sharesA)}</dd>
                            </div>
                            <div>
                                <dt className="text-sm text-ink-muted">Shares at {nameB}</dt>
                                <dd className="tabular text-ink">{formatShares(h.sharesB)}</dd>
                            </div>
                        </dl>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {h.cusip && <Identifier label="CUSIP" value={h.cusip} className="mr-2" />}
                            <Button size="sm" variant="secondary" icon={<History className="h-4 w-4" aria-hidden />} onClick={onHistoryA}>
                                History at {shortA}
                            </Button>
                            <Button size="sm" variant="secondary" icon={<History className="h-4 w-4" aria-hidden />} onClick={onHistoryB}>
                                History at {shortB}
                            </Button>
                        </div>
                    </Td>
                </tr>
            )}
        </>
    );
}
