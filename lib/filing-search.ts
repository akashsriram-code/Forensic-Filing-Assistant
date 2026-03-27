import { fetchCIK, fetchSubmission, generateSecUrl } from '@/lib/sec-client';

export interface FilingResult {
  accessionNumber: string;
  filingDate: string;
  form: string;
  size: number;
  primaryDocument: string;
  description: string;
  downloadUrl: string;
}

export interface SearchFilingsInput {
  ticker: string;
  startDate?: string;
  endDate?: string;
  filingType?: string;
}

export function matchesFilingType(formType: string, filingType?: string) {
  if (!filingType || filingType === 'ALL') return true;

  if (filingType === '10-K') {
    return formType.includes('10-K') && !formType.startsWith('NT');
  }

  if (filingType === '10-Q') {
    return formType.includes('10-Q') && !formType.startsWith('NT');
  }

  if (filingType === '424B') {
    return formType.includes('424B');
  }

  return formType.includes(filingType);
}

export async function searchFilings({
  ticker,
  startDate,
  endDate,
  filingType = 'ALL',
}: SearchFilingsInput): Promise<FilingResult[]> {
  if (!ticker) {
    throw new Error('Ticker is required');
  }

  const cik = await fetchCIK(ticker);
  if (!cik) {
    throw new Error('Ticker not found');
  }

  const submission = await fetchSubmission(cik);
  if (!submission) {
    throw new Error('No filings found');
  }

  const recent = submission.filings.recent;
  const results: FilingResult[] = [];

  const start = startDate ? new Date(startDate).getTime() : 0;
  const end = endDate ? new Date(endDate).getTime() : Date.now();

  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const fDate = new Date(recent.filingDate[i]).getTime();
    const formType = recent.form[i];

    if (fDate < start || fDate > end) continue;
    if (!matchesFilingType(formType, filingType)) continue;

    results.push({
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      form: formType,
      size: recent.size[i],
      primaryDocument: recent.primaryDocument[i],
      description: recent.primaryDocDescription[i],
      downloadUrl: generateSecUrl(cik, recent.accessionNumber[i], recent.primaryDocument[i]),
    });
  }

  return results.slice(0, 50);
}
