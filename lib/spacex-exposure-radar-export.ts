import * as XLSX from 'xlsx';
import {
    buildSpaceXExposureWorkbookRows,
    type SpaceXExposureResponse,
    type SpaceXExposureRow,
} from './spacex-exposure-radar';

type CellValue = string | number | boolean | null;
type SheetRow = Record<string, CellValue>;

interface ColumnDef {
    key: string;
    label: string;
    width?: number;
}

export function buildSpaceXExposureWorkbook(response: SpaceXExposureResponse): Buffer {
    const workbook = XLSX.utils.book_new();
    const grouped = buildSpaceXExposureWorkbookRows(response);

    appendJsonSheet(workbook, 'SpaceX Holdings', grouped.holdings.map(exposureSheetRow), exposureColumns());
    appendJsonSheet(workbook, 'Narrative Mentions', grouped.narrative.map(exposureSheetRow), exposureColumns());
    appendJsonSheet(workbook, '13F Check', grouped.thirteenF.map(exposureSheetRow), exposureColumns());
    appendJsonSheet(workbook, 'OpenArena Review', grouped.openArena.map(exposureSheetRow), exposureColumns());
    appendJsonSheet(workbook, 'Run Summary', buildSummaryRows(response), [
        { key: 'field', label: 'Field', width: 34 },
        { key: 'value', label: 'Value', width: 80 },
    ]);
    appendJsonSheet(workbook, 'Methodology', buildMethodologyRows(response), [
        { key: 'section', label: 'Section', width: 24 },
        { key: 'field', label: 'Field', width: 34 },
        { key: 'value', label: 'Value', width: 100 },
    ]);

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildSpaceXExposureExportFilename(startDate: string, endDate: string): string {
    return `spacex-exposure-radar-${safeFilenamePart(startDate)}-to-${safeFilenamePart(endDate)}.xlsx`;
}

function exposureSheetRow(row: SpaceXExposureRow): SheetRow {
    return {
        filer_name: row.filerName,
        cik: row.cik,
        form: row.form,
        filing_date: row.filingDate,
        period_end: row.periodEnd,
        accession_number: row.accessionNumber,
        document_name: row.documentName,
        file_description: row.fileDescription,
        relationship_type: row.relationshipType,
        confidence: row.confidence,
        matched_terms: row.matchedTerms.join('; '),
        security_name: row.securityName,
        issuer_name: row.issuerName,
        cusip: row.cusip,
        shares_or_balance: row.sharesOrBalance,
        units: row.units,
        value_usd: row.valueUsd,
        pct_value: row.pctValue,
        asset_category: row.assetCategory,
        issuer_category: row.issuerCategory,
        investment_country: row.investmentCountry,
        snippet: row.snippet,
        sec_document_url: row.secDocumentUrl,
        sec_filing_url: row.secFilingUrl,
        openarena_status: row.openArenaStatus,
        openarena_notes: row.openArenaNotes,
        notes: row.notes,
    };
}

function exposureColumns(): ColumnDef[] {
    return [
        { key: 'filer_name', label: 'Filer Name', width: 42 },
        { key: 'cik', label: 'CIK', width: 14 },
        { key: 'form', label: 'Form', width: 12 },
        { key: 'filing_date', label: 'Filing Date', width: 16 },
        { key: 'period_end', label: 'Period End', width: 16 },
        { key: 'accession_number', label: 'Accession Number', width: 26 },
        { key: 'document_name', label: 'Document Name', width: 34 },
        { key: 'file_description', label: 'File Description', width: 30 },
        { key: 'relationship_type', label: 'Relationship Type', width: 28 },
        { key: 'confidence', label: 'Confidence', width: 14 },
        { key: 'matched_terms', label: 'Matched Terms', width: 44 },
        { key: 'security_name', label: 'Security Name', width: 38 },
        { key: 'issuer_name', label: 'Issuer Name', width: 38 },
        { key: 'cusip', label: 'CUSIP', width: 14 },
        { key: 'shares_or_balance', label: 'Shares Or Balance', width: 18 },
        { key: 'units', label: 'Units', width: 12 },
        { key: 'value_usd', label: 'Value USD', width: 18 },
        { key: 'pct_value', label: 'Pct Value', width: 14 },
        { key: 'asset_category', label: 'Asset Category', width: 16 },
        { key: 'issuer_category', label: 'Issuer Category', width: 18 },
        { key: 'investment_country', label: 'Investment Country', width: 20 },
        { key: 'snippet', label: 'Snippet', width: 80 },
        { key: 'sec_document_url', label: 'SEC Document URL', width: 70 },
        { key: 'sec_filing_url', label: 'SEC Filing URL', width: 70 },
        { key: 'openarena_status', label: 'OpenArena Status', width: 20 },
        { key: 'openarena_notes', label: 'OpenArena Notes', width: 60 },
        { key: 'notes', label: 'Notes', width: 60 },
    ];
}

function buildSummaryRows(response: SpaceXExposureResponse): SheetRow[] {
    return [
        { field: 'Generated At', value: response.generatedAt },
        { field: 'Start Date', value: response.startDate },
        { field: 'End Date', value: response.endDate },
        { field: 'Forms', value: response.forms.join(', ') },
        { field: 'Aliases', value: response.aliases.join('; ') },
        { field: 'Contextual Terms', value: response.contextualTerms.join('; ') },
        { field: 'Total Rows', value: response.summary.totalRows },
        { field: 'Holding Rows', value: response.summary.holdingRows },
        { field: 'Narrative Rows', value: response.summary.narrativeRows },
        { field: 'Review Rows', value: response.summary.reviewRows },
        { field: 'False Positive Rows', value: response.summary.falsePositiveRows },
        { field: 'Search Hits Discovered', value: response.summary.searchHitsDiscovered },
        { field: 'Filings Searched', value: response.summary.filingsSearched },
        { field: 'Filings Fetched', value: response.summary.filingsFetched },
        { field: 'OpenArena Reviewed', value: response.summary.openArenaReviewed },
        { field: 'Warnings', value: response.warnings.join(' | ') },
    ];
}

function buildMethodologyRows(response: SpaceXExposureResponse): SheetRow[] {
    return [
        { section: 'Source', field: 'Discovery', value: 'SEC EDGAR full-text search is used to discover filings that mention SpaceX aliases, then source documents are fetched from SEC Archives.' },
        { section: 'Source', field: 'Structured Holdings', value: 'Form N-PORT XML and Form 13F XML are parsed deterministically before narrative classification is considered.' },
        { section: 'Source', field: '13F Limitation', value: 'Form 13F covers Section 13(f) reportable securities only; an empty 13F check is not proof that no filer owns private SpaceX securities.' },
        { section: 'Classification', field: 'Holdings First', value: 'Rows with portfolio/security/value fields are classified as holdings ahead of narrative mentions.' },
        { section: 'Classification', field: 'Starlink', value: 'Starlink is contextual only and does not create a direct SpaceX holding classification by itself.' },
        { section: 'OpenArena', field: 'Role', value: 'OpenArena may verify ambiguous rows, but it does not overwrite SEC-parsed facts.' },
        { section: 'Run', field: 'Forms Searched', value: response.forms.join(', ') },
        ...response.warnings.map((warning, index) => ({ section: 'Warnings', field: `Warning ${index + 1}`, value: warning })),
    ];
}

function appendJsonSheet(workbook: XLSX.WorkBook, sheetName: string, rows: SheetRow[], columns: ColumnDef[]) {
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

function safeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}
