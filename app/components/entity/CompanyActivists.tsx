"use client";

import Link from 'next/link';
import { Term, buttonClass } from '../ui';
import { ActivistView } from '../whale/ActivistView';
import { loadActivistFilings } from '../whale/ActivistStakes';
import { PageBlock, useLoad } from './shared';

/** Company page block: Schedule 13D filings by investors holding more than 5% who may push for change. */
export function CompanyActivists({ id, name }: { id: string; name: string }) {
    const state = useLoad(() => loadActivistFilings(id), [id]);
    return (
        <PageBlock
            id="company-activists"
            title="Activist stakes"
            intro={<>Investors that disclosed more than 5% of {name} with plans that could include pushing for change, from <Term id="activistStake">Schedule 13D</Term> filings.</>}
            actions={
                <Link href={`/?tab=whale&mode=activist&activist=${encodeURIComponent(id)}`} className={buttonClass('secondary', 'sm')}>
                    Open in Whale Tracker
                </Link>
            }
            state={state}
            empty={`EDGAR’s recent records for ${name} include no Schedule 13D filings.`}
            isEmpty={(data) => (data.filings || []).length === 0}
        >
            {(data) => <ActivistView data={data} query={name} compact />}
        </PageBlock>
    );
}
