"use client";

import { useState, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import { GLOSSARY, GUIDE_GLOSSARY } from '@/lib/glossary';
import { Dialog } from './ui';

function GuideSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <h3 className="text-lg font-semibold text-ink">{title}</h3>
            <div className="space-y-2 text-base text-ink-muted [&_strong]:font-semibold [&_strong]:text-ink">{children}</div>
        </section>
    );
}

/** "Guide" button in the header and the dialog it opens: what each tab is for, plus a glossary. */
export function Guide() {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-base font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
                <BookOpen className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Guide</span>
                <span className="sr-only sm:hidden">Guide</span>
            </button>

            <Dialog
                open={open}
                onClose={() => setOpen(false)}
                title="How to use the SEC Filings Assistant"
                description="What each tab is for, and what the terms mean."
                size="lg"
            >
                <div className="space-y-8">
                    <GuideSection title="13F Radar">
                        <p>
                            See what big investment funds bought and sold last quarter. Funds that manage more than $100M in US stocks file a
                            {' '}<strong>13F</strong> every quarter, listing what they held on the last day of the quarter.
                        </p>
                        <p>
                            Pick two quarters to compare. The radar only counts funds that have filed for both, so a fund that hasn&apos;t filed
                            yet never looks like a seller. During filing season the top of the page shows how many funds are in so far and when
                            the deadline is.
                        </p>
                        <p>
                            <strong>Funds to watch</strong> follows a list of well-known funds as their filings arrive. Use
                            {' '}<strong>Export audit workbook</strong> for a spreadsheet with every number and its source.
                        </p>
                    </GuideSection>

                    <GuideSection title="Whale Tracker">
                        <p><strong>Fund holdings</strong>: everything one fund reported, and what changed since its last filing.</p>
                        <p><strong>Compare funds</strong>: two funds side by side, and the stocks they both own.</p>
                        <p><strong>Who owns a stock</strong>: every fund that reported a stock, and who added or cut.</p>
                        <p><strong>Activist stakes</strong>: Schedule 13D filings, made when an investor buys more than 5% of a company and may push for change.</p>
                        <p>Choose a holding to see how the fund&apos;s position changed over past filings.</p>
                    </GuideSection>

                    <GuideSection title="Downloader">
                        <p>
                            Search SEC filings for one or more companies at once. Enter tickers, company names or fund names, then narrow by
                            form type and date. Add keywords to search the full text of each filing; results show the matching passages.
                        </p>
                        <p>
                            <strong>Read</strong> opens a clean, printable view. <strong>Compare with previous</strong> (10-K and 10-Q only)
                            shows word-level changes against the company&apos;s previous filing of the same type, focused on risk factors and
                            MD&amp;A. <strong>Download all</strong> saves every result as one ZIP file.
                        </p>
                    </GuideSection>

                    <GuideSection title="Filing alerts">
                        <p>
                            Choose <strong>Follow</strong> next to a company to get a browser notification when it files. The app checks every
                            5 minutes, and only while it is open in a browser tab, so keep a tab open or pinned. Manage everything you follow
                            from <strong>Following</strong> in the header.
                        </p>
                    </GuideSection>

                    <GuideSection title="Light and dark">
                        <p>Use the theme button in the header to match your system, or always use light or dark. Your choice is remembered on this device.</p>
                    </GuideSection>

                    <section>
                        <h3 className="text-lg font-semibold text-ink">Glossary</h3>
                        <dl className="mt-3 divide-y divide-rule border-y border-rule">
                            {GUIDE_GLOSSARY.map((key) => (
                                <div key={key} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
                                    <dt className="font-semibold text-ink">{GLOSSARY[key].term}</dt>
                                    <dd className="text-base text-ink-muted">{GLOSSARY[key].definition}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                </div>
            </Dialog>
        </>
    );
}
