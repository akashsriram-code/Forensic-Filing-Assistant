/**
 * Form 4 (insider trades): reads the transactions out of a filing's XML and summarises them in plain language.
 * Pure functions apart from the XML parser, so they can be tested with fixtures (scripts/test-form4.ts).
 *
 * Only the non-derivative table (shares themselves) is read. The derivative table (options, RSUs) would double-count
 * option exercises, which already appear in the non-derivative table as code M.
 */
import { parseForm4 } from './sec-client';
import { filingIndexUrl, formatAccession, primaryDocUrl } from './sec-urls';

export type InsiderTradeKind = 'buy' | 'sell' | 'award' | 'option' | 'tax' | 'gift' | 'other';

export const INSIDER_KIND_LABELS: Record<InsiderTradeKind, string> = {
    buy: 'Bought on the open market',
    sell: 'Sold on the open market',
    award: 'Award or grant',
    option: 'Option exercise',
    tax: 'Shares withheld for tax',
    gift: 'Gift',
    other: 'Other',
};

/** SEC transaction codes -> plain-language kind. P and S are the only open-market trades. */
export function kindForCode(code: string | null | undefined): InsiderTradeKind {
    switch ((code || '').trim().toUpperCase()) {
        case 'P':
            return 'buy';
        case 'S':
            return 'sell';
        case 'A':
            return 'award';
        case 'M':
            return 'option';
        case 'F':
            return 'tax';
        case 'G':
            return 'gift';
        default:
            return 'other';
    }
}

/** Which filing a transaction came from. `cik` is the EDGAR record the filing was listed under (its archive folder). */
export interface Form4FilingRef {
    cik: string;
    accessionNumber: string;
    filingDate: string;
    form: string;
    /** As listed by EDGAR, e.g. "xslF345X05/doc.xml" (the rendered view). */
    primaryDocument: string;
}

export interface InsiderOwner {
    name: string;
    cik: string | null;
    /** Plain label, e.g. "Chief Financial Officer", "Director", "10% owner"; several are joined with "; ". */
    role: string;
    isDirector: boolean;
    isOfficer: boolean;
    isTenPercentOwner: boolean;
    isOther: boolean;
    officerTitle: string | null;
    otherText: string | null;
}

export interface InsiderTransaction {
    /** Unique within a response: accession + row number. */
    id: string;
    ownerName: string;
    ownerCik: string | null;
    role: string;
    isDirector: boolean;
    isOfficer: boolean;
    isTenPercentOwner: boolean;
    /** Other owners on a joint filing (the same shares, reported together). */
    coOwners: string[];
    issuerName: string | null;
    issuerCik: string | null;
    issuerTicker: string | null;
    securityTitle: string | null;
    transactionDate: string | null;
    code: string | null;
    kind: InsiderTradeKind;
    kindLabel: string;
    /** A = acquired, D = disposed. */
    acquiredDisposed: 'A' | 'D' | null;
    shares: number | null;
    price: number | null;
    /** shares × price; null when no price was reported. */
    value: number | null;
    sharesOwnedAfter: number | null;
    ownership: 'direct' | 'indirect' | null;
    /** Code P or S. */
    isOpenMarket: boolean;
    /** The filer ticked the Rule 10b5-1 box: the trade was made under a plan set up in advance. */
    planned10b5One: boolean;
    /** "Planned sale (10b5-1 plan)" etc., or null. */
    planLabel: string | null;
    accessionNumber: string;
    filingDate: string;
    form: string;
    /** Filing index page on sec.gov: the link to cite. */
    url: string | null;
    /** The filing as EDGAR renders it. */
    documentUrl: string | null;
}

// ---------------------------------------------------------------------------
// XML reading (xml2js objects, explicitArray: true, namespaces stripped)
// ---------------------------------------------------------------------------

type XmlNode = Record<string, unknown>;

function firstOf(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value;
}

function childNode(node: unknown, key: string): XmlNode | null {
    if (!node || typeof node !== 'object') return null;
    const value = firstOf((node as XmlNode)[key]);
    return value && typeof value === 'object' ? (value as XmlNode) : null;
}

function textOf(value: unknown): string | null {
    const v = firstOf(value);
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number') return String(v);
    if (v && typeof v === 'object' && typeof (v as XmlNode)._ === 'string') return ((v as XmlNode)._ as string).trim() || null;
    return null;
}

