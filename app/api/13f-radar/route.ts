import { NextResponse } from 'next/server';
import {
    RadarDataError,
    buildRadarNotes,
    createRadarClientFromEnv,
    loadRadarComparison,
    readRadarRequestBody,
    resolveRadarRequest,
} from '@/lib/thirteen-f-radar-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        const body = await readRadarRequestBody(req);
        const db = createRadarClientFromEnv();
        const request = await resolveRadarRequest(db, body);
        const { comparison: mainComparison } = await loadRadarComparison(db, request);

        return NextResponse.json({
            ...mainComparison,
            securityMovements: mainComparison.securityMovements.slice(0, 100),
            initiations: mainComparison.initiations.slice(0, 50),
            liquidations: mainComparison.liquidations.slice(0, 50),
            topFilerMoves: mainComparison.topFilerMoves.slice(0, 100),
            availableQuarters: request.availableQuarters,
            watchlists: request.watchlists,
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
