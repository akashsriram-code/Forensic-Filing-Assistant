"use client";

import { Fragment, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Citation } from '@/lib/citation';
import { formatDate, plural } from '@/lib/format';
import { CopyCitation, FormMark, Identifier, Notice, Panel, RowToggle, SectionHeader, Table, TableEmpty, TableFooter, Takeaway, THead, Th, Td, rowClass } from '../ui';
import { Updating, useShowMore } from './shared';
import { activistFormLabel, readActivistField, slugify, type ActivistFiling, type ActivistResponse } from './model';

export type ActivistData = ActivistResponse & { fetchedOn: string };

/** The route reads only the newest few filings; the rest come back with placeholders. */
function details(filing: ActivistFiling) {
    return {
        person: readActivistField(filing.reportingPerson),
        stake: readActivistField(filing.percentClass),
        shares: readActivistField(filing.shares),
        purpose: readActivistField(filing.purpose),
    };
}

function citationFor(filing: ActivistFiling, subject: string): Citation {
    const person = readActivistField(filing.reportingPerson);
    return {
        entity: person ? `${person} (on ${subject})` : subject,
        form: filing.form,
        filingDate: filing.filingDate,
        accession: filing.accessionNumber,
        url: filing.indexUrl || filing.url,
        cik: filing.cik ?? null,
    };
}

export function buildActivistView(data: ActivistData, query: string) {
    const subject = data.companyName || query;
    const filings = data.filings || [];
    const latest = filings[0];
    let sentence: string;
    if (!latest) {
        sentence = `EDGAR’s recent records for ${subject} include no Schedule 13D filings.`;
    } else {
        const d = details(latest);
        const kind = /\/A$/i.test(latest.form) ? 'an amendment' : 'an initial filing';
        const by = d.person ? ` by ${d.person}` : '';
        const stake = d.stake ? `, reporting ${d.stake} of the shares` : '';
        sentence = `EDGAR’s recent records for ${subject} include ${plural(filings.length, 'Schedule 13D filing')}. The latest, ${kind}${by}, was filed ${formatDate(latest.filingDate)}${stake}.`;
    }
    return { subject, filings, sentence, sources: latest ? [citationFor(latest, subject)] : [], asOf: data.fetchedOn };
}

/**
 * Schedule 13D filings for a company or an investor: takeaway with source, then the filings with investor, stake and
 * the stated purpose. Used by Whale Tracker's "Activist stakes" mode, the company page and the fund page (compact).
 */
export function ActivistView({
    data,
    query,
    updating = false,
    compact = false,
}: {
    data: ActivistData;
    query: string;
    updating?: boolean;
    compact?: boolean;
}) {
    return <ActivistBody key={`${data.cik}-${data.fetchedOn}`} data={data} query={query} updating={updating} compact={compact} />;
}

function ActivistBody({ data, query, updating, compact }: { data: ActivistData; query: string; updating: boolean; compact: boolean }) {
    const view = useMemo(() => buildActivistView(data, query), [data, query]);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const rows = useShowMore(compact ? 5 : 25);

    const toggle = (id: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <>
            {compact ? (
                <p className="font-serif text-lg text-ink">{view.sentence}</p>
            ) : (
                <Takeaway
                    copyText={view.sentence}
                    sources={view.sources}
                    asOf={view.asOf}
                    updating={updating}
                    note={data.cik ? <Identifier label="CIK" value={data.cik} /> : undefined}
                >
                    {view.sentence}
                </Takeaway>
            )}

            <Updating updating={updating}>
                {view.filings.length > 8 && (
                    <Notice tone="info">
                        Investor, stake and purpose are read automatically from the eight newest filings. For older ones, open the
                        filing.
                    </Notice>
                )}

                <section className="space-y-4">
                    {!compact && (
                        <SectionHeader
                            level={3}
                            title="Schedule 13D filings"
                            intro="Newest first. Open a row to read the stated purpose (Item 4) as extracted from the filing."
                        />
                    )}
                    <Panel>
                        <Table caption={`Schedule 13D filings for ${view.subject}`}>
                            <THead>
                                <tr>
                                    <Th>Investor</Th>
                                    <Th>Filed</Th>
                                    <Th>Form</Th>
                                    <Th numeric>Stake</Th>
                                    <Th><span className="sr-only">Filing link</span></Th>
                                </tr>
                            </THead>
                            <tbody>
                                {view.filings.slice(0, rows.limit).map((filing) => {
                                    const id = filing.accessionNumber || filing.url;
                                    const d = details(filing);
                                    const open = expanded.has(id);
                                    const detailId = `activist-${slugify(id)}`;
                                    const noBorder = open ? 'border-b-0' : undefined;
                                    return (
                                        <Fragment key={id}>
                                            <tr className={rowClass}>
                                                <Td className={noBorder}>
                                                    {d.purpose ? (
                                                        <RowToggle expanded={open} onToggle={() => toggle(id)} controls={detailId}>
                                                            {d.person ?? 'Investor not extracted'}
                                                        </RowToggle>
                                                    ) : (
                                                        <span className={d.person ? 'font-medium text-ink' : 'text-ink-muted'}>
                                                            {d.person ?? 'Not read automatically'}
                                                        </span>
                                                    )}
                                                </Td>
                                                <Td className={noBorder}>
                                                    <span className="whitespace-nowrap">{formatDate(filing.filingDate)}</span>
                                                </Td>
                                                <Td className={noBorder}>
                                                    <FormMark form={filing.form.replace(/^(SC|SCHEDULE) /i, '')} />
                                                    <span className="mt-0.5 block text-sm text-ink-muted">{activistFormLabel(filing.form)}</span>
                                                </Td>
                                                <Td numeric className={noBorder}>
                                                    {d.stake ?? <span className="text-ink-muted">—</span>}
                                                    {d.shares && <span className="block text-sm text-ink-muted">{d.shares} shares</span>}
                                                </Td>
                                                <Td className={noBorder ? `${noBorder} text-right` : 'text-right'}>
                                                    <span className="inline-flex items-center gap-1">
                                                        <a
                                                            href={filing.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-accent hover:underline"
                                                        >
                                                            Open filing
                                                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                                                            <span className="sr-only">(opens on sec.gov in a new tab)</span>
                                                        </a>
                                                        <CopyCitation citation={citationFor(filing, view.subject)} />
                                                    </span>
                                                </Td>
                                            </tr>
                                            {open && d.purpose && (
                                                <tr id={detailId}>
                                                    <Td colSpan={5} className="bg-surface-2/50">
                                                        <p className="text-sm font-medium text-ink-muted">
                                                            Purpose of the transaction (Item 4), as extracted
                                                            {d.purpose.endsWith('...') && ' (cut at 300 characters; open the filing for the rest)'}
                                                        </p>
                                                        <p className="mt-1 max-w-3xl whitespace-pre-line text-base text-ink">{d.purpose}</p>
                                                    </Td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                                {view.filings.length === 0 && (
                                    <TableEmpty colSpan={5}>
                                        No Schedule 13D filings found. Try the target company’s ticker, or the investor’s full name as filed.
                                    </TableEmpty>
                                )}
                            </tbody>
                        </Table>
                        <TableFooter shown={Math.min(rows.limit, view.filings.length)} total={view.filings.length} noun="filings" onShowMore={rows.showMore} />
                    </Panel>
                </section>
            </Updating>
        </>
    );
}
