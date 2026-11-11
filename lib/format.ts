/**
 * Display formatters shared by every screen. Pure functions, safe on server and client.
 *
 * Money helpers always take DOLLARS. 13F values can arrive in thousands (pre-2023 filings) or dollars depending on the
 * source; convert at the call site, where the API's unit is known, and leave a comment saying which unit it returns.
 */

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const MINUS = '−'; // typographic minus, same width as "+" in tabular figures

function safe(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 1234567 -> "1,234,567" */
export function formatNumber(value: number | null | undefined): string {
    return integerFormat.format(safe(value));
}

/** 1234567 -> "1.2M" */
export function formatCompact(value: number | null | undefined): string {
    return compactFormat.format(safe(value));
}

/** Share counts: full integers below 100k, compact above, so table columns stay narrow. */
export function formatShares(value: number | null | undefined): string {
    const v = safe(value);
    return Math.abs(v) < 100_000 ? formatNumber(v) : formatCompact(v);
}

/** Dollars -> "$1.2B". */
export function formatMoney(dollars: number | null | undefined): string {
    const v = safe(dollars);
    return `${v < 0 ? MINUS : ''}$${compactFormat.format(Math.abs(v))}`;
}

/** 12.345 -> "12.3%" (value is already a percentage, not a fraction). */
export function formatPct(value: number | null | undefined, digits = 1): string {
    return `${safe(value).toFixed(digits)}%`;
}

/** "1,204 (14.2%)" */
export function formatCountPct(count: number, pct: number): string {
    return `${formatNumber(count)} (${formatPct(pct)})`;
}

/** +1,204 / −88 / 0 */
export function formatSignedNumber(value: number | null | undefined): string {
    const v = safe(value);
    if (v === 0) return '0';
    return `${v > 0 ? '+' : MINUS}${formatNumber(Math.abs(v))}`;
}

/** +$1.2B / −$40M */
export function formatSignedMoney(dollars: number | null | undefined): string {
    const v = safe(dollars);
    if (v === 0) return '$0';
    return `${v > 0 ? '+' : MINUS}$${compactFormat.format(Math.abs(v))}`;
}

/** +12.3% / −4.0% */
export function formatSignedPct(value: number | null | undefined, digits = 1): string {
    const v = safe(value);
    if (v === 0) return `0${digits > 0 ? '.' + '0'.repeat(digits) : ''}%`;
    return `${v > 0 ? '+' : MINUS}${Math.abs(v).toFixed(digits)}%`;
}

/** "2026-11-16" -> "Nov 16, 2026". Date-only strings are read as UTC so they never shift a day. */
export function formatDate(value: string | null | undefined): string {
    if (!value) return '';
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "2026-11-16" -> "Nov 16" */
export function formatShortDate(value: string | null | undefined): string {
    if (!value) return '';
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "5 minutes ago", "just now", "Nov 3" for older. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
    const seconds = Math.round((now - timestamp) / 1000);
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return formatShortDate(new Date(timestamp).toISOString().slice(0, 10));
}

/** "1 filing" / "3 filings" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

/** ["NVDA", "AAPL", "MSFT"] -> "NVDA, AAPL and MSFT" */
export function joinList(items: string[], max = 3): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length > max) return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
