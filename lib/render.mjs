// The parts of the page: tables, leader lines, movers, the SVG charts and
// the timeframe label, plus the formatting they share. lib/page.mjs puts
// them into the whole page. These functions run at build time and, bundled
// by scripts/build.mjs, again in the browser for the ?asof= and ?since=
// views, so they use nothing but plain JavaScript and Intl.

import { CONFERENCES, leaders, moverText, leagueAveragePayroll, buildRows, byConference } from './model.mjs';
import { signed, round, DASH } from './metrics.mjs';
import { gamesIn } from './timeframe.mjs';

export const PAGE_URL = 'https://hoopsmatic.com/standings';
export const LOGO_BASE = 'https://jsierrahoopshype.github.io/nba-headshots/teams/logos/current/svg/';
export const SSF_TEAM_BASE = 'https://hoopsmatic.com/salary-season-finder/team/';
export const TITLE = 'NBA Real Standings 2026-27: Records vs. Vegas, Payroll per Win and Luck | HoopsMatic';
export const DESCRIPTION = 'Every NBA team’s 2026-27 record measured against its Vegas win total, last season, payroll per win, point differential and Pythagorean luck. Updated nightly.';

export const logoUrl = (t) => LOGO_BASE + t.nba_id + '.svg';
// The team's Salary Season Finder page, and its page in this section (the
// same slug, served by the Worker at /standings/<slug>).
export const teamUrl = (t) => SSF_TEAM_BASE + t.ssf_slug + '/';
export const standingsTeamUrl = (t) => PAGE_URL + '/' + t.ssf_slug;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// AP style: Jan., Feb., Aug., Sept., Oct., Nov., Dec. abbreviated with a
// period; March, April, May, June and July spelled out.
export const AP_MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
// "Oct. 20, 2026"
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? AP_MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '';
}
// "Oct. 21", for labels inside the season.
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? AP_MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) : '';
}

// "7:30 p.m. ET" for an ISO instant.
export function fmtTimeEt(isoUtc) {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return get('hour') + ':' + get('minute').padStart(2, '0') + ' ' + (get('dayPeriod').toLowerCase() === 'am' ? 'a.m.' : 'p.m.') + ' ET';
}

// "Oct. 21, 1:42 a.m. ET (7:42 Madrid)" for an ISO instant.
export function fmtUpdated(isoUtc) {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return '';
  const part = (opts, type) => new Intl.DateTimeFormat('en-US', opts).formatToParts(d).find((p) => p.type === type).value;
  const et = { timeZone: 'America/New_York' };
  const month = AP_MONTHS[Number(part({ ...et, month: 'numeric' }, 'month')) - 1];
  const day = part({ ...et, day: 'numeric' }, 'day');
  const h12 = part({ ...et, hour: 'numeric', hour12: true }, 'hour');
  const min = part({ ...et, minute: '2-digit' }, 'minute').padStart(2, '0');
  const ampm = part({ ...et, hour: 'numeric', hour12: true }, 'dayPeriod').toLowerCase() === 'am' ? 'a.m.' : 'p.m.';
  const mad = { timeZone: 'Europe/Madrid', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' };
  const mh = String(Number(part(mad, 'hour')));
  const mm = part(mad, 'minute').padStart(2, '0');
  return `${month} ${day}, ${h12}:${min} ${ampm} ET (${mh}:${mm} Madrid)`;
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
      return `<td class="c-team" data-v="${esc(r.short)}"><a class="tm" href="${standingsTeamUrl(r)}" title="${esc(r.name)}: record vs. Vegas, point differential and luck">`
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

// ── Timeframes ──
// The parts of the page that follow the selected timeframe: leader lines,
// the two conference tables and the two charts. The build renders them for
// the season; the page script (src/views.js) renders them again for ?asof=
// and ?since= with these same functions, bundled into the page.
export function tablesHtml(conferences) {
  return CONFERENCES.map((c) => `<section class="block"><div class="block-head"><h2>${c}ern Conference</h2></div>\n${tableHtml(c, conferences[c])}\n</section>`).join('\n');
}
export function chartsHtml(rows, conferences) {
  const avg = leagueAveragePayroll(rows);
  const dom = xDomain(rows);
  return CONFERENCES.map((c) => `<figure class="chart"><h3>${c}ern Conference</h3>${scatterSvg(c, conferences[c], dom, avg)}</figure>`).join('');
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// The line under the selector, and the note when a date had to fall back.
export function timeframeLabel(tf, standings) {
  if (tf.kind === 'season') return { label: '', note: '' };
  const g = gamesIn(standings);
  const games = plural(g, 'game', 'games');
  let label;
  if (tf.preset) {
    label = (tf.preset === 'last7' ? 'Last 7 days' : 'Last 15 days')
      + (tf.used ? ' (games after ' + fmtDay(tf.used) + '): ' : ' (the season so far): ') + games;
  } else if (tf.kind === 'since') {
    label = 'Since ' + fmtDay(tf.requested) + ': ' + games;
  } else {
    label = 'As of ' + fmtDay(tf.requested) + ': ' + plural(g, 'game', 'games') + ' played';
  }
  let note = '';
  if (!tf.preset && tf.fallback) {
    note = tf.used
      ? 'Nothing was saved for ' + fmtDay(tf.requested) + ', so this uses ' + fmtDay(tf.used) + ', the nearest earlier date.'
      : 'Nothing was saved on or before ' + fmtDay(tf.requested) + ', so this '
        + (tf.kind === 'since' ? 'covers the whole season.' : 'is the 0-0 start of the season.');
  }
  return { label, note };
}

// Everything that follows the timeframe, for one set of standings.
export function timeframeParts(teams, standings, lines, payroll) {
  const rows = buildRows(teams, { teams: standings }, lines, payroll);
  const conferences = byConference(rows);
  return { leaders: leadersHtml(rows), tables: tablesHtml(conferences), charts: chartsHtml(rows, conferences) };
}
