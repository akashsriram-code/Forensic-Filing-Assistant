import { classifyFiler, type FilerType } from './filer-classification';
import { getSector } from './sectors';

export type MovementBasis = 'filer-count';

export type MovementAction =
    | 'initiated'
    | 'liquidated'
    | 'increased'
    | 'decreased'
    | 'unchanged'
    | 'absent';

export interface RadarWatchlistItem {
    ticker: string;
    label: string;
    aliases: string[];
}

export interface RadarWatchlist {
    key: string;
    label: string;
    description: string;
    items: RadarWatchlistItem[];
}

export interface RadarFilingRow {
    cik: string;
    fundName: string;
    accessionNumber: string;
    filingDate: string;
    quarter: string;
}

export interface RadarHoldingRow extends RadarFilingRow {
    issuer: string;
    cusip: string | null;
    value: number;
    shares: number;
}

export interface RadarCoverage {
    currentQuarter: string;
    previousQuarter: string;
    currentFilers: number;
    previousFilers: number;
    comparableFilers: number;
    watchedFilers: number;
    watchedHoldingRows: number;
}

export interface CategorySummary {
    key: string;
    label: string;
    currentHolders: number;
    previousHolders: number;
    exposedFilers: number;
    exposedPctOfComparable: number;
    buyers: number;
    sellers: number;
    initiatedFilers: number;
    liquidatedFilers: number;
    unchangedFilers: number;
    currentHolderPctOfComparable: number;
    previousHolderPctOfComparable: number;
    buyerPctOfExposed: number;
    sellerPctOfExposed: number;
    initiatedPctOfExposed: number;
    liquidatedPctOfExposed: number;
    buyerPctOfComparable: number;
    sellerPctOfComparable: number;
    initiatedPctOfComparable: number;
    liquidatedPctOfComparable: number;
    currentValue: number;
    previousValue: number;
}

export interface SecurityMovement {
    categoryKey: string;
    categoryLabel: string;
    issuer: string;
    cusip: string | null;
    currentHolders: number;
    previousHolders: number;
    buyers: number;
    sellers: number;
    initiatedFilers: number;
    liquidatedFilers: number;
    netBuyers: number;
    currentValue: number;
    previousValue: number;
    sampleInitiators: string[];
    sampleLiquidators: string[];
    sampleBuyers: string[];
    sampleSellers: string[];
}

export interface FilerMove {
    cik: string;
    fundName: string;
    categoryKey: string;
    categoryLabel: string;
    action: MovementAction;
    currentShares: number;
    previousShares: number;
    currentValue: number;
    previousValue: number;
    valueDelta: number;
    securityCount: number;
    initiatedCount: number;
    liquidatedCount: number;
    details: FilerMoveDetail[];
}

export interface FilerMoveDetail {
    itemKey: string;
    ticker: string;
    label: string;
    action: MovementAction;
    currentShares: number;
    previousShares: number;
    currentValue: number;
    previousValue: number;
    issuerSamples: string[];
    cusips: string[];
}

export interface FilerSideMatch {
    cik: string;
    fundName: string;
    matchedCategories: string[];
    matchedItems: string[];
    latestFilingDate: string | null;
    hasCurrentQuarter: boolean;
    hasPreviousQuarter: boolean;
}

export interface RadarComparison {
    movementBasis: MovementBasis;
    coverage: RadarCoverage;
    categorySummaries: CategorySummary[];
    sectorMovers: SectorMovementSummary[];
    filerTypeSummaries: FilerTypeSummary[];
    privateCreditInstitutionSummaries: PrivateCreditInstitutionSummary[];
    securityMovements: SecurityMovement[];
    initiations: SecurityMovement[];
    liquidations: SecurityMovement[];
    topFilerMoves: FilerMove[];
}

export interface RadarApiResponse extends RadarComparison {
    availableQuarters: string[];
    watchlists: RadarWatchlist[];
    notes: string[];
}

export interface SectorMovementSummary {
    sector: string;
    exposedFilers: number;
    currentHolders: number;
    previousHolders: number;
    buyers: number;
    sellers: number;
    initiatedFilers: number;
    liquidatedFilers: number;
    netBuyers: number;
    buyerPctOfComparable: number;
    sellerPctOfComparable: number;
    currentValue: number;
    previousValue: number;
}

export interface FilerTypeSummary {
    filerType: FilerType;
    categoryKey: string;
    categoryLabel: string;
    exposedFilers: number;
    currentHolders: number;
    previousHolders: number;
    buyers: number;
    sellers: number;
    initiatedFilers: number;
    liquidatedFilers: number;
    netBuyers: number;
    currentValue: number;
    previousValue: number;
}

export interface PrivateCreditInstitutionSummary {
    cik: string;
    fundName: string;
    filerType: FilerType;
    action: MovementAction;
    currentValue: number;
    previousValue: number;
    valueDelta: number;
    currentShares: number;
    previousShares: number;
    currentItems: string[];
    previousItems: string[];
    initiatedItems: string[];
    liquidatedItems: string[];
}

interface AliasProfile {
    normalized: string;
    compact: string;
}

const aliasProfileCache = new WeakMap<RadarWatchlistItem, AliasProfile[]>();

export interface MatchResult {
    category: RadarWatchlist;
    items: RadarWatchlistItem[];
}

export interface FilerSecurityAuditRow {
    cik: string;
    fundName: string;
    categoryKey: string;
    categoryLabel: string;
    matchedItems: string[];
    securityKey: string;
    issuer: string;
    cusip: string | null;
    action: MovementAction;
    previousAccessionNumber: string;
    currentAccessionNumber: string;
    previousFilingDate: string;
    currentFilingDate: string;
    previousShares: number;
    currentShares: number;
    previousRawValue: number;
    currentRawValue: number;
    previousEstimatedValue: number;
    currentEstimatedValue: number;
    valueDelta: number;
    previousSecFolderUrl: string | null;
    currentSecFolderUrl: string | null;
    previousSubmissionTextUrl: string | null;
    currentSubmissionTextUrl: string | null;
}

export interface MatchedRawHoldingRow extends RadarHoldingRow {
    period: 'current' | 'previous';
    rawReportedValue: number;
    estimatedValue: number;
    matchedCategoryKeys: string[];
    matchedCategories: string[];
    matchedItems: string[];
    secFolderUrl: string | null;
    submissionTextUrl: string | null;
}

export interface RadarAuditResult {
    filerSecurityAuditRows: FilerSecurityAuditRow[];
    rawCurrentHoldings: MatchedRawHoldingRow[];
    rawPreviousHoldings: MatchedRawHoldingRow[];
}

interface FilerSecurityState {
    cik: string;
    fundName: string;
    categoryKey: string;
    categoryLabel: string;
    securityKey: string;
    issuer: string;
    cusip: string | null;
    currentShares: number;
    previousShares: number;
    currentValue: number;
    previousValue: number;
    matchedItems: Map<string, { ticker: string; label: string }>;
}

interface FilerSecurityAuditState extends FilerSecurityState {
    currentRawValue: number;
    previousRawValue: number;
    currentAccessionNumber: string;
    previousAccessionNumber: string;
    currentFilingDate: string;
    previousFilingDate: string;
}

