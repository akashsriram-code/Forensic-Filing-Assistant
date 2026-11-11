"use client";

import { Fragment, useMemo, useState } from 'react';
import { ExternalLink, Megaphone } from 'lucide-react';
import { formatDate, plural } from '@/lib/format';
import {
    FormMark,
    Identifier,
    Notice,
    Panel,
    RowToggle,
    SectionHeader,
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
import { ModeIntro, RequestError, ResultSkeleton, SearchForm, Updating, useRequest, useShowMore } from './shared';
import { activistFormLabel, postJson, readActivistField, slugify, type ActivistFiling, type ActivistResponse } from './model';

// /api/whale-activist resolves the query with fetchCIK (ticker, company or fund name, or CIK) and lists the 13D filings
// in that entity's EDGAR record, so both target companies and activist investors work.
const EXAMPLES = [
    { id: 'pershing', label: 'Pershing Square', query: 'Pershing Square Capital Management' },
    { id: 'starboard', label: 'Starboard Value', query: 'Starboard Value' },
    { id: 'icahn', label: 'Icahn Enterprises', query: 'IEP' },
];

/** The list is live from EDGAR, so it is current as of the day it was fetched. */
const loadFilings = async (query: string) => ({
    ...(await postJson<ActivistResponse>('/api/whale-activist', { ticker: query })),
    fetchedOn: new Date().toISOString().slice(0, 10),
});

/** The route parses only the most recent few filings; the rest come back with placeholders. */
function details(filing: ActivistFiling) {
    return {
        person: readActivistField(filing.reportingPerson),
        stake: readActivistField(filing.percentClass),
        shares: readActivistField(filing.shares),
        purpose: readActivistField(filing.purpose),
    };
}

function buildView(data: ActivistResponse & { fetchedOn: string }, query: string) {
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
    return {
        subject,
        filings,
        sentence,
        copyText: `${sentence} Source: SEC EDGAR.`,
        asOf: data.fetchedOn,
    };
}

export function ActivistStakes() {
    const [query, setQuery] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [state, run] = useRequest(loadFilings);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const rows = useShowMore(25);

    const search = (value: string) => {
        const q = value.trim();
        if (!q) {
            setInputError('Enter a company or investor.');
            return;
        }
        setInputError(null);
        setExpanded(new Set());
        rows.reset();
        void run(q, q);
    };

    const data = state.result;
    const view = useMemo(() => (data ? buildView(data, state.query ?? '') : null), [data, state.query]);

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
                    title="Activist stakes"
                    intro={
                        <>
                            Find <Term id="activistStake">Schedule 13D</Term> filings: investors disclosing more than 5% of a company
                            and a possible plan to influence it.
                        </>
                    }
                />
                <SearchForm onSubmit={() => search(query)} loading={state.loading} submitLabel="Find filings">
                    <TickerSearch
                        className="flex-1 sm:max-w-xl"
                        label="Company or investor"
                        value={query}
                        onChange={setQuery}
                        onSelect={search}
                        uppercase={false}
                        placeholder="e.g. TSLA or Starboard Value"
                        hint="A ticker, a company or fund name, or a CIK. Lists 13D filings where it is the target company or the investor filing."
                        error={inputError}
                    />
                </SearchForm>
            </div>

            {state.error && (
                <RequestError
                    title={`Couldn’t load 13D filings for “${state.query}”`}
                    message={state.error}
                    advice="Check the spelling, or try the ticker or CIK. EDGAR can be slow; if it timed out, try again."
                    onRetry={state.query ? () => search(state.query!) : undefined}
                />
            )}

            {!data && state.loading && <ResultSkeleton label="Loading 13D filings" />}

            {!data && !state.loading && !state.error && (
                <ModeIntro
                    icon={<Megaphone className="h-5 w-5" aria-hidden />}
                    title="Is an activist investor building a stake?"
                    examples={EXAMPLES.map((example) => ({
                        id: example.id,
                        label: example.label,
                        run: () => {
                            setQuery(example.query);
                            search(example.query);
                        },
                    }))}
                >
                    Search a company to see who has disclosed a large stake with plans to push for change, or search an activist
                    fund to see its campaigns.
                </ModeIntro>
            )}

            {data && view && (
                <>
                    <Takeaway
                        copyText={view.copyText}
                        asOf={view.asOf}
                        updating={state.loading}
                        note={data.cik ? <Identifier label="CIK" value={data.cik} /> : undefined}
                    >
                        {view.sentence}
                    </Takeaway>

                    <Updating updating={state.loading}>
                        <Notice tone="caution" title="This list can be incomplete">
                            It covers EDGAR’s recent filings for this entity and matches the form names “SC 13D” and “SC 13D/A”.
                            EDGAR began filing these schedules as “SCHEDULE 13D” in December 2024, so newer filings may be missing
                            here. Investor, stake and purpose are read automatically from the five newest filings only; open the
                            filing to confirm them.
                        </Notice>

                        <section className="space-y-4">
                            <SectionHeader
                                level={3}
                                title="Schedule 13D filings"
                                intro="Newest first. Open a row to read the stated purpose (Item 4) as extracted from the filing."
                            />
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
                                                            <FormMark form={filing.form.replace(/^SC /, '')} />
                                                            <span className="mt-0.5 block text-sm text-ink-muted">{activistFormLabel(filing.form)}</span>
                                                        </Td>
                                                        <Td numeric className={noBorder}>
                                                            {d.stake ?? <span className="text-ink-muted">—</span>}
                                                            {d.shares && <span className="block text-sm text-ink-muted">{d.shares} shares</span>}
                                                        </Td>
                                                        <Td className={noBorder ? `${noBorder} text-right` : 'text-right'}>
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
                                <TableFooter
                                    shown={Math.min(rows.limit, view.filings.length)}
                                    total={view.filings.length}
                                    noun="filings"
                                    onShowMore={rows.showMore}
                                />
                            </Panel>
                        </section>
                    </Updating>
                </>
            )}
        </div>
    );
}
