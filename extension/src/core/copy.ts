/** Plain-English wording for alerts, in the same voice as SCOUT's glossary (lib/glossary.ts). */
import { normalizeScheduleForm } from '../../../lib/sec-forms';
import { LATE_AFTER_MS } from './schedule';

/** What each form is, in a few words. Keys are base forms after normalizeScheduleForm, without "/A". */
const FORM_LABELS: Record<string, string> = {
    '10-K': 'annual report',
    '10-Q': 'quarterly report',
    '8-K': 'major event',
    '3': 'new insider',
    '4': 'insider trade',
    '5': 'annual insider report',
    '144': 'planned insider sale',
    'S-1': 'IPO registration',
    'F-1': 'IPO registration',
    'S-3': 'shelf registration',
    'S-4': 'merger registration',
    'SC 13D': 'activist stake',
    'SC 13G': 'passive stake',
    'SC TO-T': 'tender offer',
    '13F-HR': 'fund holdings',
    '13F-NT': 'fund holdings notice',
    'DEF 14A': 'proxy statement',
    'DEFA14A': 'proxy material',
    '6-K': 'foreign company report',
    '20-F': 'foreign annual report',
    '40-F': 'Canadian annual report',
    'NT 10-K': 'late annual report notice',
    'NT 10-Q': 'late quarterly report notice',
};

/** "4" -> "Form 4", "SCHEDULE 13D/A" -> "Schedule 13D/A", "10-K" -> "10-K". */
export function formDisplay(form: string): string {
    const normalized = normalizeScheduleForm(form);
    if (/^[345](\/A)?$/.test(normalized) || normalized === '144') return `Form ${normalized}`;
    if (/^SC 13[DG]/.test(normalized)) return normalized.replace(/^SC /, 'Schedule ');
    return normalized;
}

export function formLabel(form: string): string | null {
    const base = normalizeScheduleForm(form).replace(/\/A$/, '');
    if (FORM_LABELS[base]) return FORM_LABELS[base];
    if (base.startsWith('424B')) return 'prospectus';
    return null;
}

/** "an 8-K", "an S-1", "a 10-K", "a Form 4": by how the name is said aloud. */
function article(display: string): string {
    return /^(8|11(?!\d)|18(?!\d)|[AEFHILMNORSX](?=[A-Z0-9 -]|$))/.test(display) ? 'an' : 'a';
}

/** "LANZATECH GLOBAL, INC." -> "LanzaTech Global" style tidy-up: title-case all-caps names, drop legal suffixes. */
export function shortCompanyName(name: string): string {
    let cleaned = name.trim();
    if (/[A-Z]/.test(cleaned) && cleaned === cleaned.toUpperCase()) {
        cleaned = cleaned.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
    }
    // One legal suffix only, and never "Company": "The Coca-Cola Company" should keep its name.
    cleaned = cleaned.replace(/,?\s+(inc|corp|corporation|co|ltd|limited|plc|llc|l\.?p|n\.?v|s\.?a|ag|se)\.?$/i, '');
    return cleaned.replace(/[,\s]+$/, '') || name.trim();
}

/** "LanzaTech Global filed a Form 4 (insider trade)" */
export function alertTitle(company: string, form: string): string {
    const amended = /\/A$/.test(normalizeScheduleForm(form));
    const display = formDisplay(form).replace(/\/A$/, '');
    const label = formLabel(form);
    const what = amended ? `an amended ${display}` : `${article(display)} ${display}`;
    return `${shortCompanyName(company)} filed ${what}${label ? ` (${label})` : ''}`;
}

const ET_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const ET_DAY_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
const ET_SHORT_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

/** Newer ICU puts a narrow no-break space before AM/PM; plain spaces read the same and keep strings predictable. */
function format(formatter: Intl.DateTimeFormat, epochMs: number): string {
    return formatter.format(new Date(epochMs)).replace(/[  ]/g, ' ');
}

/** "9:59 PM" in Eastern time, for the popup list. */
export function shortTime(epochMs: number): string {
    return format(ET_SHORT_TIME, epochMs);
}

/** "2s", "under 1s", "4 min" */
export function lagText(ms: number): string {
    if (ms < 1000) return 'under 1s';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
    return `${Math.round(ms / 3_600_000)} hr`;
}

const ROLE_NOTES: Record<string, string> = {
    reporting: 'as reporting owner (insider)',
    'filed by': 'as the investor filing',
};

/**
 * How an alert relates to the moment EDGAR published the filing:
 *  - live: caught within minutes of acceptance;
 *  - released: accepted long ago but only just published. EDGAR holds filings sent after 5:30 PM (10 PM for Forms
 *    3/4/5), at weekends and on holidays until the next business morning, and SCOUT Live was watching throughout;
 *  - away: SCOUT Live wasn't running (computer asleep or off), so it may have been public for a while.
 */
export type AlertTiming = 'live' | 'released' | 'away';

/** Watching continuously for this long means anything new must have just been published (the backstop rotation is faster). */
export const STEADY_WATCH_MS = 5 * 60 * 1000;

export function alertTiming(acceptedAt: number, caughtAt: number, watchingSince: number): AlertTiming {
    if (caughtAt - acceptedAt <= LATE_AFTER_MS) return 'live';
    return watchingSince > 0 && caughtAt - watchingSince >= STEADY_WATCH_MS ? 'released' : 'away';
}

const TIMING_NOTES: Record<Exclude<AlertTiming, 'live'>, string> = {
    released: 'just released by EDGAR',
    away: 'while you were away',
};

/**
 * "Accepted 9:59:02 PM ET · caught 2s later". For filings EDGAR held: "Accepted Tue 9:59 PM ET · just released by
 * EDGAR"; for ones caught after downtime: "... · while you were away".
 */
export function alertMessage(acceptedAt: number, caughtAt: number, role: string | null, timing: AlertTiming = alertTiming(acceptedAt, caughtAt, 0)): string {
    const lag = caughtAt - acceptedAt;
    const live = timing === 'live';
    const when = format(live ? ET_TIME : ET_DAY_TIME, acceptedAt);
    const parts = [`Accepted ${when} ET`, live ? `caught ${lagText(Math.max(0, lag))} later` : TIMING_NOTES[timing]];
    const note = role ? ROLE_NOTES[role.toLowerCase()] : undefined;
    if (note) parts.push(note);
    return parts.join(' · ');
}
