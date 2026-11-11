"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { formatDate, formatMoney, formatNumber, formatShares, formatSignedNumber, formatSignedPct, plural } from '@/lib/format';
import {
    Button,
    ChangeBadge,
    Chip,
    CopyCitation,
    Identifier,
    Panel,
    SectionHeader,
    Select,
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
    buttonClass,
    rowClass,
    signedClass,
    type ChangeKind,
} from '../ui';
import { RankedBars, Sparkline } from './charts';
import { PositionHistoryDialog, type HistoryTarget } from './PositionHistoryDialog';
import { Updating, useShowMore } from './shared';
import { downloadCsv, formatQuarter, historyPointFromReverse, quarterEndDate, reverseKind, slugify, type ReverseFund, type ReverseResponse } from './model';

type Kind = ChangeKind | 'no_prior';
type Filter = 'all' | Kind;
type Sort = 'value' | 'change' | 'date';

const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'new', label: 'New' },
    { id: 'added', label: 'Added' },
    { id: 'cut', label: 'Cut' },
    { id: 'exited', label: 'Sold out' },
    { id: 'unchanged', label: 'No change' },
    { id: 'no_prior', label: 'No earlier filing' },
];

const KIND_LABEL: Record<Kind, string> = {
    new: 'New',
    added: 'Added',
    cut: 'Cut',
    exited: 'Sold out',
    unchanged: 'No change',
    no_prior: 'No earlier filing',
};

function KindBadge({ kind }: { kind: Kind }) {
    if (kind === 'no_prior') return <ChangeBadge kind="unchanged" label="No earlier filing" />;
    return <ChangeBadge kind={kind} />;
}

type FundRow = ReverseFund & { kind: Kind };

export function buildOwnersView(data: ReverseResponse, ticker: string) {
    // /api/whale-reverse-lookup returns values in dollars (store values passed through).
    const funds: FundRow[] = data.funds.map((fund) => ({ ...fund, kind: reverseKind(fund.action) as Kind }));
    const counts: Record<Filter, number> = { all: funds.length, new: 0, added: 0, cut: 0, exited: 0, unchanged: 0, no_prior: 0 };
    for (const fund of funds) counts[fund.kind] += 1;

    const holders = funds.filter((fund) => fund.currentShares > 0);
    const valueHeld = holders.reduce((sum, fund) => sum + (fund.currentValue || 0), 0);
    const added = counts.new + counts.added;
    const cut = counts.cut + counts.exited;

    const name = data.companyName && data.companyName.toUpperCase() !== ticker ? `${ticker} (${data.companyName})` : ticker;
    const sentences = [`${plural(holders.length, 'fund')} reported holding ${name} at the end of their latest quarter.`];
    if (funds.length > 0) {
        const soldOut = counts.exited > 0 ? `, including ${formatNumber(counts.exited)} that sold out` : '';
        sentences.push(`${formatNumber(added)} bought or added shares and ${formatNumber(cut)} cut${soldOut}.`);
    }
    const sentence = sentences.join(' ');

    const topHolders = [...holders]
        .sort((a, b) => b.currentValue - a.currentValue)
        .slice(0, 10)
        .map((fund) => ({ id: fund.cik, label: fund.fundName, value: fund.currentValue, display: formatMoney(fund.currentValue) }));

    return {
        funds,
        counts,
        holders,
        valueHeld,
        added,
        cut,
        sentence,
        topHolders,
        copyText: `${sentence} Source: SEC Form 13F filings${data.currentQuarter ? ` for ${formatQuarter(data.currentQuarter)}` : ''}.`,
    };
}

function sortFunds(funds: FundRow[], sort: Sort): FundRow[] {
    const copy = [...funds];
    if (sort === 'value') return copy.sort((a, b) => b.currentValue - a.currentValue || a.fundName.localeCompare(b.fundName));
    if (sort === 'change') return copy.sort((a, b) => Math.abs(b.shareDelta) - Math.abs(a.shareDelta) || a.fundName.localeCompare(b.fundName));
    return copy.sort((a, b) => b.currentFilingDate.localeCompare(a.currentFilingDate) || a.fundName.localeCompare(b.fundName));
}

/**
 * Which funds hold a stock: takeaway, stats, largest holders and the full fund table. Used by Whale Tracker's
 * "Who owns a stock" mode and by the company page (compact: fewer rows, a link to the full view).
 */