/** Text of node[key], or of node[key].value (Form 4 wraps most fields in <value>). */
function fieldText(node: unknown, key: string): string | null {
    if (!node || typeof node !== 'object') return null;
    const raw = (node as XmlNode)[key];
    const direct = textOf(raw);
    if (direct !== null) return direct;
    return textOf(childNode(node, key)?.value);
}

function fieldNumber(node: unknown, key: string): number | null {
    const text = fieldText(node, key);
    if (text === null) return null;
    const n = Number.parseFloat(text.replace(/[,$\s]/g, ''));
    return Number.isFinite(n) ? n : null;
}

/** Keeps dollar figures free of floating-point noise (222.1932 × 12,483 = 2,773,637.7156 -> 2,773,637.72). */
function roundCents(value: number): number {
    return Math.round(value * 100) / 100;
}

function isTrue(text: string | null): boolean {
    return text !== null && /^(1|true|y|yes)$/i.test(text.trim());
}

function cleanCik(text: string | null): string | null {
    const digits = (text || '').replace(/\D/g, '');
    return digits ? digits.padStart(10, '0') : null;
}

function documentRoot(parsed: unknown): XmlNode | null {
    let root = parsed && typeof parsed === 'object' ? (parsed as XmlNode) : null;
    for (let i = 0; i < 2 && root && 'ownershipDocument' in root; i++) {
        const inner = firstOf(root.ownershipDocument);
        root = inner && typeof inner === 'object' ? (inner as XmlNode) : null;
    }
    return root;
}

/** Plain role label from the reporting-owner relationship flags. */
export function roleLabel(flags: { isDirector: boolean; isOfficer: boolean; isTenPercentOwner: boolean; isOther: boolean; officerTitle?: string | null; otherText?: string | null }): string {
    const parts: string[] = [];
    if (flags.isOfficer) parts.push(flags.officerTitle?.trim() || 'Officer');
    if (flags.isDirector) parts.push('Director');
    if (flags.isTenPercentOwner) parts.push('10% owner');
    if (flags.isOther) parts.push(flags.otherText?.trim() || 'Other');
    return parts.length > 0 ? parts.join('; ') : 'Insider';
}

function readOwner(node: XmlNode): InsiderOwner {
    const id = childNode(node, 'reportingOwnerId');
    const rel = childNode(node, 'reportingOwnerRelationship');
    const flags = {
        isDirector: isTrue(fieldText(rel, 'isDirector')),
        isOfficer: isTrue(fieldText(rel, 'isOfficer')),
        isTenPercentOwner: isTrue(fieldText(rel, 'isTenPercentOwner')),
        isOther: isTrue(fieldText(rel, 'isOther')),
        officerTitle: fieldText(rel, 'officerTitle'),
        otherText: fieldText(rel, 'otherText'),
    };
    return {
        name: fieldText(id, 'rptOwnerName') || 'Unknown insider',
        cik: cleanCik(fieldText(id, 'rptOwnerCik')),
        role: roleLabel(flags),
        ...flags,
    };
}

function planLabelFor(kind: InsiderTradeKind): string {
    if (kind === 'sell') return 'Planned sale (10b5-1 plan)';
    if (kind === 'buy') return 'Planned purchase (10b5-1 plan)';
    return 'Under a 10b5-1 plan';
}

