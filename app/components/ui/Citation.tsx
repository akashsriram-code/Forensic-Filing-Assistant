"use client";

import { useState } from 'react';
import { Check, Quote } from 'lucide-react';
import { cn } from '@/lib/cn';
import { citationUrl, formatCitation, type Citation } from '@/lib/citation';
import { formatDate } from '@/lib/format';

/** Copies a reporter-ready citation (filer, form, date, accession number, sec.gov link) to the clipboard. */
export function CopyCitation({ citation, className, withLabel = false }: { citation: Citation; className?: string; withLabel?: boolean }) {
    const [copied, setCopied] = useState(false);
    const label = copied ? 'Citation copied' : `Copy citation for ${citation.entity} ${citation.form}`;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(formatCitation(citation));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    return (
        <button
            type="button"
            onClick={copy}
            aria-label={label}
            title={copied ? 'Copied' : 'Copy citation'}
            className={cn(
                'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink',
                withLabel ? 'h-8 px-2.5 text-sm font-medium' : 'h-8 w-8',
                className
            )}
        >
            {copied ? <Check className="h-4 w-4 text-gain" aria-hidden /> : <Quote className="h-4 w-4" aria-hidden />}
            {withLabel && (copied ? 'Copied' : 'Copy citation')}
        </button>
    );
}

/** "Sources (3)" disclosure listing each cited filing with a link and its own copy button. */
export function SourceList({ sources }: { sources: Citation[] }) {
    if (sources.length === 0) return null;
    return (
        <details className="group text-sm">
            <summary className="cursor-pointer list-none font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">
                Sources ({sources.length})
            </summary>
            <ul className="mt-2 space-y-1.5 border-l-2 border-rule pl-3">
                {sources.map((source, index) => {
                    const url = citationUrl(source);
                    return (
                        <li key={`${source.accession ?? url ?? index}`} className="flex items-start gap-2 text-ink-muted">
                            <span className="min-w-0 flex-1">
                                <span className="text-ink">{source.entity}</span>, Form {source.form}
                                {source.filingDate ? `, filed ${formatDate(source.filingDate)}` : ''}
                                {url && (
                                    <>
                                        {' '}
                                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                            View on sec.gov
                                        </a>
                                    </>
                                )}
                            </span>
                            <CopyCitation citation={source} className="-my-1.5" />
                        </li>
                    );
                })}
            </ul>
        </details>
    );
}
