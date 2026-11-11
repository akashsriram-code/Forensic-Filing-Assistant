import assert from 'node:assert/strict';
import {
    INSIDER_KIND_LABELS,
    applyAmendments,
    extractForm4Transactions,
    findBuyCluster,
    kindForCode,
    parseForm4Transactions,
    roleLabel,
    sortTransactionsNewestFirst,
    subtractMonths,
    summarizeInsiderTrades,
    type Form4FilingRef,
    type InsiderTransaction,
} from '../lib/form4';
import { parseSC13D, parseSC13DText } from '../lib/sc13d-parser';
import { ACTIVIST_FORMS, PASSIVE_STAKE_FORMS, isActivistForm, isPassiveStakeForm, normalizeScheduleForm } from '../lib/sec-forms';
import { formMatches } from '../lib/follows';
import { rawXmlDocument } from '../lib/edgar-submissions';

// A realistic Form 4 (schema X0609, as EDGAR serves the raw XML): a CFO exercising options, selling under a 10b5-1
// plan in two lots, and having shares withheld for tax, all in one filing.
const CFO_FORM4 = `<?xml version="1.0"?>
<ownershipDocument>
    <schemaVersion>X0609</schemaVersion>
    <documentType>4</documentType>
    <periodOfReport>2026-10-16</periodOfReport>
    <notSubjectToSection16>0</notSubjectToSection16>
    <issuer>
        <issuerCik>0001045810</issuerCik>
        <issuerName>NVIDIA CORP</issuerName>
        <issuerTradingSymbol>NVDA</issuerTradingSymbol>
    </issuer>
    <reportingOwner>
        <reportingOwnerId>
            <rptOwnerCik>0000000101</rptOwnerCik>
            <rptOwnerName>DOE JANE</rptOwnerName>
        </reportingOwnerId>
        <reportingOwnerAddress>
            <rptOwnerStreet1>2788 SAN TOMAS EXPRESSWAY</rptOwnerStreet1>
            <rptOwnerCity>SANTA CLARA</rptOwnerCity>
            <rptOwnerState>CA</rptOwnerState>
            <rptOwnerZipCode>95051</rptOwnerZipCode>
        </reportingOwnerAddress>
        <reportingOwnerRelationship>
            <isDirector>0</isDirector>
            <isOfficer>1</isOfficer>
            <isTenPercentOwner>0</isTenPercentOwner>
            <isOther>0</isOther>
            <officerTitle>Chief Financial Officer</officerTitle>
        </reportingOwnerRelationship>
    </reportingOwner>
    <aff10b5One>1</aff10b5One>
    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-10-16</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>M</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>10000</value></transactionShares>
                <transactionPricePerShare><value>50.00</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>110000</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-10-16</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>S</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
                <footnoteId id="F1"/>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>6000</value></transactionShares>
                <transactionPricePerShare>
                    <value>200.00</value>
                    <footnoteId id="F2"/>
                </transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>104000</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-10-16</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>S</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
                <footnoteId id="F1"/>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>4,000</value></transactionShares>
                <transactionPricePerShare><value>201.50</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>100000</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-10-17</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>F</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>1000</value></transactionShares>
                <transactionPricePerShare><value>199.00</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>99000</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
        <nonDerivativeHolding>
            <securityTitle><value>Common Stock</value></securityTitle>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership><value>I</value></directOrIndirectOwnership>
                <natureOfOwnership><value>By Trust</value></natureOfOwnership>
            </ownershipNature>
        </nonDerivativeHolding>
    </nonDerivativeTable>
    <derivativeTable>
        <derivativeTransaction>
            <securityTitle><value>Employee Stock Option (right to buy)</value></securityTitle>
            <conversionOrExercisePrice><value>50.00</value></conversionOrExercisePrice>
            <transactionDate><value>2026-10-16</value></transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>M</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares><value>10000</value></transactionShares>
                <transactionPricePerShare><value>0</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
        </derivativeTransaction>
    </derivativeTable>
    <footnotes>
        <footnote id="F1">The sales reported were effected pursuant to a Rule 10b5-1 trading plan adopted on March 2, 2026.</footnote>
        <footnote id="F2">Weighted average price; prices ranged from $199.50 to $200.40.</footnote>
    </footnotes>
    <ownerSignature>
        <signatureName>/s/ Attorney-in-Fact for Jane Doe</signatureName>
        <signatureDate>2026-10-20</signatureDate>
    </ownerSignature>
</ownershipDocument>`;

