import { NextResponse } from 'next/server';
import { buildRadarAudit } from '@/lib/thirteen-f-radar-core';
import {
    RadarDataError,
    buildRadarNotes,
    createRadarClientFromEnv,
    isRadarCacheOnlyEnabled,
    loadRadarComparison,
    loadRadarComparisonFromCache,
    readRadarRequestBody,
    resolveRadarRequest,
    resolveRadarRequestFromCache,
} from '@/lib/thirteen-f-radar-data';
import { buildRadarAuditWorkbook, buildRadarExportFilename } from '@/lib/thirteen-f-radar-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const body = await readRadarRequestBody(req);
        const cacheOnly = isRadarCacheOnlyEnabled();
        const db = cacheOnly ? null : createRadarClientFromEnv();
        const request = cacheOnly
            ? await resolveRadarRequestFromCache(body)
            : await resolveRadarRequest(db!, body);
        const loaded = cacheOnly
            ? await loadRadarComparisonFromCache(request)
            : await loadRadarComparison(db!, request);
        const { comparison, filings, holdings } = loaded;
        const audit = buildRadarAudit({
            currentQuarter: request.currentQuarter,
            previousQuarter: request.previousQuarter,
            filings,
            holdings,
            watchlists: request.watchlists,
            selectedCategories: request.selectedCategories,
        });
        const workbook = buildRadarAuditWorkbook({
            request,
            comparison,
            audit,
            notes: buildRadarNotes(request.dbShape),
            generatedAt: new Date(),
        });
        const filename = buildRadarExportFilename(request.currentQuarter, request.previousQuarter);
        const responseBody = new Uint8Array(workbook);

        return new Response(responseBody, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[13F Radar Export] Error:', error);
        const status = error instanceof RadarDataError ? error.status : 500;
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status }
        );
    }
}
