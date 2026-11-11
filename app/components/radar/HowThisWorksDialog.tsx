"use client";

import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';
import { Dialog } from '../ui';

/** Terms, in reading order. The audit workbook's Read me sheet carries the same definitions. */
const TERMS: GlossaryKey[] = [
    'quarterEndHoldings',
    'filingDeadline',
    'comparableFilers',
    'watchedFilers',
    'exposedFilers',
    'buyersSellers',
    'newPosition',
    'soldOut',
    'currentHolders',
    'netBuyers',
    'sectorMovers',
    'rawValue',
    'estimatedValue',
    'concentration',
    'filerType',
    'privateCredit',
];

export function HowThisWorksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    return (
        <Dialog open={open} onClose={onClose} size="lg" title="How the 13F Radar works">
            <div className="space-y-6">
                <div className="max-w-2xl space-y-3 text-base text-ink">
                    <p>
                        Investment managers with more than $100M in US stocks file a 13F report each quarter listing what they held on the last day
                        of the quarter. The radar lines up two quarters of these filings for the same funds and counts how many bought or sold the
                        stocks on your watchlists.
                    </p>
                    <p className="text-ink-muted">
                        Only funds that have filed for both quarters are compared, so early in a filing season the counts are partial and will
                        change. These definitions are also in the Read me sheet of the audit workbook.
                    </p>
                </div>
                <dl className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                    {TERMS.map((key) => (
                        <div key={key}>
                            <dt className="font-semibold text-ink">{GLOSSARY[key].term}</dt>
                            <dd className="mt-1 text-base text-ink-muted">{GLOSSARY[key].definition}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </Dialog>
    );
}
