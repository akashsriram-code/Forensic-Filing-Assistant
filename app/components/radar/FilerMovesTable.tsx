"use client";

import { cn } from '@/lib/cn';
import { formatNumber, formatSignedMoney } from '@/lib/format';
import type { FilerMove } from '@/lib/thirteen-f-radar-core';
import { ChangeBadge, Identifier, Panel, SectionHeader, Table, TableEmpty, TableFooter, THead, Th, Td, Term, changeKindFromAction, rowClass, signedClass } from '../ui';
import { actionWord } from './radar-format';
import { useShowMore } from './radar-hooks';

const CONTRIBUTORS_SHOWN = 3;

/** The funds whose holdings in a category changed the most in dollar terms. */
export function FilerMovesTable({ moves }: { moves: FilerMove[] }) {
    const { limit, showMore, showLess } = useShowMore(15, 25);

    return (
        <section aria-labelledby="radar-fund-moves" className="space-y-4">
            <SectionHeader
                id="radar-fund-moves"
                title="Biggest fund moves"
                intro="The funds whose holdings in a category changed the most in dollar value between the two quarters."
            />
            <Panel>
                <Table caption="Biggest fund moves">
                    <THead>
                        <tr>
                            <Th>Fund</Th>
                            <Th>Category</Th>
                            <Th>Change</Th>
                            <Th numeric>
                                <Term id="estimatedValue">Change in value</Term>
                            </Th>
                            <Th numeric>New positions</Th>
                            <Th numeric>Sold out</Th>
                            <Th>Biggest contributors</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {moves.length === 0 && (
                            <TableEmpty colSpan={7}>No fund changed its holdings in the selected categories. Try adding more categories above.</TableEmpty>
                        )}
                        {moves.slice(0, limit).map((move) => {
                            const contributors = move.details.slice(0, CONTRIBUTORS_SHOWN);
                            const more = move.details.length - contributors.length;
                            return (
                                <tr key={`${move.cik}-${move.categoryKey}-${move.action}`} className={rowClass}>
                                    <Td>
                                        <div className="font-medium text-ink">{move.fundName}</div>
                                        <Identifier label="CIK" value={move.cik} />
                                    </Td>
                                    <Td className="text-ink-muted">{move.categoryLabel}</Td>
                                    <Td>
                                        <ChangeBadge kind={changeKindFromAction(move.action)} />
                                    </Td>
                                    <Td numeric className={cn('font-semibold', signedClass(move.valueDelta))}>{formatSignedMoney(move.valueDelta)}</Td>
                                    <Td numeric>{formatNumber(move.initiatedCount)}</Td>
                                    <Td numeric>{formatNumber(move.liquidatedCount)}</Td>
                                    <Td className="min-w-48 max-w-sm text-sm text-ink-muted">
                                        {contributors.length === 0
                                            ? 'None listed'
                                            : contributors.map((detail) => `${detail.label} (${actionWord(detail.action)})`).join(', ')}
                                        {more > 0 && `, and ${formatNumber(more)} more`}
                                    </Td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
                <TableFooter shown={Math.min(limit, moves.length)} total={moves.length} noun="moves" onShowMore={showMore} onShowLess={showLess} />
            </Panel>
        </section>
    );
}
