// The Oct. 21 changes, against the frozen fixture (test/fixtures/data, see
// its README) and games written for each case:
//   1. vs. Vegas = Pct - line / 82, vs. Last Year = Pct - 2025-26 wins / 82
//      (percentage points, "+39.6%"), $ per Win = full payroll / wins
//      ("$210.4M"), everywhere: table, team page, charts, leader lines,
//      movers, Since windows, methodology
//   2. leader lines count a team only after 5 games
//   3. equal Pct: head-to-head among the tied teams, then point differential
//      per game, then name; for tables, team-page ranks and leader lines
//   4. Last 10 and vs. .500+ from the game log (Reg. W-L-T was removed on
//      Oct. 21; the log still stores each game's period count), with the period
//      count stored in the log and backfilled for games logged without one
//   5. a one-line explanation on every column header
// Run: node test/formulas-ties-columns.test.mjs

import { readFile, readdir, mkdtemp, cp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { teamMetrics, fmtPctPts, fmtMoneyM, DASH } from '../lib/metrics.mjs';
import { buildRows, byConference, rankConference, leaders, orderTied, LEADER_MIN_GAMES } from '../lib/model.mjs';
import { tableHtml, timeframeParts, COLUMNS } from '../lib/render.mjs';
import { subtractStandings } from '../lib/timeframe.mjs';
import { gameStats, gamesForTimeframe, refStandingsFor, packGames, unpackGames, fromLog, recordValue } from '../lib/games.mjs';
import { rankedRows, nightRowsFor, teamSeries, teamChartsHtml, changeSince } from '../lib/team.mjs';
import { methodologyHtml } from '../lib/page.mjs';
import { finalPeriods, parseEspnScoreboard, parseNbaScheduleDay } from '../lib/scoreboard.mjs';
import { logFinal, readGameLog, datesMissingPeriods } from '../scripts/gamelog.mjs';
import { renderAll, bundleLib } from '../scripts/build.mjs';
import { run } from '../scripts/update.mjs';
import { ESPN_SCOREBOARD_URL } from '../scripts/fetch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(root, 'test/fixtures/data');
const J = async (p) => JSON.parse(await readFile(p, 'utf8'));
let failed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) { failed++; if (detail !== undefined) console.log('        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))); }
};
const MINUS = '−';

const { teams } = await J(join(FIXTURE, 'teams.json'));
const lines = await J(join(FIXTURE, 'vegas_lines_2026-27.json'));
const payroll = await J(join(FIXTURE, 'payroll_2026-27.json'));
const order = teams.map((t) => t.abbr);
const zero = () => ({ w: 0, l: 0, gp: 0, pf: 0, pa: 0, home_w: 0, home_l: 0, road_w: 0, road_l: 0 });
// A game in lib/games.mjs shape, and the standings a list of them adds up to.
const G = (date, away, home, as, hs, periods = 4) => ({ date, away, home, as, hs, periods });
function standingsFrom(games) {
  const st = Object.fromEntries(order.map((a) => [a, zero()]));
  for (const g of games) {
    const H = st[g.home], A = st[g.away];
    H.gp++; A.gp++; H.pf += g.hs; H.pa += g.as; A.pf += g.as; A.pa += g.hs;
    if (g.hs > g.as) { H.w++; H.home_w++; A.l++; A.road_l++; } else { A.w++; A.road_w++; H.l++; H.home_l++; }
  }
  return st;
}
const rowsOf = (games, st = standingsFrom(games)) => buildRows(teams, { teams: st }, lines, payroll, games);
const byAbbr = (rows) => Object.fromEntries(rows.map((r) => [r.abbr, r]));
// Opening night as it happened.
const OPENING = [G('2026-10-20', 'BOS', 'DET', 113, 121), G('2026-10-20', 'PHI', 'NYK', 106, 100), G('2026-10-20', 'OKC', 'SAS', 116, 104)];

// ── 1. Formulas ──
{
  // Philadelphia 1-0: 1 - 49.5/82 = 1 - 0.60366 = +39.6%; 1 - 45/82 = 1 - 0.54878 = +45.1%;
  // payroll 210,400,824 / 1 win = $210.4M.
  const phi = byAbbr(rowsOf(OPENING)).PHI;
  ok('formula: Philadelphia 1-0 vs. Vegas +39.6% (Pct - 49.5/82)', phi.m.text.vsVegas === '+39.6%' && Math.abs(phi.m.value.vsVegas - (1 - 49.5 / 82)) < 1e-12, phi.m.text);
  ok('formula: Philadelphia vs. Last Year +45.1% (Pct - 45/82)', phi.m.text.vsLastYear === '+45.1%' && Math.abs(phi.m.value.vsLastYear - (1 - 45 / 82)) < 1e-12, phi.m.text);
  ok('formula: Philadelphia $ per Win $210.4M (full payroll / 1 win, no proration)', phi.m.text.dollarsPerWin === '$210.4M' && phi.m.value.dollarsPerWin === payroll.payroll.PHI, phi.m.text);
  const nyk = byAbbr(rowsOf(OPENING)).NYK;
  // New York 0-1: 0 - 52.5/82 = -64.0%; 0 - 53/82 = -64.6%; no win, no $ per Win.
  ok('formula: New York 0-1 is ' + MINUS + '64.0% and ' + MINUS + '64.6%, $ per Win a dash', nyk.m.text.vsVegas === MINUS + '64.0%' && nyk.m.text.vsLastYear === MINUS + '64.6%' && nyk.m.text.dollarsPerWin === DASH, nyk.m.text);
  // 30-22 on a 41.5 line: 30/52 - 41.5/82 = 0.57692 - 0.50610 = +7.1%; 41.5 > 52 * ... never prorated: $ = payroll / 30.
  const mid = teamMetrics({ w: 30, l: 22, gp: 52, pf: 5900, pa: 5800, line: 41.5, last_season_wins: 50, payroll: 150e6 });
  ok('formula: 30-22, 41.5 line, 50 wins last year, $150M: +7.1%, ' + MINUS + '3.3%, $5.0M', mid.text.vsVegas === '+7.1%' && mid.text.vsLastYear === MINUS + '3.3%' && mid.text.dollarsPerWin === '$5.0M', mid.text);

  // The table and the team page show the same three.
  const t = tableHtml('East', byConference(rowsOf(OPENING)).East);
  const cells = (abbr) => { const tr = t.split('<tr data-o').find((x) => x.includes('/standings/' + teams.find((y) => y.abbr === abbr).ssf_slug + '"')); return [...tr.matchAll(/<td[^>]*>(?:<a[^>]*><img[^>]*>)?([^<]*)/g)].map((m) => m[1]); };
  const pc = cells('PHI');
  ok('table: Philadelphia row shows +39.6%, +45.1%, $210.4M', pc[5] === '+39.6%' && pc[6] === '+45.1%' && pc[7] === '$210.4M', pc);
  ok('table: the sign class goes by the percentage points (pos / neg)', /data-v="0\.39[0-9]*" class="pos">\+39\.6%/.test(t) && /class="neg">−64\.0%/.test(t));

  // Since a night: the window's Pct and the full payroll over the window's wins.
  const before = standingsFrom(OPENING);
  const after = standingsFrom([...OPENING, G('2026-10-22', 'PHI', 'TOR', 100, 110), G('2026-10-24', 'MIA', 'PHI', 95, 99)]);
  const win = subtractStandings(after, before);
  const wrow = byAbbr(buildRows(teams, { teams: win }, lines, payroll)).PHI;
  // Philadelphia 1-1 in the window: 0.5 - 0.60366 = -10.4%; 0.5 - 0.54878 = -4.9%; 210.4M / 1 = $210.4M.
  ok('Since window: Philadelphia 1-1 there is ' + MINUS + '10.4% vs. Vegas, ' + MINUS + '4.9% vs. Last Year, $210.4M per win', wrow.m.text.vsVegas === MINUS + '10.4%' && wrow.m.text.vsLastYear === MINUS + '4.9%' && wrow.m.text.dollarsPerWin === '$210.4M', wrow.m.text);
  const full = byAbbr(buildRows(teams, { teams: after }, lines, payroll)).PHI;
  // The season: 2-1, 0.66667 - 0.60366 = +6.3%; $210.4M / 2 = $105.2M.
  ok('Season: Philadelphia 2-1 is +6.3%, $105.2M per win', full.m.text.vsVegas === '+6.3%' && full.m.text.dollarsPerWin === '$105.2M', full.m.text);

  // Team page charts in percentage points; "since" line too.
  const nights = [];
  let acc = [];
  for (let i = 0; i < 6; i++) {
    const d = '2026-10-' + String(20 + i).padStart(2, '0');
    acc = [...acc, i % 2 ? G(d, 'PHI', 'ATL', 100, 90) : G(d, 'ATL', 'PHI', 90, 100)];   // Philadelphia wins all six
    nights.push({ date: d, teams: standingsFrom(acc) });
  }
  const series = teamSeries('PHI', nightRowsFor(nights, teams, lines, payroll, acc));
  const charts = teamChartsHtml(series);
  const vsChart = charts.split('<h3>Win % vs. Vegas</h3>')[1].split('</figure>')[0];
  ok('team chart: the vs. Vegas gap is drawn as win % against the line, axis labels with %', /<text class="ax"[^>]*>100%<\/text>/.test(vsChart) && !charts.includes('<h3>vs. Vegas</h3>'), vsChart.slice(0, 300));
  const dpw = charts.split('<h3>$ per Win</h3>')[1].split('</figure>')[0];
  // Philadelphia won all 6: $210.4M / 6 = $35.1M at the end; the axis tops out above $200M after one win.
  ok('team chart: $ per Win is full payroll / wins (first night $210.4M, 6th $35.1M)', Math.abs(series[0].dollarsPerWin - payroll.payroll.PHI) < 1 && Math.abs(series[5].dollarsPerWin - payroll.payroll.PHI / 6) < 1 && /\$2\d\d\.\dM/.test(dpw), [series[0].dollarsPerWin, series[5].dollarsPerWin]);
  const rr = rankedRows(teams, nights[5].teams, lines, payroll, acc), rb = rankedRows(teams, nights[4].teams, lines, payroll, acc.slice(0, 5));
  // 5-0 to 6-0: Pct 1 both nights, so 0.0% change.
  ok('team page "since" line in percentage points', changeSince(rr.PHI, rb.PHI, '2026-10-24', 'East').endsWith(', 0.0% vs. Vegas.'), changeSince(rr.PHI, rb.PHI, '2026-10-24', 'East'));

  const meth = methodologyHtml(lines);
  ok('methodology: vs. Vegas explained as Pct against line / 82 (49.5 -> 60.4%, 1-0 -> +39.6%)', /<dt>vs\. Vegas<\/dt><dd>[^<]*winning percentage[^<]*60\.4%[^<]*\+39\.6%/.test(meth));
  ok('methodology: vs. Last Year with last season’s record (45 -> 54.9%, +45.1%)', /<dt>vs\. Last Year<\/dt><dd>[^<]*54\.9%[^<]*\+45\.1%/.test(meth));
  ok('methodology: $ per Win is the full payroll divided by wins, no proration anywhere', /<dt>\$ per Win<\/dt><dd>[^<]*full 2026-27 payroll[^<]*divided by its wins/.test(meth) && !/prorat/i.test(meth));
}

// ── 2. Leader lines: 5 games to count ──
{
  // Seven teams with 5 games; Brooklyn, 4-0, would lead "Most overachieving" but has 4 games.
  const st = Object.fromEntries(order.map((a) => [a, zero()]));
  const rec = (w, l, pd = 0) => ({ ...zero(), w, l, gp: w + l, pf: 100 * (w + l) + pd, pa: 100 * (w + l) });
  Object.assign(st, { CHI: rec(3, 2), TOR: rec(4, 1), MIA: rec(4, 1), NOP: rec(2, 3), ATL: rec(1, 4), ORL: rec(1, 4), BKN: rec(4, 0) });
  // The two ties the lines have to settle: Toronto beat Miami, Atlanta beat Orlando.
  const games = [G('2026-10-22', 'MIA', 'TOR', 99, 101), G('2026-10-23', 'ORL', 'ATL', 90, 95)];
  const rows = buildRows(teams, { teams: st }, lines, payroll, games);
  const L = leaders(rows);
  const line = (label) => L.find((x) => x.label === label).text;
  ok('leaders: a team counts after ' + LEADER_MIN_GAMES + ' games (Brooklyn 4-0 is left out)', LEADER_MIN_GAMES === 5 && L.every((x) => !String(x.text).includes('Brooklyn')), L);
  // Chicago 3/5 - 29.5/82 = +24.0%; Toronto and Miami 4/5 - 46.5/82 = +23.3% each (both 46.5 lines).
  ok('leaders: tie on vs. Vegas settled head-to-head, Toronto (beat Miami) first', line('Most overachieving') === 'Chicago (+24.0% vs. Vegas), Toronto (+23.3%) and Miami (+23.3%)', line('Most overachieving'));
  // Atlanta and Orlando, both 43.5 lines, both 1-4: 0.2 - 0.53049 = -33.0%. The bottom line starts
  // with the team that loses the tiebreaker: Orlando.
  ok('leaders: on the bottom line the tiebreaker loser comes first (Orlando, then Atlanta)', line('Most underachieving') === 'Orlando (' + MINUS + '33.0% vs. Vegas) and Atlanta (' + MINUS + '33.0%)', line('Most underachieving'));
  ok('leaders: units are percentage points and $xx.xM', /\(\+\d+\.\d% vs\. last year\)/.test(line('Most improved')) && /^[A-Za-z .]+ \(\$\d+\.\dM per win\)/.test(line('Best bang for the buck')), [line('Most improved'), line('Best bang for the buck')]);
  const names = (t) => (t ? [...t.matchAll(/(?:^|, | and )([A-Za-z .]+?) \(/g)].map((m) => m[1]) : []);
  ok('leaders: still nobody in both lines of a pair', ['Most overachieving', 'Most improved', 'Best bang for the buck', 'Luckiest'].every((lab) => {
    const i = L.findIndex((x) => x.label === lab);
    return names(L[i].text).every((n) => !names(L[i + 1].text).includes(n));
  }));
  // Six with 5 games but only five of them: drop Orlando to 4 games.
  const st5 = { ...st, ORL: rec(1, 3), NOP: rec(2, 2) };
  ok('leaders: fewer than 6 teams with 5 games -> every pair waits', leaders(buildRows(teams, { teams: st5 }, lines, payroll, games)).every((x) => x.text === null && x.wait));
}

// ── 3. Tiebreaker ──
const eastOrder = (games) => byConference(rowsOf(games)).East.filter((r) => r.rank !== null).map((r) => r.abbr + r.rank);
{
  // Opening night: New York and Boston both 0-1, never met; New York lost by 6, Boston by 8.
  ok('tiebreak: New York (' + MINUS + '6) ahead of Boston (' + MINUS + '8) on point differential', JSON.stringify(eastOrder(OPENING)) === JSON.stringify(['DET1', 'PHI2', 'NYK3', 'BOS4']), eastOrder(OPENING));
  // Atlanta and Brooklyn 1-1; Atlanta beat Brooklyn by 1 but has the worse point differential.
  const h2h = [G('2026-10-20', 'ATL', 'BKN', 100, 99), G('2026-10-21', 'CHA', 'BKN', 90, 130), G('2026-10-21', 'ATL', 'CHI', 80, 120)];
  ok('tiebreak: head-to-head first (Atlanta beat Brooklyn, worse Pt Diff, still ahead)', JSON.stringify(eastOrder(h2h)) === JSON.stringify(['CHI1', 'ATL2', 'BKN3', 'CHA4']), eastOrder(h2h));
  // Toronto and Washington both lost by 10, never met: by name.
  const byName = [G('2026-10-20', 'WAS', 'ORL', 100, 110), G('2026-10-20', 'TOR', 'MIL', 100, 110)];
  ok('tiebreak: same Pct, same Pt Diff, no head-to-head -> name (Toronto before Washington)', JSON.stringify(eastOrder(byName)) === JSON.stringify(['MIL1', 'ORL2', 'TOR3', 'WAS4']), eastOrder(byName));
  // Three at 1-1 where Charlotte has played neither of the others: head-to-head is skipped for
  // the group and point differential decides (Brooklyn +9.5, Charlotte +1.5, Atlanta -9.5), even
  // though Atlanta beat Brooklyn.
  const skip = [G('2026-10-20', 'BKN', 'ATL', 100, 101), G('2026-10-21', 'ATL', 'MIA', 90, 110), G('2026-10-21', 'MIL', 'BKN', 100, 120),
    G('2026-10-20', 'ORL', 'CHA', 100, 105), G('2026-10-21', 'CHA', 'DET', 100, 102)];
  const o3 = eastOrder(skip).filter((x) => /^(ATL|BKN|CHA)/.test(x)).map((x) => x.slice(0, 3));
  ok('tiebreak: three-way, one has not played the others -> point differential (BKN, CHA, ATL)', o3.join() === 'BKN,CHA,ATL', eastOrder(skip));
  // Three at 1-1: Charlotte ahead on point differential (+5); Atlanta and Toronto level at 0, so
  // they start again at head-to-head: Toronto beat Atlanta, so Toronto, though A comes before T.
  const restart = [G('2026-10-20', 'ATL', 'TOR', 100, 105), G('2026-10-21', 'TOR', 'MIA', 100, 105), G('2026-10-21', 'MIL', 'ATL', 100, 105),
    G('2026-10-20', 'ORL', 'CHA', 100, 120), G('2026-10-21', 'CHA', 'DET', 100, 110)];
  const o4 = eastOrder(restart).filter((x) => /^(ATL|TOR|CHA)/.test(x)).map((x) => x.slice(0, 3));
  ok('tiebreak: a group split by Pt Diff starts again at head-to-head (CHA, TOR, ATL)', o4.join() === 'CHA,TOR,ATL', eastOrder(restart));
  // Without games (no head-to-head known) the same table falls back to Pt Diff, then name.
  const noGames = byConference(buildRows(teams, { teams: standingsFrom(restart) }, lines, payroll)).East.filter((r) => r.rank !== null).map((r) => r.abbr);
  ok('tiebreak: with no games passed, head-to-head is skipped (CHA, ATL, TOR by name)', noGames.filter((a) => ['ATL', 'TOR', 'CHA'].includes(a)).join() === 'CHA,ATL,TOR', noGames);
  // Teams that have not played: no rank, and they do not push anyone down.
  const all = rankConference(rowsOf(OPENING));
  // The three 1-0 teams by Pt Diff (OKC +12, DET +8, PHI +6), then the three 0-1 (NYK -6, BOS -8, SAS -12).
  ok('tiebreak: league ranks 1-6 for the six that played (NYK 4th, BOS 5th), the rest unranked', all.slice(0, 6).map((r) => r.abbr + r.rank).join() === 'OKC1,DET2,PHI3,NYK4,BOS5,SAS6' && all.slice(6).every((r) => r.rank === null), all.slice(0, 6).map((r) => r.abbr + r.rank));
  // orderTied on its own, worst first: the loser of each step first, name still A-Z.
  const pair = byAbbr(rowsOf(h2h));
  ok('orderTied: worstFirst turns head-to-head around', orderTied([pair.ATL, pair.BKN]).map((r) => r.abbr).join() === 'ATL,BKN' && orderTied([pair.ATL, pair.BKN], { worstFirst: true }).map((r) => r.abbr).join() === 'BKN,ATL');
}

// ── 4. Game-log columns ──
{
  const d = (i) => '2026-11-' + String(i).padStart(2, '0');
  // Atlanta: two losses, then ten wins, all against Brooklyn at home.
  const twelve = Array.from({ length: 12 }, (_, i) => (i < 2 ? G(d(i + 1), 'BKN', 'ATL', 110, 100) : G(d(i + 1), 'BKN', 'ATL', 100, 110)));
  const s = gameStats(twelve, standingsFrom(twelve));
  ok('Last 10: only the last 10 games (Atlanta 10-2 overall, 10-0 in its last 10)', s.ATL.last10.w === 10 && s.ATL.last10.l === 0 && s.BKN.last10.w === 0 && s.BKN.last10.l === 10, s.ATL.last10);
  const three = twelve.slice(0, 3);
  ok('Last 10: fewer than 10 played -> all of them (Atlanta 1-2)', JSON.stringify(gameStats(three, null).ATL.last10) === '{"w":1,"l":2}');
  // vs. .500+: against teams at .500 or better in the reference standings. Miami is exactly
  // .500 (counts), Orlando 2-4 (does not), Detroit 0-0 (no record, does not).
  const ref = { ...standingsFrom([]), MIA: { ...zero(), w: 3, l: 3, gp: 6 }, ORL: { ...zero(), w: 2, l: 4, gp: 6 } };
  const g5 = [G(d(1), 'MIA', 'CHI', 90, 100), G(d(2), 'CHI', 'MIA', 90, 100), G(d(3), 'ORL', 'CHI', 90, 100), G(d(4), 'CHI', 'DET', 100, 90), G(d(5), 'MIA', 'CHI', 100, 99)];
  ok('vs. .500+: Chicago 1-2 against Miami (.500), Orlando (2-4) and Detroit (0-0) not counted', JSON.stringify(gameStats(g5, ref).CHI.vs500) === '{"w":1,"l":2}', gameStats(g5, ref).CHI.vs500);
  // Reg. W-L-T: 4 periods W, 4 periods L, 5 periods W (a tie), 6 periods L (a tie), no count (left out).
  const reg = [G(d(1), 'PHX', 'DAL', 90, 100, 4), G(d(2), 'PHX', 'DAL', 100, 90, 4), G(d(3), 'PHX', 'DAL', 95, 99, 5), G(d(4), 'PHX', 'DAL', 120, 118, 6), G(d(5), 'PHX', 'DAL', 80, 99, null)];
  const rs = gameStats(reg, null);
  ok('Reg. W-L-T: overtime counts as a tie whoever won, a game without a period count is left out (Dallas 1-1-2)', JSON.stringify(rs.DAL.reg) === '{"w":1,"l":1,"t":2}' && JSON.stringify(rs.PHX.reg) === '{"w":1,"l":1,"t":2}', rs.DAL.reg);
  ok('Reg. W-L-T: no game with a period count -> null (shown as a dash)', gameStats([G(d(1), 'PHX', 'DAL', 90, 100, null)], null).DAL.reg === null);
  ok('records sort as Pct with a tie as half a win', recordValue({ w: 1, l: 1, t: 2 }) === 0.5 && recordValue({ w: 3, l: 1 }) === 0.75 && recordValue({ w: 0, l: 0 }) === null);

  // In the table: the three columns at the end, sortable, with values.
  const rows = buildRows(teams, { teams: standingsFrom(reg) }, lines, payroll, reg);
  const t = tableHtml('West', byConference(rows).West);
  const heads = [...t.matchAll(/<th [^>]*data-k="([^"]+)"/g)].map((m) => m[1]);
  ok('table: Last 10 and vs. .500+ are the last two columns, no Reg. W-L-T', heads.slice(-2).join() === 'last10,vs500' && heads.length === 14 && !t.includes('Reg. W-L-T') && !t.includes('regWLT'), heads);
  ok('table: the new headers sort (button, numeric, high first) and only Rank and Team are frozen', ['last10', 'vs500'].every((k) => new RegExp('<th scope="col" data-k="' + k + '" data-t="num" data-first="-1"[^>]*><button type="button"').test(t))
     && (t.match(/<th [^>]*class="c-(?:rank|team)"/g) || []).length === 2);
  const dal = t.split('<tr data-o').find((x) => x.includes('/standings/mavericks"'));
  ok('table: Dallas row 3-2 in its last 10 (data-v 0.6), no regulation record cell', /<td data-v="0\.6">3-2<\/td>/.test(dal) && !/1-1-2/.test(dal), dal);
  const atl = t.split('<tr data-o').length;
  ok('table: a team with no games shows dashes in the two', /<td data-v="" class="dash">—<\/td><td data-v="" class="dash">—<\/td><\/tr>/.test(t) && atl > 1);

  // Windows and the reference standings.
  const gs = [G('2026-10-20', 'A', 'B', 1, 2), G('2026-10-21', 'A', 'B', 1, 2), G('2026-10-22', 'A', 'B', 1, 2)];
  ok('games: As of a night keeps games through it; Since keeps the ones after; Since with no saved night keeps all; As of with none keeps none',
     gamesForTimeframe({ kind: 'asof', used: '2026-10-21' }, gs).length === 2 && gamesForTimeframe({ kind: 'since', used: '2026-10-21' }, gs).length === 1
     && gamesForTimeframe({ kind: 'since', used: null }, gs).length === 3 && gamesForTimeframe({ kind: 'asof', used: null }, gs).length === 0 && gamesForTimeframe({ kind: 'season' }, gs).length === 3);
  ok('games: .500 or better by the season at the end of the view (Since: now; As of: that night)', refStandingsFor({ kind: 'since' }, 'win', 'now') === 'now' && refStandingsFor({ kind: 'asof' }, 'night', 'now') === 'night' && refStandingsFor({ kind: 'season' }, 'now', 'now') === 'now');
  const packed = packGames(reg, order);
  ok('games: pack and unpack round-trip (period count kept, missing count null)', JSON.stringify(unpackGames(packed, order)) === JSON.stringify(reg));
}
{
  // Period counts from the feeds.
  ok('periods: "Final" 4, "Final/OT" 5, "Final/2OT" 6, a number wins, not final null',
     finalPeriods(4, 'Final') === 4 && finalPeriods(undefined, 'Final/OT') === 5 && finalPeriods(null, 'Final/2OT') === 6 && finalPeriods(7, 'Final') === 7 && finalPeriods(null, '7:30 pm ET') === null);
  const espnAbbr = Object.fromEntries(teams.map((t) => [t.abbr, t.espn[0]]));
  const ev = (id, away, home, as, hs, status) => ({ id, date: '2026-10-21T23:00:00Z', season: { type: 2 }, status,
    competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: espnAbbr[home] }, score: String(hs) }, { homeAway: 'away', team: { abbreviation: espnAbbr[away] }, score: String(as) }] }] });
  const espn = parseEspnScoreboard({ events: [
    ev('1', 'BOS', 'NYK', 120, 118, { period: 5, type: { state: 'post', completed: true, name: 'STATUS_FINAL', detail: 'Final/OT' } }),
    ev('2', 'MIA', 'ORL', 99, 100, { period: 4, type: { state: 'post', completed: true, name: 'STATUS_FINAL', detail: 'Final' } }),
    ev('3', 'LAL', 'GSW', 50, 52, { period: 3, type: { state: 'in', completed: false, name: 'STATUS_IN_PROGRESS', detail: '3rd' } }),
  ] }, teams, '2026-10-21');
  ok('ESPN scoreboard: periods 5 for an overtime final, 4 in regulation, null while in progress', espn.map((g) => g.periods).join() === '5,4,', espn.map((g) => g.periods));
  const nba = parseNbaScheduleDay({ leagueSchedule: { gameDates: [{ games: [
    { gameId: '0022600050', gameDateEst: '2026-10-21T00:00:00Z', gameStatus: 3, gameStatusText: 'Final/2OT', homeTeam: { teamId: teams.find((t) => t.abbr === 'NYK').nba_id, score: 130 }, awayTeam: { teamId: teams.find((t) => t.abbr === 'BOS').nba_id, score: 128 } },
  ] }] } }, teams, '2026-10-21');
  ok('cdn.nba.com fallback: "Final/2OT" -> 6 periods', nba.length === 1 && nba[0].periods === 6, nba);
}
{
  // The log: periods on new entries; a .periods.json file for a game logged without one.
  const dir = await mkdtemp(join(tmpdir(), 'standings-ftc-'));
  const data = join(dir, 'data');
  await cp(FIXTURE, data, { recursive: true });
  const sb = (date, away, home, as, hs, periods) => ({ key: date + '_' + away + '@' + home, id: away + home, id_source: 'espn', date, final: true, periods,
    away: { abbr: away, score: as }, home: { abbr: home, score: hs } });
  ok('log: a new final carries its period count', (await logFinal(data, sb('2026-10-21', 'BOS', 'NYK', 120, 118, 5), '2026-10-22T03:00:00.000Z')) === 'new'
     && (await J(join(data, 'games/2026-10-21/BOS@NYK.json'))).periods === 5);
  // Opening night as the bot logged it, before entries had periods.
  await mkdir(join(data, 'games/2026-10-20'), { recursive: true });
  const old = { key: '2026-10-20_PHI@NYK', game_id: '401909089', id_source: 'espn', date: '2026-10-20', away: { abbr: 'PHI', score: 106 }, home: { abbr: 'NYK', score: 100 }, final_at: '2026-10-21T02:30:00.000Z', correction: false };
  await writeFile(join(data, 'games/2026-10-20/PHI@NYK.json'), JSON.stringify(old, null, 2) + '\n');
  ok('log: a game logged without a count reads as periods null, and its date needs a backfill', (await readGameLog(data)).find((e) => e.key === old.key).periods === null && datesMissingPeriods(await readGameLog(data)).join() === '2026-10-20');
  const r = await logFinal(data, sb('2026-10-20', 'PHI', 'NYK', 106, 100, 4), '2026-10-21T17:00:00.000Z');
  const side = await J(join(data, 'games/2026-10-20/PHI@NYK.periods.json'));
  ok('log: the backfill writes PHI@NYK.periods.json and leaves the entry as it was', r === 'periods' && side.periods === 4 && side.key === old.key
     && JSON.stringify(await J(join(data, 'games/2026-10-20/PHI@NYK.json'))) === JSON.stringify(old), side);
  ok('log: readGameLog merges the count; nothing left to backfill', (await readGameLog(data)).find((e) => e.key === old.key).periods === 4 && datesMissingPeriods(await readGameLog(data)).length === 0);
  ok('log: a second backfill writes nothing', (await logFinal(data, sb('2026-10-20', 'PHI', 'NYK', 106, 100, 4), 'x')) === null
     && (await readdir(join(data, 'games/2026-10-20'))).sort().join() === 'PHI@NYK.json,PHI@NYK.periods.json');
  const c = await logFinal(data, sb('2026-10-20', 'PHI', 'NYK', 106, 101, 4), '2026-10-21T18:00:00.000Z');
  ok('log: a score correction carries its own count', c === 'correction' && (await J(join(data, 'games/2026-10-20/PHI@NYK.c1.json'))).periods === 4);
}
{
  // The update run backfills: two games from opening night logged without counts, one of them
  // on a date older than yesterday (fetched as a backfill date).
  const dir = await mkdtemp(join(tmpdir(), 'standings-ftc-run-'));
  const data = join(dir, 'data');
  await cp(FIXTURE, data, { recursive: true });
  const put = async (date, away, home, as, hs) => {
    await mkdir(join(data, 'games', date), { recursive: true });
    await writeFile(join(data, 'games', date, away + '@' + home + '.json'), JSON.stringify({ key: date + '_' + away + '@' + home, game_id: '9', id_source: 'espn', date,
      away: { abbr: away, score: as }, home: { abbr: home, score: hs }, final_at: '2026-10-21T02:30:00.000Z', correction: false }, null, 2) + '\n');
  };
  await put('2026-10-18', 'BOS', 'DET', 113, 121);
  await put('2026-10-20', 'PHI', 'NYK', 106, 100);
  await writeFile(join(data, 'finals.json'), JSON.stringify({ dates: { '2026-10-18': ['2026-10-18_BOS@DET'], '2026-10-20': ['2026-10-20_PHI@NYK'] } }));
  const espnAbbr = Object.fromEntries(teams.map((t) => [t.abbr, t.espn[0]]));
  const board = (date, away, home, as, hs, period, detail) => ({ events: [{ id: '9', date: date + 'T23:00:00Z', season: { type: 2 },
    status: { period, type: { state: 'post', completed: true, name: 'STATUS_FINAL', detail } },
    competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: espnAbbr[home] }, score: String(hs), records: [{ type: 'total', summary: '1-0' }] },
      { homeAway: 'away', team: { abbreviation: espnAbbr[away] }, score: String(as), records: [{ type: 'total', summary: '0-1' }] }] }] }] });
  const boards = { '20261018': board('2026-10-18', 'BOS', 'DET', 113, 121, 5, 'Final/OT'), '20261020': board('2026-10-20', 'PHI', 'NYK', 106, 100, 4, 'Final'), '20261021': { events: [] } };
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u.startsWith(ESPN_SCOREBOARD_URL)) return new Response(JSON.stringify(boards[u.slice(ESPN_SCOREBOARD_URL.length)] || { events: [] }));
    return new Response('x', { status: 404 });
  };
  const quiet = console.log; console.log = () => {};
  let r;
  try { r = await run({ dataDir: data, outDir: dir, now: new Date('2026-10-21T17:00:00Z') }); } finally { console.log = quiet; globalThis.fetch = real; }
  const log = await readGameLog(data);
  ok('update run: both counts backfilled (yesterday from the regular scoreboard, Oct. 18 as a backfill date)', r.periods === 2 && log.find((e) => e.key === '2026-10-18_BOS@DET').periods === 5 && log.find((e) => e.key === '2026-10-20_PHI@NYK').periods === 4, r);
  ok('update run: the backfill alone rebuilds the pages', r.built === true);
  const nyk = await readFile(join(dir, 'knicks/index.html'), 'utf8');
  const stat = (k) => (new RegExp('<div class="stat" data-k="' + k + '"><span class="lbl">[^<]*</span><span class="num">([^<]*)<').exec(nyk) || [])[1];
  ok('team page: New York shows Last 10 0-1, vs. .500+ 0-0, and no Reg. W-L-T', stat('last10') === '0-1' && stat('vs500') === '0-0' && stat('regWLT') === undefined && !nyk.includes('Reg. W-L-T'), [stat('last10'), stat('vs500'), stat('regWLT')]);
}

