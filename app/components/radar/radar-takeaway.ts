import { formatQuarterLabel, type CategorySummary, type RadarApiResponse, type SectorMovementSummary } from '@/lib/thirteen-f-radar-core';
import { formatNumber, plural } from '@/lib/format';

/** Below this share of the baseline pair's comparable filers, the current pair is flagged as partial. */
export const PARTIAL_COVERAGE_RATIO = 0.8;
/** Keep showing the filing-season strip this long after the deadline, while late filers and amendments land. */
export const FILING_SEASON_GRACE_DAYS = 30;

const DAY_MS = 86400000;

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

export interface FilingSeason {
    deadline: string | null;
    /** Whole days until the deadline (negative once it has passed); null without a deadline. */
    daysLeft: number | null;
    baselineQuarter: string | null;
    baselineComparableFilers: number | null;
    /** Comparable filers now as a share of the fully filed baseline (0-1, capped at 1). */
    ratio: number | null;
    partial: boolean;
    /** Show the filing-season strip: before the deadline, shortly after it, or while coverage is still partial. */
    active: boolean;
}

export function getFilingSeason(data: RadarApiResponse, today: string = todayIso()): FilingSeason {
    const progress = data.filingProgress;
    const deadline = progress?.deadline || null;
    const deadlineTime = deadline ? Date.parse(`${deadline}T00:00:00Z`) : Number.NaN;
    const daysLeft = Number.isNaN(deadlineTime) ? null : Math.round((deadlineTime - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
    const baseline = progress?.baselineComparableFilers ?? null;
    const comparable = data.coverage.comparableFilers || 0;
    const ratio = baseline && baseline > 0 ? Math.min(comparable / baseline, 1) : null;
    const partial = baseline !== null && baseline > 0 && comparable / baseline < PARTIAL_COVERAGE_RATIO;
    const active = daysLeft !== null && (daysLeft >= -FILING_SEASON_GRACE_DAYS || partial);
    return {
        deadline,
        daysLeft,
        baselineQuarter: progress?.baselineQuarter || null,
        baselineComparableFilers: baseline,
        ratio,
        partial,
        active,
    };
}

/** "5 days to the Nov 16, 2026 deadline" and its variants. */
export function deadlineSentence(season: FilingSeason, formatDay: (iso: string) => string): string | null {
    if (!season.deadline || season.daysLeft === null) return null;
    const day = formatDay(season.deadline);
    if (season.daysLeft > 0) return `${plural(season.daysLeft, 'day')} to the ${day} deadline`;
    if (season.daysLeft === 0) return `Filings are due today, ${day}`;
    return `The ${day} deadline has passed; late filings and amendments are still arriving`;
}

export function findTopSectorMover(movers: SectorMovementSummary[] | undefined, direction: 'buy' | 'sell'): SectorMovementSummary | null {
    return [...(movers || [])]
        // "Other" is the sector classifier's catch-all, not a sector a reader can report on.
        .filter((summary) => summary.sector !== 'Other' && (direction === 'buy' ? summary.buyers > 0 : summary.sellers > 0))
        .sort((a, b) => {
            const primary = direction === 'buy' ? b.buyers - a.buyers : b.sellers - a.sellers;
            if (primary !== 0) return primary;
            return Math.abs(b.netBuyers) - Math.abs(a.netBuyers);
        })[0] || null;
}

interface Shift {
    name: string;
    buyers: number;
    sellers: number;
}

/**
 * The watchlist category (or, failing that, the sector) with the largest gap between buying and selling funds.
 * Categories come first because they are the cards shown right under the takeaway, so the sentence's numbers always
 * match a card. Sector counts are computed differently and can share a name ("Energy") while disagreeing with it.
 */
export function findBiggestShift(data: RadarApiResponse): Shift | null {
    const rank = (a: Shift, b: Shift) =>
        Math.abs(b.buyers - b.sellers) - Math.abs(a.buyers - a.sellers) || b.buyers + b.sellers - (a.buyers + a.sellers);

    const categories: Shift[] = (data.categorySummaries || [])
        .filter((c: CategorySummary) => c.label && (c.buyers > 0 || c.sellers > 0))
        .map((c) => ({ name: c.label, buyers: c.buyers, sellers: c.sellers }));
    if (categories.length > 0) return categories.sort(rank)[0];

    const sectors: Shift[] = (data.sectorMovers || [])
        // "Other" is the classifier's catch-all, not a sector a reader can act on.
        .filter((s) => s.sector && s.sector !== 'Other' && (s.buyers > 0 || s.sellers > 0))
        .map((s) => ({ name: s.sector, buyers: s.buyers, sellers: s.sellers }));
    return sectors.length > 0 ? sectors.sort(rank)[0] : null;
}

/**
 * The plain-English headline for the radar, built only from the loaded numbers.
 *
 *   In season: "1,284 funds have filed for both Q3 2026 and Q2 2026 so far, about 15% of a fully filed quarter.
 *               Biggest shift: Technology, with 212 funds buying and 95 selling."
 *   Settled:   "Across 6,912 funds that filed in both Q2 2026 and Q1 2026, the biggest shift was in Technology:
 *               1,020 funds bought and 640 sold."
 */
export function buildRadarTakeaway(data: RadarApiResponse, season: FilingSeason): string {
    const current = formatQuarterLabel(data.coverage.currentQuarter || '') || 'this quarter';
    const previous = formatQuarterLabel(data.coverage.previousQuarter || '') || 'last quarter';
    const comparable = data.coverage.comparableFilers || 0;
    const shift = findBiggestShift(data);
    const inSeason = season.partial || (season.daysLeft !== null && season.daysLeft >= 0);

    if (comparable === 0) {
        return `No funds have filed for both ${current} and ${previous} yet. Pick an earlier quarter to see a full comparison.`;
    }

    const funds = plural(comparable, 'fund');

    if (inSeason) {
        const hasHave = comparable === 1 ? 'has' : 'have';
        const pct = season.ratio !== null ? Math.round(season.ratio * 100) : null;
        const progress = pct !== null
            ? `${funds} ${hasHave} filed for both ${current} and ${previous} so far, about ${pct}% of a fully filed quarter.`
            : `${funds} ${hasHave} filed for both ${current} and ${previous} so far.`;
        if (!shift) return `${progress} None of them changed their holdings in the selected categories.`;
        return `${progress} Biggest shift: ${shift.name}, with ${formatNumber(shift.buyers)} ${shift.buyers === 1 ? 'fund' : 'funds'} buying and ${formatNumber(shift.sellers)} selling.`;
    }

    if (!shift) {
        return `${funds} filed in both ${current} and ${previous}. None of them changed their holdings in the selected categories.`;
    }
    return `Across ${funds} that filed in both ${current} and ${previous}, the biggest shift was in ${shift.name}: ${formatNumber(shift.buyers)} ${shift.buyers === 1 ? 'fund' : 'funds'} bought and ${formatNumber(shift.sellers)} sold.`;
}
