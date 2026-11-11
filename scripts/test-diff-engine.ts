import assert from 'node:assert/strict';
import {
    compareParagraphs,
    diffParagraphs,
    extractParagraphs,
    findSection,
    normalizeForCompare,
    wordSetSimilarity,
    type Paragraph,
} from '../lib/diff-engine';

// ---------------------------------------------------------------------------------------------------------------
// Synthetic 10-K pair, styled like a modern iXBRL filing: a table-of-contents table, bold risk-factor headings in
// <span style="font-weight:700">, page numbers and "Table of Contents" back-links, hidden iXBRL header data.
// ---------------------------------------------------------------------------------------------------------------

const bold = (text: string) => `<div style="margin-top:6pt"><span style="font-weight:700">${text}</span></div>`;
const para = (text: string) => `<div style="margin-bottom:9pt"><span style="font-weight:400">${text}</span></div>`;
const pageBreak = (page: number) =>
    `<div style="height:42pt"><div><div style="text-align:center"><span>${page}</span></div></div></div><hr style="page-break-after:always"/>` +
    `<div><div><span><a href="#toc">Table of Contents</a></span></div></div>`;

const toc = `
<table>
  <tr><td><div><span><a href="#i1">Item 1.</a></span></div></td><td><div><span><a href="#i1">Business</a></span></div></td><td><div>3</div></td></tr>
  <tr><td><div><span><a href="#i1a">Item 1A.</a></span></div></td><td><div><span><a href="#i1a">Risk Factors</a></span></div></td><td><div>12</div></td></tr>
  <tr><td><div><span><a href="#i1b">Item 1B.</a></span></div></td><td><div><span><a href="#i1b">Unresolved Staff Comments</a></span></div></td><td><div>30</div></td></tr>
  <tr><td><div><span><a href="#i7">Item 7.</a></span></div></td><td><div><span><a href="#i7">Management's Discussion and Analysis of Financial Condition and Results of Operations</a></span></div></td><td><div>35</div></td></tr>
  <tr><td><div><span><a href="#i7a">Item 7A.</a></span></div></td><td><div><span><a href="#i7a">Quantitative and Qualitative Disclosures About Market Risk</a></span></div></td><td><div>48</div></td></tr>
</table>`;

interface Factor {
    heading: string;
    body: string[];
}

const COMPETITION: Factor = {
    heading: 'Competition could adversely impact our market share and financial results.',
    body: [
        'Our target markets remain competitive, and competition may intensify with expanding and changing product and service offerings, industry standards, customer needs, new entrants and consolidations.',
        'Our competitors’ products, services and technologies, including those mentioned above in this Annual Report on Form 10-K, may be cheaper or provide better functionality or features than ours.',
    ],
};

const SUPPLIERS: Factor = {
    heading: 'Dependency on third-party suppliers and their technology could harm our business.',
    body: [
        'We depend on foundries to manufacture our semiconductor wafers using their fabrication equipment and techniques. We do not assemble, test, or package our products, but instead contract with independent subcontractors.',
        'For a discussion of the properties that house our manufacturing partners, see Item 2. Properties of this report.',
        // Starts like an item marker, but is a sentence, not a heading: must not end the section either.
        'Item 2 of this report describes our facilities, including the sites our manufacturing partners lease in Asia, and the lease obligations that could raise our costs.',
    ],
};

const SUPPLIERS_CURRENT: Factor = {
    heading: SUPPLIERS.heading,
    body: [
        // Reworded: a sentence about tariffs and new wording replaces "fabrication equipment".
        'We depend on foundries to manufacture our semiconductor wafers using their manufacturing equipment and techniques, and new tariffs may raise their costs. We do not assemble, test, or package our products, but instead contract with independent subcontractors.',
        SUPPLIERS.body[1],
        SUPPLIERS.body[2],
    ],
};

const CLIMATE: Factor = {
    heading: 'Climate change may have a long-term impact on our business.',
    body: [
        'Climate change may have an increasingly adverse impact on our business and on our customers, partners and vendors. Water and energy availability and reliability in the regions where we conduct business is critical.',
    ],
};

const CRYPTO: Factor = {
    heading: 'Our exposure to the cryptocurrency market could cause volatility in our results.',
    body: [
        'Volatility in the cryptocurrency market, including changes in the prices of cryptocurrencies, can impact demand for our products and our ability to estimate demand for our products.',
    ],
};

