"use client";

import { useState } from 'react';
import { UserRound } from 'lucide-react';
import { SectionHeader, Term } from '../ui';
import { TickerSearch } from '../TickerSearch';
import { InsiderTrades, type InsiderTradesResponse } from '../insider/InsiderTrades';
import { ModeIntro, RequestError, ResultSkeleton, SearchForm, Updating, useRequest } from './shared';
import { useRunFromUrlOnce, useUrlParams } from '../useUrlState';
import { postJson } from './model';

const EXAMPLES = ['NVDA', 'TSLA', 'JPM'];

// Up to 40 Form 4 filings are read one by one from EDGAR, so allow longer than the default request timeout.
export const loadInsiderTrades = (id: string) => postJson<InsiderTradesResponse>('/api/insider-trades', { id }, 90000);

/** Whale Tracker's "Insider trades" mode: search a company, then show its Form 4 trades. */
export function InsiderLookup() {
    const { params, setParams } = useUrlParams();
    const [ticker, setTicker] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [state, run] = useRequest(loadInsiderTrades);

    const search = (value: string) => {
        const q = value.trim().toUpperCase();
        if (!q) {
            setInputError('Enter a stock ticker, such as NVDA.');
            return;
        }
        setInputError(null);
        setParams({ insider: q });
        void run(q, q);
    };

    useRunFromUrlOnce([params.get('insider')], (value) => {
        setTicker(value.toUpperCase());
        search(value);
    });

    const data = state.result;

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <SectionHeader
                    title="Insider trades"
                    intro={<>See what a company&apos;s executives, directors and big owners bought and sold, from their <Term id="form4">Form 4</Term> filings.</>}
                />
                <SearchForm onSubmit={() => search(ticker)} loading={state.loading} submitLabel="Show trades">
                    <TickerSearch
                        className="flex-1 sm:max-w-md"
                        label="Company"
                        value={ticker}
                        onChange={setTicker}
                        onSelect={search}
                        placeholder="e.g. NVDA"
                        hint="A ticker or CIK. Reads up to 40 Form 4 filings from the past year, so it can take 20–30 seconds."
                        error={inputError}
                    />
                </SearchForm>
            </div>

            {state.error && (
                <RequestError
                    title={`Couldn’t load insider trades for ${state.query}`}
                    message={state.error}
                    advice="Check the ticker. EDGAR can be slow when many filings are read at once; if it timed out, try again."
                    onRetry={state.query ? () => search(state.query!) : undefined}
                />
            )}

            {!data && state.loading && <ResultSkeleton label="Reading Form 4 filings" />}

            {!data && !state.loading && !state.error && (
                <ModeIntro
                    icon={<UserRound className="h-5 w-5" aria-hidden />}
                    title="Are insiders buying or selling?"
                    examples={EXAMPLES.map((example) => ({
                        id: example,
                        label: example,
                        run: () => {
                            setTicker(example);
                            search(example);
                        },
                    }))}
                >
                    Open-market purchases by executives are rare and often newsworthy. Sales are common, and many are scheduled in
                    advance under 10b5-1 plans; this view separates the two.
                </ModeIntro>
            )}

            {data && (
                <Updating updating={state.loading}>
                    <InsiderTrades key={`${data.cik}-${data.to}`} data={data} />
                </Updating>
            )}
        </div>
    );
}
