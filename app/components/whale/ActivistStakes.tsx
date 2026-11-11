"use client";

import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { SectionHeader, Term } from '../ui';
import { TickerSearch } from '../TickerSearch';
import { ActivistView, type ActivistData } from './ActivistView';
import { ModeIntro, RequestError, ResultSkeleton, SearchForm, useRequest } from './shared';
import { useRunFromUrlOnce, useUrlParams } from '../useUrlState';
import { postJson, type ActivistResponse } from './model';

// /api/whale-activist resolves the query with fetchCIK (ticker, company or fund name, or CIK) and lists the 13D filings
// in that entity's EDGAR record, so both target companies and activist investors work.
const EXAMPLES = [
    { id: 'pershing', label: 'Pershing Square', query: 'Pershing Square Capital Management' },
    { id: 'starboard', label: 'Starboard Value', query: 'Starboard Value' },
    { id: 'icahn', label: 'Icahn Enterprises', query: 'IEP' },
];

/** The list is live from EDGAR, so it is current as of the day it was fetched. */
export const loadActivistFilings = async (query: string): Promise<ActivistData> => ({
    ...(await postJson<ActivistResponse>('/api/whale-activist', { ticker: query })),
    fetchedOn: new Date().toISOString().slice(0, 10),
});

/** Whale Tracker's "Activist stakes" mode: search a company or investor, then show ActivistView. */
export function ActivistStakes() {
    const { params, setParams } = useUrlParams();
    const [query, setQuery] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [state, run] = useRequest(loadActivistFilings);

    const search = (value: string) => {
        const q = value.trim();
        if (!q) {
            setInputError('Enter a company or investor.');
            return;
        }
        setInputError(null);
        setParams({ activist: q });
        void run(q, q);
    };

    useRunFromUrlOnce([params.get('activist')], (value) => {
        setQuery(value);
        search(value);
    });

    const data = state.result;

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

            {data && <ActivistView data={data} query={state.query ?? ''} updating={state.loading} />}
        </div>
    );
}
