// The page around the parts in render.mjs: head, selector, methodology,
// footer and the inline scripts. Build-time only: the page script gets
// render.mjs and friends (scripts/build.mjs bundleLib), not this file.

import { PAGE_URL, TITLE, DESCRIPTION, esc, fmtDate, fmtDay, fmtUpdated, leadersHtml, moversHtml, tablesHtml, chartsHtml } from './render.mjs';
import { round } from './metrics.mjs';

// "Oct. 20", "Oct. 20 and Oct. 21", "Oct. 20, Oct. 21 and Oct. 22"
function joinDays(dates) {
  const d = dates.map(fmtDay);
  return d.length < 2 ? d.join('') : d.slice(0, -1).join(', ') + ' and ' + d[d.length - 1];
}

export function methodologyHtml(lines, nightsWithoutPayroll = []) {
  const sum = Object.values(lines.teams).reduce((s, t) => s + t.line, 0);
  const possible = 30 * 82 / 2;
  const diff = round(sum - possible, 1);
  const n = (x) => Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `<section class="method block" id="methodology">
<h2>How it works</h2>
<p>The standings are rebuilt after every game goes final. Every number below is worked out from the games played so far, so a team is compared with where it should be today, not with where it should finish in April.</p>
<dl>
<dt>W, L and Pct</dt><dd>Wins, losses and winning percentage (wins divided by games played). Each conference is ranked by Pct, with more wins breaking ties.</dd>
<dt>vs. Vegas</dt><dd>Wins above or below the pace of the team’s preseason win total. A team with a 41.5-win line is expected to win 41.5 of 82 games, so after 20 games it should have about 10.1 wins. At 12-8 it is +1.9; at 8-12 it is −2.1.</dd>
<dt>The Vegas lines</dt><dd>Consensus win totals from six sportsbooks, compiled by Boyd’s Bets and frozen as of Oct. 17, 2026, just before opening night. They never change during the season. The 30 lines add up to ${n(sum)} wins, but an 82-game season only has ${n(possible)} to hand out (every game has one winner), so the books were ${n(diff)} wins too generous across the league, about a quarter of a win per team.</dd>
<dt>vs. Last Year</dt><dd>The same pace math, using each team’s 2025-26 win total instead of the line.</dd>
<dt>$ per Win</dt><dd>The team’s 2026-27 payroll (every salary on its books in Salary Season Finder, including its share of players paid by more than one team), prorated to the games played and divided by wins. Lower is better. A team without a win shows a dash. The team pages\u2019 $ per Win charts and the As of and Since views use the payroll saved with each night (for Since, the night you pick)${nightsWithoutPayroll.length ? '; ' + joinDays(nightsWithoutPayroll) + (nightsWithoutPayroll.length === 1 ? ', saved before payrolls were stored with each night, uses' : ', saved before payrolls were stored with each night, use') + ' the current payroll' : ''}.</dd>
<dt>Pt Diff</dt><dd>Average scoring margin per game: points scored minus points allowed, divided by games played.</dd>
<dt>Exp. W-L</dt><dd>The record a team’s scoring suggests, using the Pythagorean formula with exponent 14: expected wins = games × PF¹⁴ / (PF¹⁴ + PA¹⁴), rounded to whole wins.</dd>
<dt>Luck</dt><dd>Actual wins minus expected wins. A positive number means the team has won more than its point differential says it should, usually by winning close games.</dd>
<dt>Road W − Home L</dt><dd>Road wins minus home losses. The old rule of thumb for a contender is to win at home and steal some on the road; a positive number means the road wins are outpacing the home slip-ups.</dd>
<dt>Biggest movers</dt><dd>The teams whose vs. Vegas number changed most since the standings saved after the previous night of games.</dd>
<dt>Timeframes</dt><dd>Season shows the whole season. The standings are saved once every game of a night is final, and you can look back from any saved night. As of shows the standings exactly as they were that night. Since shows only the games played after that night: wins, losses, points and home and road records are the current ones minus that night’s, and every column is worked out again from those, with payroll prorated to the games in the window. Last 7 days and Last 15 days count back from the latest night with games. If a night was not saved, the nearest earlier one is used and the page says so.</dd>
</dl>
</section>`;
}