interface FilerCategoryState {
    cik: string;
    fundName: string;
    categoryKey: string;
    categoryLabel: string;
    currentShares: number;
    previousShares: number;
    currentValue: number;
    previousValue: number;
    itemStates: Map<string, FilerMoveDetailState>;
}

interface FilerMoveDetailState {
    itemKey: string;
    ticker: string;
    label: string;
    currentShares: number;
    previousShares: number;
    currentValue: number;
    previousValue: number;
    issuerSamples: string[];
    cusips: Set<string>;
}

interface SectorFilerState {
    cik: string;
    sector: string;
    currentShares: number;
    previousShares: number;
    currentValue: number;
    previousValue: number;
}

const SQL_STOP_WORDS = new Set([
    'A',
    'AN',
    'AND',
    'CLASS',
    'CO',
    'COM',
    'COMMON',
    'CORP',
    'CORPORATION',
    'GROUP',
    'HLDG',
    'HLDGS',
    'HOLDING',
    'HOLDINGS',
    'INC',
    'LTD',
    'NEW',
    'PLC',
    'THE',
]);

export const DEFAULT_RADAR_WATCHLISTS: RadarWatchlist[] = [
    {
        key: 'mag7',
        label: 'Mag 7',
        description: 'Large-cap platform and AI bellwethers.',
        items: [
            { ticker: 'AAPL', label: 'Apple', aliases: ['APPLE', 'APPLE INC'] },
            { ticker: 'MSFT', label: 'Microsoft', aliases: ['MICROSOFT', 'MICROSOFT CORP'] },
            { ticker: 'NVDA', label: 'Nvidia', aliases: ['NVIDIA', 'NVIDIA CORP'] },
            { ticker: 'AMZN', label: 'Amazon', aliases: ['AMAZON', 'AMAZON COM', 'AMAZON.COM'] },
            { ticker: 'META', label: 'Meta', aliases: ['META PLATFORMS', 'FACEBOOK'] },
            { ticker: 'TSLA', label: 'Tesla', aliases: ['TESLA', 'TESLA INC'] },
            { ticker: 'GOOG', label: 'Alphabet Class C', aliases: ['ALPHABET INC CL C', 'ALPHABET INC CLASS C', 'GOOGLE CLASS C'] },
            { ticker: 'GOOGL', label: 'Alphabet Class A', aliases: ['ALPHABET INC CL A', 'ALPHABET INC CLASS A', 'GOOGLE CLASS A'] },
        ],
    },
    {
        key: 'palantir',
        label: 'Palantir',
        description: 'Palantir exposure.',
        items: [
            { ticker: 'PLTR', label: 'Palantir', aliases: ['PALANTIR', 'PALANTIR TECHNOLOGIES'] },
        ],
    },
    {
        key: 'strategy',
        label: 'Strategy',
        description: 'Strategy and legacy MicroStrategy exposure.',
        items: [
            { ticker: 'MSTR', label: 'Strategy', aliases: ['STRATEGY INC', 'MICROSTRATEGY', 'MICRO STRATEGY'] },
        ],
    },
    {
        key: 'energy',
        label: 'Energy',
        description: 'Large oil, gas, services, refining, and LNG names.',
        items: [
            { ticker: 'XOM', label: 'Exxon Mobil', aliases: ['EXXON', 'EXXON MOBIL'] },
            { ticker: 'CVX', label: 'Chevron', aliases: ['CHEVRON'] },
            { ticker: 'OXY', label: 'Occidental', aliases: ['OCCIDENTAL', 'OCCIDENTAL PETROLEUM'] },
            { ticker: 'COP', label: 'ConocoPhillips', aliases: ['CONOCOPHILLIPS', 'CONOCO PHILLIPS'] },
            { ticker: 'EOG', label: 'EOG Resources', aliases: ['EOG RESOURCES'] },
            { ticker: 'SLB', label: 'SLB', aliases: ['SCHLUMBERGER', 'SLB'] },
            { ticker: 'HAL', label: 'Halliburton', aliases: ['HALLIBURTON'] },
            { ticker: 'PSX', label: 'Phillips 66', aliases: ['PHILLIPS 66'] },
            { ticker: 'MPC', label: 'Marathon Petroleum', aliases: ['MARATHON PETROLEUM'] },
            { ticker: 'VLO', label: 'Valero', aliases: ['VALERO', 'VALERO ENERGY'] },
            { ticker: 'DVN', label: 'Devon Energy', aliases: ['DEVON ENERGY'] },
            { ticker: 'FANG', label: 'Diamondback Energy', aliases: ['DIAMONDBACK', 'DIAMONDBACK ENERGY'] },
            { ticker: 'LNG', label: 'Cheniere Energy', aliases: ['CHENIERE', 'CHENIERE ENERGY'] },
        ],
    },
    {
        key: 'bdc',
        label: 'BDC / Alt-Credit',
        description: 'BDCs, private-credit managers, and adjacent alternative lenders.',
        items: [
            { ticker: 'OWL', label: 'Blue Owl Capital', aliases: ['BLUE OWL'] },
            { ticker: 'OBDC', label: 'Blue Owl Capital Corp', aliases: ['BLUE OWL CAPITAL CORP', 'OWL ROCK'] },
            { ticker: 'ARCC', label: 'Ares Capital', aliases: ['ARES CAPITAL'] },
            { ticker: 'ARES', label: 'Ares Management', aliases: ['ARES MANAGEMENT'] },
            { ticker: 'KKR', label: 'KKR', aliases: ['KKR', 'KKR & CO', 'KKR CO'] },
            { ticker: 'FSK', label: 'FS KKR Capital', aliases: ['FS KKR CAPITAL'] },
            { ticker: 'BXSL', label: 'Blackstone Secured Lending', aliases: ['BLACKSTONE SECURED LENDING'] },
            { ticker: 'MAIN', label: 'Main Street Capital', aliases: ['MAIN STREET CAPITAL'] },
            { ticker: 'GBDC', label: 'Golub Capital BDC', aliases: ['GOLUB CAPITAL BDC'] },
            { ticker: 'HTGC', label: 'Hercules Capital', aliases: ['HERCULES CAPITAL'] },
            { ticker: 'TSLX', label: 'Sixth Street Specialty Lending', aliases: ['SIXTH STREET SPECIALTY LENDING'] },
            { ticker: 'PSEC', label: 'Prospect Capital', aliases: ['PROSPECT CAPITAL'] },
        ],
    },
    {
        key: 'software',
        label: 'Software / SaaS',
        description: 'Public software names exposed to AI displacement and budget scrutiny.',
        items: [
            { ticker: 'CRM', label: 'Salesforce', aliases: ['SALESFORCE', 'SALESFORCE INC'] },
            { ticker: 'ADBE', label: 'Adobe', aliases: ['ADOBE', 'ADOBE INC'] },
            { ticker: 'NOW', label: 'ServiceNow', aliases: ['SERVICENOW', 'SERVICE NOW'] },
            { ticker: 'SNOW', label: 'Snowflake', aliases: ['SNOWFLAKE'] },
            { ticker: 'DDOG', label: 'Datadog', aliases: ['DATADOG'] },
            { ticker: 'MDB', label: 'MongoDB', aliases: ['MONGODB', 'MONGO DB'] },
            { ticker: 'NET', label: 'Cloudflare', aliases: ['CLOUDFLARE'] },
            { ticker: 'TEAM', label: 'Atlassian', aliases: ['ATLASSIAN'] },
            { ticker: 'ZS', label: 'Zscaler', aliases: ['ZSCALER'] },
            { ticker: 'CRWD', label: 'CrowdStrike', aliases: ['CROWDSTRIKE', 'CROWD STRIKE'] },
            { ticker: 'OKTA', label: 'Okta', aliases: ['OKTA'] },
            { ticker: 'TWLO', label: 'Twilio', aliases: ['TWILIO'] },
            { ticker: 'HUBS', label: 'HubSpot', aliases: ['HUBSPOT', 'HUB SPOT'] },
            { ticker: 'WDAY', label: 'Workday', aliases: ['WORKDAY'] },
            { ticker: 'DOCU', label: 'DocuSign', aliases: ['DOCUSIGN', 'DOCU SIGN'] },
            { ticker: 'BILL', label: 'BILL Holdings', aliases: ['BILL HOLDINGS', 'BILL COM'] },
            { ticker: 'GTLB', label: 'GitLab', aliases: ['GITLAB', 'GIT LAB'] },
            { ticker: 'ESTC', label: 'Elastic', aliases: ['ELASTIC NV', 'ELASTIC'] },
            { ticker: 'S', label: 'SentinelOne', aliases: ['SENTINELONE', 'SENTINEL ONE'] },
            { ticker: 'ASAN', label: 'Asana', aliases: ['ASANA'] },
        ],
    },
    {
        key: 'semiconductors',
        label: 'Semiconductors',
        description: 'Chip designers, foundries, semiconductor equipment, and analog/memory names.',
        items: [
            { ticker: 'NVDA', label: 'Nvidia', aliases: ['NVIDIA', 'NVIDIA CORP'] },
            { ticker: 'AMD', label: 'Advanced Micro Devices', aliases: ['ADVANCED MICRO DEVICES', 'AMD'] },
            { ticker: 'AVGO', label: 'Broadcom', aliases: ['BROADCOM', 'BROADCOM INC'] },
            { ticker: 'INTC', label: 'Intel', aliases: ['INTEL', 'INTEL CORP'] },
            { ticker: 'QCOM', label: 'Qualcomm', aliases: ['QUALCOMM'] },
            { ticker: 'MU', label: 'Micron', aliases: ['MICRON', 'MICRON TECHNOLOGY'] },
            { ticker: 'TXN', label: 'Texas Instruments', aliases: ['TEXAS INSTRUMENTS'] },
            { ticker: 'AMAT', label: 'Applied Materials', aliases: ['APPLIED MATERIALS'] },
            { ticker: 'LRCX', label: 'Lam Research', aliases: ['LAM RESEARCH'] },
            { ticker: 'KLAC', label: 'KLA', aliases: ['KLA CORP', 'KLA TENCOR'] },
            { ticker: 'ASML', label: 'ASML', aliases: ['ASML', 'ASML HOLDING'] },
            { ticker: 'TSM', label: 'Taiwan Semiconductor', aliases: ['TAIWAN SEMICONDUCTOR', 'TAIWAN SEMICONDUCTOR MANUFACTURING'] },
            { ticker: 'ARM', label: 'Arm Holdings', aliases: ['ARM HOLDINGS'] },
            { ticker: 'MRVL', label: 'Marvell', aliases: ['MARVELL', 'MARVELL TECHNOLOGY'] },
            { ticker: 'ON', label: 'ON Semiconductor', aliases: ['ON SEMICONDUCTOR', 'ONSEMI'] },
            { ticker: 'ADI', label: 'Analog Devices', aliases: ['ANALOG DEVICES'] },
            { ticker: 'MCHP', label: 'Microchip Technology', aliases: ['MICROCHIP TECHNOLOGY'] },
        ],
    },
    {
        key: 'ai-infra',
        label: 'AI Infrastructure',
        description: 'Public infrastructure and platform names commonly cited as AI beneficiaries.',
        items: [
            { ticker: 'ORCL', label: 'Oracle', aliases: ['ORACLE', 'ORACLE CORP'] },
            { ticker: 'ANET', label: 'Arista Networks', aliases: ['ARISTA', 'ARISTA NETWORKS'] },
            { ticker: 'VRT', label: 'Vertiv', aliases: ['VERTIV'] },
            { ticker: 'DELL', label: 'Dell Technologies', aliases: ['DELL', 'DELL TECHNOLOGIES'] },
            { ticker: 'SMCI', label: 'Super Micro Computer', aliases: ['SUPER MICRO', 'SUPER MICRO COMPUTER'] },
            { ticker: 'HPE', label: 'Hewlett Packard Enterprise', aliases: ['HEWLETT PACKARD ENTERPRISE', 'HPE'] },
            { ticker: 'IBM', label: 'IBM', aliases: ['IBM', 'INTERNATIONAL BUSINESS MACHINES'] },
            { ticker: 'AVGO', label: 'Broadcom', aliases: ['BROADCOM', 'BROADCOM INC'] },
            { ticker: 'PLTR', label: 'Palantir', aliases: ['PALANTIR', 'PALANTIR TECHNOLOGIES'] },
        ],
    },
    {
        key: 'utilities-power',
        label: 'Utilities / Power',
        description: 'Power producers and regulated utilities tied to AI/data-center load growth.',
        items: [
            { ticker: 'NEE', label: 'NextEra Energy', aliases: ['NEXTERA', 'NEXTERA ENERGY'] },
            { ticker: 'CEG', label: 'Constellation Energy', aliases: ['CONSTELLATION ENERGY'] },
            { ticker: 'VST', label: 'Vistra', aliases: ['VISTRA'] },
            { ticker: 'NRG', label: 'NRG Energy', aliases: ['NRG ENERGY'] },
            { ticker: 'SO', label: 'Southern Company', aliases: ['SOUTHERN CO', 'SOUTHERN COMPANY'] },
            { ticker: 'DUK', label: 'Duke Energy', aliases: ['DUKE ENERGY'] },
            { ticker: 'AEP', label: 'American Electric Power', aliases: ['AMERICAN ELECTRIC POWER'] },
            { ticker: 'EXC', label: 'Exelon', aliases: ['EXELON'] },
            { ticker: 'PEG', label: 'Public Service Enterprise', aliases: ['PUBLIC SERVICE ENTERPRISE', 'PSEG'] },
            { ticker: 'SRE', label: 'Sempra', aliases: ['SEMPRA'] },
            { ticker: 'PCG', label: 'PG&E', aliases: ['PG&E', 'PG E CORP'] },
            { ticker: 'ETR', label: 'Entergy', aliases: ['ENTERGY'] },
            { ticker: 'D', label: 'Dominion Energy', aliases: ['DOMINION ENERGY'] },
            { ticker: 'XEL', label: 'Xcel Energy', aliases: ['XCEL ENERGY'] },
            { ticker: 'AES', label: 'AES', aliases: ['AES CORP'] },
        ],
    },
    {
        key: 'data-centers',
        label: 'Data Centers',
        description: 'Data-center REITs, towers, power equipment, and buildout enablers.',
        items: [
            { ticker: 'EQIX', label: 'Equinix', aliases: ['EQUINIX'] },
            { ticker: 'DLR', label: 'Digital Realty', aliases: ['DIGITAL REALTY'] },
            { ticker: 'IRM', label: 'Iron Mountain', aliases: ['IRON MOUNTAIN'] },
            { ticker: 'AMT', label: 'American Tower', aliases: ['AMERICAN TOWER'] },
            { ticker: 'CCI', label: 'Crown Castle', aliases: ['CROWN CASTLE'] },
            { ticker: 'VRT', label: 'Vertiv', aliases: ['VERTIV'] },
            { ticker: 'ETN', label: 'Eaton', aliases: ['EATON'] },
            { ticker: 'PWR', label: 'Quanta Services', aliases: ['QUANTA SERVICES'] },
        ],
    },
];

