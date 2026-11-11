"use client";

import { useState } from 'react';
import { Briefcase } from 'lucide-react';
import { SectionHeader, Term } from '../ui';
import { TickerSearch } from '../TickerSearch';
import { FundHoldingsView } from './FundHoldingsView';
import { ModeIntro, RequestError, ResultSkeleton, SearchForm, useRequest } from './shared';
import { useRunFromUrlOnce, useUrlParams } from '../useUrlState';
import { postJson, type FundHoldingsResponse } from './model';

// Names the store resolves by filer name; Berkshire also resolves through its ticker's CIK.
const EXAMPLES = [
    { id: 'berkshire', label: 'Berkshire Hathaway', query: 'Berkshire Hathaway' },
    { id: 'bridgewater', label: 'Bridgewater Associates', query: 'Bridgewater Associates' },
    { id: 'pershing', label: 'Pershing Square', query: 'Pershing Square' },
];

export const loadFundHoldings = (query: string) => postJson<FundHoldingsResponse>('/api/whale-tracker', { ticker: query });

/** Whale Tracker's "Fund holdings" mode: search a fund, then show FundHoldingsView. */
export function FundHoldings() {
    const { params, setParams } = useUrlParams();
    const [query, setQuery] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [state, run] = useRequest(loadFundHoldings);

    const search = (value: string) => {
        const q = value.trim();
        if (!q) {
            setInputError('Enter a fund name, ticker or CIK.');
            return;
        }
        setInputError(null);
        setParams({ fund: q });
        void run(q, q);
    };

    // A shared link like ?tab=whale&fund=Berkshire+Hathaway opens straight to the result.
    useRunFromUrlOnce([params.get('fund')], (fund) => {
        setQuery(fund);
        search(fund);
    });

    const data = state.result;

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <SectionHeader
                    title="Fund holdings"
                    intro={<>See what a fund reported in its latest <Term id="form13f">13F filing</Term> and what changed from the quarter before.</>}
                />
                <SearchForm onSubmit={() => search(query)} loading={state.loading} submitLabel="Show holdings">
                    <TickerSearch
                        className="flex-1 sm:max-w-xl"
                        label="Fund"
                        value={query}
                        onChange={setQuery}
                        onSelect={search}
                        uppercase={false}
                        placeholder="e.g. Berkshire Hathaway"
                        hint="A fund name, its ticker or its CIK. Suggestions list only listed companies; for other funds, type the name and press Enter."
                        error={inputError}
                    />
                </SearchForm>
            </div>

            {state.error && (
                <RequestError
                    title={`Couldn’t load holdings for “${state.query}”`}
                    message={state.error}
                    advice="Check the spelling, try the fund’s full name as filed with the SEC, or search by its CIK number."
                    onRetry={state.query ? () => search(state.query!) : undefined}
                />
            )}

            {!data && state.loading && <ResultSkeleton label="Loading fund holdings" />}

            {!data && !state.loading && !state.error && (
                <ModeIntro
                    icon={<Briefcase className="h-5 w-5" aria-hidden />}
                    title="What does a fund own, and what did it change?"
                    examples={EXAMPLES.map((example) => ({
                        id: example.id,
                        label: example.label,
                        run: () => {
                            setQuery(example.query);
                            search(example.query);
                        },
                    }))}
                >
                    Search a fund to see its holdings at the end of the latest quarter, its biggest new positions and cuts, and how
                    any one holding changed over time.
                </ModeIntro>
            )}

            {data && <FundHoldingsView data={data} updating={state.loading} linkFundPage />}
        </div>
    );
}