/** Transactions from an already-parsed Form 4 (xml2js object). */
export function extractForm4Transactions(parsed: unknown, ref: Form4FilingRef): InsiderTransaction[] {
    const root = documentRoot(parsed);
    if (!root) return [];

    const owners = (Array.isArray(root.reportingOwner) ? root.reportingOwner : [])
        .filter((o): o is XmlNode => Boolean(o) && typeof o === 'object')
        .map(readOwner);
    const owner: InsiderOwner = owners[0] ?? readOwner({});
    const issuer = childNode(root, 'issuer');
    const planned = isTrue(fieldText(root, 'aff10b5One'));
    const accessionNumber = formatAccession(ref.accessionNumber);
    const url = filingIndexUrl(ref.cik, accessionNumber);
    const documentUrl = ref.primaryDocument ? primaryDocUrl(ref.cik, accessionNumber, ref.primaryDocument) : null;

    const table = childNode(root, 'nonDerivativeTable');
    const rows = Array.isArray(table?.nonDerivativeTransaction) ? (table!.nonDerivativeTransaction as unknown[]) : [];

    return rows
        .filter((row): row is XmlNode => Boolean(row) && typeof row === 'object')
        .map((row, n) => {
            const coding = childNode(row, 'transactionCoding');
            const amounts = childNode(row, 'transactionAmounts');
            const post = childNode(row, 'postTransactionAmounts');
            const nature = childNode(row, 'ownershipNature');
            const code = fieldText(coding, 'transactionCode')?.toUpperCase() ?? null;
            const kind = kindForCode(code);
            const shares = fieldNumber(amounts, 'transactionShares');
            const price = fieldNumber(amounts, 'transactionPricePerShare');
            const ad = fieldText(amounts, 'transactionAcquiredDisposedCode')?.toUpperCase();
            const di = fieldText(nature, 'directOrIndirectOwnership')?.toUpperCase();
            return {
                id: `${accessionNumber}-${n + 1}`,
                ownerName: owner.name,
                ownerCik: owner.cik,
                role: owner.role,
                isDirector: owner.isDirector,
                isOfficer: owner.isOfficer,
                isTenPercentOwner: owner.isTenPercentOwner,
                coOwners: owners.slice(1).map((o) => o.name),
                issuerName: fieldText(issuer, 'issuerName'),
                issuerCik: cleanCik(fieldText(issuer, 'issuerCik')),
                issuerTicker: fieldText(issuer, 'issuerTradingSymbol')?.toUpperCase() ?? null,
                securityTitle: fieldText(row, 'securityTitle'),
                transactionDate: fieldText(row, 'transactionDate')?.slice(0, 10) ?? null,
                code,
                kind,
                kindLabel: INSIDER_KIND_LABELS[kind],
                acquiredDisposed: ad === 'A' || ad === 'D' ? ad : null,
                shares,
                price,
                value: shares !== null && price !== null ? roundCents(shares * price) : null,
                sharesOwnedAfter: fieldNumber(post, 'sharesOwnedFollowingTransaction'),
                ownership: di === 'D' ? 'direct' : di === 'I' ? 'indirect' : null,
                isOpenMarket: kind === 'buy' || kind === 'sell',
                planned10b5One: planned,
                planLabel: planned ? planLabelFor(kind) : null,
                accessionNumber,
                filingDate: ref.filingDate,
                form: ref.form,
                url,
                documentUrl,
            };
        });
}

/** Parses a raw Form 4 XML document. Null when it isn't readable XML. */
export async function parseForm4Transactions(xml: string, ref: Form4FilingRef): Promise<InsiderTransaction[] | null> {
    const parsed = await parseForm4(xml);
    if (!parsed || !documentRoot(parsed)?.reportingOwner) return null;
    return extractForm4Transactions(parsed, ref);
}

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

const ownerKey = (t: Pick<InsiderTransaction, 'ownerCik' | 'ownerName'>) => t.ownerCik || t.ownerName.toUpperCase();

/**
 * A 4/A restates an earlier Form 4. When a 4/A reports a transaction for the same insider, date and code as an
 * earlier original, the original's rows are dropped so the trade isn't counted twice.
 */
