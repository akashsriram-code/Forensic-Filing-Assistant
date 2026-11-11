"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { EntityProfile, RecentFiling } from '@/lib/entity';
import { formatDate } from '@/lib/format';
import { FilingActions, FilingSummary, type FilingResult } from '../Downloader';
import { Chip, Panel, Table, TableFooter, Td, Th, THead, buttonClass, rowClass } from '../ui';

type Group = 'all' | 'reports' | 'events' | 'insiders' | 'ownership' | 'other';

const GROUPS: { id: Group; label: string; match: (form: string) => boolean }[] = [
    { id: 'all', label: 'All', match: () => true },
    { id: 'reports', label: 'Annual and quarterly reports', match: (f) => /^(10-K|10-Q|20-F|40-F|6-K)(\/A)?$/.test(f) },
    { id: 'events', label: 'Major events (8-K)', match: (f) => /^8-K(\/A)?$/.test(f) },
    { id: 'insiders', label: 'Insider trades', match: (f) => /^(3|4|5)(\/A)?$/.test(f) },
    { id: 'ownership', label: 'Ownership stakes', match: (f) => /13D|13G|^13F/.test(f) },
    { id: 'other', label: 'Other', match: (f) => !/^(10-K|10-Q|20-F|40-F|6-K|8-K|3|4|5)(\/A)?$/.test(f) && !/13D|13G|^13F/.test(f) },
];

/** Plain-English names for common forms, used when EDGAR's description is missing, a file path or just the form name. */
const FORM_NAMES: Record<string, string> = {
    '10-K': 'Annual report',
    '10-Q': 'Quarterly report',
    '8-K': 'Major event report',
    '20-F': 'Annual report (foreign company)',
    '6-K': 'Report by a foreign company',
    '3': 'Insider’s first report of holdings',
    '4': 'Insider trade report',
    '5': 'Insider’s annual report of trades',
    '144': 'Notice of a planned sale of restricted stock',
    'DEF 14A': 'Proxy statement',
    'DEFA14A': 'Additional proxy material',
    'S-8': 'Registration of shares for employee plans',
    'SC 13G': 'Passive stake over 5%',
    'SC 13G/A': 'Passive stake over 5% (amended)',
    'SCHEDULE 13G': 'Passive stake over 5%',
    'SCHEDULE 13G/A': 'Passive stake over 5% (amended)',
    'SC 13D': 'Activist stake over 5%',
    'SC 13D/A': 'Activist stake over 5% (amended)',
    'SCHEDULE 13D': 'Activist stake over 5%',
    'SCHEDULE 13D/A': 'Activist stake over 5% (amended)',
    '13F-HR': 'Quarterly holdings report (13F)',
    '13F-HR/A': 'Quarterly holdings report (13F, amended)',
    'SD': 'Specialized disclosure (conflict minerals)',
    'CORRESP': 'Letter to the SEC',
    'UPLOAD': 'Letter from the SEC',
};

function describeFiling(filing: RecentFiling): string {
    const raw = (filing.description || '').trim();
    const isPath = /[/\\]|\.(x?html?|xml|txt)$/i.test(raw);
    const isJustForm = raw.replace(/^form\s+/i, '').toUpperCase() === filing.form.toUpperCase();
    if (raw && !isPath && !isJustForm) return raw;
    const base = filing.form.replace(/\/A$/, '');
    const name = FORM_NAMES[filing.form] ?? (FORM_NAMES[base] ? `${FORM_NAMES[base]} (amended)` : null);
    return name ?? (raw && !isPath ? raw : `Form ${filing.form}`);
}

/** Adapts an /api/entity filing to the Downloader's row components, so rows look and act the same everywhere. */
function toFilingResult(filing: RecentFiling, profile: EntityProfile): FilingResult {
    return {
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        form: filing.form,
        size: filing.size,
        primaryDocument: filing.primaryDocument,
        description: describeFiling(filing),
        downloadUrl: filing.url,
        companyQuery: profile.name,
        companyName: profile.name,
        companyTicker: profile.tickers[0] || '',
        companyCik: profile.cik,
        matchedKeywords: [],
        matchCount: 0,
        matchSnippets: [],
    };
}

/** The entity's newest filings with Read, Compare, Copy citation and Download, filterable by kind of filing. */
export function RecentFilings({ profile }: { profile: EntityProfile }) {
    const [group, setGroup] = useState<Group>('all');
    const [limit, setLimit] = useState(12);
    const rows = useMemo(() => profile.recentFilings.map((filing) => toFilingResult(filing, profile)), [profile]);
    const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, rows.filter((row) => g.match(row.form)).length])) as Record<Group, number>, [rows]);
    const visibleAll = rows.filter((row) => GROUPS.find((g) => g.id === group)!.match(row.form));
    const visible = visibleAll.slice(0, limit);
    const searchHref = `/?tab=downloader&companies=${encodeURIComponent(profile.tickers[0] || String(Number(profile.cik)))}`;

    // "Compare with previous" needs the previous filing of the same form, which may be outside the current filter.
    const previousOf = (row: FilingResult) => {
        const index = rows.indexOf(row);
        return rows.slice(index + 1).find((other) => other.form === row.form);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter filings by kind">
                    {GROUPS.filter((g) => g.id === 'all' || counts[g.id] > 0).map((g) => (
                        <Chip key={g.id} selected={group === g.id} count={counts[g.id]} onClick={() => { setGroup(g.id); setLimit(12); }}>
                            {g.label}
                        </Chip>
                    ))}
                </div>
                <Link href={searchHref} className={buttonClass('secondary', 'sm')}>
                    Search all filings
                </Link>
            </div>
            <Panel>
                <Table caption={`Recent filings by ${profile.name}`}>
                    <THead>
                        <tr>
                            <Th>Filed</Th>
                            <Th>Filing</Th>
                            <Th className="text-right">Actions</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {visible.map((row) => (
                            <tr key={row.accessionNumber} className={rowClass}>
                                <Td className="tabular whitespace-nowrap">{formatDate(row.filingDate)}</Td>
                                <Td className="min-w-64"><FilingSummary item={row} keywords={[]} /></Td>
                                <Td><FilingActions item={row} previous={previousOf(row)} /></Td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
                <TableFooter
                    shown={visible.length}
                    total={visibleAll.length}
                    noun="filings"
                    onShowMore={() => setLimit((value) => value + 12)}
                    note={profile.recentFilings.length >= 40 ? 'The newest 40 filings; use Search all filings for older ones' : undefined}
                />
            </Panel>
        </div>
    );
}
