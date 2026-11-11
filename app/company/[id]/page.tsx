"use client";

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { Citation } from '@/lib/citation';
import type { EntityProfile, RecentFiling } from '@/lib/entity';
import { formatDate, joinList, plural } from '@/lib/format';
import { AppHeader } from '../../components/AppHeader';
import { CompanyActivists } from '../../components/entity/CompanyActivists';
import { CompanyInsiders } from '../../components/entity/CompanyInsiders';
import { EntityHeader, EntityHeaderSkeleton } from '../../components/entity/EntityHeader';
import { LatestChanges } from '../../components/entity/LatestChanges';
import { RecentFilings } from '../../components/entity/RecentFilings';
import { PageBlock, getJson, useLoad } from '../../components/entity/shared';
import { SiteNav } from '../../components/entity/SiteNav';
import { Notice, Takeaway, Term } from '../../components/ui';
import { OwnersView } from '../../components/whale/OwnersView';
import { postJson, type ReverseResponse } from '../../components/whale/model';

const REPORT_FORMS = /^(10-K|10-Q|20-F|40-F)$/;
const DAY_MS = 86_400_000;

/** "NVIDIA last filed a 10-Q on Nov 19, 2026. In the past 90 days it also filed 3 8-Ks." Built only from the filing list. */
function filingTakeaway(profile: EntityProfile): { sentence: string; sources: Citation[] } {
    const filings = profile.recentFilings;
    const latestReport = filings.find((filing) => REPORT_FORMS.test(filing.form));
    const name = profile.name;
    const sources: Citation[] = [];
    const cite = (filing: RecentFiling): Citation => ({ entity: name, form: filing.form, filingDate: filing.filingDate, accession: filing.accessionNumber, url: filing.indexUrl });

    const sentences: string[] = [];
    if (latestReport) {
        sentences.push(`${name}'s latest report is a ${latestReport.form} filed ${formatDate(latestReport.filingDate)}.`);
        sources.push(cite(latestReport));
    } else if (filings[0]) {
        sentences.push(`${name} last filed a ${filings[0].form} on ${formatDate(filings[0].filingDate)}.`);
        sources.push(cite(filings[0]));
    }

    const newest = filings[0] ? Date.parse(`${filings[0].filingDate}T00:00:00Z`) : NaN;
    if (!Number.isNaN(newest)) {
        const cutoff = new Date(Date.now() - 90 * DAY_MS).toISOString().slice(0, 10);
        const recent = filings.filter((filing) => filing.filingDate >= cutoff);
        const eightKs = recent.filter((filing) => /^8-K/.test(filing.form));
        const form4s = recent.filter((filing) => /^4(\/A)?$/.test(filing.form));
        const parts: string[] = [];
        if (eightKs.length > 0) parts.push(plural(eightKs.length, 'major-event report (8-K)', 'major-event reports (8-K)'));
        if (form4s.length > 0) parts.push(plural(form4s.length, 'insider trading report (Form 4)', 'insider trading reports (Form 4)'));
        if (parts.length > 0) {
            sentences.push(`In the past 90 days it filed ${joinList(parts)}.`);
            sources.push(...eightKs.slice(0, 3).map(cite));
        }
    }
    if (sentences.length === 0) sentences.push(`${name} has no recent filings on EDGAR.`);
    return { sentence: sentences.join(' '), sources };
}

/**
 * /company/NVDA (also a CIK or a name): one place for a company's filings, what changed in its last annual report,
 * insider trades, which funds own it and activist stakes. Each block loads on its own.
 */
export default function CompanyPage() {
    const params = useParams<{ id: string }>();
    const id = decodeURIComponent(params.id || '');
    const profile = useLoad(() => getJson<EntityProfile>(`/api/entity?id=${encodeURIComponent(id)}`), [id]);
    const p = profile.data;
    const ticker = p?.tickers[0] ?? null;
    const cik = p ? String(Number(p.cik)) : null;

    const owners = useLoad(ticker ? () => postJson<ReverseResponse>('/api/whale-reverse-lookup', { ticker }) : null, [ticker]);
    const takeaway = useMemo(() => (p ? filingTakeaway(p) : null), [p]);

    return (
        <div className="min-h-screen bg-paper">
            <AppHeader tabs={<SiteNav />} />
            <main className="mx-auto max-w-[1200px] space-y-10 px-4 py-8 sm:px-8 sm:py-10">
                {profile.loading && <EntityHeaderSkeleton />}
                {profile.error && (
                    <Notice tone="error" title={`No company found for “${id}”`}>
                        {profile.error} Try the ticker (for example NVDA), the company&apos;s full name or its CIK in the search box above.
                    </Notice>
                )}

                {p && takeaway && (
                    <>
                        <EntityHeader
                            profile={p}
                            kindLabel={p.isCompany ? 'Company' : 'SEC filer'}
                            followId={ticker || cik!}
                            crossLink={
                                p.filesHoldings && (
                                    <>
                                        {p.name} also reports what it holds in <Term id="form13f">13F filings</Term>.{' '}
                                        <Link href={`/fund/${cik}`} className="font-medium text-accent hover:underline">
                                            Open its fund page
                                        </Link>
                                    </>
                                )
                            }
                        />

                        <Takeaway copyText={takeaway.sentence} sources={takeaway.sources} asOf={p.recentFilings[0]?.filingDate}>
                            {takeaway.sentence}
                        </Takeaway>

                        <section aria-labelledby="company-filings" className="space-y-5 border-t border-rule pt-8">
                            <div className="max-w-3xl">
                                <h2 id="company-filings" className="text-xl font-semibold text-ink">Recent filings</h2>
                                <p className="mt-1 text-base text-ink-muted">Everything {p.name} filed with the SEC recently, newest first.</p>
                            </div>
                            <RecentFilings profile={p} />
                        </section>

                        <section aria-labelledby="company-changes" className="space-y-5 border-t border-rule pt-8">
                            <div className="max-w-3xl">
                                <h2 id="company-changes" className="text-xl font-semibold text-ink">What changed in the latest annual report</h2>
                                <p className="mt-1 text-base text-ink-muted">
                                    New, removed and reworded <Term id="riskFactors">risk factors</Term> compared with the year before. New
                                    risks are often the first public sign of a problem.
                                </p>
                            </div>
                            <LatestChanges profile={p} />
                        </section>

                        <CompanyInsiders id={ticker || cik!} name={p.name} />

                        {ticker ? (
                            <PageBlock
                                id="company-owners"
                                title="Who owns it"
                                intro={<>Funds that reported the stock in their latest <Term id="form13f">13F filings</Term>, and who bought or sold.</>}
                                state={owners}
                                empty="No funds reported holding this stock in their latest 13F filings."
                                isEmpty={(data) => data.funds.length === 0}
                            >
                                {(data) => <OwnersView data={data} symbol={ticker} compact />}
                            </PageBlock>
                        ) : (
                            <section className="space-y-3 border-t border-rule pt-8">
                                <h2 className="text-xl font-semibold text-ink">Who owns it</h2>
                                <p className="text-base text-ink-muted">
                                    {p.name} has no stock ticker on file with the SEC, so fund ownership can&apos;t be looked up here.
                                </p>
                            </section>
                        )}

                        <CompanyActivists id={cik!} name={p.name} />
                    </>
                )}
            </main>
        </div>
    );
}
