# GAS return-report contract

Google Sheets, exposed by the existing GAS web app, is the only source of report
returns. GAS must read **each mapped page independently** and return its three source
columns without deriving or sharing values between pages:

- column A: `保單年度`
- column B: `領取百分比`
- column C: `倍數`

The GET response must include one of `return_tables` (preferred), `report_data`,
`returns`, or `sheet_data`, keyed by mapping code or mapped sheet name:

```json
{
  "system_version": "v6.3.26",
  "return_data_version": "2026-09-18T00:00:00Z",
  "return_tables": {
    "自動滾存": {
      "rows": [
        { "保單年度": 8, "領取百分比": 0, "倍數": 1.16 },
        { "保單年度": 10, "領取百分比": 0, "倍數": 1.32 }
      ]
    }
  }
}
```

Header/data matrices such as `[["保單年度", "領取百分比", "倍數"], [8, 0, 1.16]]`
and raw positional A/B/C rows such as `[[8, 0, 1.16]]` are also accepted.

All six pages (`8年領取`, `自動滾存`, `15年領取`, `20年領取`, `25年領取`, and
`30年領取`) must include an exact row for every policy year shown by the UI. For each
reservoir, the client selects its mapped page and relative policy year, then calculates:

- annual withdrawal = actual principal × that row's column B withdrawal percentage;
- cumulative withdrawal = actual principal × the sum of column B through that year;
- asset value = actual principal × that row's column C multiplier.

There is no `base_principal` scaling, cross-page reuse, interpolation, fixed growth rate,
or front-end IRR derivation. Missing page/year/C data fails closed rather than producing
an estimated return.

The normalized A/B/C response is cached in `ava_return_data_cache_v2`. On startup the
client renders that cache and calls `?check_version=true`; GAS should return
`return_data_version` (or at least `system_version`). A matching version avoids a full
table download, while a changed or absent version triggers the full GET. Offline mode
uses only the last successful cloud response.