export function OwnersView({
    data,
    symbol,
    updating = false,
    compact = false,
}: {
    data: ReverseResponse;
    /** Ticker or CUSIP the user looked up. */
    symbol: string;
    updating?: boolean;
    compact?: boolean;
}) {
    return <OwnersBody key={`${symbol}-${data.currentQuarter}`} data={data} symbol={symbol.toUpperCase()} updating={updating} compact={compact} />;
}

function OwnersBody({ data, symbol, updating, compact }: { data: ReverseResponse; symbol: string; updating: boolean; compact: boolean }) {
    const view = useMemo(() => buildOwnersView(data, symbol), [data, symbol]);
    const [filter, setFilter] = useState<Filter>('all');
    const [sort, setSort] = useState<Sort>('value');
    const rows = useShowMore(compact ? 10 : 25);
    const [history, setHistory] = useState<HistoryTarget | null>(null);

    const visibleAll = useMemo(() => {
        const filtered = filter === 'all' ? view.funds : view.funds.filter((fund) => fund.kind === filter);
        return sortFunds(filtered, sort);
    }, [view, filter, sort]);
    const visible = visibleAll.slice(0, rows.limit);
    const fullViewHref = `/?tab=whale&mode=owners&stock=${encodeURIComponent(symbol)}`;

    return (
        <>
            {!compact && (
                <Takeaway
                    copyText={view.copyText}
                    asOf={quarterEndDate(data.currentQuarter)}
                    updating={updating}
                    note={<span>Each fund is compared on its own two latest filings</span>}
                >
                    {view.sentence}
                </Takeaway>
            )}

            <Updating updating={updating}>
                {compact && <p className="font-serif text-lg text-ink">{view.sentence}</p>}
                <StatStrip>
                    <Stat label="Funds holding now" value={formatNumber(view.holders.length)} />
                    <Stat label="Bought or added" value={formatNumber(view.added)} tone={view.added > 0 ? 'gain' : undefined} note="Including new positions" />
                    <Stat label="Cut or sold out" value={formatNumber(view.cut)} tone={view.cut > 0 ? 'loss' : undefined} note="Including sold-out positions" />
                    <Stat label="Value held" term="estimatedValue" value={formatMoney(view.valueHeld)} note="By the funds listed here" />
                </StatStrip>

                {!compact && view.topHolders.length > 1 && (
                    <section className="space-y-4">
                        <SectionHeader level={3} title="Largest holders" intro={`The ten funds with the most ${symbol} by reported value.`} />
                        <RankedBars items={view.topHolders} label={`Largest holders of ${symbol}`} />
                    </section>
                )}

                <section className="space-y-4">
                    <SectionHeader
                        level={3}
                        title={compact ? 'Largest holders' : 'All funds'}
                        intro={
                            compact
                                ? 'Funds with the largest positions. Choose a fund to see everything it holds.'
                                : 'Every fund with the stock in either of its two latest filings. Choose a fund to see everything it holds, or History to see its position over time.'
                        }
                        actions={
                            compact ? (
                                <Link href={fullViewHref} className={buttonClass('secondary', 'sm')}>
                                    See all {formatNumber(view.funds.length)} funds
                                </Link>
                            ) : (
                                view.funds.length > 0 && (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={<Download className="h-4 w-4" aria-hidden />}
                                        onClick={() =>
                                            downloadCsv(
                                                visibleAll.map((fund) => ({
                                                    Fund: fund.fundName,
                                                    CIK: fund.cik,
                                                    Change: KIND_LABEL[fund.kind],
                                                    'Shares now': fund.currentShares,
                                                    'Shares before': fund.previousShares,
                                                    'Change in shares': fund.shareDelta,
                                                    'Change in shares (%)': fund.percentChange === null ? '' : Number(fund.percentChange.toFixed(2)),
                                                    'Value (USD)': Math.round(fund.currentValue),
                                                    Filed: fund.currentFilingDate,
                                                    Quarter: formatQuarter(fund.currentQuarter),
                                                    'Accession number': fund.currentAccession ?? '',
                                                })),
                                                `${slugify(symbol)}-holders-${slugify(data.currentQuarter || 'latest')}.csv`
                                            )
                                        }
                                    >
                                        Download CSV
                                    </Button>
                                )
                            )
                        }
                    />
                    {!compact && (
                        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter funds by change">
                                {FILTERS.filter((f) => f.id === 'all' || view.counts[f.id] > 0).map((f) => (
                                    <Chip
                                        key={f.id}
                                        selected={filter === f.id}
                                        onClick={() => {
                                            setFilter(f.id);
                                            rows.reset();
                                        }}
                                        count={view.counts[f.id]}
                                    >
                                        {f.label}
                                    </Chip>
                                ))}
                            </div>
                            <Select
                                label="Sort by"
                                className="w-full md:w-56"
                                value={sort}
                                onChange={(event) => {
                                    setSort(event.target.value as Sort);
                                    rows.reset();
                                }}
                            >
                                <option value="value">Largest position</option>
                                <option value="change">Biggest change in shares</option>
                                <option value="date">Latest filing</option>
                            </Select>
                        </div>
                    )}
                    <Panel>
                        <Table caption={`Funds holding ${symbol}`}>
                            <THead>
                                <tr>
                                    <Th>Fund</Th>
                                    <Th>Change</Th>
                                    <Th numeric>Shares now</Th>
                                    <Th numeric>Change in shares</Th>
                                    <Th numeric><Term id="estimatedValue">Value</Term></Th>
                                    <Th>Filed</Th>
                                    <Th><span className="sr-only">Actions</span></Th>
                                </tr>
                            </THead>
                            <tbody>
                                {visible.map((fund) => (
                                    <tr key={fund.cik} className={rowClass}>
                                        <Td>
                                            <Link href={`/fund/${Number(fund.cik) || fund.cik}`} className="font-medium text-ink hover:text-accent hover:underline">
                                                {fund.fundName}
                                            </Link>
                                            <Identifier label="CIK" value={fund.cik} className="block text-xs" />
                                        </Td>
                                        <Td><KindBadge kind={fund.kind} /></Td>
                                        <Td numeric>{formatShares(fund.currentShares)}</Td>
                                        <Td numeric className={signedClass(fund.shareDelta)}>
                                            {fund.shareDelta === 0 ? '—' : formatSignedNumber(fund.shareDelta)}
                                            {(fund.kind === 'added' || fund.kind === 'cut') && fund.percentChange !== null && (
                                                <span className="block text-sm">{formatSignedPct(fund.percentChange)}</span>
                                            )}
                                        </Td>
                                        <Td numeric>{fund.currentShares > 0 ? formatMoney(fund.currentValue) : <span className="text-ink-muted">—</span>}</Td>
                                        <Td>
                                            <span className="whitespace-nowrap">{formatDate(fund.currentFilingDate)}</span>
                                            <span className="block text-sm text-ink-muted">{formatQuarter(fund.currentQuarter)}</span>
                                        </Td>
                                        <Td className="text-right">
                                            <span className="inline-flex items-center gap-1">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    aria-label={`Position history for ${fund.fundName}`}
                                                    onClick={() =>
                                                        setHistory({
                                                            kind: 'points',
                                                            fundName: fund.fundName,
                                                            issuer: data.companyName || symbol,
                                                            points: fund.history.map(historyPointFromReverse),
                                                        })
                                                    }
                                                >
                                                    <Sparkline values={fund.history.map((point) => point.shares)} />
                                                    History
                                                </Button>
                                                {fund.currentAccession && (
                                                    <CopyCitation
                                                        citation={{
                                                            entity: fund.fundName,
                                                            form: '13F-HR',
                                                            filingDate: fund.currentFilingDate,
                                                            accession: fund.currentAccession,
                                                            cik: fund.cik,
                                                        }}
                                                    />
                                                )}
                                            </span>
                                        </Td>
                                    </tr>
                                ))}
                                {visible.length === 0 && (
                                    <TableEmpty colSpan={7}>
                                        {filter === 'all'
                                            ? 'No funds reported this stock in their two latest filings.'
                                            : `No funds in the “${KIND_LABEL[filter as Kind]}” group. Choose All to see every fund.`}
                                    </TableEmpty>
                                )}
                            </tbody>
                        </Table>
                        {!compact && (
                            <TableFooter
                                shown={visible.length}
                                total={visibleAll.length}
                                noun="funds"
                                onShowMore={rows.showMore}
                                note={
                                    data.returnedCount !== undefined && data.returnedCount < data.matchCount
                                        ? `${formatNumber(data.matchCount)} funds matched; the service returned ${formatNumber(data.returnedCount)}`
                                        : undefined
                                }
                            />
                        )}
                    </Panel>
                </section>
            </Updating>

            <PositionHistoryDialog target={history} onClose={() => setHistory(null)} />
        </>
    );
}