interface FixtureTx {
    date: string;
    code: string;
    shares: number;
    price?: number;
    ad: 'A' | 'D';
    after: number;
}

/** Smaller filings built from the same structure. */
function form4Xml(options: {
    ownerCik: string;
    ownerName: string;
    director?: boolean;
    officerTitle?: string;
    tenPercent?: boolean;
    other?: string;
    plan?: boolean;
    txs: FixtureTx[];
    coOwner?: string;
}): string {
    const owner = (cik: string, name: string) => `
    <reportingOwner>
        <reportingOwnerId><rptOwnerCik>${cik}</rptOwnerCik><rptOwnerName>${name}</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship>
            <isDirector>${options.director ? 1 : 0}</isDirector>
            <isOfficer>${options.officerTitle ? 'true' : 'false'}</isOfficer>
            <isTenPercentOwner>${options.tenPercent ? 1 : 0}</isTenPercentOwner>
            <isOther>${options.other ? 1 : 0}</isOther>
            ${options.officerTitle ? `<officerTitle>${options.officerTitle}</officerTitle>` : ''}
            ${options.other ? `<otherText>${options.other}</otherText>` : ''}
        </reportingOwnerRelationship>
    </reportingOwner>`;
    const rows = options.txs
        .map(
            (tx) => `
        <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>${tx.date}</value></transactionDate>
            <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${tx.code}</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
            <transactionAmounts>
                <transactionShares><value>${tx.shares}</value></transactionShares>
                <transactionPricePerShare>${tx.price === undefined ? '<footnoteId id="F1"/>' : `<value>${tx.price}</value>`}</transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>${tx.ad}</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts><sharesOwnedFollowingTransaction><value>${tx.after}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
            <ownershipNature><directOrIndirectOwnership><value>I</value></directOrIndirectOwnership></ownershipNature>
        </nonDerivativeTransaction>`
        )
        .join('');
    return `<?xml version="1.0"?>
<ownershipDocument>
    <schemaVersion>X0609</schemaVersion>
    <documentType>4</documentType>
    <issuer><issuerCik>0001045810</issuerCik><issuerName>NVIDIA CORP</issuerName><issuerTradingSymbol>nvda</issuerTradingSymbol></issuer>
    ${owner(options.ownerCik, options.ownerName)}
    ${options.coOwner ? owner('0000000999', options.coOwner) : ''}
    <aff10b5One>${options.plan ? 1 : 0}</aff10b5One>
    <nonDerivativeTable>${rows}
    </nonDerivativeTable>
    <derivativeTable></derivativeTable>
</ownershipDocument>`;
}

function ref(accessionNumber: string, filingDate: string, form = '4'): Form4FilingRef {
    return { cik: '0001045810', accessionNumber, filingDate, form, primaryDocument: 'xslF345X06/form4.xml' };
}

async function parse(xml: string, filingRef: Form4FilingRef): Promise<InsiderTransaction[]> {
    const rows = await parseForm4Transactions(xml, filingRef);
    assert.ok(rows, 'fixture should parse');
    return rows!;
}