export function normalizeIssuerName(value: string): string {
    return value
        .toUpperCase()
        .replace(/&/g, ' AND ')
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function compactIssuerName(value: string): string {
    return normalizeIssuerName(value).replace(/\s+/g, '');
}

export function compareQuartersAsc(a: string, b: string): number {
    const parsedA = parseQuarter(a);
    const parsedB = parseQuarter(b);
    if (!parsedA && !parsedB) return a.localeCompare(b);
    if (!parsedA) return -1;
    if (!parsedB) return 1;
    return parsedA.year === parsedB.year ? parsedA.quarter - parsedB.quarter : parsedA.year - parsedB.year;
}

export function sortQuartersDesc(quarters: string[]): string[] {
    return [...new Set(quarters)].sort((a, b) => compareQuartersAsc(b, a));
}

export function normalizeCik(cik: string): string {
    const raw = String(cik || '').trim();
    const digits = raw.replace(/\D/g, '');
    const unpadded = digits.replace(/^0+/, '');
    return unpadded || raw;
}

export function classifyMovement(previousShares: number, currentShares: number): MovementAction {
    if (previousShares <= 0 && currentShares <= 0) return 'absent';
    if (previousShares <= 0 && currentShares > 0) return 'initiated';
    if (previousShares > 0 && currentShares <= 0) return 'liquidated';
    if (currentShares > previousShares) return 'increased';
    if (currentShares < previousShares) return 'decreased';
    return 'unchanged';
}

export function selectLatestFilings(rows: RadarFilingRow[], quarter?: string): RadarFilingRow[] {
    const latestByCik = new Map<string, RadarFilingRow>();
    const sorted = rows
        .filter((row) => !quarter || row.quarter === quarter)
        .sort((a, b) => {
            const dateCmp = b.filingDate.localeCompare(a.filingDate);
            if (dateCmp !== 0) return dateCmp;
            return b.accessionNumber.localeCompare(a.accessionNumber);
        });

    for (const row of sorted) {
        const cik = normalizeCik(row.cik);
        if (!latestByCik.has(cik)) {
            latestByCik.set(cik, { ...row, cik });
        }
    }

    return Array.from(latestByCik.values());
}

export function issuerMatchesItem(issuer: string, item: RadarWatchlistItem): boolean {
    const issuerNorm = normalizeIssuerName(issuer);
    const issuerCompact = compactIssuerName(issuer);

    return issuerMatchesPreparedItem(issuerNorm, issuerCompact, item);
}

export function matchIssuerToWatchlists(
    issuer: string,
    watchlists: RadarWatchlist[],
    selectedCategories?: string[]
): MatchResult[] {
    const selected = selectedCategories && selectedCategories.length > 0 ? new Set(selectedCategories) : null;
    const issuerNorm = normalizeIssuerName(issuer);
    const issuerCompact = issuerNorm.replace(/\s+/g, '');
    const matches: MatchResult[] = [];

    for (const watchlist of watchlists) {
        if (selected && !selected.has(watchlist.key)) continue;
        const items = watchlist.items.filter((item) => issuerMatchesPreparedItem(issuerNorm, issuerCompact, item));
        if (items.length > 0) {
            matches.push({ category: watchlist, items });
        }
    }

    return matches;
}

export function buildIssuerSqlPatterns(watchlists: RadarWatchlist[], selectedCategories?: string[]): string[] {
    const selected = selectedCategories && selectedCategories.length > 0 ? new Set(selectedCategories) : null;
    const patterns = new Set<string>();

    for (const watchlist of watchlists) {
        if (selected && !selected.has(watchlist.key)) continue;

        for (const item of watchlist.items) {
            for (const alias of getItemAliases(item)) {
                const words = normalizeIssuerName(alias)
                    .split(' ')
                    .filter((word) => word.length >= 3 && !SQL_STOP_WORDS.has(word));

                if (words.length === 0) continue;
                patterns.add(`%${escapeLikePattern(words[0])}%`);
                if (words.length > 1) {
                    patterns.add(`%${escapeLikePattern(words[0])}%${escapeLikePattern(words[1])}%`);
                }
            }
        }
    }

    return Array.from(patterns);
}

export function hydrateEditableWatchlists(
    defaults: RadarWatchlist[],
    editedItemsByKey: Record<string, string[]>
): RadarWatchlist[] {
    return defaults.map((watchlist) => {
        const editedItems = editedItemsByKey[watchlist.key];
        if (!editedItems) return watchlist;

        const existingByTicker = new Map(watchlist.items.map((item) => [item.ticker.toUpperCase(), item]));
        const existingByLabel = new Map(watchlist.items.map((item) => [item.label.toUpperCase(), item]));

        const items = editedItems
            .map((raw) => raw.trim())
            .filter(Boolean)
            .map((raw) => {
                const key = raw.toUpperCase();
                const existing = existingByTicker.get(key) || existingByLabel.get(key);
                if (existing) return existing;
                return { ticker: key, label: raw, aliases: [raw] };
            });

        return { ...watchlist, items };
    });
}

export function buildRadarComparison(params: {
    currentQuarter: string;
    previousQuarter: string;
    filings: RadarFilingRow[];
    holdings: RadarHoldingRow[];
    watchlists: RadarWatchlist[];
    selectedCategories?: string[];
    movementBasis?: MovementBasis;
}): RadarComparison {
    const {
        currentQuarter,
        previousQuarter,
        filings,
        holdings,
        watchlists,
        selectedCategories,
        movementBasis = 'filer-count',
    } = params;

    const selectedWatchlists = watchlists.filter((watchlist) =>
        !selectedCategories || selectedCategories.length === 0 || selectedCategories.includes(watchlist.key)
    );

    const normalizedFilings = filings.map((filing) => ({ ...filing, cik: normalizeCik(filing.cik) }));
    const normalizedHoldings = holdings.map((holding) => ({ ...holding, cik: normalizeCik(holding.cik) }));
    const currentFilings = selectLatestFilings(normalizedFilings, currentQuarter);
    const previousFilings = selectLatestFilings(normalizedFilings, previousQuarter);
    const currentByCik = new Map(currentFilings.map((filing) => [filing.cik, filing]));
    const previousByCik = new Map(previousFilings.map((filing) => [filing.cik, filing]));
    const comparableCiks = Array.from(currentByCik.keys()).filter((cik) => previousByCik.has(cik)).sort();
    const comparableSet = new Set(comparableCiks);
    const currentAccessionByCik = new Map(currentFilings.map((filing) => [filing.cik, filing.accessionNumber]));
    const previousAccessionByCik = new Map(previousFilings.map((filing) => [filing.cik, filing.accessionNumber]));
    const filerNameByCik = new Map<string, string>();

    for (const filing of [...currentFilings, ...previousFilings]) {
        if (!filerNameByCik.has(filing.cik)) filerNameByCik.set(filing.cik, filing.fundName);
    }

    const securityStates = new Map<string, FilerSecurityState>();
    const sectorSecurityStates = new Map<string, SectorFilerState>();
    let watchedHoldingRows = 0;

    for (const row of normalizedHoldings) {
        if (!comparableSet.has(row.cik)) continue;

        const period =
            row.quarter === currentQuarter && currentAccessionByCik.get(row.cik) === row.accessionNumber
                ? 'current'
                : row.quarter === previousQuarter && previousAccessionByCik.get(row.cik) === row.accessionNumber
                    ? 'previous'
                    : null;

        if (!period) continue;

        const matches = matchIssuerToWatchlists(row.issuer, selectedWatchlists, selectedCategories);
        if (matches.length === 0) continue;

        watchedHoldingRows++;
        const sectorSecurityKey = `${row.cik}|${row.cusip || compactIssuerName(row.issuer)}`;
        const sectorSecurityState = sectorSecurityStates.get(sectorSecurityKey) || {
            cik: row.cik,
            sector: getSector(row.issuer),
            currentShares: 0,
            previousShares: 0,
            currentValue: 0,
            previousValue: 0,
        };
        if (period === 'current') {
            sectorSecurityState.currentShares += safeNumber(row.shares);
            sectorSecurityState.currentValue += estimateActualValue(row.value, row.shares);
        } else {
            sectorSecurityState.previousShares += safeNumber(row.shares);
            sectorSecurityState.previousValue += estimateActualValue(row.value, row.shares);
        }
        sectorSecurityStates.set(sectorSecurityKey, sectorSecurityState);

        for (const match of matches) {
            const securityKey = row.cusip || compactIssuerName(row.issuer);
            const stateKey = `${row.cik}|${match.category.key}|${securityKey}`;
            const existing = securityStates.get(stateKey);
            const state: FilerSecurityState = existing || {
                cik: row.cik,
                fundName: filerNameByCik.get(row.cik) || row.fundName || row.cik,
                categoryKey: match.category.key,
                categoryLabel: match.category.label,
                securityKey,
                issuer: row.issuer,
                cusip: row.cusip,
                currentShares: 0,
                previousShares: 0,
                currentValue: 0,
                previousValue: 0,
                matchedItems: new Map<string, { ticker: string; label: string }>(),
            };

            for (const item of match.items) {
                state.matchedItems.set(canonicalItemKey(match.category.key, item), {
                    ticker: item.ticker,
                    label: item.label,
                });
            }

            if (period === 'current') {
                state.currentShares += safeNumber(row.shares);
                state.currentValue += estimateActualValue(row.value, row.shares);
                state.issuer = row.issuer || state.issuer;
                state.cusip = row.cusip || state.cusip;
            } else {
                state.previousShares += safeNumber(row.shares);
                state.previousValue += estimateActualValue(row.value, row.shares);
                if (!state.issuer || state.issuer === 'Unknown') state.issuer = row.issuer;
                if (!state.cusip) state.cusip = row.cusip;
            }

            securityStates.set(stateKey, state);
        }
    }

    const securitySummaryMap = new Map<string, SecurityMovement>();
    const categoryByFilerMap = new Map<string, FilerCategoryState>();
    const watchedFilerSet = new Set<string>();

    for (const state of securityStates.values()) {
        const action = classifyMovement(state.previousShares, state.currentShares);
        if (action === 'absent') continue;

        watchedFilerSet.add(state.cik);
        const securitySummaryKey = `${state.categoryKey}|${state.securityKey}`;
        const securitySummary = securitySummaryMap.get(securitySummaryKey) || {
            categoryKey: state.categoryKey,
            categoryLabel: state.categoryLabel,
            issuer: state.issuer,
            cusip: state.cusip,
            currentHolders: 0,
            previousHolders: 0,
            buyers: 0,
            sellers: 0,
            initiatedFilers: 0,
            liquidatedFilers: 0,
            netBuyers: 0,
            currentValue: 0,
            previousValue: 0,
            sampleInitiators: [],
            sampleLiquidators: [],
            sampleBuyers: [],
            sampleSellers: [],
        };

        if (state.currentShares > 0) securitySummary.currentHolders++;
        if (state.previousShares > 0) securitySummary.previousHolders++;
        if (state.currentShares > state.previousShares) {
            securitySummary.buyers++;
            pushSample(securitySummary.sampleBuyers, state.fundName);
        }
        if (state.currentShares < state.previousShares) {
            securitySummary.sellers++;
            pushSample(securitySummary.sampleSellers, state.fundName);
        }
        if (action === 'initiated') {
            securitySummary.initiatedFilers++;
            pushSample(securitySummary.sampleInitiators, state.fundName);
        }
        if (action === 'liquidated') {
            securitySummary.liquidatedFilers++;
            pushSample(securitySummary.sampleLiquidators, state.fundName);
        }
        securitySummary.netBuyers = securitySummary.buyers - securitySummary.sellers;
        securitySummary.currentValue += state.currentValue;
        securitySummary.previousValue += state.previousValue;
        if (state.currentValue > securitySummary.currentValue || !securitySummary.issuer) {
            securitySummary.issuer = state.issuer;
        }
        securitySummaryMap.set(securitySummaryKey, securitySummary);

        const categoryKey = `${state.cik}|${state.categoryKey}`;
        const categoryState = categoryByFilerMap.get(categoryKey) || {
            cik: state.cik,
            fundName: state.fundName,
            categoryKey: state.categoryKey,
            categoryLabel: state.categoryLabel,
            currentShares: 0,
            previousShares: 0,
            currentValue: 0,
            previousValue: 0,
            itemStates: new Map<string, FilerMoveDetailState>(),
        };
        categoryState.currentShares += state.currentShares;
        categoryState.previousShares += state.previousShares;
        categoryState.currentValue += state.currentValue;
        categoryState.previousValue += state.previousValue;
        for (const [itemKey, item] of state.matchedItems) {
            const detail = categoryState.itemStates.get(itemKey) || {
                itemKey,
                ticker: item.ticker,
                label: item.label,
                currentShares: 0,
                previousShares: 0,
                currentValue: 0,
                previousValue: 0,
                issuerSamples: [],
                cusips: new Set<string>(),
            };
            detail.currentShares += state.currentShares;
            detail.previousShares += state.previousShares;
            detail.currentValue += state.currentValue;
            detail.previousValue += state.previousValue;
            pushSample(detail.issuerSamples, state.issuer);
            if (state.cusip) detail.cusips.add(state.cusip);
            categoryState.itemStates.set(itemKey, detail);
        }
        categoryByFilerMap.set(categoryKey, categoryState);
    }

    const categorySummaries = selectedWatchlists.map((watchlist) => {
        let currentHolders = 0;
        let previousHolders = 0;
        let exposedFilers = 0;
        let buyers = 0;
        let sellers = 0;
        let initiatedFilers = 0;
        let liquidatedFilers = 0;
        let unchangedFilers = 0;
        let currentValue = 0;
        let previousValue = 0;

        for (const state of categoryByFilerMap.values()) {
            if (state.categoryKey !== watchlist.key) continue;
            const action = classifyMovement(state.previousShares, state.currentShares);
            if (action === 'absent') continue;
            exposedFilers++;
            if (state.currentShares > 0) currentHolders++;
            if (state.previousShares > 0) previousHolders++;
            if (state.currentShares > state.previousShares) buyers++;
            if (state.currentShares < state.previousShares) sellers++;
            if (action === 'initiated') initiatedFilers++;
            if (action === 'liquidated') liquidatedFilers++;
            if (action === 'unchanged') unchangedFilers++;
            currentValue += state.currentValue;
            previousValue += state.previousValue;
        }

        return {
            key: watchlist.key,
            label: watchlist.label,
            currentHolders,
            previousHolders,
            exposedFilers,
            exposedPctOfComparable: pct(exposedFilers, comparableCiks.length),
            buyers,
            sellers,
            initiatedFilers,
            liquidatedFilers,
            unchangedFilers,
            currentHolderPctOfComparable: pct(currentHolders, comparableCiks.length),
            previousHolderPctOfComparable: pct(previousHolders, comparableCiks.length),
            buyerPctOfExposed: pct(buyers, exposedFilers),
            sellerPctOfExposed: pct(sellers, exposedFilers),
            initiatedPctOfExposed: pct(initiatedFilers, exposedFilers),
            liquidatedPctOfExposed: pct(liquidatedFilers, exposedFilers),
            buyerPctOfComparable: pct(buyers, comparableCiks.length),
            sellerPctOfComparable: pct(sellers, comparableCiks.length),
            initiatedPctOfComparable: pct(initiatedFilers, comparableCiks.length),
            liquidatedPctOfComparable: pct(liquidatedFilers, comparableCiks.length),
            currentValue,
            previousValue,
        };
    });

    const securityMovements = Array.from(securitySummaryMap.values()).sort((a, b) => {
        const first = b.initiatedFilers + b.liquidatedFilers - (a.initiatedFilers + a.liquidatedFilers);
        if (first !== 0) return first;
        return b.currentValue + b.previousValue - (a.currentValue + a.previousValue);
    });

    const topFilerMoves = Array.from(categoryByFilerMap.values())
        .map((state) => {
            const details = Array.from(state.itemStates.values())
                .map((detail) => ({
                    itemKey: detail.itemKey,
                    ticker: detail.ticker,
                    label: detail.label,
                    action: classifyMovement(detail.previousShares, detail.currentShares),
                    currentShares: detail.currentShares,
                    previousShares: detail.previousShares,
                    currentValue: detail.currentValue,
                    previousValue: detail.previousValue,
                    issuerSamples: detail.issuerSamples,
                    cusips: Array.from(detail.cusips).sort(),
                }))
                .filter((detail) => detail.action !== 'absent')
                .sort((a, b) => Math.abs(b.currentValue - b.previousValue) - Math.abs(a.currentValue - a.previousValue));

            return {
                cik: state.cik,
                fundName: state.fundName,
                categoryKey: state.categoryKey,
                categoryLabel: state.categoryLabel,
                action: classifyMovement(state.previousShares, state.currentShares),
                currentShares: state.currentShares,
                previousShares: state.previousShares,
                currentValue: state.currentValue,
                previousValue: state.previousValue,
                valueDelta: state.currentValue - state.previousValue,
                securityCount: details.length,
                initiatedCount: details.filter((detail) => detail.action === 'initiated').length,
                liquidatedCount: details.filter((detail) => detail.action === 'liquidated').length,
                details,
            };
        })
        .filter((move) => move.action !== 'absent' && move.action !== 'unchanged')
        .sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta));

    const sectorByFilerMap = new Map<string, SectorFilerState>();
    for (const state of sectorSecurityStates.values()) {
        const sectorKey = `${state.cik}|${state.sector}`;
        const sectorState = sectorByFilerMap.get(sectorKey) || {
            cik: state.cik,
            sector: state.sector,
            currentShares: 0,
            previousShares: 0,
            currentValue: 0,
            previousValue: 0,
        };
        sectorState.currentShares += state.currentShares;
        sectorState.previousShares += state.previousShares;
        sectorState.currentValue += state.currentValue;
        sectorState.previousValue += state.previousValue;
        sectorByFilerMap.set(sectorKey, sectorState);
    }

    const sectorMovers = buildSectorMovers(Array.from(sectorByFilerMap.values()), comparableCiks.length);
    const filerTypeSummaries = buildFilerTypeSummaries(Array.from(categoryByFilerMap.values()));
    const privateCreditInstitutionSummaries = buildPrivateCreditInstitutionSummaries(Array.from(categoryByFilerMap.values()));

    return {
        movementBasis,
        coverage: {
            currentQuarter,
            previousQuarter,
            currentFilers: currentFilings.length,
            previousFilers: previousFilings.length,
            comparableFilers: comparableCiks.length,
            watchedFilers: watchedFilerSet.size,
            watchedHoldingRows,
        },
        categorySummaries,
        sectorMovers,
        filerTypeSummaries,
        privateCreditInstitutionSummaries,
        securityMovements,
        initiations: securityMovements
            .filter((movement) => movement.initiatedFilers > 0)
            .sort((a, b) => b.initiatedFilers - a.initiatedFilers || b.currentValue - a.currentValue),
        liquidations: securityMovements
            .filter((movement) => movement.liquidatedFilers > 0)
            .sort((a, b) => b.liquidatedFilers - a.liquidatedFilers || b.previousValue - a.previousValue),
        topFilerMoves,
    };
}

