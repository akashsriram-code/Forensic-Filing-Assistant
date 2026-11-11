import { NextRequest, NextResponse } from 'next/server';
import { buildEntityProfile, normalizeEntityId } from '@/lib/entity';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { fetchCIK, fetchSubmission } from '@/lib/sec-client';
import { SEC_USER_AGENT } from '@/lib/sec-http';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Submissions are cached for an hour by fetchSubmission (revalidate 3600); let CDNs keep the GET response as long. */
const CACHE_SECONDS = 3600;
const PROBE_TIMEOUT_MS = 8000;

const SEC_UNAVAILABLE = 'SEC EDGAR did not respond. It may be busy or down - try again in a minute.';

type Outcome = { status: 200; body: ReturnType<typeof buildEntityProfile> } | { status: 400 | 404 | 502; body: { error: string } };

/**
 * Company or fund profile for /company/[id] and /fund/[cik]. `id` is a ticker (NVDA, BRK.A, BRK-A), a CIK (with or
 * without leading zeros) or a name. POST { id } or GET ?id=.
 */
export async function POST(req: NextRequest) {
    let body: unknown = null;
    try {
        body = await req.json();
    } catch {
        // Treated as a missing id below.
    }
    const id = body && typeof body === 'object' ? (body as Record<string, unknown>).id : undefined;
    return respond(await resolveEntity(id));
}

export async function GET(req: NextRequest) {
    return respond(await resolveEntity(req.nextUrl.searchParams.get('id')));
}

function respond(outcome: Outcome) {
    const headers: Record<string, string> =
        outcome.status === 200
            ? { 'Cache-Control': `public, max-age=300, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400` }
            : outcome.status === 404
              ? { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
              : { 'Cache-Control': 'no-store' };
    return NextResponse.json(outcome.body, { status: outcome.status, headers });
}

async function resolveEntity(rawId: unknown): Promise<Outcome> {
    const id = normalizeEntityId(rawId);
    if (!id) return { status: 400, body: { error: 'Enter a ticker, company name or CIK.' } };
    const display = typeof rawId === 'string' ? rawId.trim() : id;
    const notFound: Outcome = { status: 404, body: { error: `No SEC filer matches "${display}".` } };

    try {
        const cik = await fetchCIK(id);
        if (!cik) {
            // fetchCIK returns null both for "no match" and for EDGAR errors; tell them apart so a reporter isn't told
            // a real company doesn't exist when EDGAR is merely down.
            return (await secIsReachable('https://www.sec.gov/files/company_tickers.json', 86400))
                ? notFound
                : { status: 502, body: { error: SEC_UNAVAILABLE } };
        }

        const submission = await fetchSubmission(cik);
        if (!submission) {
            const status = await probeStatus(`https://data.sec.gov/submissions/CIK${cik}.json`);
            return status === 404 ? notFound : { status: 502, body: { error: SEC_UNAVAILABLE } };
        }

        return { status: 200, body: buildEntityProfile(submission) };
    } catch (error) {
        console.error('[Entity] Error resolving', id, error);
        return { status: 502, body: { error: SEC_UNAVAILABLE } };
    }
}

async function probeStatus(url: string, revalidate?: number): Promise<number | null> {
    try {
        const response = await fetchWithTimeout(
            url,
            { headers: { 'User-Agent': SEC_USER_AGENT }, ...(revalidate ? { next: { revalidate } } : { cache: 'no-store' as const }) },
            PROBE_TIMEOUT_MS
        );
        return response.status;
    } catch {
        return null;
    }
}

async function secIsReachable(url: string, revalidate: number): Promise<boolean> {
    const status = await probeStatus(url, revalidate);
    return status !== null && status >= 200 && status < 300;
}
