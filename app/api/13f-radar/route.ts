import { NextResponse } from 'next/server';
import {
    RadarDataError,
    buildEventLens,
    buildRadarNotes,
    createRadarClientFromEnv,
    loadRadarComparison,
    readRadarRequestBody,
    resolveRadarRequest,
} from '@/lib/thirteen-f-radar-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const body = await readRadarRequestBody(req);
        const turso = createRadarClientFromEnv();
        const request = await resolveRadarRequest(turso, body);
        const { comparison: mainComparison } = await loadRadarComparison(turso, request);
        const eventLens = await buildEventLens({ turso, request, mainComparison });

        return NextResponse.json({
            ...mainComparison,
            securityMovements: mainComparison.securityMovements.slice(0, 100),
            initiations: mainComparison.initiations.slice(0, 50),
            liquidations: mainComparison.liquidations.slice(0, 50),
            topFilerMoves: mainComparison.topFilerMoves.slice(0, 100),
            availableQuarters: request.availableQuarters,
            watchlists: request.watchlists,
            eventLens,
            notes: buildRadarNotes(request.dbShape),
        });
    } catch (error) {
        console.error('[13F Radar] Error:', error);
        const status = error instanceof RadarDataError ? error.status : 500;
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status }
        );
    }
}