function buildSectorMovers(states: SectorFilerState[], comparableFilers: number): SectorMovementSummary[] {
    const summaryMap = new Map<string, SectorMovementSummary>();
    for (const state of states) {
        const action = classifyMovement(state.previousShares, state.currentShares);
        if (action === 'absent') continue;
        const summary = summaryMap.get(state.sector) || {
            sector: state.sector,
            exposedFilers: 0,
            currentHolders: 0,
            previousHolders: 0,
            buyers: 0,
            sellers: 0,
            initiatedFilers: 0,
            liquidatedFilers: 0,
            netBuyers: 0,
            buyerPctOfComparable: 0,
            sellerPctOfComparable: 0,
            currentValue: 0,
            previousValue: 0,
        };
        summary.exposedFilers++;
        if (state.currentShares > 0) summary.currentHolders++;
        if (state.previousShares > 0) summary.previousHolders++;
        if (state.currentShares > state.previousShares) summary.buyers++;
        if (state.currentShares < state.previousShares) summary.sellers++;
        if (action === 'initiated') summary.initiatedFilers++;
        if (action === 'liquidated') summary.liquidatedFilers++;
        summary.currentValue += state.currentValue;
        summary.previousValue += state.previousValue;
        summary.netBuyers = summary.buyers - summary.sellers;
        summary.buyerPctOfComparable = pct(summary.buyers, comparableFilers);
        summary.sellerPctOfComparable = pct(summary.sellers, comparableFilers);
        summaryMap.set(state.sector, summary);
    }

    return Array.from(summaryMap.values()).sort((a, b) =>
        Math.abs(b.netBuyers) - Math.abs(a.netBuyers) ||
        Math.abs((b.currentValue - b.previousValue)) - Math.abs((a.currentValue - a.previousValue))
    );
}

