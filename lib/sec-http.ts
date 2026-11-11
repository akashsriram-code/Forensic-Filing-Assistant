/**
 * Shared settings for every request this app makes to the SEC.
 *
 * SEC fair-access rules ask automated clients to identify themselves with a real contact in the User-Agent, e.g.
 * "SCOUT newsroom@example.org". Set SEC_USER_AGENT in the environment (Vercel project settings and the
 * GitHub Actions secret of the same name); the fallback below is only for local development.
 */
const FALLBACK_USER_AGENT = 'SCOUT contact@example.com';

/** Read at call time, for scripts that set SEC_USER_AGENT from a command-line flag after modules load. */
export function secUserAgent(): string {
    return process.env.SEC_USER_AGENT || FALLBACK_USER_AGENT;
}

export const SEC_USER_AGENT = secUserAgent();

/** Hosts the app is allowed to fetch on a caller's behalf. Anything else is refused, so our routes can't be used as an open proxy. */
const SEC_HOSTS = new Set(['www.sec.gov', 'sec.gov', 'data.sec.gov', 'efts.sec.gov']);

/** True for an https URL on an SEC host. */
export function isSecUrl(value: string | null | undefined): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && SEC_HOSTS.has(url.hostname.toLowerCase()) && !url.username && !url.password;
    } catch {
        return false;
    }
}

/** Safe `filename="..."` value for Content-Disposition: keeps letters, digits, dot, dash and underscore only. */
export function safeDownloadName(value: string | null | undefined, fallback = 'filing.htm'): string {
    const cleaned = (value || '').split(/[\\/]/).pop()?.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 150) || '';
    return cleaned || fallback;
}
