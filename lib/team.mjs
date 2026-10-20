// The team pages, /standings/<slug>: one static page per team, built with
// the main page from the same data. Every number on it comes from the same
// functions as the main table (buildRows, rankConference), so a team's page
// and its row in the table always agree for the same night.

import { buildRows, rankConference } from './model.mjs';
import { expectedWins, round, signed, DASH } from './metrics.mjs';
import { PAGE_URL, esc, fmtDay, fmtTipEtMadrid, logoUrl, teamUrl } from './render.mjs';
import { lineChart } from './charts.mjs';

export const MIN_CHART_POINTS = 5;
const SEASON_GAMES = 82;

export const teamPageUrl = (t) => PAGE_URL + '/' + t.ssf_slug;

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

// Every team's row for one set of standings, with its conference rank
// (rank) and league rank (leagueRank), both null before its first game.
export function rankedRows(teams, standingsTeams, lines, payroll) {
  const rows = buildRows(teams, { teams: standingsTeams }, lines, payroll);
  const league = Object.fromEntries(rankConference(rows).map((r) => [r.abbr, r.rank]));
  const out = {};
  for (const conf of ['East', 'West']) {
    for (const r of rankConference(rows.filter((x) => x.conf === conf))) out[r.abbr] = { ...r, leagueRank: league[r.abbr] };
  }
  return out;
}

// Every saved night's rows, each with the payroll saved with that night
// (the current payroll for a night saved before payrolls were).
export function nightRowsFor(snapshots, teams, lines, currentPayroll) {
  return snapshots.map((sn) => ({ date: sn.date, ownPayroll: !!sn.payroll,
    rows: rankedRows(teams, sn.teams, lines, sn.payroll ? { payroll: sn.payroll } : currentPayroll) }));
}

// One point per saved night, for one team.
export function teamSeries(abbr, nights) {
  return nights.map((n) => {
    const r = n.rows[abbr];
    const e = expectedWins(r);
    return {
      date: n.date, w: r.w, gp: r.gp,
      pace: r.gp ? r.gp * (r.line / SEASON_GAMES) : null,
      vsVegas: r.m.value.vsVegas, vsLastYear: r.m.value.vsLastYear, dollarsPerWin: r.m.value.dollarsPerWin,
      ptDiff: r.m.value.ptDiff, expW: e, roadMinusHome: r.m.value.roadMinusHome, rank: r.rank,
    };
  });
}

const money = (v) => '$' + (v / 1e6).toFixed(1) + 'M';
const one = (v) => signed(v);
const num1 = (v) => String(round(v, 1));

export function teamChartsHtml(series) {
  if (series.length < MIN_CHART_POINTS) {
    return '<p class="note">Charts fill in after a few games.</p>';
  }
  const dates = series.map((p) => p.date);
  const col = (k) => series.map((p) => (p[k] === null || p[k] === undefined ? null : p[k]));
  return '<div class="mcharts">' + [
    lineChart('Wins vs. Vegas pace', dates, [{ name: 'Actual wins', values: col('w'), cls: 'a' }, { name: 'Vegas pace', values: col('pace'), cls: 'b' }], { fmt: num1 }),
    lineChart('vs. Vegas', dates, [{ name: 'vs. Vegas', values: col('vsVegas'), cls: 'a' }], { fmt: one, zero: true }),
    lineChart('vs. Last Year', dates, [{ name: 'vs. Last Year', values: col('vsLastYear'), cls: 'a' }], { fmt: one, zero: true }),
    lineChart('$ per Win', dates, [{ name: '$ per Win', values: col('dollarsPerWin'), cls: 'a' }], { fmt: money }),
    lineChart('Pt Diff', dates, [{ name: 'Pt Diff', values: col('ptDiff'), cls: 'a' }], { fmt: one, zero: true }),
    lineChart('Actual vs. expected wins (the gap is Luck)', dates, [{ name: 'Actual wins', values: col('w'), cls: 'a' }, { name: 'Expected wins', values: col('expW'), cls: 'b' }], { fmt: num1 }),
    lineChart('Road W − Home L', dates, [{ name: 'Road W − Home L', values: col('roadMinusHome'), cls: 'a' }], { fmt: (v) => signed(v, 0), zero: true }),
    lineChart('Conference rank', dates, [{ name: 'Conference rank', values: col('rank'), cls: 'a' }], { fmt: (v) => String(Math.round(v)), invert: true, fixed: [1, 15] }),
  ].join('') + '</div>';
}