function buildFilerTypeSummaries(states: FilerCategoryState[]): FilerTypeSummary[] {
    const summaryMap = new Map<string, FilerTypeSummary>();
    for (const state of states) {
        const action = classifyMovement(state.previousShares, state.currentShares);
        if (action === 'absent') continue;
        const filerType = classifyFiler(state.cik, state.fundName).type;
        const summaryKey = `${filerType}|${state.categoryKey}`;
        const summary = summaryMap.get(summaryKey) || {
            filerType,
            categoryKey: state.categoryKey,
            categoryLabel: state.categoryLabel,
            exposedFilers: 0,
            currentHolders: 0,
            previousHolders: 0,
            buyers: 0,
            sellers: 0,
            initiatedFilers: 0,
            liquidatedFilers: 0,
            netBuyers: 0,
            currentValue: 0,
            previousValue: 0,
        };
        summary.exposedFilers++;
        if (state.currentShares > 0) summary.currentHolders++;
        if (state.previousShares > 0) summary.previousHolders++;
        if (state.currentShares > state.previousShares) summary.buyers++;
        if (state.currentShares < state.previousShares) summary.sellers++;
        if (action === 'initiated') summary.initiatedFilers++;
        if (action === 'liquidated') summary.liquidatedFilers++;
        summary.netBuyers = summary.buyers - summary.sellers;
        summary.currentValue += state.currentValue;
        summary.previousValue += state.previousValue;
        summaryMap.set(summaryKey, summary);
    }

    return Array.from(summaryMap.values()).sort((a, b) =>
        a.filerType.localeCompare(b.filerType) ||
        Math.abs(b.netBuyers) - Math.abs(a.netBuyers) ||
        a.categoryLabel.localeCompare(b.categoryLabel)
    );
}

