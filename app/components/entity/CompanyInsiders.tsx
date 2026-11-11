"use client";

import { InsiderTrades } from '../insider/InsiderTrades';
import { Term } from '../ui';
import { loadInsiderTrades } from '../whale/InsiderLookup';
import { PageBlock, useLoad } from './shared';

/** Company page block: open-market insider buying and selling from Form 4 filings. */
export function CompanyInsiders({ id, name }: { id: string; name: string }) {
    const state = useLoad(() => loadInsiderTrades(id), [id]);
    return (
        <PageBlock
            id="company-insiders"
            title="Insider trades"
            intro={<>What {name}&apos;s executives, directors and 10% owners bought and sold, from their <Term id="form4">Form 4</Term> filings over the past year.</>}
            state={state}
            empty="No Form 4 insider filings in the past year."
            isEmpty={(data) => data.filingsChecked === 0}
        >
            {(data) => <InsiderTrades data={data} compact />}
        </PageBlock>
    );
}
