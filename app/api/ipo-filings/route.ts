
import { NextResponse } from 'next/server';
import { fetchRecentIpoFilings, resolvePrimaryDocument, parseIpoData, IpoFiling } from '@/lib/ipo-scraper';
import { fetchFilingContent } from '@/lib/sec-client';
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'ipo_filings.json');

// Helper to read data
function readData(): IpoFiling[] {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const content = fs.readFileSync(DATA_FILE, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            console.error("Error reading IPO data", e);
        }
    }
    return [];
}

// Helper to save data
function saveData(data: IpoFiling[]) {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error saving IPO data", e);
    }
}

export async function GET() {
    const cachedData = readData();
    const { startDate, endDate } = getLiveFeedWindow();

    try {
        const liveData = await fetchRecentIpoFilings(startDate, endDate);
        const mergedData = mergeFilings(liveData, cachedData);

        return NextResponse.json({
            filings: mergedData,
            liveCount: liveData.length,
            cachedCount: cachedData.length,
            source: liveData.length > 0 ? 'sec-live' : 'cache',
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error("Live IPO feed failed, returning cached data", error);
    }

    return NextResponse.json({
        filings: cachedData,
        source: 'cache',
        warning: 'Live SEC feed unavailable; returned cached filings.',
        lastUpdated: fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE).mtime : null
    });
}

export async function POST() {
    try {
        const { startDate, endDate } = getLiveFeedWindow();

        console.log(`Starting IPO Scrape from ${startDate} to ${endDate}...`);
        const filings = await fetchRecentIpoFilings(startDate, endDate);
        console.log(`Found ${filings.length} filings in feed.`);

        // INCREMENTAL UPDATE LOGIC:
        // 1. Load existing data
        const existingData = readData();
        const existingAccessionSet = new Set(existingData.map(f => f.accessionNumber));

        // 2. Filter out filings we already have for the slower enrichment pass.
        const newFilings = filings.filter(f => !existingAccessionSet.has(f.accessionNumber));
        console.log(`Identified ${newFilings.length} new filings to process.`);

        // 3. Process Only New Filings
        // Enhance with details - Limit to recent 100 to avoid timeouts during demand-scrape
        // In a real app, this should be a background job.
        const detailLimit = 25;
        const filingsToProcess = newFilings.slice(0, detailLimit);

        const newlyProcessedFilings: IpoFiling[] = [];

        // Helper for Concurrency
        async function processInBatches<T>(items: T[], batchSize: number, task: (item: T) => Promise<void>) {
            for (let i = 0; i < items.length; i += batchSize) {
                const batch = items.slice(i, i + batchSize);
                await Promise.all(batch.map(task));
            }
        }

        if (filingsToProcess.length > 0) {
            console.log(`Processing ${filingsToProcess.length} new filings...`);
            await processInBatches(filingsToProcess, 5, async (filing) => {
                try {
                    const docUrl = await resolvePrimaryDocument(filing);
                    if (docUrl) {
                        filing.reportUrl = docUrl;
                        const html = await fetchFilingContent(docUrl);
                        if (html) {
                            const details = await parseIpoData(html);
                            filing.pricing = { ...filing.pricing, ...details.pricing };
                            filing.financials = { ...filing.financials, ...details.financials };
                            filing.isTrueIpo = details.isTrueIpo;
                            filing.offeringType = details.offeringType;

                            newlyProcessedFilings.push(filing);
                        } else {
                            console.log(`[Filter] Skipping ${filing.companyName}: Could not fetch HTML to verify.`);
                        }
                    } else {
                        console.log(`[Filter] Skipping ${filing.companyName}: Could not resolve document.`);
                    }
                } catch (e) {
                    console.error(`Error processing ${filing.companyName}`, e);
                }
            });
        }

        // 4. Merge Data
        // Combine new findings with existing data
        // Sort by date desc
        const enrichedByAccession = new Map(newlyProcessedFilings.map(filing => [filing.accessionNumber, filing]));
        const liveWithEnrichment = filings.map(filing => enrichedByAccession.get(filing.accessionNumber) || filing);
        const mergedData = mergeFilings(liveWithEnrichment, existingData);
        mergedData.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

        // Save
        saveData(mergedData);

        return NextResponse.json({
            success: true,
            count: newlyProcessedFilings.length,
            liveCount: filings.length,
            total: mergedData.length,
            filings: mergedData
        });

    } catch (e: any) {
        console.error("Scrape failed", e);
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}

function getLiveFeedWindow() {
    const lookbackDays = Number.parseInt(process.env.IPO_FEED_LOOKBACK_DAYS || '30', 10);
    const days = Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 30;
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);

    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
    };
}

function mergeFilings(primary: IpoFiling[], fallback: IpoFiling[]) {
    const merged = new Map<string, IpoFiling>();

    for (const filing of fallback) {
        merged.set(filing.accessionNumber, filing);
    }

    for (const filing of primary) {
        const cached = merged.get(filing.accessionNumber);
        merged.set(filing.accessionNumber, cached ? { ...filing, ...cached, reportUrl: cached.reportUrl || filing.reportUrl } : filing);
    }

    return Array.from(merged.values())
        .sort((a, b) => b.filingDate.localeCompare(a.filingDate))
        .slice(0, 250);
}