// This team's games from the log, newest first, with the record after each
// one. The record column is shown only when the log holds every game the
// standings count (the log started with this phase; earlier games are
// backfilled by the update run).
export function teamGames(abbr, log) {
  const mine = log.filter((g) => g.home.abbr === abbr || g.away.abbr === abbr)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  let w = 0, l = 0;
  return mine.map((g) => {
    const home = g.home.abbr === abbr;
    const us = home ? g.home : g.away, them = home ? g.away : g.home;
    const won = us.score > them.score;
    won ? w++ : l++;
    return { date: g.date, home, opp: them.abbr, us: us.score, them: them.score, won, w, l, correction: !!g.correction };
  }).reverse();
}

export function gameLogHtml(games, byAbbr, gp) {
  if (!games.length) return '<p class="note">No games yet.</p>';
  const withRecord = games.length === gp;
  const head = '<tr><th class="left">Date</th><th class="left">Opponent</th><th>Result</th>' + (withRecord ? '<th>Record</th>' : '') + '</tr>';
  const rows = games.map((g) => {
    const o = byAbbr[g.opp];
    return `<tr><td class="left">${esc(fmtDay(g.date))}</td>`
      + `<td class="left">${g.home ? 'vs.' : 'at'} <a href="${teamPageUrl(o)}">${esc(o.short)}</a></td>`
      + `<td class="${g.won ? 'pos' : 'neg'}">${g.won ? 'W' : 'L'} ${g.us}-${g.them}</td>`
      + (withRecord ? `<td>${g.w}-${g.l}</td>` : '') + '</tr>';
  }).join('');
  return `<div class="table-wrap"><table class="lb glog"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

// The earliest archived pregame entry for this team on or after the latest
// game night that is not in the game log yet.
export function nextGame(abbr, pregames, log, gameDate) {
  const done = new Set(log.map((g) => g.key));
  return pregames.filter((p) => (p.home.abbr === abbr || p.away.abbr === abbr) && !done.has(p.key) && (!gameDate || p.date >= gameDate))
    .sort((a, b) => (a.tip || a.date).localeCompare(b.tip || b.date))[0] || null;
}

// The next game from the cached season schedule: the team's earliest game
// on or after today (ET) that is not final in the game log. A game in
// progress tonight is still the next game until it goes final.
export function nextScheduled(abbr, games, log, today) {
  const done = new Set(log.map((g) => g.key));
  return games.find((g) => (g.home === abbr || g.away === abbr) && g.date >= today && !done.has(g.key)) || null;
}

// "Since Oct. 21: went 1-0, 3rd in the West (was 5th), +0.4 vs. Vegas"
export function changeSince(cur, base, baseDate, conf) {
  if (!base) return 'Changes since the previous night show from the second night of games.';
  const dw = cur.w - base.w, dl = cur.l - base.l;
  const games = dw + dl === 0 ? 'did not play' : 'went ' + dw + '-' + dl;
  const rank = cur.rank === null ? '' : ', ' + ordinal(cur.rank) + ' in the ' + conf
    + (base.rank === null ? '' : base.rank === cur.rank ? ' (unchanged)' : ' (was ' + ordinal(base.rank) + ')');
  const dv = (cur.m.value.vsVegas ?? 0) - (base.m.value.vsVegas ?? 0);
  return 'Since ' + fmtDay(baseDate) + ': ' + games + rank + (dw + dl ? ', ' + signed(dv) + ' vs. Vegas' : '') + '.';
}

const METRIC_CELLS = [
  ['pct', 'Pct'], ['vsVegas', 'vs. Vegas'], ['vsLastYear', 'vs. Last Year'], ['dollarsPerWin', '$ per Win'],
  ['ptDiff', 'Pt Diff'], ['expWL', 'Exp. W-L'], ['luck', 'Luck'], ['roadMinusHome', 'Road W − Home L'],
];

export function teamTitle(t) { return t.name + ' 2026-27: Record vs. Vegas, Point Differential and Luck | HoopsMatic'; }
export function teamDescription(t, line, last) {
  const poss = /s$/.test(t.name) ? t.name + '’' : t.name + '’s';
  return `How the ${poss} 2026-27 season compares with its Vegas win total of ${line} and last season’s ${last} wins: payroll per win, point differential, Pythagorean luck and every game.`;
}

export function teamPageHtml({ team, row, base, baseDate, series, games, next, peers, byAbbr, line, last, styles, fontsCss }) {
  const url = teamPageUrl(team);
  const title = teamTitle(team), desc = teamDescription(team, line, last);
  const conf = team.conf;
  const confRank = row.rank === null ? DASH : ordinal(row.rank) + ' in the ' + conf;
  const leagueRank = row.leagueRank === null ? DASH : ordinal(row.leagueRank) + ' in the NBA';
  const t = row.m.text;
  const metrics = METRIC_CELLS.map(([k, label]) => `<div class="stat" data-k="${k}"><span class="lbl">${esc(label)}</span><span class="num">${esc(t[k])}</span></div>`).join('');
  let nextHtml = '';
  if (next) {
    // A schedule game names teams by abbreviation; a pregame entry by { abbr }.
    const h = typeof next.home === 'string' ? next.home : next.home.abbr;
    const a = typeof next.away === 'string' ? next.away : next.away.abbr;
    const home = h === team.abbr;
    const o = byAbbr[home ? a : h];
    nextHtml = `<p class="next">Next game: ${home ? 'vs.' : 'at'} <a href="${teamPageUrl(o)}">${esc(o.short)}</a>, ${esc(fmtDay(next.date))}${next.tip ? ', ' + esc(fmtTipEtMadrid(next.tip)) : ''}</p>`;
  }
  const peerLinks = peers.map((p) => `<li><a class="tm" href="${teamPageUrl(p)}"><img src="${logoUrl(p)}" alt="" width="20" height="20" loading="lazy">${esc(p.short)}</a></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="HoopsMatic">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<style>
${fontsCss}
${styles}
</style>
</head>
<body>
<div class="container">

<div class="hdr team-hdr"><img src="${logoUrl(team)}" alt="" width="40" height="40"><h1>${esc(team.name)}</h1></div>
<p class="subtitle">The 2026-27 season against Vegas, last season, payroll and luck. <a href="${PAGE_URL}">Full standings</a></p>

<section class="block">
<div class="stat-cards">
<div class="stat-card"><div class="lbl">Record</div><div class="num" data-k="record">${row.w}-${row.l}</div></div>
<div class="stat-card"><div class="lbl">Conference</div><div class="num" data-k="confRank">${esc(confRank)}</div></div>
<div class="stat-card"><div class="lbl">League</div><div class="num" data-k="leagueRank">${esc(leagueRank)}</div></div>
</div>
<p class="since">${esc(changeSince(row, base, baseDate, conf))}</p>
${nextHtml}
<div class="stats">${metrics}</div>
</section>

<section class="block"><div class="block-head"><h2>Night by night</h2></div>
${teamChartsHtml(series)}
</section>

<section class="block"><div class="block-head"><h2>Games</h2></div>
${gameLogHtml(games, byAbbr, row.gp)}
</section>

<section class="block links">
<p><a href="${PAGE_URL}">Full NBA Real Standings</a> · <a href="${teamUrl(team)}">${esc(team.name)} payroll and salaries (Salary Season Finder)</a></p>
<h2>Other ${conf}ern Conference teams</h2>
<ul class="peers">${peerLinks}</ul>
</section>

<footer class="foot">
<p>Anything wrong? Email us at <a href="mailto:hoopshype@hoopshype.com">hoopshype@hoopshype.com</a></p>
<p>For business inquiries, contact us at <a href="mailto:ads@hoopshype.com">ads@hoopshype.com</a></p>
</footer>

</div>
</body>
</html>
`;
}
