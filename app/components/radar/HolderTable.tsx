"use client";

import { Fragment, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney, formatNumber, formatShares } from '@/lib/format';
import type { FilerMove } from '@/lib/thirteen-f-radar-core';
import { ChangeBadge, Identifier, RowToggle, Table, TableEmpty, TableFooter, THead, Th, Td, Term, changeKindFromAction, rowClass, signedClass } from '../ui';
import { actionOrder, formatShareChange, sharePctChange } from './radar-format';
import { useShowMore } from './radar-hooks';

export interface EnrichedFilerMove extends FilerMove {
    filerType: string;
    /** Null for a new position (no shares last quarter). */
    sharePctChange: number | null;
}

/** Every holder in a category, with each fund's individual stocks one click away. */
export function HolderTable({ moves }: { moves: EnrichedFilerMove[] }) {
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const { limit, showMore, showLess } = useShowMore(25, 50);

    const toggle = (cik: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(cik)) next.delete(cik);
            else next.add(cik);
            return next;
        });

    return (
        <div>
            <div className="px-4 pb-3 sm:px-5">
                <h4 className="text-lg font-semibold text-ink">All holders</h4>
                <p className="mt-1 text-base text-ink-muted">
                    New positions first, then sold out, added, cut and unchanged. Open a fund to see the individual stocks it holds.
                </p>
            </div>
            <Table caption="All holders and their changes">
                <THead>
                    <tr>
                        <Th>Fund or stock</Th>
                        <Th>
                            <Term id="filerType">Fund type</Term>
                        </Th>
                        <Th>Change</Th>
                        <Th numeric>Shares</Th>
                        <Th numeric>Last quarter</Th>
                        <Th numeric>Change in shares</Th>
                        <Th numeric>
                            <Term id="estimatedValue">Value</Term>
                        </Th>
                    </tr>
                </THead>
                <tbody>
                    {moves.length === 0 && <TableEmpty colSpan={7}>No fund reported holding these stocks in either quarter.</TableEmpty>}
                    {moves.slice(0, limit).map((move) => {
                        const isOpen = expanded.has(move.cik);
                        const hasDetails = move.details.length > 0;
                        const detailsId = `holder-${move.cik}-${move.categoryKey}-stocks`;
                        const details = [...move.details].sort(
                            (a, b) => actionOrder(a.action) - actionOrder(b.action) || b.currentShares - a.currentShares
                        );
                        return (
                            <Fragment key={`${move.cik}-${move.categoryKey}`}>
                                <tr className={cn(rowClass, isOpen && 'bg-surface-2/60')}>
                                    <Td>
                                        {hasDetails ? (
                                            <RowToggle expanded={isOpen} onToggle={() => toggle(move.cik)} controls={isOpen ? detailsId : undefined}>
                                                {move.fundName}
                                            </RowToggle>
                                        ) : (
                                            <div className="font-medium text-ink">{move.fundName}</div>
                                        )}
                                        <div className={cn('flex flex-wrap gap-x-3', hasDetails && 'pl-[22px]')}>
                                            <Identifier label="CIK" value={move.cik} />
                                            {hasDetails && <span className="text-sm text-ink-muted">{formatNumber(move.details.length)} {move.details.length === 1 ? 'stock' : 'stocks'}</span>}
                                        </div>
                                    </Td>
                                    <Td className="text-ink-muted">{move.filerType}</Td>
                                    <Td>
                                        <ChangeBadge kind={changeKindFromAction(move.action)} />
                                    </Td>
                                    <Td numeric className="font-semibold text-ink">{formatShares(move.currentShares)}</Td>
                                    <Td numeric className="text-ink-muted">{formatShares(move.previousShares)}</Td>
                                    <Td numeric className={signedClass(move.sharePctChange ?? 0)}>{formatShareChange(move.sharePctChange)}</Td>
                                    <Td numeric>{formatMoney(move.currentValue)}</Td>
                                </tr>
                                {isOpen &&
                                    details.map((detail, idx) => {
                                        const pct = sharePctChange(detail.previousShares, detail.currentShares);
                                        return (
                                            <tr key={`${move.cik}-${detail.itemKey}-${idx}`} id={idx === 0 ? detailsId : undefined} className="bg-surface-2/40">
                                                <Td className="pl-10">
                                                    <div className="text-ink">{detail.label}</div>
                                                    <div className="flex flex-wrap gap-x-3">
                                                        {detail.ticker && <span className="text-sm text-ink-muted">{detail.ticker}</span>}
                                                        {detail.cusips[0] && <Identifier label="CUSIP" value={detail.cusips[0]} />}
                                                    </div>
                                                </Td>
                                                <Td />
                                                <Td>
                                                    <ChangeBadge kind={changeKindFromAction(detail.action)} />
                                                </Td>
                                                <Td numeric>{formatShares(detail.currentShares)}</Td>
                                                <Td numeric className="text-ink-muted">{formatShares(detail.previousShares)}</Td>
                                                <Td numeric className={signedClass(pct ?? 0)}>{formatShareChange(pct)}</Td>
                                                <Td numeric>{formatMoney(detail.currentValue)}</Td>
                                            </tr>
                                        );
                                    })}
                            </Fragment>
                        );
                    })}
                </tbody>
            </Table>
            <TableFooter
                shown={Math.min(limit, moves.length)}
                total={moves.length}
                noun="funds"
                onShowMore={showMore}
                onShowLess={showLess}
                note={moves.length > limit ? 'Download the CSV for the complete list' : undefined}
            />
        </div>
    );
}