function buildPrivateCreditInstitutionSummaries(states: FilerCategoryState[]): PrivateCreditInstitutionSummary[] {
    const summaries: PrivateCreditInstitutionSummary[] = [];

    for (const state of states) {
        if (state.categoryKey !== 'bdc') continue;
        const classification = classifyFiler(state.cik, state.fundName);
        if (classification.type !== 'Pension / Public Fund' && classification.type !== 'University / Endowment') continue;

        const action = classifyMovement(state.previousShares, state.currentShares);
        if (action === 'absent') continue;

        const details = Array.from(state.itemStates.values()).map((detail) => ({
            label: detail.label,
            action: classifyMovement(detail.previousShares, detail.currentShares),
            currentShares: detail.currentShares,
            previousShares: detail.previousShares,
        }));

        summaries.push({
            cik: state.cik,
            fundName: state.fundName,
            filerType: classification.type,
            action,
            currentValue: state.currentValue,
            previousValue: state.previousValue,
            valueDelta: state.currentValue - state.previousValue,
            currentShares: state.currentShares,
            previousShares: state.previousShares,
            currentItems: uniqueStrings(details.filter((detail) => detail.currentShares > 0).map((detail) => detail.label)),
            previousItems: uniqueStrings(details.filter((detail) => detail.previousShares > 0).map((detail) => detail.label)),
            initiatedItems: uniqueStrings(details.filter((detail) => detail.action === 'initiated').map((detail) => detail.label)),
            liquidatedItems: uniqueStrings(details.filter((detail) => detail.action === 'liquidated').map((detail) => detail.label)),
        });
    }

    return summaries.sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta) || b.currentValue - a.currentValue);
}

