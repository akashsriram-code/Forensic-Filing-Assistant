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
    exposedFilers: number;
    buyers: number;
    sellers: number;
    initiatedFilers: number;
    liquidatedFilers: number;
    unchangedFilers: number;
    buyerPctOfExposed: number;
    sellerPctOfExposed: number;
    buyerPctOfComparable: number;
    sellerPctOfComparable: number;
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

export interface EventLensCategorySignal {
    categoryKey: string;
    label: string;
    buyers: number;
    sellers: number;
    buyerPctOfComparable: number;
    sellerPctOfComparable: number;
    exposedFilers: number;
}

export interface EventLensSummary {
    key: 'pre-event' | 'post-event';
    label: string;
    currentQuarter: string;
    previousQuarter: string;
    available: boolean;
    status: string;
    signals: EventLensCategorySignal[];
}

export interface RadarComparison {
    movementBasis: MovementBasis;
    coverage: RadarCoverage;
    categorySummaries: CategorySummary[];
    securityMovements: SecurityMovement[];
    initiations: SecurityMovement[];
    liquidations: SecurityMovement[];
    topFilerMoves: FilerMove[];
}

export interface RadarApiResponse extends RadarComparison {
    availableQuarters: string[];
    watchlists: RadarWatchlist[];
    eventLens: EventLensSummary[];
    filerSideMatches: FilerSideMatch[];
    notes: string[];
}

interface AliasProfile {
    normalized: string;
    compact: string;
}

const aliasProfileCache = new WeakMap<RadarWatchlistItem, AliasProfile[]>();

interface MatchResult {
    category: RadarWatchlist;
    items: RadarWatchlistItem[];
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
    securityKeys: Set<string>;
    initiatedCount: number;
    liquidatedCount: number;
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
            { ticker: 'GOOG/GOOGL', label: 'Alphabet', aliases: ['ALPHABET', 'GOOGLE'] },
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
        if (!latestByCik.has(row.cik)) {
            latestByCik.set(row.cik, row);
        }
    }

    return Array.from(latestByCik.values());
}

export function issuerMatchesItem(issuer: string, item: RadarWatchlistItem): boolean {
    const issuerNorm = normalizeIssuerName(issuer);
    const issuerCompact = compactIssuerName(issuer);

    return issuerMatchesAliasProfiles(issuerNorm, issuerCompact, item);
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
        const items = watchlist.items.filter((item) => issuerMatchesAliasProfiles(issuerNorm, issuerCompact, item));
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

    const currentFilings = selectLatestFilings(filings, currentQuarter);
    const previousFilings = selectLatestFilings(filings, previousQuarter);
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
    let watchedHoldingRows = 0;

    for (const row of holdings) {
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
            };

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
            securityKeys: new Set<string>(),
            initiatedCount: 0,
            liquidatedCount: 0,
        };
        categoryState.currentShares += state.currentShares;
        categoryState.previousShares += state.previousShares;
        categoryState.currentValue += state.currentValue;
        categoryState.previousValue += state.previousValue;
        categoryState.securityKeys.add(state.securityKey);
        if (action === 'initiated') categoryState.initiatedCount++;
        if (action === 'liquidated') categoryState.liquidatedCount++;
        categoryByFilerMap.set(categoryKey, categoryState);
    }

    const categorySummaries = selectedWatchlists.map((watchlist) => {
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
            exposedFilers,
            buyers,
            sellers,
            initiatedFilers,
            liquidatedFilers,
            unchangedFilers,
            buyerPctOfExposed: pct(buyers, exposedFilers),
            sellerPctOfExposed: pct(sellers, exposedFilers),
            buyerPctOfComparable: pct(buyers, comparableCiks.length),
            sellerPctOfComparable: pct(sellers, comparableCiks.length),
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
        .map((state) => ({
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
            securityCount: state.securityKeys.size,
            initiatedCount: state.initiatedCount,
            liquidatedCount: state.liquidatedCount,
        }))
        .filter((move) => move.action !== 'absent' && move.action !== 'unchanged')
        .sort((a, b) => Math.abs(b.valueDelta) - Math.abs(a.valueDelta));

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

export function buildEventLensSummary(
    key: EventLensSummary['key'],
    availableQuarters: string[],
    comparison: RadarComparison | null
): EventLensSummary {
    const isPre = key === 'pre-event';
    const currentQuarter = isPre ? '2025-Q4' : '2026-Q1';
    const previousQuarter = isPre ? '2025-Q3' : '2025-Q4';
    const available = availableQuarters.includes(currentQuarter) && availableQuarters.includes(previousQuarter);
    const signals = comparison
        ? comparison.categorySummaries
            .filter((summary) => summary.key === 'energy' || summary.key === 'software')
            .map((summary) => ({
                categoryKey: summary.key,
                label: summary.label,
                buyers: summary.buyers,
                sellers: summary.sellers,
                buyerPctOfComparable: summary.buyerPctOfComparable,
                sellerPctOfComparable: summary.sellerPctOfComparable,
                exposedFilers: summary.exposedFilers,
            }))
        : [];

    return {
        key,
        label: isPre ? 'Pre-event setup' : 'Post-event response',
        currentQuarter,
        previousQuarter,
        available,
        status: available
            ? isPre
                ? 'Q4 2025 vs Q3 2025 quarter-end positioning.'
                : 'Q1 2026 vs Q4 2025 is partial until the May 15, 2026 deadline.'
            : 'Not enough ingested quarters yet.',
        signals,
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

function estimateActualValue(value: number, shares: number): number {
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