// The selector. Plain links and a form, so it works before the script runs
// (and without it): every choice is a /standings?... URL.
export function selectorHtml(dates) {
  const opts = (sel) => dates.length
    ? '<option value="">Pick a date</option>' + [...dates].reverse().map((d) => `<option value="${d}">${esc(fmtDay(d))}</option>`).join('')
    : '<option value="">No saved dates yet</option>';
  const dis = dates.length ? '' : ' disabled';
  return `<nav class="tf" aria-label="Timeframe">
<div class="chips">
<a class="chip active" data-tf="season" href="${PAGE_URL}">Season</a>
<a class="chip" data-tf="last7" href="${PAGE_URL}?since=last7">Last 7 days</a>
<a class="chip" data-tf="last15" href="${PAGE_URL}?since=last15">Last 15 days</a>
</div>
<form class="tf-dates" action="${PAGE_URL}" method="get">
<label>As of <select name="asof" id="tf-asof"${dis}>${opts()}</select></label>
<label>Since <select name="since" id="tf-since"${dis}>${opts()}</select></label>
<noscript><button type="submit">Show</button></noscript>
</form>
<p class="tf-label" id="tf-label" hidden></p>
<p class="tf-note" id="tf-note" hidden></p>
</nav>`;
}

export function pageHtml({ rows, conferences, movers, prevDate, gameDate, updatedOn, updatedAt, lines, styles, fontsCss, sortJs, dates = [], dataJson = '', bundleJs = '', viewsJs = '', nightsWithoutPayroll = [] }) {
  const tables = tablesHtml(conferences);
  const charts = chartsHtml(rows, conferences);
  const prevIsYesterday = prevDate && gameDate && (Date.parse(gameDate) - Date.parse(prevDate)) === 86400000;
  const moversTitle = !prevDate || prevIsYesterday ? 'Biggest movers since yesterday' : 'Biggest movers since ' + fmtDate(prevDate);
  const stamp = updatedAt ? fmtUpdated(updatedAt) : fmtDate(updatedOn);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<link rel="canonical" href="${PAGE_URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="HoopsMatic">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${PAGE_URL}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(TITLE)}">
<meta name="twitter:description" content="${esc(DESCRIPTION)}">
<style>
${fontsCss}
${styles}
</style>
</head>
<body>
<div class="container">

<div class="hdr"><h1>NBA Real Standings</h1></div>
<p class="subtitle">Every team’s record measured against Vegas, last season, its payroll and its luck. <span class="stamp">Updated ${esc(stamp)}</span></p>

<section class="block">${selectorHtml(dates)}</section>

<section class="block" id="tf-leaders">${leadersHtml(rows)}</section>

<section class="block"><div class="block-head"><h2>${esc(moversTitle)}</h2></div>
${moversHtml(movers, prevDate, updatedOn)}
</section>

<div id="tf-tables">
${tables}
</div>

<section class="block"><div class="block-head"><h2>Payroll vs. win percentage</h2><span class="sub">Dashed lines: .500 and league-average payroll</span></div>
<div class="charts" id="tf-charts">${charts}</div>
</section>

${methodologyHtml(lines, nightsWithoutPayroll)}

<footer class="foot">
<p>Anything wrong? Email us at <a href="mailto:hoopshype@hoopshype.com">hoopshype@hoopshype.com</a></p>
<p>For business inquiries, contact us at <a href="mailto:ads@hoopshype.com">ads@hoopshype.com</a></p>
</footer>

</div>
<script type="application/json" id="hm-data">${dataJson}</script>
<script>
${sortJs}
</script>
<script>
${bundleJs}
${viewsJs}
</script>
</body>
</html>
`;
}