export function buildRadarAudit(params: {
    currentQuarter: string;
    previousQuarter: string;
    filings: RadarFilingRow[];
    holdings: RadarHoldingRow[];
    watchlists: RadarWatchlist[];
    selectedCategories?: string[];
}): RadarAuditResult {
    const { currentQuarter, previousQuarter, filings, holdings, watchlists, selectedCategories } = params;
    const selectedWatchlists = watchlists.filter((watchlist) =>
        !selectedCategories || selectedCategories.length === 0 || selectedCategories.includes(watchlist.key)
    );

    const normalizedFilings = filings.map((filing) => ({ ...filing, cik: normalizeCik(filing.cik) }));
    const normalizedHoldings = holdings.map((holding) => ({ ...holding, cik: normalizeCik(holding.cik) }));
    const currentFilings = selectLatestFilings(normalizedFilings, currentQuarter);
    const previousFilings = selectLatestFilings(normalizedFilings, previousQuarter);
    const currentByCik = new Map(currentFilings.map((filing) => [filing.cik, filing]));
    const previousByCik = new Map(previousFilings.map((filing) => [filing.cik, filing]));
    const comparableSet = new Set(Array.from(currentByCik.keys()).filter((cik) => previousByCik.has(cik)));
    const states = new Map<string, FilerSecurityAuditState>();
    const rawCurrentHoldings: MatchedRawHoldingRow[] = [];
    const rawPreviousHoldings: MatchedRawHoldingRow[] = [];

    for (const row of normalizedHoldings) {
        if (!comparableSet.has(row.cik)) continue;

        const currentFiling = currentByCik.get(row.cik);
        const previousFiling = previousByCik.get(row.cik);
        if (!currentFiling || !previousFiling) continue;

        const period =
            row.quarter === currentQuarter && currentFiling.accessionNumber === row.accessionNumber
                ? 'current'
                : row.quarter === previousQuarter && previousFiling.accessionNumber === row.accessionNumber
                    ? 'previous'
                    : null;

        if (!period) continue;

        const matches = matchIssuerToWatchlists(row.issuer, selectedWatchlists, selectedCategories);
        if (matches.length === 0) continue;

        const matchedCategoryKeys = uniqueStrings(matches.map((match) => match.category.key));
        const matchedCategories = uniqueStrings(matches.map((match) => match.category.label));
        const matchedItems = uniqueStrings(matches.flatMap((match) => match.items.map((item) => item.label)));
        const rawHolding: MatchedRawHoldingRow = {
            ...row,
            period,
            rawReportedValue: row.value,
            estimatedValue: estimateActualValue(row.value, row.shares),
            matchedCategoryKeys,
            matchedCategories,
            matchedItems,
            secFolderUrl: buildSecAccessionFolderUrl(row.cik, row.accessionNumber),
            submissionTextUrl: buildSecSubmissionTextUrl(row.cik, row.accessionNumber),
        };

        if (period === 'current') {
            rawCurrentHoldings.push(rawHolding);
        } else {
            rawPreviousHoldings.push(rawHolding);
        }

        for (const match of matches) {
            const securityKey = row.cusip || compactIssuerName(row.issuer);
            const stateKey = `${row.cik}|${match.category.key}|${securityKey}`;
            const existing = states.get(stateKey);
            const state: FilerSecurityAuditState = existing || {
                cik: row.cik,
                fundName: currentFiling.fundName || previousFiling.fundName || row.fundName || row.cik,
                categoryKey: match.category.key,
                categoryLabel: match.category.label,
                securityKey,
                issuer: row.issuer,
                cusip: row.cusip,
                currentShares: 0,
                previousShares: 0,
                currentValue: 0,
                previousValue: 0,
                currentRawValue: 0,
                previousRawValue: 0,
                matchedItems: new Map<string, { ticker: string; label: string }>(),
                currentAccessionNumber: currentFiling.accessionNumber,
                previousAccessionNumber: previousFiling.accessionNumber,
                currentFilingDate: currentFiling.filingDate,
                previousFilingDate: previousFiling.filingDate,
            };

            for (const item of match.items) {
                state.matchedItems.set(canonicalItemKey(match.category.key, item), {
                    ticker: item.ticker,
                    label: item.label,
                });
            }

            if (period === 'current') {
                state.currentShares += safeNumber(row.shares);
                state.currentRawValue += safeNumber(row.value);
                state.currentValue += estimateActualValue(row.value, row.shares);
                state.issuer = row.issuer || state.issuer;
                state.cusip = row.cusip || state.cusip;
            } else {
                state.previousShares += safeNumber(row.shares);
                state.previousRawValue += safeNumber(row.value);
                state.previousValue += estimateActualValue(row.value, row.shares);
                if (!state.issuer || state.issuer === 'Unknown') state.issuer = row.issuer;
                if (!state.cusip) state.cusip = row.cusip;
            }

            states.set(stateKey, state);
        }
    }

    const filerSecurityAuditRows = Array.from(states.values())
        .map((state) => {
            const action = classifyMovement(state.previousShares, state.currentShares);
            return {
                cik: state.cik,
                fundName: state.fundName,
                categoryKey: state.categoryKey,
                categoryLabel: state.categoryLabel,
                matchedItems: uniqueStrings(Array.from(state.matchedItems.values()).map((item) => item.label)),
                securityKey: state.securityKey,
                issuer: state.issuer,
                cusip: state.cusip,
                action,
                previousAccessionNumber: state.previousAccessionNumber,
                currentAccessionNumber: state.currentAccessionNumber,
                previousFilingDate: state.previousFilingDate,
                currentFilingDate: state.currentFilingDate,
                previousShares: state.previousShares,
                currentShares: state.currentShares,
                previousRawValue: state.previousRawValue,
                currentRawValue: state.currentRawValue,
                previousEstimatedValue: state.previousValue,
                currentEstimatedValue: state.currentValue,
                valueDelta: state.currentValue - state.previousValue,
                previousSecFolderUrl: buildSecAccessionFolderUrl(state.cik, state.previousAccessionNumber),
                currentSecFolderUrl: buildSecAccessionFolderUrl(state.cik, state.currentAccessionNumber),
                previousSubmissionTextUrl: buildSecSubmissionTextUrl(state.cik, state.previousAccessionNumber),
                currentSubmissionTextUrl: buildSecSubmissionTextUrl(state.cik, state.currentAccessionNumber),
            };
        })
        .filter((row) => row.action !== 'absent')
        .sort((a, b) =>
            a.categoryLabel.localeCompare(b.categoryLabel) ||
            a.issuer.localeCompare(b.issuer) ||
            a.fundName.localeCompare(b.fundName)
        );

    return {
        filerSecurityAuditRows,
        rawCurrentHoldings: sortRawHoldings(rawCurrentHoldings),
        rawPreviousHoldings: sortRawHoldings(rawPreviousHoldings),
    };
}

