import type { RadarApiResponse, RadarWatchlist } from '@/lib/thirteen-f-radar-core';

// Default views are precomputed; custom watchlists hit the database, so allow longer before giving up.
export const RADAR_REQUEST_TIMEOUT_MS = 45000;

/** Body sent to /api/13f-radar, /holders and /export. Empty quarters mean "let the server pick". */
export interface RadarPayload {
    currentQuarter?: string;
    previousQuarter?: string;
    categories: string[];
    watchlists: RadarWatchlist[];
    movementBasis: 'filer-count';
}

export const buildWatchlistText = (watchlists: RadarWatchlist[]): Record<string, string> =>
    Object.fromEntries(watchlists.map((watchlist) => [watchlist.key, watchlist.items.map((item) => item.ticker).join(', ')]));

export const parseEditorList = (value: string): string[] =>
    value
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);

function serverMessage(parsed: unknown, text: string, status: number): string {
    if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error;
    }
    return text.trim().slice(0, 220) || `The server responded with HTTP ${status}.`;
}

export async function parseRadarResponse(res: Response): Promise<RadarApiResponse> {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let parsed: unknown = null;

    if (contentType.includes('application/json') || text.trim().startsWith('{')) {
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error(`The server sent back data we couldn't read (HTTP ${res.status}).`);
        }
    }

    if (!res.ok) throw new Error(serverMessage(parsed, text, res.status));

    if (!parsed) {
        const preview = text.trim().slice(0, 220);
        throw new Error(`The server sent back an unexpected response${preview ? `: ${preview}` : '.'}`);
    }

    return parsed as RadarApiResponse;
}

export async function parseRadarErrorResponse(res: Response): Promise<string> {
    const text = await res.text();
    if (text.trim().startsWith('{')) {
        try {
            return serverMessage(JSON.parse(text), text, res.status);
        } catch {
            return `The server sent back an error we couldn't read (HTTP ${res.status}).`;
        }
    }
    return text.trim().slice(0, 220) || `The server responded with HTTP ${res.status}.`;
}

export function getDownloadFilename(res: Response, fallback: string): string {
    const contentDisposition = res.headers.get('content-disposition') || '';
    const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    return filenameMatch?.[1] || fallback;
}

/** Save a blob through a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? err.message : fallback;
}
