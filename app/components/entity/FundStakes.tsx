"use client";

import { Term } from '../ui';
import { ActivistView } from '../whale/ActivistView';
import { loadActivistFilings } from '../whale/ActivistStakes';
import { PageBlock, useLoad } from './shared';

/** Fund page block: Schedule 13D stakes the fund itself disclosed (its activist campaigns). */
export function FundStakes({ cik, name }: { cik: string; name: string }) {
    const state = useLoad(() => loadActivistFilings(cik), [cik]);
    return (
        <PageBlock
            id="fund-stakes"
            title="Activist stakes"
            intro={<>Companies where {name} disclosed more than 5% with possible plans to influence them, from its <Term id="activistStake">Schedule 13D</Term> filings.</>}
            state={state}
            empty={`${name} has no recent Schedule 13D filings on EDGAR.`}
            isEmpty={(data) => (data.filings || []).length === 0}
        >
            {(data) => <ActivistView data={data} query={name} compact />}
        </PageBlock>
    );
}