const EXPORT: Factor = {
    heading: 'New export controls on our products could negatively impact our business.',
    body: [
        'Export controls and tariffs imposed by the United States and other governments could restrict our ability to sell our products in certain markets, and could encourage customers to seek alternatives.',
        'We may not be able to obtain the licenses we need to ship products into affected markets on a timely basis, or at all.',
    ],
};

const TAX: Factor = {
    heading: 'We may have exposure to additional tax liabilities.',
    body: ['We are subject to income taxes in the United States and foreign jurisdictions, and changes in tax laws or their interpretation could affect our results.'],
};

function riskSection(factors: Factor[]): string {
    const blocks = factors.map((factor) => bold(factor.heading) + factor.body.map(para).join(''));
    // A page break in the middle of the section.
    blocks.splice(2, 0, pageBreak(14));
    return (
        `<div id="i1a"></div>${bold('Item 1A. Risk Factors')}` +
        para('The following risk factors should be considered in addition to the other information in this Annual Report on Form 10-K.') +
        bold('Risks Related to Our Industry and Markets') +
        blocks.join('')
    );
}

function filing(factors: Factor[], mdaParagraphs: string[]): string {
    return `<html><head><title>10-K</title><style>.x{font-weight:700}</style></head><body>
<div style="display:none"><ix:header><ix:hidden><ix:nonNumeric name="dei:DocumentType">10-K</ix:nonNumeric></ix:hidden></ix:header></div>
${para('UNITED STATES SECURITIES AND EXCHANGE COMMISSION')}
${bold('Table of Contents')}
${toc}
${pageBreak(2)}
<div id="i1"></div>${bold('Item 1. Business')}
${para('We are a technology company. For a discussion of risks, refer to “Item 1A. Risk Factors” in this report.')}
${riskSection(factors)}
${bold('Item 1B. Unresolved Staff Comments')}
${para('None.')}
${bold('Item 1C. Cybersecurity')}
${para('We have a cybersecurity program.')}
${bold('Item 2. Properties')}
${para('Our headquarters are in Santa Clara, California.')}
${bold("Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations")}
${para('The following discussion should be read in conjunction with “Item 1A. Risk Factors” and our financial statements.')}
${bold('Results of Operations')}
${mdaParagraphs.map(para).join('')}
<table>
  <tr><td><span style="font-weight:700">Revenue</span></td><td>$</td><td>130,497</td><td>$</td><td>60,922</td></tr>
</table>
${bold('Item 7A. Quantitative and Qualitative Disclosures About Market Risk')}
${para('We are exposed to interest rate risk.')}
${bold('Item 8. Financial Statements and Supplementary Data')}
${para('The information required by this item is set forth in our financial statements.')}
</body></html>`;
}

const MDA_UNCHANGED = [
    'Our operating expenses increased due to higher compensation and benefits, reflecting employee growth and compensation increases.',
    'We believe that we have sufficient liquidity to meet our operating requirements for at least the next twelve months.',
];
const MDA_PREVIOUS = ['Revenue for fiscal year 2025 was $130.5 billion, up 114% from a year ago, driven by demand for our Data Center products.', ...MDA_UNCHANGED];
const MDA_CURRENT = ['Revenue for fiscal year 2026 was $215.9 billion, up 65% from a year ago, driven by strong demand for our Data Center and networking products.', ...MDA_UNCHANGED];

// Previous: competition, suppliers, climate, crypto, tax. Current: crypto removed, export controls added, suppliers reworded.
const previousHtml = filing([COMPETITION, SUPPLIERS, CLIMATE, CRYPTO, TAX], MDA_PREVIOUS);
const currentHtml = filing([COMPETITION, SUPPLIERS_CURRENT, CLIMATE, EXPORT, TAX], MDA_CURRENT);

// ---------------------------------------------------------------------------------------------------------------

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
}

const previous = extractParagraphs(previousHtml);
const current = extractParagraphs(currentHtml);
const texts = (paragraphs: Paragraph[]) => paragraphs.map((paragraph) => paragraph.text);

