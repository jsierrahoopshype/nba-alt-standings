# nba-alt-standings

NBA Real Standings, served at https://hoopsmatic.com/standings (the hoopsmatic-worker proxies this repo's GitHub Pages site).

Every team's 2026-27 record against its Vegas win total, last season, payroll per win, point differential and Pythagorean luck.

## How it updates

`.github/workflows/nightly.yml` runs every morning (10:23 UTC) and on demand (Actions tab, "Run workflow"):

1. `scripts/fetch.mjs`: every request goes through `lib/http.mjs` (desktop Chrome headers, plus nba.com Referer/Origin for cdn.nba.com; 30s, one retry), the same code the "Probe feeds" step (`scripts/probe.mjs`) runs. If every standings source fails, nothing is written and the run fails. Standings come from ESPN's public feed (`site.api.espn.com/apis/v2/sports/basketball/nba/standings`); if that fails, they are rebuilt from cdn.nba.com's season schedule. Payroll is the sum of 2026-27 salaries in Salary Season Finder's `data/data.json`. Writes `data/standings.json`, `data/payroll_2026-27.json` and a snapshot in `data/history/` on each day the standings changed.
2. `scripts/build.mjs`: renders `index.html` (one self-contained file: styles, fonts and the sort script inline) and `sitemap.xml`. `data/page_hashes.json` keeps the page's content hash; its `<lastmod>` moves only when the hash changes.
3. Tests, then a commit only if something changed.

`data/vegas_lines_2026-27.json` is frozen (Boyd's Bets six-book consensus, Oct 17, 2026) and never written by the run.

## Files

- `lib/metrics.mjs`: every column's formula and formatting.
- `lib/sources.mjs`: ESPN, cdn.nba.com and Salary Season Finder parsers.
- `lib/model.mjs`: conference ranks, leader lines, movers.
- `lib/render.mjs`: the page, tables and SVG charts.
- `data/teams.json`: the 30 teams (ESPN abbreviations, NBA ids for logos, Salary Season Finder slugs).
- `fonts/`: DM Sans and JetBrains Mono (SIL OFL), inlined by the build.

## Tests

```
node test/metrics.test.mjs
node test/data-and-page.test.mjs
node test/http.test.mjs
```
