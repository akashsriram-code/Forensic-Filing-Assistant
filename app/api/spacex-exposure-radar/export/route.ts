import { NextResponse } from 'next/server';
import { runSpaceXExposureRadar, type SpaceXExposureRequestBody } from '@/lib/spacex-exposure-radar';
import {
    buildSpaceXExposureExportFilename,
    buildSpaceXExposureWorkbook,
} from '@/lib/spacex-exposure-radar-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        const body = await readBody(req);
        const result = await runSpaceXExposureRadar(body);
        const workbook = buildSpaceXExposureWorkbook(result);
        const filename = buildSpaceXExposureExportFilename(result.startDate, result.endDate);

        return new Response(new Uint8Array(workbook), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[SpaceX Exposure Radar Export] Error:', error);
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
