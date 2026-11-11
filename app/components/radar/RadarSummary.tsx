import { formatNumber, formatPct, formatSignedNumber } from '@/lib/format';
import { formatQuarterLabel, type RadarApiResponse, type SectorMovementSummary } from '@/lib/thirteen-f-radar-core';
import { Notice, Skeleton, Stat, StatStrip } from '../ui';
import { findTopSectorMover } from './radar-takeaway';

function sectorNote(mover: SectorMovementSummary | null, direction: 'buy' | 'sell'): string {
    if (!mover) return direction === 'buy' ? 'No fund bought the watched stocks' : 'No fund sold the watched stocks';
    const count = direction === 'buy' ? mover.buyers : mover.sellers;
    const pct = direction === 'buy' ? mover.buyerPctOfComparable : mover.sellerPctOfComparable;
    return `${formatNumber(count)} funds ${direction === 'buy' ? 'buying' : 'selling'} (${formatPct(pct)}), net ${formatSignedNumber(mover.netBuyers)}`;
}

/** Sector names are words, not figures: smaller on phones and allowed to wrap so "Communication Services" fits. */
function SectorName({ name }: { name?: string }) {
    return <span className="block text-xl leading-snug [overflow-wrap:anywhere] sm:text-2xl">{name || 'None'}</span>;
}

/** Four headline figures plus any data notes from the server. */
export function RadarSummary({ data }: { data: RadarApiResponse }) {
    const { coverage } = data;
    const buying = findTopSectorMover(data.sectorMovers, 'buy');
    const selling = findTopSectorMover(data.sectorMovers, 'sell');

    return (
        <div className="space-y-4">
            <StatStrip>
                <Stat
                    label="Funds filed in both quarters"
                    term="comparableFilers"
                    value={formatNumber(coverage.comparableFilers)}
                    note={`${formatNumber(coverage.currentFilers)} filed for ${formatQuarterLabel(coverage.currentQuarter)}, ${formatNumber(coverage.previousFilers)} for ${formatQuarterLabel(coverage.previousQuarter)}`}
                />
                <Stat
                    label="Funds watched"
                    term="watchedFilers"
                    value={formatNumber(coverage.watchedFilers)}
                    note={`${formatNumber(coverage.watchedHoldingRows)} matching holdings`}
                />
                <Stat label="Sector most bought" term="sectorMovers" value={<SectorName name={buying?.sector} />} note={sectorNote(buying, 'buy')} />
                <Stat label="Sector most sold" term="sectorMovers" value={<SectorName name={selling?.sector} />} note={sectorNote(selling, 'sell')} />
            </StatStrip>

            {data.notes.length > 0 && (
                <Notice tone="caution" title="About this data">
                    <ul className="list-disc space-y-1 pl-5">
                        {data.notes.map((note) => (
                            <li key={note}>{note}</li>
                        ))}
                    </ul>
                </Notice>
            )}
        </div>
    );
}

/** First-load placeholder for the takeaway and filing-season strip. */
export function TakeawaySkeleton() {
    return (
        <div role="status" aria-label="Loading the 13F comparison" className="space-y-5">
            <div className="max-w-4xl space-y-3">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-14 w-full rounded-lg" />
        </div>
    );
}

/** First-load placeholder for the stat strip and the category cards. */
export function BodySkeleton() {
    return (
        <div className="space-y-8" aria-hidden>
            <div className="grid grid-cols-2 gap-6 border-y border-rule py-5 md:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="space-y-2">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-8 w-20" />
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-48 rounded-lg" />
                ))}
            </div>
        </div>
    );
}