test('extractParagraphs drops page numbers, back-links, hidden iXBRL data and styles', () => {
    const all = texts(current);
    assert.ok(!all.includes('14'), 'page number dropped');
    assert.ok(!all.includes('Table of Contents'), 'back-links dropped');
    assert.ok(!all.some((text) => text.includes('dei:DocumentType') || text === '10-K'), 'hidden ix:header skipped');
    assert.ok(!all.some((text) => text.includes('font-weight')), 'no CSS text');
});

test('extractParagraphs emits each block once (no double-counting of nested divs)', () => {
    const occurrences = texts(current).filter((text) => text === COMPETITION.body[0]).length;
    assert.equal(occurrences, 1);
});

test('extractParagraphs joins a table row into one paragraph', () => {
    assert.ok(texts(current).includes('Item 1A. Risk Factors 12'), 'TOC row joined');
    const revenueRow = current.find((paragraph) => paragraph.text.startsWith('Revenue $'));
    assert.ok(revenueRow, 'figures row present');
    assert.equal(revenueRow.table, true, 'row of figures flagged as table');
});

test('extractParagraphs detects bold headings and keeps body paragraphs as non-headings', () => {
    const heading = current.find((paragraph) => paragraph.text === EXPORT.heading);
    assert.ok(heading?.heading, 'bold risk-factor heading detected');
    const body = current.find((paragraph) => paragraph.text === EXPORT.body[0]);
    assert.equal(body?.heading, false, 'regular paragraph is not a heading');
});

test('extractParagraphs detects run-in bold leads and italic headings', () => {
    const [runIn] = extractParagraphs('<p><b>Competition.</b> We face intense competition in every market we serve.</p>');
    assert.equal(runIn.heading, true);
    assert.equal(runIn.lead, 'Competition');
    const [italic] = extractParagraphs('<p><i>Our stock price may be volatile</i></p>');
    assert.equal(italic.heading, true);
    const [italicProse] = extractParagraphs(
        '<p style="font-style:italic">The following risks could harm our business. Additional risks not presently known to us may also harm us.</p>'
    );
    assert.equal(italicProse.heading, false, 'two italic sentences are an emphasised paragraph, not a heading');
});

test('extractParagraphs rejoins a paragraph split by a page break', () => {
    const [joined] = extractParagraphs(
        `${para('Our results could be harmed by the loss of')}${pageBreak(9)}${para('a key customer or partner.')}`
    );
    assert.equal(joined.text, 'Our results could be harmed by the loss of a key customer or partner.');
});

const prevRisk = findSection(previous, 'risk');
const currRisk = findSection(current, 'risk');

test('findSection skips the table of contents and finds Item 1A', () => {
    assert.ok(prevRisk && currRisk, 'risk factors found in both');
    assert.ok(currRisk.length > 10, `risk section is not TOC-sized (${currRisk.length} paragraphs)`);
    assert.ok(!texts(currRisk).some((text) => text.includes('Unresolved Staff Comments')), 'no TOC text');
    assert.equal(currRisk[0].text, 'The following risk factors should be considered in addition to the other information in this Annual Report on Form 10-K.');
});

test('findSection is not cut short by an in-body "see Item 2" cross-reference', () => {
    assert.ok(currRisk);
    assert.ok(texts(currRisk).includes(SUPPLIERS.body[1]), 'cross-reference paragraph is inside the section');
    assert.ok(texts(currRisk).includes(SUPPLIERS.body[2]), 'a sentence starting "Item 2" is not an end marker');
    assert.equal(currRisk[currRisk.length - 1].text, TAX.body[0], 'section runs to the last risk factor, ending before Item 1B');
});

test('findSection handles "Item 1A" and "Risk Factors" in adjacent paragraphs, and "ITEM 1A:" / "Item 1A —" forms', () => {
    const split = extractParagraphs(`${bold('ITEM 1A:')}${bold('RISK FACTORS')}${para('First risk.')}${para('Second risk.')}${bold('ITEM 1B.')}${bold('UNRESOLVED STAFF COMMENTS')}`);
    assert.deepEqual(texts(findSection(split, 'risk') ?? []), ['First risk.', 'Second risk.']);
    const dashed = extractParagraphs(`${bold('Item 1A — Risk Factors')}${para('Only risk.')}${bold('Item 2 — Properties')}`);
    assert.deepEqual(texts(findSection(dashed, 'risk') ?? []), ['Only risk.']);
});

