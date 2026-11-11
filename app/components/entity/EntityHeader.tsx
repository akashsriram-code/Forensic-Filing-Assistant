"use client";

import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { EntityProfile } from '@/lib/entity';
import { FollowButton } from '../FollowButton';
import { Identifier, Skeleton } from '../ui';

/** Fiscal year end "0131" -> "January 31". */
function fiscalYearEndLabel(value: string | null): string | null {
    if (!value || !/^\d{4}$/.test(value)) return null;
    const month = Number(value.slice(0, 2));
    const day = Number(value.slice(2));
    const date = new Date(Date.UTC(2000, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Name, identifiers and quick facts at the top of a company or fund page. */
export function EntityHeader({
    profile,
    kindLabel,
    followId,
    crossLink,
}: {
    profile: EntityProfile;
    /** "Company" or "Fund". */
    kindLabel: string;
    /** Ticker or CIK to follow for filing alerts. */
    followId: string;
    crossLink?: ReactNode;
}) {
    const fiscalYearEnd = fiscalYearEndLabel(profile.fiscalYearEnd);
    const facts = [
        profile.tickers.length > 0 ? `${profile.tickers.join(', ')}${profile.exchanges[0] ? ` on ${profile.exchanges.join(', ')}` : ''}` : null,
        profile.sicDescription,
        profile.stateOfIncorporation ? `Incorporated in ${profile.stateOfIncorporation}` : null,
        fiscalYearEnd ? `Fiscal year ends ${fiscalYearEnd}` : null,
    ].filter(Boolean) as string[];

    return (
        <header className="space-y-3">
            <p className="text-sm font-medium text-ink-muted">{kindLabel}</p>
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 max-w-3xl">
                    <h1 className="font-serif text-2xl font-semibold text-ink">{profile.name}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <Identifier label="CIK" value={profile.cik} />
                        {facts.map((fact) => (
                            <span key={fact} className="text-sm text-ink-muted">{fact}</span>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <FollowButton ticker={followId} />
                    <a
                        href={profile.edgarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-base font-medium text-accent hover:bg-surface-2"
                    >
                        View on EDGAR
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                    </a>
                </div>
            </div>
            {crossLink && <div className="text-base text-ink-muted">{crossLink}</div>}
        </header>
    );
}

export function EntityHeaderSkeleton() {
    return (
        <div className="space-y-3" role="status" aria-label="Loading">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
        </div>
    );
}
