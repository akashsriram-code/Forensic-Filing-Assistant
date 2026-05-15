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
export const maxDuration = 300;

const DEFAULT_MAX_FILER_SECURITY_AUDIT_ROWS = 1000;
const DEFAULT_MAX_TOP_FILER_MOVE_DETAIL_ROWS = 1000;

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
            includeRawHoldings: false,
        });
        const workbook = buildRadarAuditWorkbook({
            request,
            comparison,
            audit,
            notes: buildRadarNotes(request.dbShape),
            generatedAt: new Date(),
            maxFilerSecurityAuditRows: resolveExportRowLimit(
                'THIRTEEN_F_RADAR_EXPORT_AUDIT_ROW_LIMIT',
                DEFAULT_MAX_FILER_SECURITY_AUDIT_ROWS
            ),
            maxTopFilerMoveDetailRows: resolveExportRowLimit(
                'THIRTEEN_F_RADAR_EXPORT_TOP_MOVE_ROW_LIMIT',
                DEFAULT_MAX_TOP_FILER_MOVE_DETAIL_ROWS
            ),
            includeRawHoldings: false,
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

function resolveExportRowLimit(envName: string, fallback: number): number {
    const configured = Number.parseInt(process.env[envName] || '', 10);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : fallback;
}
