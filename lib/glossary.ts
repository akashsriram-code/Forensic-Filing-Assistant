/**
 * Plain-English definitions for the SEC and fund terms that appear on screen. Used by the <Term> tooltip and the
 * Guide's glossary, so one edit here updates both. Written for reporters, not quants.
 */

export interface GlossaryEntry {
    term: string;
    definition: string;
}

export const GLOSSARY = {
    form13f: {
        term: '13F filing',
        definition: 'A quarterly report that investment managers with more than $100M in US stocks must file, listing what they held on the last day of the quarter. It is due 45 days after quarter end.',
    },
    quarterEndHoldings: {
        term: 'Quarter-end snapshot',
        definition: '13F filings show what a fund held on the last day of the quarter, not when it traded. A fund could have bought and sold in between.',
    },
    cik: {
        term: 'CIK',
        definition: 'The SEC’s permanent ID number for a company or fund. Names change; the CIK does not.',
    },
    cusip: {
        term: 'CUSIP',
        definition: 'A nine-character code that identifies a specific security, like a share class or bond.',
    },
    accession: {
        term: 'Accession number',
        definition: 'The SEC’s unique ID for one filing.',
    },
    comparableFilers: {
        term: 'Funds filed in both quarters',
        definition: 'Funds whose latest filing is in for both quarters being compared. Changes are only counted for these funds, so a fund that hasn’t filed yet never looks like a seller.',
    },
    exposedFilers: {
        term: 'Funds holding the category',
        definition: 'Funds filed in both quarters that held at least one stock in this category in either quarter.',
    },
    buyersSellers: {
        term: 'Buyers and sellers',
        definition: 'A buyer held more shares in the category at the end of this quarter than last quarter; a seller held fewer.',
    },
    newPosition: {
        term: 'New position',
        definition: 'The fund held none last quarter and some this quarter. Every new position also counts as a buyer.',
    },
    soldOut: {
        term: 'Sold out',
        definition: 'The fund held some last quarter and none this quarter. Every sold-out position also counts as a seller.',
    },
    netBuyers: {
        term: 'Net buyers',
        definition: 'Number of buyers minus number of sellers. Positive means more funds added than cut.',
    },
    watchedFilers: {
        term: 'Funds watched',
        definition: 'Funds that held at least one stock from your watchlists in either quarter.',
    },
    currentHolders: {
        term: 'Holders now and last quarter',
        definition: 'Funds that held any shares in the category at the end of this quarter, or at the end of last quarter.',
    },
    sectorMovers: {
        term: 'Sector most bought or sold',
        definition: 'Counted only from the stocks on your watchlists, not from each fund’s whole portfolio. The sector with the most buying funds, or the most selling funds, wins.',
    },
    watchlists: {
        term: 'Watchlists',
        definition: 'Groups of stocks (such as semiconductors or defense) that the radar tracks. You can edit the stocks in each one.',
    },
    rawValue: {
        term: 'Raw 13F value',
        definition: 'The market value exactly as it appears in the filing, kept in the audit workbook. Filings since 2023 report whole dollars, so it matches the value shown.',
    },
    cumulativeOwnership: {
        term: 'Cumulative ownership curve',
        definition: 'The share of all reported shares held by the largest 1, 5, 10, 25, 50 and 100 funds. The faster it reaches 100%, the more a few funds dominate.',
    },
    estimatedValue: {
        term: 'Value',
        definition: 'The market value the fund reported in its filing, in dollars, as of the quarter end. 13F filings have reported whole dollars since January 2023.',
    },
    concentration: {
        term: 'Ownership concentration',
        definition: 'How much of a category is held by a few funds. High means a handful of big holders dominate; low means ownership is spread out. Measured with the Herfindahl-Hirschman Index (HHI), from 0 to 10,000.',
    },
    filerType: {
        term: 'Fund type',
        definition: 'A rough classification (hedge fund, pension, bank and so on) based on the filer’s name and a list of known funds. Treat it as a starting point, not a fact.',
    },
    privateCredit: {
        term: 'Private credit',
        definition: 'Lending by non-banks, often through business development companies (BDCs). This view shows which pensions and endowments hold those vehicles.',
    },
    activistStake: {
        term: 'Activist stake (Schedule 13D)',
        definition: 'Anyone who buys more than 5% of a company and may try to influence it must file a Schedule 13D within days. It is often an early sign of a campaign for change.',
    },
    passiveStake: {
        term: 'Passive stake (Schedule 13G)',
        definition: 'A shorter form for investors who own more than 5% but don’t intend to influence the company.',
    },
    positionHistory: {
        term: 'Position history',
        definition: 'How a fund’s holding in one stock changed across its past 13F filings.',
    },
    filingDeadline: {
        term: 'Filing deadline',
        definition: '13F filings are due 45 days after quarter end, moved to the next business day if that falls on a weekend or federal holiday.',
    },
    form10k: { term: '10-K', definition: 'A company’s annual report, with audited financial statements and risk factors.' },
    form10q: { term: '10-Q', definition: 'A company’s quarterly report. Unaudited, shorter than a 10-K.' },
    form8k: { term: '8-K', definition: 'A report of a major event, such as an acquisition, a CEO change or a bankruptcy, filed within four business days.' },
    form4: { term: 'Form 4', definition: 'Filed when a company insider (an executive, director or 10% owner) buys or sells the company’s stock.' },
    riskFactors: { term: 'Risk factors', definition: 'The section of a 10-K or 10-Q where the company lists what could hurt its business. New risks are often newsworthy.' },
    mdna: { term: 'MD&A', definition: 'Management’s discussion and analysis: the section where executives explain results in their own words.' },
    sectorGuess: {
        term: 'Sector (estimated)',
        definition: 'A rough sector assigned from the company’s name using a short list of known companies and keywords. It is not an official classification, and many holdings end up unclassified.',
    },
    tradeValue: {
        term: 'Estimated value bought or sold',
        definition: 'The change in shares multiplied by this quarter’s price per share, worked out from the filing (value ÷ shares). It is a rough guide to size, not the price the fund actually paid or received.',
    },
    openMarketTrade: {
        term: 'Open-market trade',
        definition: 'An insider buying (Form 4 code P) or selling (code S) shares on the stock market at the going price. Awards, option exercises and shares withheld for tax are not open-market trades.',
    },
    plan10b5: {
        term: 'Planned trade (10b5-1 plan)',
        definition: 'A trade made under a plan the insider set up in advance, often months earlier, so the timing was fixed before the trade. The insider ticks a box on Form 4 when this applies.',
    },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Terms shown in the Guide's glossary, in reading order. */
export const GUIDE_GLOSSARY: GlossaryKey[] = [
    'form13f', 'quarterEndHoldings', 'filingDeadline', 'comparableFilers', 'watchlists', 'watchedFilers', 'buyersSellers',
    'newPosition', 'soldOut', 'netBuyers', 'estimatedValue', 'tradeValue', 'sectorGuess', 'concentration',
    'cumulativeOwnership', 'filerType', 'privateCredit', 'activistStake', 'passiveStake',
    'form10k', 'form10q', 'form8k', 'form4', 'riskFactors', 'mdna', 'cik', 'cusip', 'accession',
];
