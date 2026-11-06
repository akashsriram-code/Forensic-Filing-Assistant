/**
 * One-off repair for the YYYYMMDD filing-date bug (fixed in 2b18147).
 *
 * Live ingest stored EDGAR daily-index dates as 20261103 and compared them as strings against YYYY-MM-DD dates,
 * so a later filing could look older ("2026-11-05" < "20261103"), be skipped as superseded, and be marked seen in
 * f13_applied_filings, which means it is never retried. This finds those filings and removes them from
 * f13_applied_filings so the next live ingestion run applies them.
 *
 * A filing is requeued only if it is a replace-mode filing (base 13F-HR or RESTATEMENT amendment) for a stored
 * cur/prev quarter, has real holdings, isn't the filer's stored accession for that side, and is newer than that
 * stored filing, which correct ingestion would always have applied. NEW HOLDINGS amendments are never requeued:
 * they skip the date check, so they were applied already and re-applying would double-count.
 *
 * Usage: npx tsx scripts/requeue-13f-date-skips.ts [--apply]   (dry run unless --apply)
 */
import * as dotenv from 'dotenv';
import { assertPostgresWritable, createPostgresPool, getPostgresConnectionString } from '../lib/thirteen-f-radar-postgres';
import { normalizeCik } from '../lib/thirteen-f-radar-core';
import { queryAppliedAccessions, readStoreMeta, type StoreSide } from '../lib/thirteen-f-store';
import {
    fetchTextWithRetry,
    filingIndexQuarterForReportQuarter,
    hasArg,
    normalizeSecDate,
    parseLive13FSubmissionText,
    quarterFromReportDate,
} from './13f-ingestion-utils';
import { parseIndexContent, type IndexEntry } from './ingest-live-13f';

dotenv.config({ quiet: true });

const RATE_LIMIT_MS = 150;

interface FilerRow {
    cik: string;
    name: string;
    cur_accession: string | null;
    cur_filing_date: string | null;
    prev_accession: string | null;
    prev_filing_date: string | null;
    prior_accession: string | null;
}

async function main() {
    const apply = hasArg('--apply');
    if (!getPostgresConnectionString()) throw new Error('Missing DATABASE_URL or POSTGRES_URL.');
    const pool = createPostgresPool();
    try {
        if (apply) await assertPostgresWritable(pool, '13F date-skip requeue');
        const meta = await readStoreMeta(pool);
        if (!meta) throw new Error('The 13F store is empty.');
        const quarterSide = new Map<string, Exclude<StoreSide, 'prior'>>([
            [meta.currentQuarter, 'cur'],
            [meta.previousQuarter, 'prev'],
        ]);

        // The same filing indexes live ingest scans, so requeued filings are picked up by the next run.
        const entries: IndexEntry[] = [];
        for (const quarter of quarterSide.keys()) {
            const { year, quarter: q } = filingIndexQuarterForReportQuarter(quarter);
            entries.push(...parseIndexContent(await fetchTextWithRetry(`https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${q}/master.idx`)));
        }

        const { rows } = await pool.query<FilerRow>(
            'SELECT cik, name, cur_accession, cur_filing_date, prev_accession, prev_filing_date, prior_accession FROM f13_filers'
        );
        const filers = new Map(rows.map((row) => [normalizeCik(row.cik), row]));
        const applied = await queryAppliedAccessions(pool);

        const candidates = entries.filter((entry) => {
            const filer = filers.get(normalizeCik(entry.cik));
            const accession = accessionOf(entry);
            if (!filer || !applied.has(accession)) return false;
            if ([filer.cur_accession, filer.prev_accession, filer.prior_accession].includes(accession)) return false;
            // Cheap pre-filter; the exact side check happens after the filing's report quarter is known.
            return [filer.cur_filing_date, filer.prev_filing_date].some((d) => d && entry.date >= normalizeSecDate(d));
        });
        console.log(`[Requeue] Store ${meta.currentQuarter} / ${meta.previousQuarter}; ${entries.length} index entries, ${candidates.length} candidates to inspect`);

        const requeue: Array<Record<string, string>> = [];
        const kept: Record<string, number> = {};
        const keep = (reason: string) => { kept[reason] = (kept[reason] || 0) + 1; };

        for (const entry of candidates) {
            await sleep(RATE_LIMIT_MS);
            const filer = filers.get(normalizeCik(entry.cik))!;
            const accession = accessionOf(entry);
            let parsed;
            try {
                parsed = await parseLive13FSubmissionText(await fetchTextWithRetry(`https://www.sec.gov/Archives/${entry.filename}`, 3));
            } catch (error) {
                console.warn(`[Requeue] Could not read ${accession}: ${error instanceof Error ? error.message : error}`);
                keep('fetch error');
                continue;
            }
            const reportQuarter = parsed.reportDate ? quarterFromReportDate(parsed.reportDate) : null;
            const side = reportQuarter ? quarterSide.get(reportQuarter) : undefined;
            if (!side) { keep('other report quarter (correctly skipped)'); continue; }
            if (parsed.amendmentType === 'NEW HOLDINGS') { keep('new-holdings amendment (already added)'); continue; }
            const equity = parsed.holdings.filter((h) => !h.putcall);
            if (equity.length === 0 || equity.reduce((sum, h) => sum + (h.value || 0), 0) <= 0) { keep('no holdings / zero value (correctly skipped)'); continue; }

            const rawSideDate = side === 'cur' ? filer.cur_filing_date : filer.prev_filing_date;
            const sideAccession = side === 'cur' ? filer.cur_accession : filer.prev_accession;
            if (!rawSideDate || !sideAccession) { keep('no stored filing on that side'); continue; }
            const sideDate = normalizeSecDate(rawSideDate);
            // Live ingest applies a filer's filings in (date, filename) order, so the last one wins.
            const newer = entry.date > sideDate || (entry.date === sideDate && accession > sideAccession);
            if (!newer) { keep('older than stored filing (correctly skipped)'); continue; }

            requeue.push({
                filer: filer.name,
                form: entry.form,
                quarter: reportQuarter!,
                filed: entry.date,
                accession,
                replaces: `${sideAccession} (${rawSideDate})`,
            });
        }

        console.table(requeue);
        console.log('[Requeue] Left alone:', kept);
        if (!apply) {
            console.log(`[Requeue] Dry run: would requeue ${requeue.length} filings. Re-run with --apply to remove them from f13_applied_filings.`);
            return;
        }
        if (requeue.length > 0) {
            const { rowCount } = await pool.query('DELETE FROM f13_applied_filings WHERE accession_number = ANY($1)', [requeue.map((r) => r.accession)]);
            console.log(`[Requeue] Requeued ${rowCount} filings; the next live ingestion run will apply them.`);
        }
    } finally {
        await pool.end();
    }
}

function accessionOf(entry: IndexEntry): string {
    return entry.filename.split('/').pop()!.replace(/\.txt$/i, '');
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
