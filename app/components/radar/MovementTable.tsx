"use client";

import { formatNumber, joinList } from '@/lib/format';
import type { SecurityMovement } from '@/lib/thirteen-f-radar-core';
import { Identifier, Panel, SectionHeader, Table, TableEmpty, TableFooter, THead, Th, Td, Term, rowClass } from '../ui';
import { useShowMore } from './radar-hooks';

const COPY = {
    initiated: {
        id: 'radar-new-positions',
        title: 'New positions',
        intro: (
            <>
                Stocks that funds held none of last quarter and own now, ranked by how many funds started a{' '}
                <Term id="newPosition">new position</Term>.
            </>
        ),
        countHeader: 'Funds starting a position',
        empty: 'No fund started a new position in the selected categories. Try adding more categories above.',
        caption: 'Stocks with the most new positions',
    },
    liquidated: {
        id: 'radar-sold-out',
        title: 'Sold-out positions',
        intro: (
            <>
                Stocks that funds owned last quarter and have now <Term id="soldOut">sold out</Term> of completely, ranked by how many funds left.
            </>
        ),
        countHeader: 'Funds that sold out',
        empty: 'No fund sold out of a stock in the selected categories. Try adding more categories above.',
        caption: 'Stocks with the most sold-out positions',
    },
} as const;

/** New positions or sold-out positions by stock. */
export function MovementTable({ kind, movements }: { kind: 'initiated' | 'liquidated'; movements: SecurityMovement[] }) {
    const copy = COPY[kind];
    const { limit, showMore, showLess } = useShowMore(10, 20);
    const countOf = (movement: SecurityMovement) => (kind === 'initiated' ? movement.initiatedFilers : movement.liquidatedFilers);
    const samplesOf = (movement: SecurityMovement) => (kind === 'initiated' ? movement.sampleInitiators : movement.sampleLiquidators);

    return (
        <section aria-labelledby={copy.id} className="space-y-4">
            <SectionHeader id={copy.id} title={copy.title} intro={copy.intro} />
            <Panel>
                <Table caption={copy.caption}>
                    <THead>
                        <tr>
                            <Th>Stock</Th>
                            <Th>Category</Th>
                            <Th numeric>{copy.countHeader}</Th>
                            <Th>Examples</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {movements.length === 0 && <TableEmpty colSpan={4}>{copy.empty}</TableEmpty>}
                        {movements.slice(0, limit).map((movement) => {
                            const samples = samplesOf(movement);
                            return (
                                <tr key={`${movement.categoryKey}-${movement.cusip || movement.issuer}`} className={rowClass}>
                                    <Td>
                                        <div className="font-medium text-ink">{movement.issuer}</div>
                                        {movement.cusip ? <Identifier label="CUSIP" value={movement.cusip} /> : <span className="text-sm text-ink-muted">No CUSIP</span>}
                                    </Td>
                                    <Td className="text-ink-muted">{movement.categoryLabel}</Td>
                                    <Td numeric className="font-semibold text-ink">{formatNumber(countOf(movement))}</Td>
                                    <Td className="min-w-48 max-w-md text-sm text-ink-muted">{samples.length > 0 ? joinList(samples, samples.length) : 'None listed'}</Td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
                <TableFooter shown={Math.min(limit, movements.length)} total={movements.length} noun="stocks" onShowMore={showMore} onShowLess={showLess} />
            </Panel>
        </section>
    );
}
