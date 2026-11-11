"use client";

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { EntitySearch } from './EntitySearch';
import { FollowingMenu } from './FollowingMenu';
import { Guide } from './Guide';
import { NotificationManager } from './NotificationManager';
import { ThemeMenu } from './ThemeMenu';

/**
 * Shared header for every page: brand and utilities on the first row, then either the main tabs or a back link.
 * Publishes its height as --sticky-offset so table headers stick just below it. Also runs the filing-alert checker,
 * so alerts keep working on the Reader and Diff pages.
 */
export function AppHeader({ tabs, back }: { tabs?: ReactNode; back?: { href: string; label: string } }) {
    const ref = useRef<HTMLElement>(null);

    useEffect(() => {
        const header = ref.current;
        if (!header) return;
        const update = () => document.documentElement.style.setProperty('--sticky-offset', `${header.offsetHeight}px`);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(header);
        return () => observer.disconnect();
    }, []);

    return (
        <header ref={ref} className="sticky top-0 z-30 border-b border-rule bg-surface print:hidden">
            <NotificationManager />
            <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-8">
                <Link href="/" className="flex min-w-0 items-center gap-3 rounded-md">
                    <BrandMark className="h-8 w-8 shrink-0" />
                    <span className="min-w-0" title="SCOUT: SEC Company & Ownership Update Tracker">
                        <span className="block truncate font-serif text-lg font-semibold leading-tight tracking-wide text-ink">SCOUT</span>
                        {/* The full name only fits beside the search box on wide screens. */}
                        <span className="hidden text-xs text-ink-muted sm:block xl:hidden">by Akash Sriram</span>
                        <span className="hidden text-xs text-ink-muted xl:block">SEC Company &amp; Ownership Update Tracker, by Akash Sriram</span>
                    </span>
                </Link>
                <EntitySearch />
                <div className="flex shrink-0 items-center gap-1">
                    <FollowingMenu />
                    <Guide />
                    <ThemeMenu />
                </div>
            </div>
            {(tabs || back) && (
                <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
                    {tabs}
                    {back && (
                        <Link href={back.href} className="inline-flex h-11 items-center gap-2 text-base font-medium text-accent hover:underline">
                            <ArrowLeft className="h-4 w-4" aria-hidden />
                            {back.label}
                        </Link>
                    )}
                </div>
            )}
        </header>
    );
}