function parseQuarter(value: string): { year: number; quarter: number } | null {
    const match = value.match(/^(\d{4})-Q([1-4])$/);
    if (!match) return null;
    return { year: Number(match[1]), quarter: Number(match[2]) };
}

function getItemAliases(item: RadarWatchlistItem): string[] {
    return item.aliases
        .map((alias) => alias.trim())
        .filter(Boolean);
}

function getItemAliasProfiles(item: RadarWatchlistItem): AliasProfile[] {
    const cached = aliasProfileCache.get(item);
    if (cached) return cached;

    const profiles = getItemAliases(item)
        .map((alias) => ({
            normalized: normalizeIssuerName(alias),
            compact: compactIssuerName(alias),
        }))
        .filter((alias) => alias.compact.length >= 4);

    aliasProfileCache.set(item, profiles);
    return profiles;
}

function canonicalItemKey(categoryKey: string, item: RadarWatchlistItem): string {
    return `${categoryKey}|${item.ticker.toUpperCase()}|${compactIssuerName(item.label)}`;
}

function issuerMatchesPreparedItem(issuerNorm: string, issuerCompact: string, item: RadarWatchlistItem): boolean {
    const alphabetMatch = matchAlphabetShareClass(issuerNorm, item);
    if (alphabetMatch !== null) return alphabetMatch;
    return issuerMatchesAliasProfiles(issuerNorm, issuerCompact, item);
}

function matchAlphabetShareClass(issuerNorm: string, item: RadarWatchlistItem): boolean | null {
    const ticker = item.ticker.toUpperCase();
    if (ticker !== 'GOOG' && ticker !== 'GOOGL') return null;
    if (!/\b(ALPHABET|GOOGLE)\b/.test(issuerNorm)) return false;

    const hasClassA = /\b(CL|CLASS)\s+A\b/.test(issuerNorm);
    const hasClassC = /\b(CL|CLASS)\s+C\b/.test(issuerNorm);
    if (ticker === 'GOOGL') return hasClassA;
    return hasClassC || (!hasClassA && !hasClassC);
}

function issuerMatchesAliasProfiles(issuerNorm: string, issuerCompact: string, item: RadarWatchlistItem): boolean {
    return getItemAliasProfiles(item).some((alias) =>
        issuerNorm.includes(alias.normalized) || issuerCompact.includes(alias.compact)
    );
}

function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function safeNumber(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

export function estimateActualValue(value: number, shares: number): number {
    const safeValue = safeNumber(value);
    const safeShares = safeNumber(shares);
    if (safeValue <= 0) return 0;
    if (safeShares <= 0) return safeValue;

    const ratio = Math.abs(safeValue / safeShares);
    return ratio > 4 ? safeValue : safeValue * 1000;
}

function pct(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Number(((numerator / denominator) * 100).toFixed(1));
}

function pushSample(samples: string[], value: string) {
    if (samples.length >= 5) return;
    if (!samples.includes(value)) samples.push(value);
}

export function buildSecAccessionFolderUrl(cik: string, accessionNumber: string): string | null {
    const cikPath = normalizeCikPath(cik);
    const accessionNoDash = accessionNumber.replace(/-/g, '');
    if (!cikPath || !accessionNoDash) return null;
    return `https://www.sec.gov/Archives/edgar/data/${cikPath}/${accessionNoDash}/`;
}

export function buildSecSubmissionTextUrl(cik: string, accessionNumber: string): string | null {
    const folderUrl = buildSecAccessionFolderUrl(cik, accessionNumber);
    if (!folderUrl || !accessionNumber) return null;
    return `${folderUrl}${accessionNumber}.txt`;
}

function normalizeCikPath(cik: string): string | null {
    const digits = cik.replace(/\D/g, '').replace(/^0+/, '');
    return digits || null;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).sort();
}

function sortRawHoldings(rows: MatchedRawHoldingRow[]): MatchedRawHoldingRow[] {
    return rows.sort((a, b) =>
        a.matchedCategories.join(',').localeCompare(b.matchedCategories.join(',')) ||
        a.issuer.localeCompare(b.issuer) ||
        a.fundName.localeCompare(b.fundName)
    );
}
