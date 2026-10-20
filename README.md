# nba-alt-standings

NBA Real Standings, served at https://hoopsmatic.com/standings (the hoopsmatic-worker proxies this repo's GitHub Pages site).

Every team's 2026-27 record against its Vegas win total, last season, payroll per win, point differential and Pythagorean luck.

## How it updates

`.github/workflows/nightly.yml` runs `scripts/update.mjs` every 30 minutes from 16:00 to 08:00 UTC, as a daily safety net at 10:23 UTC (`--force`) and on "Run workflow" (`--force`):

1. Scoreboards for yesterday and today (ET), ESPN first, cdn.nba.com's schedule as the fallback. Every request goes through `lib/http.mjs` (desktop Chrome headers, plus nba.com Referer/Origin for cdn.nba.com; 30s, one retry), the same code the "Probe feeds" step (`scripts/probe.mjs`, forced runs only) runs.
2. Pregame archive: each game not yet started gets `data/pregame/<date>/<AWAY>@<HOME>.json` (game id, teams, tip, time saved, both records). Written once, never edited. Game log: each final gets `data/games/<date>/<AWAY>@<HOME>.json` (game id, ET date, home, away, scores, when it was recorded); a later score correction is a new `.c1`, `.c2` ... entry marked as a correction, never an edit. Counted dates missing from the log are backfilled.
3. If no regular-season game has gone final since the last update (`data/finals.json`), the run stops and nothing is committed.
4. Otherwise the standings are refreshed (ESPN's feed, else rebuilt from cdn.nba.com's schedule). A final counts once the standings reflect it. If every source fails, the run fails and nothing is written.
5. `data/history/<date>.json`: the standings after every game of that ET date is final; rewritten if it changes that same night, never after the next game date has started. No games, no file.
6. Payroll (Salary Season Finder's `data/data.json`), then `index.html`, the 30 team pages (`<slug>/index.html`, served at `/standings/<slug>`), `data/nights.json` and `sitemap.xml`, only when some file was written. The page's "Updated" time moves with the standings or the payroll; each sitemap `<lastmod>` moves only with its own numbers: `/standings` with every team's, a team page with its team's (`data/page_hashes.json`).

`data/vegas_lines_2026-27.json` is frozen (Boyd's Bets six-book consensus, Oct 17, 2026) and never written by the run.

## Team pages

`/standings/<slug>` (Salary Season Finder's slugs: `lakers`, `trail-blazers` ...): record, conference and league rank, the change since the previous game night, the same eight metrics as the table, one chart per metric over the saved nights (from 5 nights on), the game log, the next game when the pregame archive has it, and links to the full standings, the team's Salary Season Finder page and its 14 conference rivals.

## Timeframes

`/standings` is the season. `?asof=YYYY-MM-DD` shows a saved night exactly; `?since=YYYY-MM-DD` (or `last7`, `last15`) shows the current standings minus that night's, with every column recomputed. A date without a saved night uses the nearest earlier one, and the page says so. These views are drawn in the browser (`src/views.js`, with `lib/` bundled into the page) from `data/nights.json`, fetched only when one is picked, and are marked `noindex,follow` with a canonical to themselves; the plain page is unchanged and the only URL in the sitemap.

## Files

- `lib/metrics.mjs`: every column's formula and formatting.
- `lib/sources.mjs`: ESPN, cdn.nba.com and Salary Season Finder parsers.
- `lib/model.mjs`: conference ranks, leader lines, movers.
- `lib/render.mjs`: tables, leader lines, movers, SVG charts, timeframe labels (also bundled into the page).
- `lib/page.mjs`: the page around them (head, selector, methodology, footer).
- `lib/timeframe.mjs`: as-of and since views (snapshot subtraction, nearest earlier night).
- `lib/scoreboard.mjs`: scoreboard parsers.
- `lib/team.mjs`, `lib/charts.mjs`: team pages and their SVG line charts.
- `scripts/gamelog.mjs`: the append-only game log.
- `data/teams.json`: the 30 teams (ESPN abbreviations, NBA ids for logos, Salary Season Finder slugs).
- `fonts/`: DM Sans and JetBrains Mono (SIL OFL), inlined by the build.

## Tests

```
node test/metrics.test.mjs
node test/data-and-page.test.mjs
node test/http.test.mjs
node test/phase1.test.mjs
node test/phase1b.test.mjs
```
