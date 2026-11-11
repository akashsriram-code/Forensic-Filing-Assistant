import { NextRequest, NextResponse } from 'next/server';
import { SEC_USER_AGENT, isSecUrl, safeDownloadName } from '@/lib/sec-http';

/**
 * Fetches an SEC filing for the Reader and the Downloader. Only sec.gov URLs are allowed, both as requested and after
 * redirects, so this can't be used to fetch arbitrary sites through our server.
 */
export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const url = searchParams.get('url');
    const filename = safeDownloadName(searchParams.get('filename'));

    if (!url) {
        return NextResponse.json({ error: 'A filing URL is required.' }, { status: 400 });
    }
    if (!isSecUrl(url)) {
        return NextResponse.json({ error: 'Only filings on sec.gov can be opened.' }, { status: 400 });
    }

    try {
        const response = await fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT } });

        if (!isSecUrl(response.url)) {
            return NextResponse.json({ error: 'The SEC redirected to a site outside sec.gov.' }, { status: 502 });
        }
        if (!response.ok) {
            return NextResponse.json({ error: `The SEC returned an error (${response.status}).` }, { status: 502 });
        }

        const blob = await response.blob();
        const headers = new Headers();
        headers.set('Content-Disposition', `attachment; filename="${filename}"`);
        headers.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
        headers.set('X-Content-Type-Options', 'nosniff');
        // If someone opens this URL directly, the filing's own markup can't run scripts on our origin.
        headers.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'");

        return new NextResponse(blob, { headers });
    } catch (error) {
        console.error('Download Proxy Error:', error);
        return NextResponse.json({ error: 'The filing could not be fetched from the SEC.' }, { status: 502 });
    }
}
