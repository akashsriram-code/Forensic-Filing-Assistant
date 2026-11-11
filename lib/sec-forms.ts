/**
 * SEC form names that changed over time. Since December 2024 EDGAR files beneficial-ownership schedules as structured
 * XML under the names "SCHEDULE 13D" / "SCHEDULE 13G"; older filings use "SC 13D" / "SC 13G". Code that looks for these
 * forms should use the sets and helpers here so it catches both names. Pure functions, safe on client and server.
 */

/** Schedule 13D: more than 5% of a company, with a possible plan to influence it. */
export const ACTIVIST_FORMS: ReadonlySet<string> = new Set(['SC 13D', 'SC 13D/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A']);

/** Schedule 13G: more than 5%, held passively. */
export const PASSIVE_STAKE_FORMS: ReadonlySet<string> = new Set(['SC 13G', 'SC 13G/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A']);

function cleanForm(form: string | null | undefined): string {
    return String(form ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Maps both spellings of a schedule to the older short name, so they compare equal:
 * "SCHEDULE 13D/A" -> "SC 13D/A", "schedule 13g" -> "SC 13G". Other forms come back trimmed and upper-cased.
 */
export function normalizeScheduleForm(form: string | null | undefined): string {
    return cleanForm(form).replace(/^SCHEDULE (13[DG])\b/, 'SC $1');
}

export function isActivistForm(form: string | null | undefined): boolean {
    return ACTIVIST_FORMS.has(cleanForm(form));
}

export function isPassiveStakeForm(form: string | null | undefined): boolean {
    return PASSIVE_STAKE_FORMS.has(cleanForm(form));
}

/** "SC 13D/A", "SCHEDULE 13D/A", "4/A" ... */
export function isAmendmentForm(form: string | null | undefined): boolean {
    return /\/A$/.test(cleanForm(form));
}
