/**
 * Plain-English sentences describing a 10-K / 10-Q section comparison (see lib/diff-engine.ts). Shared by the /diff
 * page and the company page's "What changed" block, so both say the same thing about the same filings.
 */
import type { SectionKind, SectionSummary } from './diff-engine';
import { formatNumber } from './format';

export const SECTION_NAMES: Record<SectionKind | 'all', string> = { risk: 'the risk factors', mda: 'MD&A', all: 'the full text' };
export const SECTION_TITLES: Record<SectionKind, string> = { risk: 'risk factors', mda: 'MD&A' };

export function count(n: number, singular: string, pluralForm = `${singular}s`): string {
    return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`;
}

export const wasWere = (n: number) => (n === 1 ? 'was' : 'were');

/** "a", "a and b", "a, b and c". */
export function joinClauses(clauses: string[]): string {
    if (clauses.length <= 1) return clauses.join('');
    return `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
}

export function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Risk factors can be counted one by one only when the filing marks them with headings. */
export function countsByHeading(kind: SectionKind, summary: SectionSummary): boolean {
    return kind === 'risk' && summary.headingCount.previous + summary.headingCount.current > 0;
}

/** The plain-English takeaway for one section, built from the same lists the page shows. */
export function sectionTakeaway(kind: SectionKind, summary: SectionSummary, byHeading: boolean): string[] {
    const name = SECTION_NAMES[kind];
    const { found } = summary;
    if (!found.previous || !found.current) {
        const where = !found.previous && !found.current ? 'either filing' : !found.previous ? 'the previous filing' : 'the current filing';
        return [`The ${SECTION_TITLES[kind]} section wasn't found in ${where}, so the two can't be compared.`];
    }

    if (byHeading) {
        const added = summary.newFactors.length;
        const removed = summary.removedFactors.length;
        const reworded = summary.changed.length;
        const sentences: string[] = [];
        if (added === 0 && removed === 0) {
            sentences.push(
                reworded === 0
                    ? 'No risk factors were added or removed, and no paragraphs were reworded.'
                    : `No risk factors were added or removed, but ${count(reworded, 'paragraph')} ${wasWere(reworded)} reworded.`
            );
        } else {
            const clauses: string[] = [];
            if (added > 0) clauses.push(count(added, 'new risk factor'));
            if (removed > 0) clauses.push(added > 0 ? `${formatNumber(removed)} removed` : count(removed, 'removed risk factor'));
            if (reworded > 0) clauses.push(count(reworded, 'reworded paragraph'));
            sentences.push(`${capitalize(joinClauses(clauses))} in ${name}.`);
        }
        const otherAdded = summary.otherAdded.length;
        const otherRemoved = summary.otherRemoved.length;
        if (otherAdded > 0 && otherRemoved > 0) {
            sentences.push(`Elsewhere in the section, ${count(otherAdded, 'paragraph')} ${wasWere(otherAdded)} added and ${formatNumber(otherRemoved)} removed.`);
        } else if (otherAdded > 0) {
            sentences.push(`Elsewhere in the section, ${count(otherAdded, 'paragraph')} ${wasWere(otherAdded)} added.`);
        } else if (otherRemoved > 0) {
            sentences.push(`Elsewhere in the section, ${count(otherRemoved, 'paragraph')} ${wasWere(otherRemoved)} removed.`);
        }
        return sentences;
    }

    const added = summary.added.length;
    const removed = summary.removed.length;
    const reworded = summary.changed.length;
    if (added === 0 && removed === 0 && reworded === 0) return [`No passages were added, removed or reworded in ${name}.`];
    const clauses: string[] = [];
    if (added > 0) clauses.push(count(added, 'new passage'));
    if (removed > 0) clauses.push(added > 0 ? `${formatNumber(removed)} removed` : count(removed, 'removed passage'));
    if (reworded > 0) clauses.push(count(reworded, 'reworded passage'));
    return [`${capitalize(joinClauses(clauses))} in ${name}.`];
}
