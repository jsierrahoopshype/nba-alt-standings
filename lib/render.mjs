// Renders the whole page as one self-contained HTML file: styles, fonts
// (base64) and the sort script are inlined, the tables, leader lines, movers
// and charts are drawn here at build time. The only things the browser
// fetches besides the page are the team logos from nba-headshots.

import { CONFERENCES, leaders, moverText, leagueAveragePayroll } from './model.mjs';
import { signed, round, DASH } from './metrics.mjs';

export const PAGE_URL = 'https://hoopsmatic.com/standings';
export const LOGO_BASE = 'https://jsierrahoopshype.github.io/nba-headshots/teams/logos/current/svg/';
export const SSF_TEAM_BASE = 'https://hoopsmatic.com/salary-season-finder/team/';
export const TITLE = 'NBA Real Standings 2026-27: Records vs. Vegas, Payroll per Win and Luck | HoopsMatic';
export const DESCRIPTION = 'Every NBA team’s 2026-27 record measured against its Vegas win total, last season, payroll per win, point differential and Pythagorean luck. Updated nightly.';

export const logoUrl = (t) => LOGO_BASE + t.nba_id + '.svg';
export const teamUrl = (t) => SSF_TEAM_BASE + t.ssf_slug + '/';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '';
}

// Sign class for a signed column: by the value as shown, so +0.0 is neutral.
function signCls(v, d = 1) {
  const r = round(v, d);
  return r === null ? 'dash' : r > 0 ? 'pos' : r < 0 ? 'neg' : '';
}

// first: the direction of the first tap (1 = low to high).
export const COLUMNS = [
  { k: 'rank', label: 'Rank', t: 'num', first: 1 },
  { k: 'team', label: 'Team', t: 'str', first: 1 },
  { k: 'w', label: 'W', t: 'num', first: -1 },
  { k: 'l', label: 'L', t: 'num', first: -1 },
  { k: 'pct', label: 'Pct', t: 'num', first: -1 },
  { k: 'vsVegas', label: 'vs. Vegas', t: 'num', first: -1 },
  { k: 'vsLastYear', label: 'vs. Last Year', t: 'num', first: -1 },
  { k: 'dollarsPerWin', label: '$ per Win', t: 'num', first: 1 },
  { k: 'ptDiff', label: 'Pt Diff', t: 'num', first: -1 },
  { k: 'expW', label: 'Exp. W-L', t: 'num', first: -1 },
  { k: 'luck', label: 'Luck', t: 'num', first: -1 },
  { k: 'roadMinusHome', label: 'Road W − Home L', t: 'num', first: -1 },
];

function cell(r, k) {
  const v = r.m.value, t = r.m.text;
  const dv = (x) => (x === null || x === undefined ? '' : String(x));
  switch (k) {
    case 'rank': return `<td class="c-rank" data-v="${dv(r.rank)}">${r.rank ?? DASH}</td>`;
    case 'team':
      return `<td class="c-team" data-v="${esc(r.short)}"><a class="tm" href="${teamUrl(r)}" title="${esc(r.name)} payroll and salaries">`
        + `<img src="${logoUrl(r)}" alt="" width="22" height="22" loading="lazy">${esc(r.short)}</a></td>`;
    case 'w': return `<td data-v="${r.w}">${r.w}</td>`;
    case 'l': return `<td data-v="${r.l}">${r.l}</td>`;
    case 'pct': return `<td class="pct" data-v="${dv(v.pct)}">${t.pct}</td>`;
    case 'dollarsPerWin': return `<td data-v="${dv(v.dollarsPerWin)}"${v.dollarsPerWin === null ? ' class="dash"' : ''}>${t.dollarsPerWin}</td>`;
    case 'expW': return `<td data-v="${dv(v.expW)}"${v.expW === null ? ' class="dash"' : ''}>${t.expWL}</td>`;
    case 'roadMinusHome': return `<td data-v="${dv(v.roadMinusHome)}" class="${signCls(v.roadMinusHome, 0)}">${t.roadMinusHome}</td>`;
    default: return `<td data-v="${dv(v[k])}" class="${signCls(v[k])}">${t[k]}</td>`;
  }
}

