"use client";

import { Suspense, useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppHeader } from './components/AppHeader';
import { Downloader } from './components/Downloader';
import { ThirteenFRadar } from './components/ThirteenFRadar';
import { WhaleTracker } from './components/WhaleTracker';
import { Tabs, tabPanelProps } from './components/ui';

type TabId = 'radar' | 'whale' | 'downloader';

const TABS: { id: TabId; label: string }[] = [
  { id: 'radar', label: '13F Radar' },
  { id: 'whale', label: 'Whale Tracker' },
  { id: 'downloader', label: 'Downloader' },
];

const DEFAULT_TAB: TabId = 'radar';

function isTab(value: string | null): value is TabId {
  return value === 'radar' || value === 'whale' || value === 'downloader';
}

function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const param = searchParams.get('tab');
  const activeTab: TabId = isTab(param) ? param : DEFAULT_TAB;

  // Mount each tab the first time it's opened, then keep it mounted so switching tabs keeps its results.
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([activeTab]));
  if (!visited.has(activeTab)) setVisited(new Set(visited).add(activeTab));

  const selectTab = useCallback(
    (id: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id === DEFAULT_TAB) params.delete('tab');
      else params.set('tab', id);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader tabs={<Tabs items={TABS} value={activeTab} onChange={selectTab} label="Sections" idPrefix="main" />} />
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        {TABS.map((tab) =>
          visited.has(tab.id) ? (
            <div key={tab.id} {...tabPanelProps('main', tab.id)} hidden={tab.id !== activeTab} className="outline-none">
              {tab.id === 'radar' && <ThirteenFRadar />}
              {tab.id === 'whale' && <WhaleTracker />}
              {tab.id === 'downloader' && <Downloader />}
            </div>
          ) : null
        )}
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <Home />
    </Suspense>
  );
}
