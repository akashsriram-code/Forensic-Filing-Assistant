"use client";

import { cn } from '@/lib/cn';
import { formatSignedMoney } from '@/lib/format';
import type { PrivateCreditInstitutionSummary } from '@/lib/thirteen-f-radar-core';
import { ChangeBadge, Identifier, Panel, SectionHeader, Table, TableEmpty, TableFooter, THead, Th, Td, Term, changeKindFromAction, rowClass, signedClass } from '../ui';
import { useShowMore } from './radar-hooks';

/** Pensions, public funds and endowments that hold private-credit vehicles (mostly BDCs). */
export function PrivateCreditTable({ summaries }: { summaries: PrivateCreditInstitutionSummary[] }) {
    const { limit, showMore, showLess } = useShowMore(15, 30);

    return (
        <section aria-labelledby="radar-private-credit" className="space-y-4">
            <SectionHeader
                id="radar-private-credit"
                title="Private credit"
                intro={
                    <>
                        Pensions, public funds and endowments that hold <Term id="privateCredit">private-credit</Term> vehicles, such as business
                        development companies, and how their holdings changed.
                    </>
                }
            />
            <Panel>
                <Table caption="Pensions, public funds and endowments with private-credit holdings">
                    <THead>
                        <tr>
                            <Th>Fund</Th>
                            <Th>Fund type</Th>
                            <Th>Change</Th>
                            <Th numeric>
                                <Term id="estimatedValue">Change in value</Term>
                            </Th>
                            <Th>Holds now</Th>
                            <Th>New and sold out</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {summaries.length === 0 && (
                            <TableEmpty colSpan={6}>
                                No pension, public fund or endowment holds private credit in this comparison. Try another pair of quarters.
                            </TableEmpty>
                        )}
                        {summaries.slice(0, limit).map((summary) => (
                            <tr key={`${summary.cik}-${summary.action}-${summary.currentItems.join('|')}`} className={rowClass}>
                                <Td>
                                    <div className="font-medium text-ink">{summary.fundName}</div>
                                    <Identifier label="CIK" value={summary.cik} />
                                </Td>
                                <Td className="text-ink-muted">{summary.filerType}</Td>
                                <Td>
                                    <ChangeBadge kind={changeKindFromAction(summary.action)} />
                                </Td>
                                <Td numeric className={cn('font-semibold', signedClass(summary.valueDelta))}>{formatSignedMoney(summary.valueDelta)}</Td>
                                <Td className="min-w-40 max-w-xs text-sm text-ink-muted">{summary.currentItems.join(', ') || 'None'}</Td>
                                <Td className="min-w-40 max-w-xs text-sm text-ink-muted">
                                    {summary.initiatedItems.length === 0 && summary.liquidatedItems.length === 0 ? (
                                        'None'
                                    ) : (
                                        <div className="space-y-1">
                                            {summary.initiatedItems.length > 0 && (
                                                <div>
                                                    <span className="font-medium text-gain">New:</span> {summary.initiatedItems.join(', ')}
                                                </div>
                                            )}
                                            {summary.liquidatedItems.length > 0 && (
                                                <div>
                                                    <span className="font-medium text-loss">Sold out:</span> {summary.liquidatedItems.join(', ')}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </Td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
                <TableFooter shown={Math.min(limit, summaries.length)} total={summaries.length} noun="funds" onShowMore={showMore} onShowLess={showLess} />
            </Panel>
        </section>
    );
}
