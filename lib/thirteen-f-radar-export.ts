import * as XLSX from 'xlsx';
import {
    type FilerSideMatch,
    type MatchedRawHoldingRow,
    type RadarAuditResult,
    type RadarComparison,
    type SecurityMovement,
} from './thirteen-f-radar-core';
import { type ResolvedRadarRequest } from './thirteen-f-radar-data';

type CellValue = string | number | boolean | null;
type SheetRow = Record<string, CellValue>;

interface ColumnDef {
    key: string;
    label: string;
    width?: number;
}

export interface RadarExportWorkbookInput {
    request: ResolvedRadarRequest;
    comparison: RadarComparison;
    audit: RadarAuditResult;
    filerSideMatches: FilerSideMatch[];
    notes: string[];
    generatedAt: Date;
}

export function buildRadarAuditWorkbook(input: RadarExportWorkbookInput): Buffer {
    const workbook = XLSX.utils.book_new();

    appendJsonSheet(workbook, 'Read Me', buildReadMeRows(input), [
        { key: 'section', label: 'Section', width: 24 },
        { key: 'field', label: 'Field', width: 30 },
        { key: 'value', label: 'Value', width: 90 },
    ]);

    appendJsonSheet(workbook, 'Coverage', buildCoverageRows(input), [
        { key: 'field', label: 'Field', width: 34 },
        { key: 'value', label: 'Value', width: 60 },
    ]);

    appendJsonSheet(workbook, 'Category Trends', input.comparison.categorySummaries.map((summary) => ({
        category_key: summary.key,
        category: summary.label,
        exposed_filers: summary.exposedFilers,
        buyers: summary.buyers,
        sellers: summary.sellers,
        initiated_filers: summary.initiatedFilers,
        liquidated_filers: summary.liquidatedFilers,
        unchanged_filers: summary.unchangedFilers,
        buyer_pct_of_exposed: summary.buyerPctOfExposed,
        seller_pct_of_exposed: summary.sellerPctOfExposed,
        buyer_pct_of_comparable: summary.buyerPctOfComparable,
        seller_pct_of_comparable: summary.sellerPctOfComparable,
        current_estimated_value: summary.currentValue,
        previous_estimated_value: summary.previousValue,
    })), [
        { key: 'category_key', label: 'Category Key', width: 18 },
        { key: 'category', label: 'Category', width: 24 },
        { key: 'exposed_filers', label: 'Exposed Filers', width: 16 },
        { key: 'buyers', label: 'Buyers', width: 12 },
        { key: 'sellers', label: 'Sellers', width: 12 },
        { key: 'initiated_filers', label: 'Initiated Filers', width: 18 },
        { key: 'liquidated_filers', label: 'Liquidated Filers', width: 18 },
        { key: 'unchanged_filers', label: 'Unchanged Filers', width: 18 },
        { key: 'buyer_pct_of_exposed', label: 'Buyer % Of Exposed', width: 20 },
        { key: 'seller_pct_of_exposed', label: 'Seller % Of Exposed', width: 20 },
        { key: 'buyer_pct_of_comparable', label: 'Buyer % Of Comparable', width: 22 },
        { key: 'seller_pct_of_comparable', label: 'Seller % Of Comparable', width: 22 },
        { key: 'current_estimated_value', label: 'Current Estimated Value', width: 24 },
        { key: 'previous_estimated_value', label: 'Previous Estimated Value', width: 24 },
    ]);

    appendJsonSheet(workbook, 'Security Movements', input.comparison.securityMovements.map(securityMovementRow), [
        { key: 'category_key', label: 'Category Key', width: 18 },
        { key: 'category', label: 'Category', width: 24 },
        { key: 'issuer', label: 'Issuer', width: 34 },
        { key: 'cusip', label: 'CUSIP', width: 14 },
        { key: 'current_holders', label: 'Current Holders', width: 17 },
        { key: 'previous_holders', label: 'Previous Holders', width: 17 },
        { key: 'buyers', label: 'Buyers', width: 12 },
        { key: 'sellers', label: 'Sellers', width: 12 },
        { key: 'initiated_filers', label: 'Initiated Filers', width: 18 },
        { key: 'liquidated_filers', label: 'Liquidated Filers', width: 18 },
        { key: 'net_buyers', label: 'Net Buyers', width: 14 },
        { key: 'current_estimated_value', label: 'Current Estimated Value', width: 24 },
        { key: 'previous_estimated_value', label: 'Previous Estimated Value', width: 24 },
    ]);

    appendJsonSheet(workbook, 'Filer Security Audit', input.audit.filerSecurityAuditRows.map((row) => ({
        cik: row.cik,
        fund_name: row.fundName,
        category_key: row.categoryKey,
        category: row.categoryLabel,
        matched_watchlist_items: row.matchedItems.join('; '),
        issuer: row.issuer,
        cusip: row.cusip,
        action: row.action,
        previous_accession_number: row.previousAccessionNumber,
        current_accession_number: row.currentAccessionNumber,
        previous_filing_date: row.previousFilingDate,
        current_filing_date: row.currentFilingDate,
        previous_shares: row.previousShares,
        current_shares: row.currentShares,
        previous_raw_reported_value: row.previousRawValue,
        current_raw_reported_value: row.currentRawValue,
        previous_estimated_value: row.previousEstimatedValue,
        current_estimated_value: row.currentEstimatedValue,
        estimated_value_delta: row.valueDelta,
        previous_sec_folder_url: row.previousSecFolderUrl,
        current_sec_folder_url: row.currentSecFolderUrl,
        previous_submission_text_url: row.previousSubmissionTextUrl,
        current_submission_text_url: row.currentSubmissionTextUrl,
    })), [
        { key: 'cik', label: 'CIK', width: 14 },
        { key: 'fund_name', label: 'Fund Name', width: 36 },
        { key: 'category_key', label: 'Category Key', width: 18 },
        { key: 'category', label: 'Category', width: 24 },
        { key: 'matched_watchlist_items', label: 'Matched Watchlist Items', width: 36 },
        { key: 'issuer', label: 'Issuer', width: 34 },
        { key: 'cusip', label: 'CUSIP', width: 14 },
        { key: 'action', label: 'Action', width: 14 },
        { key: 'previous_accession_number', label: 'Previous Accession Number', width: 26 },
        { key: 'current_accession_number', label: 'Current Accession Number', width: 26 },
        { key: 'previous_filing_date', label: 'Previous Filing Date', width: 18 },
        { key: 'current_filing_date', label: 'Current Filing Date', width: 18 },
        { key: 'previous_shares', label: 'Previous Shares', width: 18 },
        { key: 'current_shares', label: 'Current Shares', width: 18 },
        { key: 'previous_raw_reported_value', label: 'Previous Raw Reported Value', width: 28 },
        { key: 'current_raw_reported_value', label: 'Current Raw Reported Value', width: 28 },
        { key: 'previous_estimated_value', label: 'Previous Estimated Value', width: 26 },
        { key: 'current_estimated_value', label: 'Current Estimated Value', width: 26 },
        { key: 'estimated_value_delta', label: 'Estimated Value Delta', width: 24 },
        { key: 'previous_sec_folder_url', label: 'Previous SEC Folder URL', width: 60 },
        { key: 'current_sec_folder_url', label: 'Current SEC Folder URL', width: 60 },
        { key: 'previous_submission_text_url', label: 'Previous Submission Text URL', width: 70 },
        { key: 'current_submission_text_url', label: 'Current Submission Text URL', width: 70 },
    ]);

    appendRawHoldingsSheet(workbook, 'Raw Current Holdings', input.audit.rawCurrentHoldings);
    appendRawHoldingsSheet(workbook, 'Raw Previous Holdings', input.audit.rawPreviousHoldings);

    appendJsonSheet(workbook, 'Filer Side Matches', input.filerSideMatches.map((match) => ({
        cik: match.cik,
        fund_name: match.fundName,
        matched_categories: match.matchedCategories.join('; '),
        matched_items: match.matchedItems.join('; '),
        latest_filing_date: match.latestFilingDate,
        has_current_quarter: match.hasCurrentQuarter,
        has_previous_quarter: match.hasPreviousQuarter,
    })), [
        { key: 'cik', label: 'CIK', width: 14 },
        { key: 'fund_name', label: 'Fund Name', width: 36 },
        { key: 'matched_categories', label: 'Matched Categories', width: 34 },
        { key: 'matched_items', label: 'Matched Items', width: 44 },
        { key: 'latest_filing_date', label: 'Latest Filing Date', width: 20 },
        { key: 'has_current_quarter', label: 'Has Current Quarter', width: 20 },
        { key: 'has_previous_quarter', label: 'Has Previous Quarter', width: 20 },
    ]);

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildRadarExportFilename(currentQuarter: string, previousQuarter: string): string {
    return `13f-radar-audit-${currentQuarter}-vs-${previousQuarter}.xlsx`;
}

function buildReadMeRows(input: RadarExportWorkbookInput): SheetRow[] {
    const { request, notes, generatedAt } = input;
    const selectedCategoryLabels = request.watchlists
        .filter((watchlist) => request.selectedCategories.includes(watchlist.key))
        .map((watchlist) => watchlist.label);
    const watchlistRows = request.watchlists
        .filter((watchlist) => request.selectedCategories.includes(watchlist.key))
        .map((watchlist) => ({
            section: 'Watchlist',
            field: watchlist.label,
            value: watchlist.items.map((item) => `${item.ticker} (${item.label})`).join('; '),
        }));

    return [
        { section: 'Export', field: 'Generated At', value: generatedAt.toISOString() },
        { section: 'Export', field: 'Current Quarter', value: request.currentQuarter },
        { section: 'Export', field: 'Previous Quarter', value: request.previousQuarter },
        { section: 'Export', field: 'Selected Categories', value: selectedCategoryLabels.join('; ') },
        { section: 'Methodology', field: 'Movement Basis', value: request.movementBasis },
        { section: 'Methodology', field: 'Comparable Filers', value: 'Only filers with latest filings in both selected quarters are compared.' },
        { section: 'Methodology', field: 'Timing Caveat', value: 'Form 13F reports quarter-end holdings and does not reveal exact trade dates.' },
        { section: 'Methodology', field: 'Options', value: 'Put/call rows are excluded when the holdings table provides a put/call column.' },
        { section: 'Methodology', field: 'Source Validation', value: 'The workbook uses ingested Turso holdings and provides SEC source links for manual spot-checking.' },
        ...notes.map((note, index) => ({ section: 'Notes', field: `Note ${index + 1}`, value: note })),
        ...watchlistRows,
    ];
}

function buildCoverageRows(input: RadarExportWorkbookInput): SheetRow[] {
    const { comparison, request, audit } = input;
    return [
        { field: 'Current Quarter', value: request.currentQuarter },
        { field: 'Previous Quarter', value: request.previousQuarter },
        { field: 'Current Filers', value: comparison.coverage.currentFilers },
        { field: 'Previous Filers', value: comparison.coverage.previousFilers },
        { field: 'Comparable Filers', value: comparison.coverage.comparableFilers },
        { field: 'Watched Filers', value: comparison.coverage.watchedFilers },
        { field: 'Watched Holding Rows', value: comparison.coverage.watchedHoldingRows },
        { field: 'Filer Security Audit Rows', value: audit.filerSecurityAuditRows.length },
        { field: 'Raw Current Holding Rows', value: audit.rawCurrentHoldings.length },
        { field: 'Raw Previous Holding Rows', value: audit.rawPreviousHoldings.length },
        { field: 'Available Quarters', value: request.availableQuarters.join('; ') },
        { field: 'Selected Category Keys', value: request.selectedCategories.join('; ') },
    ];
}

function securityMovementRow(movement: SecurityMovement): SheetRow {
    return {
        category_key: movement.categoryKey,
        category: movement.categoryLabel,
        issuer: movement.issuer,
        cusip: movement.cusip,
        current_holders: movement.currentHolders,
        previous_holders: movement.previousHolders,
        buyers: movement.buyers,
        sellers: movement.sellers,
        initiated_filers: movement.initiatedFilers,
        liquidated_filers: movement.liquidatedFilers,
        net_buyers: movement.netBuyers,
        current_estimated_value: movement.currentValue,
        previous_estimated_value: movement.previousValue,
    };
}

function appendRawHoldingsSheet(workbook: XLSX.WorkBook, sheetName: string, rows: MatchedRawHoldingRow[]) {
    appendJsonSheet(workbook, sheetName, rows.map((row) => ({
        period: row.period,
        cik: row.cik,
        fund_name: row.fundName,
        accession_number: row.accessionNumber,
        filing_date: row.filingDate,
        quarter: row.quarter,
        issuer: row.issuer,
        cusip: row.cusip,
        shares: row.shares,
        raw_reported_value: row.rawReportedValue,
        estimated_value: row.estimatedValue,
        matched_category_keys: row.matchedCategoryKeys.join('; '),
        matched_categories: row.matchedCategories.join('; '),
        matched_items: row.matchedItems.join('; '),
        sec_folder_url: row.secFolderUrl,
        submission_text_url: row.submissionTextUrl,
    })), [
        { key: 'period', label: 'Period', width: 12 },
        { key: 'cik', label: 'CIK', width: 14 },
        { key: 'fund_name', label: 'Fund Name', width: 36 },
        { key: 'accession_number', label: 'Accession Number', width: 26 },
        { key: 'filing_date', label: 'Filing Date', width: 16 },
        { key: 'quarter', label: 'Quarter', width: 12 },
        { key: 'issuer', label: 'Issuer', width: 34 },
        { key: 'cusip', label: 'CUSIP', width: 14 },
        { key: 'shares', label: 'Shares', width: 16 },
        { key: 'raw_reported_value', label: 'Raw Reported Value', width: 22 },
        { key: 'estimated_value', label: 'Estimated Value', width: 20 },
        { key: 'matched_category_keys', label: 'Matched Category Keys', width: 28 },
        { key: 'matched_categories', label: 'Matched Categories', width: 34 },
        { key: 'matched_items', label: 'Matched Items', width: 44 },
        { key: 'sec_folder_url', label: 'SEC Folder URL', width: 60 },
        { key: 'submission_text_url', label: 'Submission Text URL', width: 70 },
    ]);
}

function appendJsonSheet(
    workbook: XLSX.WorkBook,
    sheetName: string,
    rows: SheetRow[],
    columns: ColumnDef[]
) {
    const aoa = [
        columns.map((column) => column.label),
        ...rows.map((row) => columns.map((column) => normalizeCellValue(row[column.key]))),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet['!cols'] = columns.map((column) => ({ wch: column.width || 18 }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
}

function normalizeCellValue(value: CellValue | undefined): CellValue {
    if (value === undefined || value === null) return '';
    return value;
}
