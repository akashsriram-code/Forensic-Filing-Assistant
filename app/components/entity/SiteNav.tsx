import Link from 'next/link';

const LINKS = [
    { href: '/', label: '13F Radar' },
    { href: '/?tab=whale', label: 'Whale Tracker' },
    { href: '/?tab=downloader', label: 'Downloader' },
];

/** The main sections as links, for pages outside the tabbed home page (company and fund pages). */
export function SiteNav() {
    return (
        <nav aria-label="Sections" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {LINKS.map((link) => (
                <Link
                    key={link.href}
                    href={link.href}
                    className="inline-flex h-11 shrink-0 items-center whitespace-nowrap border-b-2 border-transparent px-3 text-base font-medium text-ink-muted transition-colors hover:text-ink"
                >
                    {link.label}
                </Link>
            ))}
        </nav>
    );
}