test('findSection finds MD&A between Item 7 and Item 7A, and returns null when missing', () => {
    const mda = findSection(current, 'mda');
    assert.ok(mda);
    assert.ok(texts(mda).includes(MDA_CURRENT[0]));
    assert.ok(!texts(mda).some((text) => text.includes('interest rate risk')), 'stops before Item 7A');
    assert.equal(findSection(extractParagraphs('<p>Nothing to see here.</p>'), 'risk'), null);
});

test('diffParagraphs reports one new, one removed and one reworded risk factor', () => {
    assert.ok(prevRisk && currRisk);
    const diff = diffParagraphs(prevRisk, currRisk);
    assert.deepEqual(diff.newHeadings, [EXPORT.heading]);
    assert.deepEqual(diff.removedHeadings, [CRYPTO.heading]);
    assert.equal(diff.changed.length, 1, 'one reworded paragraph');
    assert.equal(diff.changed[0].before.text, SUPPLIERS.body[0]);
    assert.equal(diff.changed[0].after.text, SUPPLIERS_CURRENT.body[0]);
    assert.ok(diff.changed[0].parts.some((part) => part.added && part.value.includes('tariffs')), 'word diff shows the insertion');
    assert.ok(diff.changed[0].parts.some((part) => part.removed && part.value.includes('fabrication')), 'word diff shows the deletion');
    assert.equal(diff.added.length, 1 + EXPORT.body.length, 'new heading and its body');
    assert.equal(diff.removed.length, 1 + CRYPTO.body.length);
    assert.deepEqual(diff.newFactors[0].body, EXPORT.body, 'new factor carries its body text');
    assert.equal(diff.otherAdded.length, 0, 'body of the new factor is not double-listed');
    assert.equal(diff.otherRemoved.length, 0);
    assert.equal(diff.unchangedCount, currRisk.length - diff.added.length - diff.changed.length);
});

test('diffParagraphs on MD&A finds the one changed paragraph', () => {
    const diff = diffParagraphs(findSection(previous, 'mda')!, findSection(current, 'mda')!);
    assert.equal(diff.changed.length, 1);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.newHeadings.length, 0);
});

test('compareParagraphs builds side-by-side parts with paragraph breaks', () => {
    const { parts } = compareParagraphs(prevRisk!, currRisk!);
    const currentText = parts.filter((part) => !part.removed).map((part) => part.value).join('');
    const previousText = parts.filter((part) => !part.added).map((part) => part.value).join('');
    assert.equal(currentText.trim(), texts(currRisk!).join('\n\n'));
    assert.equal(previousText.trim(), texts(prevRisk!).join('\n\n'));
    assert.ok(previousText.includes(CRYPTO.heading) && !currentText.includes(CRYPTO.heading));
});

test('normalisation ignores case, curly quotes, dashes and spacing', () => {
    assert.equal(normalizeForCompare('Our  “AI”  strategy — today’s focus'), normalizeForCompare('our "AI" strategy - today\'s focus'));
    const same = diffParagraphs([{ text: 'Our “AI” strategy — focus.', heading: false }], [{ text: 'our "ai" strategy - focus.', heading: false }]);
    assert.equal(same.unchangedCount, 1);
    assert.equal(same.changed.length, 0);
});

test('wordSetSimilarity ignores figures and pairs only similar paragraphs', () => {
    assert.equal(wordSetSimilarity(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
    assert.equal(wordSetSimilarity(new Set(['a']), new Set()), 0);
    const unrelated = diffParagraphs([{ text: 'We sell graphics chips to gamers.', heading: false }], [{ text: 'Interest rates rose sharply this year.', heading: false }]);
    assert.equal(unrelated.changed.length, 0);
    assert.equal(unrelated.added.length, 1);
    assert.equal(unrelated.removed.length, 1);
});

test('a moved, unchanged paragraph is not reported as added or removed', () => {
    const a: Paragraph = { text: 'Alpha paragraph about supply.', heading: false };
    const b: Paragraph = { text: 'Beta paragraph about demand.', heading: false };
    const c: Paragraph = { text: 'Gamma paragraph about pricing.', heading: false };
    const diff = diffParagraphs([a, b, c], [b, c, a]);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.unchangedCount, 3);
    assert.equal(diff.movedCount, 1);
});

console.log(`\n${passed} diff-engine tests passed`);
