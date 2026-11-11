/**
 * The app's mark: a filing page with one highlighted passage. Same artwork as app/icon.svg (the favicon); keep the two
 * in sync. Fixed brand colors, so it reads the same in light and dark themes.
 */
export function BrandMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
            <rect width="32" height="32" rx="7" fill="#2347B5" />
            <path d="M10 4h8l6 6v16a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#FFFFFF" />
            <path d="M18 4v4a2 2 0 0 0 2 2h4z" fill="#BFCBF2" />
            <rect x="10" y="12" width="12" height="2" fill="#2347B5" />
            <rect x="10" y="16" width="12" height="4" rx="1" fill="#E7B85C" />
            <rect x="10" y="22" width="6" height="2" fill="#2347B5" />
        </svg>
    );
}