export function tableHtml(conf, rows) {
  const head = COLUMNS.map((c) => {
    const cls = c.k === 'rank' ? ' class="c-rank"' : c.k === 'team' ? ' class="c-team"' : '';
    const sort = c.k === 'pct' ? 'descending' : 'none';
    const arr = c.k === 'pct' ? '▼' : '';
    return `<th scope="col"${cls} data-k="${c.k}" data-t="${c.t}" data-first="${c.first}" aria-sort="${sort}"><button type="button">${esc(c.label)}<span class="arr">${arr}</span></button></th>`;
  }).join('');
  const body = rows.map((r, i) => `<tr data-o="${i}">` + COLUMNS.map((c) => cell(r, c.k)).join('') + '</tr>').join('\n');
  return `<div class="table-wrap"><table class="lb" data-sortable aria-label="${conf}ern Conference">`
    + `<thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

export function leadersHtml(rows) {
  const L = leaders(rows);
  const pairs = [[L[0], L[1]], [L[2], L[3]], [L[4], L[5]], [L[6], L[7]]];
  return '<div class="leaders">' + pairs.map((p) => '<div class="lead"><dl>' + p.map((x) =>
    `<div><dt>${esc(x.label)}</dt>` + (x.text ? `<dd>${esc(x.text)}</dd>` : '<dd class="none">After the first games.</dd>') + '</div>').join('') + '</dl></div>').join('') + '</div>';
}

export function moversHtml(list, prevDate, today) {
  if (list === null) return '<p class="note">Movers appear once there is a previous night to compare against.</p>';
  const since = prevDate ? fmtDate(prevDate) : '';
  if (!list.length) return `<p class="note">No games since the ${esc(since)} update.</p>`;
  return '<div class="movers">' + list.map((m) => {
    const t = moverText(m);
    const cls = round(m.delta, 1) > 0 ? 'pos' : round(m.delta, 1) < 0 ? 'neg' : '';
    return `<div class="mover"><img src="${logoUrl(m)}" alt="" width="28" height="28" loading="lazy">`
      + `<span><span class="nm">${esc(m.short)} <span class="d ${cls}">${esc(t.delta)}</span></span>`
      + `<span class="det">${esc(t.games)}, now ${esc(t.record)}</span></span></div>`;
  }).join('') + '</div>';
}

// ── Scatter chart: X payroll, Y win % ──
// Drawn in a 400x320 box that is scaled to the column width, so at 360px it
// is close to 1:1 and the labels stay legible. X is shared by both charts
// (auto-scaled to the league's payroll range in $10M steps), Y is 0-100%.
export function xDomain(rows) {
  const ps = rows.map((r) => r.payroll).filter((p) => p !== null);
  if (!ps.length) return [150e6, 250e6];
  const step = 10e6;
  return [Math.floor((Math.min(...ps) - 4e6) / step) * step, Math.ceil((Math.max(...ps) + 4e6) / step) * step];
}

export function scatterSvg(conf, rows, domain, avgPayroll) {
  const W = 400, H = 320, ml = 40, mr = 24, mt = 12, mb = 40;
  const [x0, x1] = domain;
  const X = (p) => ml + ((p - x0) / (x1 - x0)) * (W - ml - mr);
  const Y = (f) => mt + (1 - f) * (H - mt - mb);
  const out = [];
  out.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-${conf}-t">`);
  out.push(`<title id="chart-${conf}-t">${conf}ern Conference: payroll against win percentage</title>`);
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    if (f !== 0.5) out.push(`<line class="grid" x1="${ml}" x2="${W - mr}" y1="${Y(f)}" y2="${Y(f)}"/>`);
    out.push(`<text class="ax" x="${ml - 6}" y="${Y(f) + 4}" text-anchor="end">${Math.round(f * 100)}%</text>`);
  }
  const span = (x1 - x0) / 1e6;
  const tickStep = span > 80 ? 20e6 : 10e6;
  for (let p = Math.ceil(x0 / tickStep) * tickStep; p <= x1; p += tickStep) {
    out.push(`<line class="grid" x1="${X(p)}" x2="${X(p)}" y1="${mt}" y2="${H - mb}" opacity=".5"/>`);
    out.push(`<text class="ax" x="${X(p)}" y="${H - mb + 15}" text-anchor="middle">$${Math.round(p / 1e6)}M</text>`);
  }
  out.push(`<text class="ax" x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle">2026-27 payroll</text>`);
  // Reference lines: .500 and the league-average payroll.
  out.push(`<line class="ref" x1="${ml}" x2="${W - mr}" y1="${Y(0.5)}" y2="${Y(0.5)}"/>`);
  out.push(`<text class="reflbl" x="${W - mr - 2}" y="${Y(0.5) - 4}" text-anchor="end">.500</text>`);
  if (avgPayroll !== null) {
    const ax = X(avgPayroll);
    out.push(`<line class="ref" x1="${ax}" x2="${ax}" y1="${mt}" y2="${H - mb}"/>`);
    out.push(`<text class="reflbl" x="${ax + 4}" y="${mt + 11}">avg $${round(avgPayroll / 1e6, 1).toFixed(1)}M</text>`);
  }
  const pts = rows.filter((r) => r.payroll !== null && r.m.value.pct !== null);
  if (!pts.length) {
    out.push(`<text class="empty" x="${(ml + W - mr) / 2}" y="${Y(0.75)}" text-anchor="middle">Teams appear here after their first game.</text>`);
  }
  const S = 26;
  // Lowest win % first, so the better team's logo sits on top where two overlap.
  for (const r of [...pts].sort((a, b) => a.m.value.pct - b.m.value.pct)) {
    const cx = X(r.payroll), cy = Y(r.m.value.pct);
    out.push(`<g><title>${esc(r.name)}: ${esc(r.m.text.pct)} (${r.w}-${r.l}), $${round(r.payroll / 1e6, 2).toFixed(2)}M payroll</title>`
      + `<image href="${logoUrl(r)}" x="${(cx - S / 2).toFixed(1)}" y="${(cy - S / 2).toFixed(1)}" width="${S}" height="${S}"/></g>`);
  }
  out.push('</svg>');
  return out.join('');
}