// ── Pages: the build end to end, from a scratch log ──
{
  const dir = await mkdtemp(join(tmpdir(), 'standings-ftc-build-'));
  const data = join(dir, 'data');
  await cp(FIXTURE, data, { recursive: true });
  for (const g of OPENING) {
    await logFinal(data, { key: g.date + '_' + g.away + '@' + g.home, id: g.away, id_source: 'espn', date: g.date, final: true, periods: g.periods,
      away: { abbr: g.away, score: g.as }, home: { abbr: g.home, score: g.hs } }, '2026-10-21T04:00:00.000Z');
  }
  const st = await J(join(data, 'standings.json'));
  st.teams = standingsFrom(OPENING); st.game_date = '2026-10-20';
  await writeFile(join(data, 'standings.json'), JSON.stringify(st));
  const all = await renderAll({ dataDir: data, srcRoot: root, today: '2026-10-21' });
  const page = (slug) => all.teamPages.find((t) => t.slug === slug).html;
  const cell = (html, k) => (new RegExp('<div class="num" data-k="' + k + '">([^<]*)<').exec(html) || [])[1];
  const stat = (html, k) => (new RegExp('<div class="stat" data-k="' + k + '"><span class="lbl">[^<]*</span><span class="num">([^<]*)<').exec(html) || [])[1];
  ok('page: New York 3rd and Boston 4th in the East table', /data-v="3">3<\/td><td class="c-team" data-v="New York"/.test(all.index) && /data-v="4">4<\/td><td class="c-team" data-v="Boston"/.test(all.index));
  ok('team pages: New York 3rd in the East / 4th in the NBA, Boston 4th / 5th', cell(page('knicks'), 'confRank') === '3rd in the East' && cell(page('knicks'), 'leagueRank') === '4th in the NBA'
     && cell(page('celtics'), 'confRank') === '4th in the East' && cell(page('celtics'), 'leagueRank') === '5th in the NBA', [cell(page('knicks'), 'confRank'), cell(page('celtics'), 'leagueRank')]);
  ok('team page: Philadelphia +39.6%, +45.1%, $210.4M, Last 10 1-0, no Reg. W-L-T', stat(page('76ers'), 'vsVegas') === '+39.6%' && stat(page('76ers'), 'vsLastYear') === '+45.1%'
     && stat(page('76ers'), 'dollarsPerWin') === '$210.4M' && stat(page('76ers'), 'last10') === '1-0' && stat(page('76ers'), 'regWLT') === undefined && !page('76ers').includes('Reg. W-L-T'));
  const N = JSON.parse(all.nights);
  ok('nights.json: carries every logged game for the date views', JSON.stringify(unpackGames(N.games, N.order)) === JSON.stringify(fromLog(await readGameLog(data))) && N.games.length === 3);

  // ── 5. Explanations on every header ──
  const ths = [...all.index.matchAll(/<table class="lb"[\s\S]*?<\/thead>/g)].flatMap((m) => [...m[0].matchAll(/<th [^>]*>[\s\S]*?<\/th>/g)].map((x) => x[0]));
  ok('tips: all 28 headers of the two tables carry a one-line explanation', ths.length === 28 && ths.every((h) => {
    const tip = (/data-tip="([^"]+)"/.exec(h) || [])[1];
    return tip && tip.length > 4 && tip.length < 110 && !tip.includes('\n') && h.includes('<span class="sr" id="') && h.includes('aria-describedby=');
  }), ths.find((h) => !/data-tip="[^"]+"/.test(h)));
  ok('tips: every column defined with its explanation, no em dash', COLUMNS.every((c) => c.tip && !c.tip.includes('—')));
  ok('tips: the script ships on /standings and on the team pages', all.index.includes("box.className = 'hm-tip'") && page('knicks').includes("box.className = 'hm-tip'"));
  const glog = page('knicks').split('class="lb glog"')[1].split('</thead>')[0];
  ok('tips: the team page game log headers too', (glog.match(/<th[^>]* data-tip="[^"]+"/g) || []).length === 4, glog);

  // The page script renders the date views with the same functions, games included.
  const sandbox = { window: {}, Intl, URLSearchParams };
  vm.runInNewContext(await bundleLib(root), sandbox);
  const HM = sandbox.window.HM;
  const tf = { kind: 'asof', used: '2026-10-20' };
  const games = HM.gamesForTimeframe(tf, HM.unpackGames(N.games, N.order));
  const a = timeframeParts(teams, st.teams, lines, payroll, gamesForTimeframe(tf, fromLog(await readGameLog(data))), st.teams);
  const b = HM.timeframeParts(teams, st.teams, lines, payroll, games, HM.refStandingsFor(tf, st.teams, st.teams));
  ok('bundle: with games, leader lines, tables and charts identical to lib/', a.tables === b.tables && a.leaders === b.leaders && a.charts === b.charts);
  ok('bundle: the As of view has New York ahead of Boston', /data-v="3">3<\/td><td class="c-team" data-v="New York"/.test(b.tables));
}

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
