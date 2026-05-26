import { NextResponse } from 'next/server';
import { runSpaceXExposureRadar, type SpaceXExposureRequestBody } from '@/lib/spacex-exposure-radar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        const body = await readBody(req);
        const result = await runSpaceXExposureRadar(body);
        return NextResponse.json(result);
    } catch (error) {
        console.error('[SpaceX Exposure Radar] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}

async function readBody(req: Request): Promise<SpaceXExposureRequestBody> {
    try {
        return await req.json() as SpaceXExposureRequestBody;
    } catch {
        return {};
    }
}
