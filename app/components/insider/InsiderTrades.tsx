"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
// Types only: lib/form4 itself pulls in the server-side XML parser.
import type { InsiderSummary, InsiderTransaction } from '@/lib/form4';
import type { Citation } from '@/lib/citation';
import { formatDate, formatMoney, formatNumber, formatPct, formatShares, joinList, plural } from '@/lib/format';
import { ChangeBadge, CopyCitation, Notice, Panel, SectionHeader, Stat, StatStrip, Table, TableEmpty, TableFooter, Takeaway, Term, THead, Th, Td, buttonClass, rowClass } from '../ui';

export interface InsiderTradesResponse {
    cik: string;
    companyName: string;
    ticker: string | null;
    from: string;
    to: string;
    coveredFrom: string;
    filingsChecked: number;
    transactions: InsiderTransaction[];
    summary: InsiderSummary;
    warnings: string[];
}

function citationFor(t: InsiderTransaction): Citation {
    return { entity: `${t.ownerName} (${t.issuerName ?? 'issuer'})`, form: t.form, filingDate: t.filingDate, accession: t.accessionNumber, url: t.url };
}

/** The headline: open-market buying, selling (and how much was pre-planned), and any cluster of buyers. */
export function buildInsiderTakeaway(data: InsiderTradesResponse): string {
    const { summary } = data;
    const subject = data.ticker || data.companyName;
    const period = `in the past ${plural(summary.months, 'month')}`;
    const sentences: string[] = [];

    if (summary.buys.count > 0) {
        sentences.push(`${plural(summary.buys.insiders, 'insider')} bought ${formatMoney(summary.buys.value)} of ${subject} stock on the open market ${period}.`);
    } else {
        sentences.push(`No ${subject} insider bought shares on the open market ${period}.`);
    }
    if (summary.sells.count > 0) {
        const planned =
            summary.sells.plannedShareOfValue !== null && summary.sells.planned.count > 0
                ? `, ${formatPct(summary.sells.plannedShareOfValue * 100, 0)} of it under pre-arranged 10b5-1 plans`
                : '';
        sentences.push(`${plural(summary.sells.insiders, 'insider')} sold ${formatMoney(summary.sells.value)}${planned}.`);
    } else {
        sentences.push('None sold on the open market.');
    }
    if (summary.cluster) {
        const names = joinList(summary.cluster.insiders.map((insider) => insider.name), 3);
        sentences.push(
            `${plural(summary.cluster.insiderCount, 'insider')} bought within 30 days of each other, from ${formatDate(summary.cluster.from)} to ${formatDate(summary.cluster.to)}: ${names}.`
        );
    }
    return sentences.join(' ');
}

