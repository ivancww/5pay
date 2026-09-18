const assert = require('node:assert/strict');
const { normalize, calculate } = require('../report-data.js');

const mappings = [
    ['withdraw7_from8', '8年領取'], ['none', '自動滾存'], ['withdraw12_from15', '15年領取'],
    ['withdraw18_from20', '20年領取'], ['withdraw23_from25', '25年領取'], ['withdraw29_from30', '30年領取']
].map(([code, sheet_name]) => ({ code, sheet_name }));

const years = [5, 8, 10, 15, 20, 23, 25, 30];
const rollingMultipliers = { 5: 1, 8: 1.16, 10: 1.32, 15: 1.86, 20: 2.71, 23: 3.53, 25: 3.9, 30: 5.2 };
const return_tables = {};
mappings.forEach((mapping, pageIndex) => {
    return_tables[mapping.sheet_name] = {
        rows: years.map(year => ({
            保單年度: year,
            領取百分比: mapping.code === 'none' ? 0 : `${pageIndex + year / 10}%`,
            倍數: mapping.code === 'none' ? rollingMultipliers[year] : 1 + pageIndex / 10 + year / 100
        }))
    };
});
const tables = normalize({ return_tables }, mappings);

assert.equal(Object.keys(tables).length, 6, 'all six mapped pages are loaded independently');
for (const [pageIndex, mapping] of mappings.entries()) {
    for (const year of [5, 10, 15, 20]) {
        const source = return_tables[mapping.sheet_name].rows.find(row => row.保單年度 === year);
        const result = calculate(tables, [{ id: 'jar1', strategy: mapping.code, startOffset: 1, totalInput: 200000, annualContribution: 40000 }], year);
        assert.equal(result.asset, 200000 * source.倍數, `${mapping.sheet_name} year ${year} uses its own column C`);
        assert.equal(result.income, 200000 * (Number.parseFloat(source.領取百分比) / 100), `${mapping.sheet_name} year ${year} uses its own column B`);
        assert.equal(tables[mapping.code].rows.find(row => row.year === year).multiplier, source.倍數, `page ${pageIndex + 1} keeps its own multiplier`);
    }
}

for (const [year, multiplier] of Object.entries({ 8: 1.16, 10: 1.32, 15: 1.86, 20: 2.71, 23: 3.53 })) {
    const principal = 200000;
    const result = calculate(tables, [{ id: 'jar1', strategy: 'none', startOffset: 1, totalInput: principal, annualContribution: 40000 }], Number(year));
    assert.equal(result.asset, principal * multiplier, `自動滾存 year ${year}: principal × ${multiplier}`);
    assert.equal(result.income, 0, `自動滾存 year ${year}: column B is zero`);
}

const scaled = calculate(tables, [{ id: 'jar1', strategy: 'none', startOffset: 1, totalInput: 100000, annualContribution: 20000 }], 10);
assert.equal(scaled.asset, 132000, 'different principal multiplies the same Sheet C value directly');

const mixed = calculate(tables, [
    { id: 'jar1', strategy: 'withdraw7_from8', startOffset: 1, totalInput: 200000, annualContribution: 40000 },
    { id: 'jar2', strategy: 'withdraw12_from15', startOffset: 6, totalInput: 400000, annualContribution: 80000 }
], 15);
assert.equal(mixed.missing.length, 0, 'two reservoirs resolve their own page and relative policy year');
assert.equal(mixed.asset, 200000 * 1.15 + 400000 * 1.3, 'two reservoirs aggregate only after page/year lookup');

const four = calculate(tables, mappings.slice(0, 4).map((mapping, index) => ({
    id: `jar${index + 1}`, strategy: mapping.code, startOffset: index * 5 + 1,
    totalInput: (index + 1) * 200000, annualContribution: (index + 1) * 40000
})), 20);
assert.equal(four.missing.length, 0, 'four reservoirs cover relative years 20/15/10/5 from four pages');

const matrix = normalize({ sheet_data: { '自動滾存': { data: [['保單年度', '領取百分比', '倍數'], [8, '0%', 1.16]] } } }, mappings);
assert.deepEqual(matrix.none.rows[0], { year: 8, withdrawalRate: 0, multiplier: 1.16 }, 'A/B/C header matrix is supported');
const positional = normalize({ returns: { none: [[8, 0, 1.16]] } }, mappings);
assert.deepEqual(positional.none.rows[0], { year: 8, withdrawalRate: 0, multiplier: 1.16 }, 'raw positional A/B/C rows are supported');
const missingColumnB = normalize({ returns: { none: [{ 保單年度: 8, 倍數: 1.16 }] } }, mappings);
assert.equal(missingColumnB.none, undefined, 'a page without source column B is rejected');

const missing = calculate(tables, [{ id: 'jar1', strategy: 'none', startOffset: 1, totalInput: 200000 }], 11);
assert.equal(missing.complete, false, 'missing page/year is reported instead of interpolated');
assert.equal(missing.asset, 0, 'missing C value never falls back to a fabricated return');
console.log('report-data: all assertions passed');
