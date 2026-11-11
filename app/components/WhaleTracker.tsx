"use client";

import { useState } from 'react';
import { Briefcase, Building2, GitCompare, Megaphone } from 'lucide-react';
import { Tabs, tabPanelProps, type TabItem } from './ui';
import { ActivistStakes } from './whale/ActivistStakes';
import { CompareFunds } from './whale/CompareFunds';
import { FundHoldings } from './whale/FundHoldings';
import { WhoOwns } from './whale/WhoOwns';

type Mode = 'fund' | 'compare' | 'owners' | 'activist';

const MODES: TabItem<Mode>[] = [
    { id: 'fund', label: 'Fund holdings', icon: <Briefcase className="h-4 w-4" aria-hidden /> },
    { id: 'compare', label: 'Compare funds', icon: <GitCompare className="h-4 w-4" aria-hidden /> },
    { id: 'owners', label: 'Who owns a stock', icon: <Building2 className="h-4 w-4" aria-hidden /> },
    { id: 'activist', label: 'Activist stakes', icon: <Megaphone className="h-4 w-4" aria-hidden /> },
];

const ID_PREFIX = 'whale';

/**
 * Whale Tracker: four ways into 13F and 13D filings. Every mode stays mounted (hidden when inactive), so each keeps
 * its own search, loading state, error and results when you switch tabs, and nothing is fetched until you search.
 */
export function WhaleTracker() {
    const [mode, setMode] = useState<Mode>('fund');

    return (
        <div className="space-y-8">
            <Tabs items={MODES} value={mode} onChange={setMode} label="Whale Tracker views" idPrefix={ID_PREFIX} variant="segmented" />
            <div {...tabPanelProps(ID_PREFIX, 'fund')} hidden={mode !== 'fund'}>
                <FundHoldings />
            </div>
            <div {...tabPanelProps(ID_PREFIX, 'compare')} hidden={mode !== 'compare'}>
                <CompareFunds />
            </div>
            <div {...tabPanelProps(ID_PREFIX, 'owners')} hidden={mode !== 'owners'}>
                <WhoOwns />
            </div>
            <div {...tabPanelProps(ID_PREFIX, 'activist')} hidden={mode !== 'activist'}>
                <ActivistStakes />
            </div>
        </div>
    );
}
