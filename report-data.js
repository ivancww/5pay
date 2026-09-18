(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AVAReportData = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Google Sheet source columns: A = policy year, B = withdrawal percentage,
    // C = multiplier. Aliases only describe the same three source columns.
    const FIELDS = {
        year: ['year', 'policy_year', '年份', '年度', '保單年度', '第幾年', 'a欄保單年度'],
        withdrawalRate: ['withdrawal_rate', 'withdrawal_percentage', '領取百分比', '提取百分比', '領取比例', 'b欄領取百分比'],
        multiplier: ['multiplier', 'multiple', '倍數', '回報倍數', 'c欄倍數']
    };

    function number(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (value == null || value === '') return null;
        const parsed = Number(String(value).replace(/[$,%\s,]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }

    function percentage(value) {
        const parsed = number(value);
        if (parsed == null) return 0;
        const hasPercentSign = typeof value === 'string' && value.includes('%');
        return hasPercentSign || Math.abs(parsed) > 1 ? parsed / 100 : parsed;
    }

    function fieldFor(row, aliases) {
        const key = Object.keys(row || {}).find(candidate => aliases.includes(String(candidate).trim().toLowerCase()));
        return { found: key != null, value: key == null ? null : row[key] };
    }

    function objectRows(rows) {
        if (!rows.length || !Array.isArray(rows[0])) return rows;
        // GAS may send raw A/B/C values without a header row.
        if (number(rows[0][0]) != null) {
            return rows.map(cells => ({ policy_year: cells[0], withdrawal_percentage: cells[1], multiplier: cells[2] }));
        }
        const headers = rows[0].map(String);
        return rows.slice(1).map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
    }

    function findTables(payload) {
        for (const key of ['return_tables', 'report_data', 'returns', 'sheet_data']) {
            if (payload && payload[key] && typeof payload[key] === 'object') return payload[key];
        }
        return {};
    }

    function normalize(payload, mappings) {
        const source = findTables(payload);
        const result = {};
        (mappings || []).forEach(mapping => {
            const raw = source[mapping.code] || source[mapping.sheet_name];
            const rows = Array.isArray(raw) ? raw : raw && (raw.rows || raw.data);
            if (!Array.isArray(rows)) return;
            const normalizedRows = objectRows(rows).map(row => {
                const year = fieldFor(row, FIELDS.year);
                const withdrawalRate = fieldFor(row, FIELDS.withdrawalRate);
                const multiplier = fieldFor(row, FIELDS.multiplier);
                return {
                    year: number(year.value),
                    withdrawalRate: percentage(withdrawalRate.value),
                    multiplier: number(multiplier.value),
                    hasSourceColumns: year.found && withdrawalRate.found && multiplier.found
                };
            }).filter(row => row.hasSourceColumns && Number.isInteger(row.year) && row.year > 0 && row.multiplier != null)
                .map(({ hasSourceColumns, ...row }) => row);
            if (normalizedRows.length) {
                result[mapping.code] = { sheetName: mapping.sheet_name, rows: normalizedRows };
            }
        });
        return result;
    }

    function calculate(tables, jars, displayYear) {
        const totals = { reserve: 0, income: 0, accumulated: 0, asset: 0, returnRate: null, missing: [] };
        (jars || []).forEach(jar => {
            const jarYear = displayYear - jar.startOffset + 1;
            if (jarYear <= 0) return;
            const table = tables[jar.strategy];
            const row = table && table.rows.find(item => item.year === jarYear);
            if (!row) {
                totals.missing.push({ jar: jar.id, strategy: jar.strategy, year: jarYear });
                return;
            }
            const annualContribution = jar.annualContribution || jar.totalInput / 5;
            totals.reserve += Math.min(jarYear, 5) * annualContribution;
            totals.income += jar.totalInput * row.withdrawalRate;
            totals.accumulated += jar.totalInput * table.rows
                .filter(item => item.year <= jarYear)
                .reduce((sum, item) => sum + item.withdrawalRate, 0);
            // Core return calculation: actual principal × that page/year's Sheet column C.
            totals.asset += jar.totalInput * row.multiplier;
        });
        totals.complete = totals.missing.length === 0;
        return totals;
    }

    return { normalize, calculate, FIELD_NAMES: FIELDS };
}));
