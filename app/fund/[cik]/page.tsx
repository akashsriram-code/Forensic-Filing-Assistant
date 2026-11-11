"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppHeader } from '../../components/AppHeader';
import { EntityHeader, EntityHeaderSkeleton } from '../../components/entity/EntityHeader';
import { RecentFilings } from '../../components/entity/RecentFilings';
import { PageBlock, getJson, useLoad } from '../../components/entity/shared';
import { SiteNav } from '../../components/entity/SiteNav';
import { FundStakes } from '../../components/entity/FundStakes';
import { Notice, Term } from '../../components/ui';
import { FundHoldingsView } from '../../components/whale/FundHoldingsView';
import { postJson, type FundHoldingsResponse } from '../../components/whale/model';
import type { EntityProfile } from '@/lib/entity';

/** /fund/1067983 or /fund/0001067983: what a 13F filer holds and what it changed, plus its stakes and filings. */
export default function FundPage() {
    const params = useParams<{ cik: string }>();
    const raw = decodeURIComponent(params.cik || '');
    // Accept padded and unpadded CIKs; anything else (a name) is resolved by /api/entity.
    const id = /^\d{1,10}$/.test(raw) ? String(Number(raw)) : raw;

    const profile = useLoad(() => getJson<EntityProfile>(`/api/entity?id=${encodeURIComponent(id)}`), [id]);
    const cik = profile.data ? String(Number(profile.data.cik)) : null;
    const filesHoldings = profile.data?.filesHoldings ?? false;
    const holdings = useLoad(
        cik && filesHoldings ? () => postJson<FundHoldingsResponse>('/api/whale-tracker', { ticker: cik }) : null,
        [cik, filesHoldings]
    );

    return (
        <div className="min-h-screen bg-paper">
            <AppHeader tabs={<SiteNav />} />
            <main className="mx-auto max-w-[1200px] space-y-10 px-4 py-8 sm:px-8 sm:py-10">
                {profile.loading && <EntityHeaderSkeleton />}
                {profile.error && (
                    <Notice tone="error" title="This fund couldn’t be found">
                        {profile.error} Try the header search, or a fund&apos;s CIK number.
                    </Notice>
                )}

                {profile.data && (
                    <>
                        <EntityHeader
                            profile={profile.data}
                            kindLabel="Fund"
                            followId={cik!}
                            crossLink={
                                profile.data.isCompany && (
                                    <>
                                        {profile.data.name} is also a listed company.{' '}
                                        <Link href={`/company/${encodeURIComponent(profile.data.tickers[0] || cik!)}`} className="font-medium text-accent hover:underline">
                                            Open its company page
                                        </Link>
                                    </>
                                )
                            }
                        />

                        {!filesHoldings ? (
                            <Notice tone="info" title="No 13F holdings reports">
                                {profile.data.name} doesn&apos;t file <Term id="form13f">13F holdings reports</Term>, so there are no fund holdings to show.
                                {profile.data.isCompany && (
                                    <>
                                        {' '}
                                        <Link href={`/company/${encodeURIComponent(profile.data.tickers[0] || cik!)}`} className="font-medium text-accent hover:underline">
                                            Open its company page instead
                                        </Link>
                                        .
                                    </>
                                )}
                            </Notice>
                        ) : (
                            <PageBlock
                                id="fund-holdings"
                                title="Holdings"
                                intro={<>What the fund reported in its latest <Term id="form13f">13F filing</Term>, and what changed from the quarter before.</>}
                                state={holdings}
                            >
                                {(data) => <FundHoldingsView data={data} showIdentity={false} />}
                            </PageBlock>
                        )}

                        <FundStakes cik={cik!} name={profile.data.name} />

                        <section aria-labelledby="fund-filings" className="space-y-5 border-t border-rule pt-8">
                            <div className="max-w-3xl">
                                <h2 id="fund-filings" className="text-xl font-semibold text-ink">Recent filings</h2>
                                <p className="mt-1 text-base text-ink-muted">Everything {profile.data.name} filed with the SEC recently, newest first.</p>
                            </div>
                            <RecentFilings profile={profile.data} />
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}