function TradeRow({ t, showKind }: { t: InsiderTransaction; showKind: boolean }) {
    return (
        <tr className={rowClass}>
            <Td className="tabular whitespace-nowrap">{t.transactionDate ? formatDate(t.transactionDate) : formatDate(t.filingDate)}</Td>
            <Td className="min-w-44">
                <span className="font-medium text-ink">{t.ownerName}</span>
                <span className="block text-sm text-ink-muted">{t.role}</span>
                {t.coOwners.length > 0 && <span className="block text-sm text-ink-muted">Filed jointly with {joinList(t.coOwners, 2)}</span>}
            </Td>
            <Td>
                {t.kind === 'buy' ? (
                    <ChangeBadge kind="added" label="Bought" />
                ) : t.kind === 'sell' ? (
                    <ChangeBadge kind="cut" label="Sold" />
                ) : showKind ? (
                    <span className="text-base text-ink">{t.kindLabel}</span>
                ) : null}
                {t.planLabel && <span className="mt-1 block text-sm text-ink-muted"><Term id="plan10b5">{t.planLabel}</Term></span>}
            </Td>
            <Td numeric>{t.shares === null ? '—' : formatShares(t.shares)}</Td>
            <Td numeric>{t.price === null || t.price === 0 ? <span className="text-ink-muted">—</span> : `$${t.price.toFixed(2)}`}</Td>
            <Td numeric>{t.value === null || t.value === 0 ? <span className="text-ink-muted">—</span> : formatMoney(t.value)}</Td>
            <Td numeric className="text-ink-muted">{t.sharesOwnedAfter === null ? '—' : formatShares(t.sharesOwnedAfter)}</Td>
            <Td className="text-right">
                <span className="inline-flex items-center gap-1">
                    {(t.documentUrl || t.url) && (
                        <a
                            href={t.documentUrl || t.url || undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-accent hover:underline"
                        >
                            Form {t.form}
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            <span className="sr-only">(opens on sec.gov in a new tab)</span>
                        </a>
                    )}
                    <CopyCitation citation={citationFor(t)} />
                </span>
            </Td>
        </tr>
    );
}

function TradeTable({ rows, caption, showKind, empty }: { rows: InsiderTransaction[]; caption: string; showKind: boolean; empty: string }) {
    return (
        <Table caption={caption}>
            <THead>
                <tr>
                    <Th>Date</Th>
                    <Th>Insider</Th>
                    <Th>Trade</Th>
                    <Th numeric>Shares</Th>
                    <Th numeric>Price</Th>
                    <Th numeric>Value</Th>
                    <Th numeric>Owned after</Th>
                    <Th><span className="sr-only">Filing</span></Th>
                </tr>
            </THead>
            <tbody>
                {rows.map((t) => <TradeRow key={t.id} t={t} showKind={showKind} />)}
                {rows.length === 0 && <TableEmpty colSpan={8}>{empty}</TableEmpty>}
            </tbody>
        </Table>
    );
}

/**
 * Insider trades (Form 4) for one company: takeaway, open-market buy/sell totals, the open-market trades, and the
 * other transactions (awards, option exercises, tax withholding) underneath. Used by Whale Tracker and the company page.
 */
export function InsiderTrades({ data, compact = false }: { data: InsiderTradesResponse; compact?: boolean }) {
    const [openLimit, setOpenLimit] = useState(compact ? 8 : 25);
    const [otherLimit, setOtherLimit] = useState(15);
    const [showOther, setShowOther] = useState(false);
    const sentence = useMemo(() => buildInsiderTakeaway(data), [data]);
    const openMarket = data.transactions.filter((t) => t.isOpenMarket);
    const other = data.transactions.filter((t) => !t.isOpenMarket);
    const latest = data.transactions[0];
    const sources: Citation[] = data.transactions
        .filter((t) => t.isOpenMarket)
        .slice(0, 3)
        .map(citationFor);
    const { summary } = data;
    const fullHref = `/?tab=whale&mode=insider&insider=${encodeURIComponent(data.ticker || String(Number(data.cik)))}`;

    return (
        <div className="space-y-6">
            {compact ? (
                <p className="font-serif text-lg text-ink">{sentence}</p>
            ) : (
                <Takeaway copyText={sentence} sources={sources} asOf={latest?.filingDate ?? data.to}>
                    {sentence}
                </Takeaway>
            )}

            {data.warnings.length > 0 && (
                <Notice tone="caution" title="Some filings may be missing">
                    <ul className="list-disc space-y-1 pl-5">
                        {data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                </Notice>
            )}

            <StatStrip>
                <Stat
                    label="Bought on the open market"
                    term="openMarketTrade"
                    value={formatMoney(summary.buys.value)}
                    tone={summary.buys.count > 0 ? 'gain' : undefined}
                    note={`${plural(summary.buys.count, 'trade')} by ${plural(summary.buys.insiders, 'insider')}`}
                />
                <Stat
                    label="Sold on the open market"
                    value={formatMoney(summary.sells.value)}
                    tone={summary.sells.count > 0 ? 'loss' : undefined}
                    note={`${plural(summary.sells.count, 'trade')} by ${plural(summary.sells.insiders, 'insider')}`}
                />
                <Stat
                    label="Sold under 10b5-1 plans"
                    term="plan10b5"
                    value={summary.sells.plannedShareOfValue === null ? '—' : formatPct(summary.sells.plannedShareOfValue * 100, 0)}
                    note="Share of the value sold"
                />
                <Stat label="Other transactions" value={formatNumber(summary.otherTransactions)} note="Awards, option exercises, tax" />
            </StatStrip>
            <p className="text-sm text-ink-muted">
                Totals cover {formatDate(summary.from)} to {formatDate(summary.to)}, from {plural(data.filingsChecked, 'Form 4 filing')}.
            </p>

            <section className="space-y-3">
                <SectionHeader
                    level={3}
                    title="Open-market trades"
                    intro="Purchases and sales insiders made on the market with their own money: the trades most worth a look."
                    actions={compact ? <Link href={fullHref} className={buttonClass('secondary', 'sm')}>See all insider trades</Link> : undefined}
                />
                <Panel>
                    <TradeTable
                        rows={openMarket.slice(0, openLimit)}
                        caption={`Open-market insider trades in ${data.companyName}`}
                        showKind={false}
                        empty="No insider bought or sold shares on the open market in these filings."
                    />
                    <TableFooter shown={Math.min(openLimit, openMarket.length)} total={openMarket.length} noun="trades" onShowMore={() => setOpenLimit((v) => v + 25)} />
                </Panel>
            </section>

            {!compact && other.length > 0 && (
                <section className="space-y-3">
                    <SectionHeader
                        level={3}
                        title="Other transactions"
                        intro="Stock awards, option exercises and shares withheld to pay tax. These are routine and rarely signal a view on the stock."
                        actions={
                            <button type="button" className={buttonClass('secondary', 'sm')} aria-expanded={showOther} onClick={() => setShowOther((v) => !v)}>
                                {showOther ? 'Hide' : `Show ${formatNumber(other.length)}`}
                            </button>
                        }
                    />
                    {showOther && (
                        <Panel>
                            <TradeTable rows={other.slice(0, otherLimit)} caption={`Other insider transactions in ${data.companyName}`} showKind empty="None." />
                            <TableFooter shown={Math.min(otherLimit, other.length)} total={other.length} noun="transactions" onShowMore={() => setOtherLimit((v) => v + 25)} />
                        </Panel>
                    )}
                </section>
            )}
        </div>
    );
}
