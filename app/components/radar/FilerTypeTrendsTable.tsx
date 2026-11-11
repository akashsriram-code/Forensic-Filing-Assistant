"use client";

import { cn } from '@/lib/cn';
import { formatNumber, formatSignedNumber } from '@/lib/format';
import type { FilerTypeSummary } from '@/lib/thirteen-f-radar-core';
import { Panel, SectionHeader, Table, TableEmpty, TableFooter, THead, Th, Td, Term, rowClass, signedClass } from '../ui';
import { useShowMore } from './radar-hooks';

/** Buying and selling by kind of fund (hedge fund, pension, bank and so on) for each category. */
export function FilerTypeTrendsTable({ summaries }: { summaries: FilerTypeSummary[] }) {
    const { limit, showMore, showLess } = useShowMore(15, 30);

    return (
        <section aria-labelledby="radar-fund-types" className="space-y-4">
            <SectionHeader
                id="radar-fund-types"
                title="Fund types"
                intro={
                    <>
                        Buying and selling by kind of fund in each category. The <Term id="filerType">fund type</Term> is a rough guess from the
                        fund’s name, so use it as a lead, not a fact.
                    </>
                }
            />
            <Panel>
                <Table caption="Buying and selling by fund type">
                    <THead>
                        <tr>
                            <Th>Fund type</Th>
                            <Th>Category</Th>
                            <Th numeric>
                                <Term id="exposedFilers">Funds holding</Term>
                            </Th>
                            <Th numeric>Buyers</Th>
                            <Th numeric>Sellers</Th>
                            <Th numeric>
                                <Term id="netBuyers">Net buyers</Term>
                            </Th>
                            <Th numeric>New positions</Th>
                            <Th numeric>Sold out</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {summaries.length === 0 && (
                            <TableEmpty colSpan={8}>No fund-type trends for the selected categories. Try adding more categories above.</TableEmpty>
                        )}
                        {summaries.slice(0, limit).map((summary) => (
                            <tr key={`${summary.filerType}-${summary.categoryKey}`} className={rowClass}>
                                <Td className="font-medium text-ink">{summary.filerType}</Td>
                                <Td className="text-ink-muted">{summary.categoryLabel}</Td>
                                <Td numeric>{formatNumber(summary.exposedFilers)}</Td>
                                <Td numeric>{formatNumber(summary.buyers)}</Td>
                                <Td numeric>{formatNumber(summary.sellers)}</Td>
                                <Td numeric className={cn('font-semibold', signedClass(summary.netBuyers))}>{formatSignedNumber(summary.netBuyers)}</Td>
                                <Td numeric>{formatNumber(summary.initiatedFilers)}</Td>
                                <Td numeric>{formatNumber(summary.liquidatedFilers)}</Td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
                <TableFooter shown={Math.min(limit, summaries.length)} total={summaries.length} noun="rows" onShowMore={showMore} onShowLess={showLess} />
            </Panel>
        </section>
    );
}