export function applyAmendments(transactions: InsiderTransaction[]): { transactions: InsiderTransaction[]; replaced: number } {
    const amended = new Map<string, string>(); // key -> latest 4/A filing date
    for (const t of transactions) {
        if (t.form.toUpperCase() !== '4/A') continue;
        const key = `${ownerKey(t)}|${t.transactionDate}|${t.code}`;
        if (!amended.has(key) || amended.get(key)! < t.filingDate) amended.set(key, t.filingDate);
    }
    let replaced = 0;
    const kept = transactions.filter((t) => {
        if (t.form.toUpperCase() === '4/A') return true;
        const amendedOn = amended.get(`${ownerKey(t)}|${t.transactionDate}|${t.code}`);
        if (amendedOn && amendedOn >= t.filingDate) {
            replaced++;
            return false;
        }
        return true;
    });
    return { transactions: kept, replaced };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface TradeTotals {
    count: number;
    /** Dollars; transactions without a price add nothing. */
    value: number;
    /** Distinct insiders. */
    insiders: number;
    insiderNames: string[];
}

export interface BuyCluster {
    /** Distinct insiders who bought on the open market inside the window. */
    insiders: { name: string; cik: string | null; role: string }[];
    insiderCount: number;
    /** First and last purchase dates in the window (at most 30 days apart, counting both ends). */
    from: string;
    to: string;
    transactions: number;
    totalValue: number;
}

export interface InsiderSummary {
    /** Window of transaction dates covered, YYYY-MM-DD, inclusive. */
    from: string;
    to: string;
    months: number;
    buys: TradeTotals;
    sells: TradeTotals & {
        /** Sells the filer marked as made under a 10b5-1 plan. */
        planned: { count: number; value: number };
        /** planned / all sells, 0-1; null when there were no sells. */
        plannedShareOfCount: number | null;
        plannedShareOfValue: number | null;
    };
    /** Awards, option exercises, tax withholding, gifts and other codes in the window. */
    otherTransactions: number;
    /** Set when 3+ distinct insiders bought on the open market within 30 days. */
    cluster: BuyCluster | null;
}

const DAY_MS = 86_400_000;

function isoDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** "2026-11-11" minus n months, clamped to the month's last day ("2026-08-31" - 6 months = "2026-02-28"). */
export function subtractMonths(iso: string, months: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 - months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    return isoDay(target);
}

function dayNumber(iso: string): number {
    return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

function totals(list: InsiderTransaction[]): TradeTotals {
    const names = new Map<string, string>();
    for (const t of list) if (!names.has(ownerKey(t))) names.set(ownerKey(t), t.ownerName);
    return {
        count: list.length,
        value: roundCents(list.reduce((sum, t) => sum + (t.value ?? 0), 0)),
        insiders: names.size,
        insiderNames: Array.from(names.values()),
    };
}

/**
 * The 30-day window (both ends counted, so purchases at most 29 days apart) with the most distinct open-market
 * buyers; null unless that is at least `minInsiders`. Ties go to the larger total, then the earlier window.
 */
export function findBuyCluster(transactions: InsiderTransaction[], windowDays = 30, minInsiders = 3): BuyCluster | null {
    const buys = transactions
        .filter((t) => t.kind === 'buy' && t.transactionDate)
        .sort((a, b) => a.transactionDate!.localeCompare(b.transactionDate!));
    let best: BuyCluster | null = null;
    for (let i = 0; i < buys.length; i++) {
        const start = dayNumber(buys[i].transactionDate!);
        const inWindow = buys.filter((t, j) => j >= i && dayNumber(t.transactionDate!) - start <= windowDays - 1);
        const insiders = new Map<string, { name: string; cik: string | null; role: string }>();
        for (const t of inWindow) if (!insiders.has(ownerKey(t))) insiders.set(ownerKey(t), { name: t.ownerName, cik: t.ownerCik, role: t.role });
        if (insiders.size < minInsiders) continue;
        const candidate: BuyCluster = {
            insiders: Array.from(insiders.values()),
            insiderCount: insiders.size,
            from: buys[i].transactionDate!,
            to: inWindow[inWindow.length - 1].transactionDate!,
            transactions: inWindow.length,
            totalValue: roundCents(inWindow.reduce((sum, t) => sum + (t.value ?? 0), 0)),
        };
        if (!best || candidate.insiderCount > best.insiderCount || (candidate.insiderCount === best.insiderCount && candidate.totalValue > best.totalValue)) {
            best = candidate;
        }
    }
    return best;
}

/** Open-market buys and sells by transaction date over the last `months` months up to `to` (YYYY-MM-DD). */
export function summarizeInsiderTrades(transactions: InsiderTransaction[], options: { to: string; months?: number }): InsiderSummary {
    const months = options.months ?? 6;
    const to = options.to;
    const from = subtractMonths(to, months);
    const inWindow = transactions.filter((t) => {
        const date = t.transactionDate || t.filingDate;
        return date >= from && date <= to;
    });
    const buys = inWindow.filter((t) => t.kind === 'buy');
    const sells = inWindow.filter((t) => t.kind === 'sell');
    const plannedSells = sells.filter((t) => t.planned10b5One);
    const sellTotals = totals(sells);
    const plannedValue = roundCents(plannedSells.reduce((sum, t) => sum + (t.value ?? 0), 0));
    return {
        from,
        to,
        months,
        buys: totals(buys),
        sells: {
            ...sellTotals,
            planned: { count: plannedSells.length, value: plannedValue },
            plannedShareOfCount: sells.length > 0 ? plannedSells.length / sells.length : null,
            plannedShareOfValue: sellTotals.value > 0 ? plannedValue / sellTotals.value : null,
        },
        otherTransactions: inWindow.length - buys.length - sells.length,
        cluster: findBuyCluster(inWindow),
    };
}

/** Newest transaction first (by transaction date, then filing date, then row). */
export function sortTransactionsNewestFirst(transactions: InsiderTransaction[]): InsiderTransaction[] {
    return [...transactions].sort(
        (a, b) =>
            (b.transactionDate || b.filingDate).localeCompare(a.transactionDate || a.filingDate) ||
            b.filingDate.localeCompare(a.filingDate) ||
            a.id.localeCompare(b.id)
    );
}