async function run() {
    // --- Codes and labels -------------------------------------------------------------------------------------
    assert.equal(kindForCode('P'), 'buy');
    assert.equal(kindForCode('s'), 'sell');
    assert.equal(kindForCode('A'), 'award');
    assert.equal(kindForCode('M'), 'option');
    assert.equal(kindForCode('F'), 'tax');
    assert.equal(kindForCode('G'), 'gift');
    assert.equal(kindForCode('J'), 'other');
    assert.equal(kindForCode(null), 'other');
    assert.equal(INSIDER_KIND_LABELS.buy, 'Bought on the open market');
    assert.equal(INSIDER_KIND_LABELS.sell, 'Sold on the open market');
    assert.equal(INSIDER_KIND_LABELS.tax, 'Shares withheld for tax');

    const noFlags = { isDirector: false, isOfficer: false, isTenPercentOwner: false, isOther: false };
    assert.equal(roleLabel({ ...noFlags, isDirector: true }), 'Director');
    assert.equal(roleLabel({ ...noFlags, isOfficer: true, officerTitle: ' Chief Financial Officer ' }), 'Chief Financial Officer');
    assert.equal(roleLabel({ ...noFlags, isOfficer: true }), 'Officer');
    assert.equal(roleLabel({ ...noFlags, isTenPercentOwner: true }), '10% owner');
    assert.equal(roleLabel({ ...noFlags, isOther: true, otherText: 'Member of 10% group' }), 'Member of 10% group');
    assert.equal(roleLabel({ ...noFlags, isOfficer: true, officerTitle: 'CEO', isDirector: true }), 'CEO; Director');
    assert.equal(roleLabel(noFlags), 'Insider');

    // --- Multi-transaction filing: M, S (10b5-1, two lots), F ---------------------------------------------------
    const cfo = await parse(CFO_FORM4, ref('0000000101-26-000001', '2026-10-20'));
    assert.equal(cfo.length, 4, 'only the non-derivative transactions, not holdings or the derivative row');
    assert.deepEqual(cfo.map((t) => t.kind), ['option', 'sell', 'sell', 'tax']);
    assert.deepEqual(cfo.map((t) => t.code), ['M', 'S', 'S', 'F']);
    const [exercise, sale1, sale2, tax] = cfo;
    assert.equal(sale1.ownerName, 'DOE JANE');
    assert.equal(sale1.ownerCik, '0000000101');
    assert.equal(sale1.role, 'Chief Financial Officer');
    assert.equal(sale1.isOfficer, true);
    assert.equal(sale1.issuerTicker, 'NVDA');
    assert.equal(sale1.issuerName, 'NVIDIA CORP');
    assert.equal(sale1.transactionDate, '2026-10-16');
    assert.equal(sale1.acquiredDisposed, 'D');
    assert.equal(sale1.shares, 6000);
    assert.equal(sale1.price, 200);
    assert.equal(sale1.value, 1_200_000);
    assert.equal(sale1.sharesOwnedAfter, 104000);
    assert.equal(sale1.ownership, 'direct');
    assert.equal(sale1.isOpenMarket, true);
    assert.equal(sale1.kindLabel, 'Sold on the open market');
    assert.equal(sale1.planned10b5One, true);
    assert.equal(sale1.planLabel, 'Planned sale (10b5-1 plan)');
    assert.equal(sale2.shares, 4000, 'thousands separators are tolerated');
    assert.equal(sale2.value, 806_000);
    assert.equal(exercise.kindLabel, 'Option exercise');
    assert.equal(exercise.acquiredDisposed, 'A');
    assert.equal(exercise.isOpenMarket, false);
    assert.equal(tax.kindLabel, 'Shares withheld for tax');
    assert.equal(tax.transactionDate, '2026-10-17');
    // Citation fields.
    assert.equal(sale1.accessionNumber, '0000000101-26-000001');
    assert.equal(sale1.filingDate, '2026-10-20');
    assert.equal(sale1.form, '4');
    assert.equal(sale1.url, 'https://www.sec.gov/Archives/edgar/data/1045810/000000010126000001/0000000101-26-000001-index.htm');
    assert.equal(sale1.documentUrl, 'https://www.sec.gov/Archives/edgar/data/1045810/000000010126000001/xslF345X06/form4.xml');
    assert.equal(new Set(cfo.map((t) => t.id)).size, 4, 'ids are unique');

    // --- Award (A) to a director, no plan; price given as 0 -----------------------------------------------------
    const award = await parse(
        form4Xml({ ownerCik: '0000000102', ownerName: 'ROE JOHN', director: true, txs: [{ date: '2026-09-01', code: 'A', shares: 2000, price: 0, ad: 'A', after: 12000 }] }),
        ref('0000000102-26-000002', '2026-09-03')
    );
    assert.equal(award.length, 1);
    assert.equal(award[0].kind, 'award');
    assert.equal(award[0].kindLabel, 'Award or grant');
    assert.equal(award[0].role, 'Director');
    assert.equal(award[0].value, 0);
    assert.equal(award[0].planned10b5One, false);
    assert.equal(award[0].planLabel, null);
    assert.equal(award[0].ownership, 'indirect');
    assert.equal(award[0].issuerTicker, 'NVDA', 'ticker is upper-cased');

    // --- A gift with no price: value unknown, not zero ----------------------------------------------------------
    const gift = await parse(
        form4Xml({ ownerCik: '0000000103', ownerName: 'GIVER ANN', officerTitle: 'EVP, Operations', txs: [{ date: '2026-08-01', code: 'G', shares: 500, ad: 'D', after: 1000 }] }),
        ref('0000000103-26-000003', '2026-08-04')
    );
    assert.equal(gift[0].kind, 'gift');
    assert.equal(gift[0].price, null);
    assert.equal(gift[0].value, null);
    assert.equal(gift[0].role, 'EVP, Operations');

    // --- Open-market buys (P) by three insiders, one a 10% owner on a joint filing --------------------------------
    const buyA = await parse(
        form4Xml({ ownerCik: '0000000201', ownerName: 'SMITH ALEX', director: true, txs: [{ date: '2026-10-01', code: 'P', shares: 1000, price: 180, ad: 'A', after: 5000 }] }),
        ref('0000000201-26-000010', '2026-10-02')
    );
    const buyB = await parse(
        form4Xml({ ownerCik: '0000000202', ownerName: 'JONES BEA', director: true, txs: [{ date: '2026-10-15', code: 'P', shares: 500, price: 190, ad: 'A', after: 2500 }] }),
        ref('0000000202-26-000011', '2026-10-16')
    );
    const buyC = await parse(
        form4Xml({
            ownerCik: '0000000203',
            ownerName: 'BIG HOLDER FUND LP',
            tenPercent: true,
            coOwner: 'BIG HOLDER GP LLC',
            txs: [
                { date: '2026-10-29', code: 'P', shares: 10000, price: 185, ad: 'A', after: 900000 },
                { date: '2026-10-30', code: 'P', shares: 5000, price: 186, ad: 'A', after: 905000 },
            ],
        }),
        ref('0000000203-26-000012', '2026-10-31')
    );
    assert.equal(buyC.length, 2);
    assert.equal(buyC[0].role, '10% owner');
    assert.equal(buyC[0].isTenPercentOwner, true);
    assert.equal(buyC[0].isDirector, false);
    assert.deepEqual(buyC[0].coOwners, ['BIG HOLDER GP LLC']);
    assert.equal(buyC[0].kindLabel, 'Bought on the open market');
    assert.equal(buyC[0].value, 1_850_000);

    // --- Summary over the last 6 months ---------------------------------------------------------------------------
    const old = await parse(
        form4Xml({ ownerCik: '0000000204', ownerName: 'EARLY SELLER', director: true, txs: [{ date: '2026-03-01', code: 'S', shares: 100, price: 100, ad: 'D', after: 0 }] }),
        ref('0000000204-26-000013', '2026-03-03')
    );
    const all = sortTransactionsNewestFirst([...cfo, ...award, ...gift, ...buyA, ...buyB, ...buyC, ...old]);
    assert.equal(all[0].transactionDate, '2026-10-30');
    const summary = summarizeInsiderTrades(all, { to: '2026-11-11', months: 6 });
    assert.equal(summary.from, '2026-05-11');
    assert.equal(summary.to, '2026-11-11');
    assert.equal(summary.buys.count, 4);
    assert.equal(summary.buys.insiders, 3);
    assert.equal(summary.buys.value, 180_000 + 95_000 + 1_850_000 + 930_000);
    assert.equal(summary.sells.count, 2, 'the March sale is outside the 6-month window');
    assert.equal(summary.sells.insiders, 1);
    assert.equal(summary.sells.value, 2_006_000);
    assert.equal(summary.sells.planned.count, 2);
    assert.equal(summary.sells.plannedShareOfCount, 1);
    assert.equal(summary.sells.plannedShareOfValue, 1);
    assert.equal(summary.otherTransactions, 4, 'M, F, A and G');

    // --- Cluster: 3 distinct insiders bought within 30 days --------------------------------------------------------
    assert.ok(summary.cluster);
    assert.equal(summary.cluster!.insiderCount, 3);
    assert.deepEqual(summary.cluster!.insiders.map((i) => i.name), ['SMITH ALEX', 'JONES BEA', 'BIG HOLDER FUND LP']);
    assert.equal(summary.cluster!.from, '2026-10-01');
    assert.equal(summary.cluster!.to, '2026-10-30', '10-01 to 10-30 is 30 days counting both ends');
    assert.equal(summary.cluster!.transactions, 4);
    assert.equal(summary.cluster!.totalValue, 180_000 + 95_000 + 1_850_000 + 930_000);
    // 10-01 to 10-31 is 31 days: the third insider falls outside a window starting 10-01, but 10-15..10-31 has only 2.
    const boundary = buyC.map((t) => ({ ...t, transactionDate: '2026-10-31' }));
    assert.equal(findBuyCluster([...buyA, ...buyB.map((t) => ({ ...t, transactionDate: '2026-10-01' })), ...boundary]), null);
    const inside = buyC.map((t) => ({ ...t, transactionDate: '2026-10-30' }));
    assert.equal(findBuyCluster([...buyA, ...buyB.map((t) => ({ ...t, transactionDate: '2026-10-01' })), ...inside])?.insiderCount, 3);
    // Two insiders only: no cluster. Three insiders spread over more than 30 days: no cluster.
    assert.equal(findBuyCluster([...buyA, ...buyB]), null);
    const lateBuy = buyC.map((t) => ({ ...t, transactionDate: '2026-11-05' }));
    assert.equal(findBuyCluster([...buyA, ...buyB.map((t) => ({ ...t, transactionDate: '2026-10-20' })), ...lateBuy]), null);
    // The same insider buying three times is not a cluster.
    assert.equal(findBuyCluster([...buyC, ...buyC.map((t) => ({ ...t, id: `${t.id}-x` }))]), null);
    const noPlanSells = summarizeInsiderTrades([...buyA], { to: '2026-11-11' });
    assert.equal(noPlanSells.sells.count, 0);
    assert.equal(noPlanSells.sells.plannedShareOfCount, null);
    assert.equal(noPlanSells.cluster, null);

    // --- Amendments: a 4/A replaces the original's rows for the same insider, date and code ------------------------
    const amendment = await parse(
        form4Xml({ ownerCik: '0000000201', ownerName: 'SMITH ALEX', director: true, txs: [{ date: '2026-10-01', code: 'P', shares: 1200, price: 180, ad: 'A', after: 5200 }] }),
        ref('0000000201-26-000020', '2026-10-05', '4/A')
    );
    const amended = applyAmendments([...buyA, ...buyB, ...amendment]);
    assert.equal(amended.replaced, 1);
    assert.equal(amended.transactions.length, 2);
    assert.equal(amended.transactions.find((t) => t.ownerName === 'SMITH ALEX')!.shares, 1200);

    // --- Not a Form 4 -----------------------------------------------------------------------------------------------
    assert.equal(await parseForm4Transactions('<html><body>Not XML</body></html>', ref('0000000000-26-000000', '2026-10-01')), null);
    assert.deepEqual(extractForm4Transactions({}, ref('0000000000-26-000000', '2026-10-01')), []);
    assert.equal(subtractMonths('2026-08-31', 6), '2026-02-28');
    assert.equal(subtractMonths('2026-11-11', 12), '2025-11-11');
    assert.equal(rawXmlDocument('xslF345X05/doc.xml'), 'doc.xml');
    assert.equal(rawXmlDocument('xslSCHEDULE_13D_X02/primary_doc.xml'), 'primary_doc.xml');
    assert.equal(rawXmlDocument('form4.xml'), 'form4.xml');

    // --- Related: schedule form names and the structured Schedule 13D reader ---------------------------------------
    for (const form of ['SC 13D', 'SC 13D/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A']) assert.ok(ACTIVIST_FORMS.has(form) && isActivistForm(form));
    for (const form of ['SC 13G', 'SC 13G/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A']) assert.ok(PASSIVE_STAKE_FORMS.has(form) && isPassiveStakeForm(form));
    assert.equal(isActivistForm('schedule  13d/a'), true);
    assert.equal(isActivistForm('SCHEDULE 13G'), false);
    assert.equal(normalizeScheduleForm('SCHEDULE 13D/A'), 'SC 13D/A');
    assert.equal(normalizeScheduleForm('10-K'), '10-K');
    assert.equal(formMatches('SCHEDULE 13D/A', ['SC 13D']), true);
    assert.equal(formMatches('SCHEDULE 13G', ['SC 13G']), true);
    assert.equal(formMatches('SC 13D', ['SCHEDULE 13D']), true);
    assert.equal(formMatches('SCHEDULE 13G', ['SC 13D']), false);
    assert.equal(formMatches('4/A', ['4']), true);
    assert.equal(formMatches('424B4', ['4']), false);
    assert.equal(formMatches('10-K/A', ['10-K']), true);

    // Trimmed from Pershing Square's SCHEDULE 13D/A on Howard Hughes Holdings, accession 0001140361-26-024479.
    const schedule13d = parseSC13D(`<?xml version="1.0" encoding="UTF-8"?><edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D" xmlns:common="http://www.sec.gov/edgar/common">
  <schemaVersion>X0202</schemaVersion>
  <headerData><submissionType>SCHEDULE 13D/A</submissionType></headerData>
  <formData>
    <coverPageHeader>
      <amendmentNo>33</amendmentNo>
      <issuerInfo>
        <issuerCIK> 0001981792</issuerCIK>
        <issuerCusips><issuerCusipNumber>44267T102</issuerCusipNumber></issuerCusips>
        <issuerName>Howard Hughes Holdings Inc.</issuerName>
      </issuerInfo>
    </coverPageHeader>
    <reportingPersons>
      <reportingPersonInfo>
        <reportingPersonCIK>0001336528</reportingPersonCIK>
        <reportingPersonName>Pershing Square Capital Management, L.P.</reportingPersonName>
        <aggregateAmountOwned>27852064.00</aggregateAmountOwned>
        <percentOfClass>46.7</percentOfClass>
      </reportingPersonInfo>
      <reportingPersonInfo>
        <reportingPersonNoCIK>Y</reportingPersonNoCIK>
        <reportingPersonName>Pershing Square HHH Holdings, LLC</reportingPersonName>
        <aggregateAmountOwned>9000000.00</aggregateAmountOwned>
        <percentOfClass>15.1</percentOfClass>
      </reportingPersonInfo>
      <reportingPersonInfo>
        <reportingPersonName>William A. Ackman</reportingPersonName>
        <aggregateAmountOwned>27852064.00</aggregateAmountOwned>
        <percentOfClass>46.7</percentOfClass>
      </reportingPersonInfo>
    </reportingPersons>
    <items1To7>
      <item1><issuerName>Howard Hughes Holdings Inc.</issuerName></item1>
      <item4>
        <transactionPurpose>Item 4 of the Schedule 13D is hereby amended and supplemented by adding the following information:

On June 4, 2026 (the "Closing Date"), Howard Hughes Insurance Holdings, LLC completed its previously announced acquisition of Vantage Group Holdings, Ltd., H&amp;F Vantage Aggregator, L.P. and the Carlyle Investor, in their capacities as the Sellers' representatives, and, solely for purposes of guaranteeing the obligations of Buyer pursuant to the Purchase Agreement, the Issuer.</transactionPurpose>
      </item4>
    </items1To7>
  </formData>
</edgarSubmission>`);
    assert.equal(schedule13d.format, 'xml');
    assert.equal(schedule13d.reportingPerson, 'Pershing Square Capital Management, L.P. and 2 others');
    assert.equal(schedule13d.percentClass, '46.7%');
    assert.equal(schedule13d.shares, '27,852,064');
    assert.equal(schedule13d.issuerName, 'Howard Hughes Holdings Inc.');
    assert.equal(schedule13d.issuerCik, '0001981792');
    assert.equal(schedule13d.reportingPersons?.length, 3);
    assert.equal(schedule13d.reportingPersons?.[0].cik, '0001336528');
    assert.equal(schedule13d.reportingPersons?.[1].percentClass, 15.1);
    assert.ok(schedule13d.purpose.startsWith('Item 4 of the Schedule 13D is hereby amended'));
    assert.ok(schedule13d.purpose.includes('\n\nOn June 4, 2026'), 'paragraph breaks are kept');
    assert.ok(schedule13d.purpose.endsWith('...') && schedule13d.purpose.length <= 303, 'cut at 300 characters');
    assert.ok(!schedule13d.purpose.includes('&amp;'));

    // Old HTML filings still go through the regex reader. Cover-page layout as in Pershing Square's SC 13D,
    // accession 0000930413-24-002266 (the "(11)" row reference must not be read as the percentage).
    const html13d = parseSC13D(`<html><body><table>
        <tr><td>1</td><td>NAME OF REPORTING PERSON</td></tr><tr><td>Pershing Square Capital Management, L.P.</td></tr>
        <tr><td>2</td><td>CHECK THE APPROPRIATE BOX IF A MEMBER OF A GROUP (SEE INSTRUCTIONS) (a) o (b) o</td></tr>
        <tr><td>11</td><td>AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON</td><td>2,094,673</td></tr>
        <tr><td>12</td><td>CHECK IF THE AGGREGATE AMOUNT IN ROW (11) EXCLUDES CERTAIN SHARES (SEE INSTRUCTIONS) o</td></tr>
        <tr><td>13</td><td>PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (11)</td><td>37.9%*</td></tr>
        </table>
        <p>Item 4. Purpose of Transaction The Reporting Persons intend to engage with the Board. Item 5. Interest</p></body></html>`);
    assert.equal(html13d.format, 'html');
    assert.equal(html13d.reportingPerson, 'Pershing Square Capital Management, L.P.');
    assert.equal(html13d.shares, '2,094,673');
    assert.equal(html13d.percentClass, '37.9%');
    assert.equal(html13d.purpose, 'The Reporting Persons intend to engage with the Board.');
    // The older layout with the I.R.S. label after the name.
    const htmlOld = parseSC13DText(`<p>1 NAMES OF REPORTING PERSONS STARBOARD VALUE LP I.R.S. IDENTIFICATION NOS. OF ABOVE PERSONS (ENTITIES ONLY)</p>
        <p>2 CHECK THE APPROPRIATE BOX IF A MEMBER OF A GROUP</p><p>13 PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW 11 9.8</p>`);
    assert.equal(htmlOld.reportingPerson, 'STARBOARD VALUE LP');
    assert.equal(htmlOld.percentClass, '9.8%');
    assert.deepEqual(parseSC13DText('<p>nothing</p>').percentClass, 'N/A');

    console.log('Form 4 (insider trades) unit tests passed.');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
