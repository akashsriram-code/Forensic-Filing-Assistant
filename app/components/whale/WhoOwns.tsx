"use client";

import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { SectionHeader } from '../ui';
import { TickerSearch } from '../TickerSearch';
import { OwnersView } from './OwnersView';
import { ModeIntro, RequestError, ResultSkeleton, SearchForm, useRequest } from './shared';
import { useRunFromUrlOnce, useUrlParams } from '../useUrlState';
import { postJson, type ReverseResponse } from './model';

const EXAMPLES = ['NVDA', 'AAPL', 'TSLA'];

export const loadHolders = (ticker: string) => postJson<ReverseResponse>('/api/whale-reverse-lookup', { ticker });

/** Whale Tracker's "Who owns a stock" mode: search a ticker or CUSIP, then show OwnersView. */
export function WhoOwns() {
    const { params, setParams } = useUrlParams();
    const [ticker, setTicker] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [state, run] = useRequest(loadHolders);

    const search = (value: string) => {
        const q = value.trim().toUpperCase();
        if (!q) {
            setInputError('Enter a stock ticker, such as NVDA.');
            return;
        }
        setInputError(null);
        setParams({ stock: q });
        void run(q, q);
    };

    useRunFromUrlOnce([params.get('stock')], (stock) => {
        setTicker(stock.toUpperCase());
        search(stock);
    });

    const data = state.result;
    const symbol = (data?.ticker || state.query || '').toUpperCase();

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <SectionHeader
                    title="Who owns a stock"
                    intro="See which funds reported holding a stock in their latest 13F filings, and which of them bought or sold."
                />
                <SearchForm onSubmit={() => search(ticker)} loading={state.loading} submitLabel="Find funds">
                    <TickerSearch
                        className="flex-1 sm:max-w-md"
                        label="Stock ticker"
                        value={ticker}
                        onChange={setTicker}
                        onSelect={search}
                        placeholder="e.g. NVDA"
                        hint="A ticker such as NVDA, or a 9-character CUSIP."
                        error={inputError}
                    />
                </SearchForm>
            </div>

            {state.error && (
                <RequestError
                    title={`Couldn’t find funds holding ${state.query}`}
                    message={state.error}
                    advice="Check the ticker. Only US-listed tickers in the SEC’s list work; for other securities, try the 9-character CUSIP."
                    onRetry={state.query ? () => search(state.query!) : undefined}
                />
            )}

            {!data && state.loading && <ResultSkeleton label="Finding funds" />}

            {!data && !state.loading && !state.error && (
                <ModeIntro
                    icon={<Building2 className="h-5 w-5" aria-hidden />}
                    title="Which funds own a stock, and who is buying or selling?"
                    examples={EXAMPLES.map((example) => ({
                        id: example,
                        label: example,
                        run: () => {
                            setTicker(example);
                            search(example);
                        },
                    }))}
                >
                    Enter a ticker to list every fund that reported the stock in its latest 13F filing, with who started, added to,
                    cut or sold out of a position.
                </ModeIntro>
            )}

            {data && <OwnersView data={data} symbol={symbol} updating={state.loading} />}
        </div>
    );
}
