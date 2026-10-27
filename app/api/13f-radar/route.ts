import { NextResponse } from 'next/server';
import {
    RadarDataError,
    buildFilingProgress,
    loadPrecomputedRadarResponse,
    loadRadarComparisonFromStore,
    readAppStoreMeta,
    readRadarRequestBody,
    resolveRadarRequest,
    toRadarApiResponse,
} from '@/lib/thirteen-f-radar-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const body = await readRadarRequestBody(req);
        const meta = await readAppStoreMeta().catch((error) => {
            // The default view can still be served from precomputed files while the DB is unreachable.
            console.error('[13F Radar] Store unavailable:', error);
            return null;
        });
        const request = await resolveRadarRequest(body, meta);
        const filingProgress = await buildFilingProgress(request);

        const precomputed = await loadPrecomputedRadarResponse(request);
        if (precomputed) return NextResponse.json({ ...precomputed, filingProgress });

        if (!meta) {
            throw new RadarDataError('The 13F database is unavailable, and only the built-in watchlists are precomputed. Try again shortly.', 503);
        }
        const { comparison } = await loadRadarComparisonFromStore(request, meta);
        return NextResponse.json({ ...toRadarApiResponse(comparison, request), filingProgress });
    } catch (error) {
        console.error('[13F Radar] Error:', error);
        const status = error instanceof RadarDataError ? error.status : 500;
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status }
        );
    }
}
