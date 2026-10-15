import { NextResponse } from 'next/server';
import {
    RadarDataError,
    loadCategoryHolders,
    readAppStoreMeta,
    readRadarRequestBody,
    resolveRadarRequest,
} from '@/lib/thirteen-f-radar-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** All current holders for one radar category, loaded when the category panel opens. */
export async function POST(req: Request) {
    try {
        const body = await readRadarRequestBody(req);
        const category = typeof body.category === 'string' ? body.category : '';
        // Archived pairs are served from git, so a DB outage only affects the live pair.
        const meta = await readAppStoreMeta().catch((error) => {
            console.error('[13F Radar Holders] Store unavailable:', error);
            return null;
        });
        const request = await resolveRadarRequest(body, meta);
        const holders = await loadCategoryHolders(request, meta, category);
        return NextResponse.json({ category, currentQuarter: request.currentQuarter, previousQuarter: request.previousQuarter, holders });
    } catch (error) {
        console.error('[13F Radar Holders] Error:', error);
        const status = error instanceof RadarDataError ? error.status : 500;
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status }
        );
    }
}