export function methodologyHtml(lines) {
  const sum = Object.values(lines.teams).reduce((s, t) => s + t.line, 0);
  const possible = 30 * 82 / 2;
  const diff = round(sum - possible, 1);
  const n = (x) => Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `<section class="method block" id="methodology">
<h2>How it works</h2>
<p>The standings are rebuilt every morning after the previous night’s games. Every number below is worked out from the games played so far, so a team is compared with where it should be today, not with where it should finish in April.</p>
<dl>
<dt>W, L and Pct</dt><dd>Wins, losses and winning percentage (wins divided by games played). Each conference is ranked by Pct, with more wins breaking ties.</dd>
<dt>vs. Vegas</dt><dd>Wins above or below the pace of the team’s preseason win total. A team with a 41.5-win line is expected to win 41.5 of 82 games, so after 20 games it should have about 10.1 wins. At 12-8 it is +1.9; at 8-12 it is −2.1.</dd>
<dt>The Vegas lines</dt><dd>Consensus win totals from six sportsbooks, compiled by Boyd’s Bets and frozen as of Oct 17, 2026, just before opening night. They never change during the season. The 30 lines add up to ${n(sum)} wins, but an 82-game season only has ${n(possible)} to hand out (every game has one winner), so the books were ${n(diff)} wins too generous across the league, about a quarter of a win per team.</dd>
<dt>vs. Last Year</dt><dd>The same pace math, using each team’s 2025-26 win total instead of the line.</dd>
<dt>$ per Win</dt><dd>The team’s 2026-27 payroll (every salary on its books in Salary Season Finder, including its share of players paid by more than one team), prorated to the games played and divided by wins. Lower is better. A team without a win shows a dash.</dd>
<dt>Pt Diff</dt><dd>Average scoring margin per game: points scored minus points allowed, divided by games played.</dd>
<dt>Exp. W-L</dt><dd>The record a team’s scoring suggests, using the Pythagorean formula with exponent 14: expected wins = games × PF¹⁴ / (PF¹⁴ + PA¹⁴), rounded to whole wins.</dd>
<dt>Luck</dt><dd>Actual wins minus expected wins. A positive number means the team has won more than its point differential says it should, usually by winning close games.</dd>
<dt>Road W − Home L</dt><dd>Road wins minus home losses. The old rule of thumb for a contender is to win at home and steal some on the road; a positive number means the road wins are outpacing the home slip-ups.</dd>
<dt>Biggest movers</dt><dd>The teams whose vs. Vegas number changed most since the previous night’s update.</dd>
</dl>
<p>Sources: records, points scored and allowed, and home and road records from ESPN’s standings feed. Payroll from Salary Season Finder. Before a team’s first game, and wherever a number cannot be worked out yet, the table shows a dash.</p>
</section>`;
}

export function pageHtml({ rows, conferences, movers, prevDate, updatedOn, lines, styles, fontsCss, sortJs }) {
  const avg = leagueAveragePayroll(rows);
  const dom = xDomain(rows);
  const tables = CONFERENCES.map((c) => `<section class="block"><div class="block-head"><h2>${c}ern Conference</h2></div>\n${tableHtml(c, conferences[c])}\n</section>`).join('\n');
  const charts = CONFERENCES.map((c) => `<figure class="chart"><h3>${c}ern Conference</h3>${scatterSvg(c, conferences[c], dom, avg)}</figure>`).join('');
  const prevIsYesterday = prevDate && updatedOn && (Date.parse(updatedOn) - Date.parse(prevDate)) === 86400000;
  const moversTitle = !prevDate || prevIsYesterday ? 'Biggest movers since yesterday' : 'Biggest movers since ' + fmtDate(prevDate);
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
<p class="subtitle">Every team’s record measured against Vegas, last season, its payroll and its luck. <span class="stamp">Updated ${esc(fmtDate(updatedOn))}</span></p>

<section class="block">${leadersHtml(rows)}</section>

<section class="block"><div class="block-head"><h2>${esc(moversTitle)}</h2></div>
${moversHtml(movers, prevDate, updatedOn)}
</section>

${tables}

<section class="block"><div class="block-head"><h2>Payroll vs. win percentage</h2><span class="sub">Dashed lines: .500 and league-average payroll</span></div>
<div class="charts">${charts}</div>
</section>

${methodologyHtml(lines)}

<footer class="foot">
<p>Anything wrong? Email us at <a href="mailto:hoopshype@hoopshype.com">hoopshype@hoopshype.com</a></p>
<p>For business inquiries, contact us at <a href="mailto:ads@hoopshype.com">ads@hoopshype.com</a></p>
</footer>

</div>
<script>
${sortJs}
</script>
</body>
</html>
`;
}
