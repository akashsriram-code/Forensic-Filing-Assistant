"use client";

import Link from 'next/link';
import { CopyCitation, Identifier } from '../ui';

/** /fund/{cik} for a radar row (CIKs may be zero-padded). */
export function fundPageHref(cik: string): string {
    return `/fund/${Number(cik) || cik}`;
}

/**
 * A fund in a radar table: its name linking to the fund page, its CIK, and (when the row knows which 13F-HR it came
 * from) a "Copy citation" button.
 */
export function FundCell({
    cik,
    fundName,
    accessionNumber,
    filingDate,
}: {
    cik: string;
    fundName: string;
    accessionNumber?: string;
    filingDate?: string;
}) {
    return (
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <Link href={fundPageHref(cik)} className="font-medium text-ink hover:text-accent hover:underline">
                    {fundName}
                </Link>
                <Identifier label="CIK" value={cik} className="block" />
            </div>
            {accessionNumber && (
                <CopyCitation citation={{ entity: fundName, form: '13F-HR', filingDate: filingDate ?? null, accession: accessionNumber, cik }} />
            )}
        </div>
    );
}
