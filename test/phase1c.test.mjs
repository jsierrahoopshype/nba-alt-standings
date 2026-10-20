// Phase 1b follow-ups: payroll saved with each night, next game from the
// season schedule.
//
//   - a night's snapshot stores that night's payroll; the team pages' $ per
//     Win charts and the As of / Since views use it, and a night saved
//     without one uses the current payroll (named in the methodology);
//   - the season schedule (cdn.nba.com) is cached in data/, refreshed with
//     --schedule or when missing, and a failed fetch keeps the cached copy;
//   - each team page shows its next scheduled game with the tip in ET and
//     Madrid time, moving on as days pass and games go final.
//
// Run: node test/phase1c.test.mjs

import { readFile, readdir, mkdtemp, cp, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { run } from '../scripts/update.mjs';
import { build, renderAll, nightsJson, bundleLib } from '../scripts/build.mjs';
import { ESPN_URL, ESPN_SCOREBOARD_URL, NBA_SCHEDULE_URL, SSF_DATA_URL } from '../scripts/fetch.mjs';
import { parseSeasonSchedule } from '../lib/scoreboard.mjs';
import { nightRowsFor, teamSeries, nextScheduled } from '../lib/team.mjs';
import { payrollFor, packPayroll, resolveTimeframe } from '../lib/timeframe.mjs';
import { fmtTipEtMadrid } from '../lib/render.mjs';
import { methodologyHtml } from '../lib/page.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = async (p) => JSON.parse(await readFile(p, 'utf8'));
let failed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) { failed++; if (detail !== undefined) console.log('        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))); }
};
const { teams } = await J(join(root, 'data/teams.json'));
const lines = await J(join(root, 'data/vegas_lines_2026-27.json'));
const order = teams.map((t) => t.abbr);
const zero = () => ({ w: 0, l: 0, gp: 0, pf: 0, pa: 0, home_w: 0, home_l: 0, road_w: 0, road_l: 0 });
const league = (over = {}) => Object.fromEntries(order.map((a) => [a, over[a] || zero()]));
const flat = (amount) => Object.fromEntries(order.map((a) => [a, amount]));
const quiet = console.log;

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), 'standings-p1c-'));
  await cp(join(root, 'data'), join(dir, 'data'), { recursive: true });
  for (const f of ['index.html', 'sitemap.xml']) await cp(join(root, f), join(dir, f));
  for (const t of teams) await cp(join(root, t.ssf_slug), join(dir, t.ssf_slug), { recursive: true });
  return { data: join(dir, 'data'), out: dir };
}

// ── 1. Payroll with each night ──
{
  // Two nights, the Knicks 2-0 on both (no game in between), payroll $200M
  // saved with the second; the first night was saved without one.
  const st = league({ NYK: { ...zero(), w: 2, gp: 2, pf: 230, pa: 210, home_w: 1, road_w: 1 } });
  const snaps = [{ date: '2026-10-20', teams: st }, { date: '2026-10-21', teams: st, payroll: flat(200e6) }];
  const current = { payroll: flat(100e6) };
  const nr = nightRowsFor(snaps, teams, lines, current);
  const s = teamSeries('NYK', nr);
  // $ per Win = payroll * GP/82 / W: 100M*2/82/2 = 1.2195M, 200M*2/82/2 = 2.439M.
  ok('charts: a night saved without payroll uses the current one (Oct. 20: $1.22M per win)', Math.abs(s[0].dollarsPerWin - 100e6 * 2 / 82 / 2) < 1 && !nr[0].ownPayroll);
  ok('charts: a night with its own payroll uses it (Oct. 21: $2.44M per win, not $1.22M)', Math.abs(s[1].dollarsPerWin - 200e6 * 2 / 82 / 2) < 1 && nr[1].ownPayroll);

  const N = JSON.parse(nightsJson(snaps, order));
  ok('nights.json: payrolls only for the nights that have one, in team order', Object.keys(N.payrolls).join() === '2026-10-21' && N.payrolls['2026-10-21'][order.indexOf('NYK')] === 200e6);
  const ctx = { dates: N.dates, gameDate: '2026-10-21' };
  const pf = (params) => payrollFor(resolveTimeframe(params, ctx), N.payrolls, current, order).payroll.NYK;
  ok('views: season uses the current payroll', pf({}) === 100e6);
  ok('views: As of Oct. 21 uses Oct. 21\'s payroll', pf({ asof: '2026-10-21' }) === 200e6);
  ok('views: As of Oct. 20 (saved without payroll) uses the current payroll', pf({ asof: '2026-10-20' }) === 100e6);
  ok('views: Since Oct. 21 uses Oct. 21\'s payroll (the night picked)', pf({ since: '2026-10-21' }) === 200e6);
  ok('views: Since a date before any saved night uses the current payroll', pf({ since: '2026-10-01' }) === 100e6);
  ok('pack/unpack payroll', JSON.stringify(packPayroll(flat(5), order)) === JSON.stringify(order.map(() => 5)));
  const code = await bundleLib(root);
  const sandbox = { window: {}, Intl, URLSearchParams };
  vm.runInNewContext(code, sandbox);
  ok('bundle: the page script has payrollFor, and it agrees', typeof sandbox.window.HM.payrollFor === 'function'
     && sandbox.window.HM.payrollFor(resolveTimeframe({ asof: '2026-10-21' }, ctx), N.payrolls, current, order).payroll.NYK === 200e6);
  const views = await readFile(join(root, 'src/views.js'), 'utf8');
  ok('views.js: date views pass the night\'s payroll', /HM\.payrollFor\(t2, N\.payrolls, D\.payroll, N\.order\)/.test(views));

  const m1 = methodologyHtml(lines, ['2026-10-20']);
  const m0 = methodologyHtml(lines, []);
  ok('methodology: names Oct. 20 as saved before payrolls and using the current payroll', /use the payroll saved with each night \(for Since, the night you pick\); Oct\. 20, saved before payrolls were stored with each night, uses the current payroll\./.test(m1), m1.match(/The team pages[^<]*/)[0]);
  ok('methodology: no such note once every night has its payroll', !/saved before payrolls/.test(m0) && /use the payroll saved with each night \(for Since, the night you pick\)\./.test(m0));
}

// ── 2. The update run saves the payroll with the night ──
const espnAbbr = Object.fromEntries(teams.map((t) => [t.abbr, t.espn[0]]));
function standingsBody(st) {
  return { children: ['East', 'West'].map((c) => ({ standings: { season: 2027, entries: teams.filter((t) => t.conf === c).map((t) => ({ team: { abbreviation: espnAbbr[t.abbr] },
    stats: [{ name: 'wins', value: st[t.abbr].w }, { name: 'losses', value: st[t.abbr].l }, { name: 'pointsFor', value: st[t.abbr].pf }, { name: 'pointsAgainst', value: st[t.abbr].pa },
      { name: 'Home', type: 'home', summary: st[t.abbr].home_w + '-' + st[t.abbr].home_l }, { name: 'Road', type: 'road', summary: st[t.abbr].road_w + '-' + st[t.abbr].road_l }] })) } })) };
}
function board(games) {
  return { events: games.map((g, i) => ({ id: String(700 + i), date: g.date + 'T23:30:00Z', season: { type: 2 },
    status: { type: { state: g.final ? 'post' : 'pre', completed: !!g.final, name: g.final ? 'STATUS_FINAL' : 'STATUS_SCHEDULED' } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { abbreviation: espnAbbr[g.home] }, score: g.final ? String(g.hs) : undefined, records: [{ type: 'total', summary: g.hr }] },
      { homeAway: 'away', team: { abbreviation: espnAbbr[g.away] }, score: g.final ? String(g.as) : undefined, records: [{ type: 'total', summary: g.ar }] }] }] })) };
}
// A schedule fixture in cdn.nba.com's shape: the Knicks' first three games.
const sched = (seasonYear = '2026-27') => {
  const id = Object.fromEntries(teams.map((t) => [t.abbr, t.nba_id]));
  const g = (n, date, tip, away, home, extra = {}) => ({ gameId: '00226000' + String(n).padStart(2, '0'), gameDateEst: date + 'T00:00:00Z', gameDateTimeUTC: tip, gameStatus: 1,
    homeTeam: { teamId: id[home] }, awayTeam: { teamId: id[away] }, ...extra });
  const games = [
    g(1, '2026-10-20', '2026-10-20T23:30:00Z', 'PHI', 'NYK'),
    g(2, '2026-10-22', '2026-10-22T23:30:00Z', 'NYK', 'BOS'),
    g(3, '2026-10-24', '2026-10-25T00:00:00Z', 'MIA', 'NYK'),
    g(4, '2026-10-23', '2026-10-23T23:00:00Z', 'NYK', 'TOR', { gameStatusText: 'PPD' }),
    { ...g(5, '2026-10-10', '2026-10-10T23:00:00Z', 'NYK', 'BKN'), gameId: '0012600005' },   // preseason
  ];
  // Pad to a full season of other games so the parser's size check passes.
  for (let i = 0; i < 1225; i++) games.push(g(100 + i, '2027-03-01', '2027-03-02T00:00:00Z', 'SAC', 'POR'));
  return { leagueSchedule: { seasonYear, gameDates: [{ games }] } };
};
let world, calls;
const real = globalThis.fetch;
globalThis.fetch = async (u) => {
  u = String(u); calls.push(u);
  if (u === ESPN_URL) return new Response(JSON.stringify(standingsBody(world.standings)));
  if (u.startsWith(ESPN_SCOREBOARD_URL)) {
    const d = u.slice(ESPN_SCOREBOARD_URL.length);
    return new Response(JSON.stringify(board(world.boards[d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6)] || [])));
  }
  if (u === NBA_SCHEDULE_URL) return world.schedule ? new Response(JSON.stringify(world.schedule)) : new Response('nope', { status: 403 });
  if (u === SSF_DATA_URL) return world.payroll ? new Response(JSON.stringify(world.payroll)) : new Response('down', { status: 503 });
  return new Response('x', { status: 404 });
};
const go = async (d, now, opts = {}) => { calls = []; console.log = () => {}; try { return await run({ dataDir: d.data, outDir: d.out, now: new Date(now), ...opts }); } finally { console.log = quiet; } };

{
  const d = await scratch();
  const st = league({ NYK: { ...zero(), w: 1, gp: 1, pf: 110, pa: 100, home_w: 1 }, PHI: { ...zero(), l: 1, gp: 1, pf: 100, pa: 110, road_l: 1 } });
  world = { standings: st, schedule: sched(), payroll: null,
    boards: { '2026-10-20': [{ date: '2026-10-20', away: 'PHI', home: 'NYK', final: true, as: 100, hs: 110, ar: '0-1', hr: '1-0' }], '2026-10-21': [] } };
  const r = await go(d, '2026-10-21T05:00:00Z');
  const snap = await J(join(d.data, 'history/2026-10-20.json'));
  const pr = await J(join(d.data, 'payroll_2026-27.json'));
  ok('update run: the night\'s snapshot carries that night\'s payroll', r.snapshots.join() === '2026-10-20' && JSON.stringify(snap.payroll) === JSON.stringify(pr.payroll), Object.keys(snap));
  const N = await J(join(d.data, 'nights.json'));
  ok('update run: nights.json carries it for the page script', N.payrolls && N.payrolls['2026-10-20'][order.indexOf('NYK')] === pr.payroll.NYK);
  const page = await readFile(join(d.out, 'index.html'), 'utf8');
  const note = (page.match(/The team pages[^<]*/) || [''])[0];
  ok('update run: once every night has its payroll, the methodology note goes', /^The team pages\u2019 \$ per Win charts and the As of and Since views use the payroll saved with each night \(for Since, the night you pick\)\.$/.test(note), note);

  // ── 3. Schedule cache and next game ──
  const cache = await J(join(d.data, 'schedule_2026-27.json'));
  ok('schedule: fetched when there is no cached copy (regular season only, postponed dropped)', r.scheduleChanged && cache.games.length === 1228
     && !cache.games.some((g) => g.id === '0012600005' || g.key === '2026-10-23_NYK@TOR'));
  const knicks = await readFile(join(d.out, 'knicks/index.html'), 'utf8');
  ok('team page: next game is the next scheduled one not yet final (at Boston, Oct. 22), tip in ET and Madrid',
     knicks.includes('Next game: at <a href="https://hoopsmatic.com/standings/celtics">Boston</a>, Oct. 22, 7:30 p.m. ET (1:30 Madrid)'), (knicks.match(/<p class="next">[\s\S]*?<\/p>/) || [''])[0]);
  const before = await readFile(join(d.data, 'schedule_2026-27.json'), 'utf8');
  // No --schedule and a cache present: not fetched.
  world.boards = { '2026-10-21': [], '2026-10-22': [] };
  await go(d, '2026-10-22T14:00:00Z');
  ok('schedule: not fetched on an ordinary run when cached', !calls.includes(NBA_SCHEDULE_URL));
  // --schedule with the feed down: the cached copy stays, byte for byte.
  world.schedule = null;
  const r2 = await go(d, '2026-10-22T14:23:00Z', { force: true, refreshSchedule: true });
  ok('schedule: a failed refresh keeps the cached copy', calls.includes(NBA_SCHEDULE_URL) && !r2.scheduleChanged && (await readFile(join(d.data, 'schedule_2026-27.json'), 'utf8')) === before);
  // --schedule with a changed schedule: rewritten.
  world.schedule = sched();
  world.schedule.leagueSchedule.gameDates[0].games[1].gameDateTimeUTC = '2026-10-23T00:00:00Z';
  const r3 = await go(d, '2026-10-22T14:30:00Z', { force: true, refreshSchedule: true });
  const k3 = await readFile(join(d.out, 'knicks/index.html'), 'utf8');
  ok('schedule: a refresh with a changed tip rewrites the cache and the page (8 p.m. ET, 2:00 Madrid)', r3.scheduleChanged && k3.includes('Oct. 22, 8:00 p.m. ET (2:00 Madrid)'), (k3.match(/<p class="next">[\s\S]*?<\/p>/) || [''])[0]);
  // A day later (the forced 10:23 run), Oct. 22 is past: next is Miami at home.
  world.boards = { '2026-10-22': [], '2026-10-23': [] };
  await go(d, '2026-10-23T14:23:00Z', { force: true });
  const k4 = await readFile(join(d.out, 'knicks/index.html'), 'utf8');
  ok('team page: the next game moves on with the calendar on the daily run (vs. Miami, Oct. 24, 8:00 p.m. ET)',
     k4.includes('Next game: vs. <a href="https://hoopsmatic.com/standings/heat">Miami</a>, Oct. 24, 8:00 p.m. ET (2:00 Madrid)'), (k4.match(/<p class="next">[\s\S]*?<\/p>/) || [''])[0]);
}
globalThis.fetch = real;

{
  const games = parseSeasonSchedule(sched(), teams, { seasonYear: '2026-27' }).games;
  const log = [{ key: '2026-10-20_PHI@NYK' }];
  ok('nextScheduled: a game already final in the log is skipped', nextScheduled('NYK', games, log, '2026-10-20').key === '2026-10-22_NYK@BOS');
  ok('nextScheduled: tonight\'s game is next until it is final', nextScheduled('NYK', games, [], '2026-10-20').key === '2026-10-20_PHI@NYK');
  ok('nextScheduled: nothing left -> null', nextScheduled('NYK', games, [], '2026-11-01') === null);
  let threw = false; try { parseSeasonSchedule(sched('2025-26'), teams, { seasonYear: '2026-27' }); } catch { threw = true; }
  ok('schedule: wrong season rejected', threw);
  threw = false; try { parseSeasonSchedule({ leagueSchedule: { gameDates: [{ games: [] }] } }, teams, {}); } catch { threw = true; }
  ok('schedule: an empty or partial schedule is rejected (keeps the cache)', threw);
  ok('tip time: ET and Madrid across the clock change (Nov. 2: 7:30 p.m. ET = 1:30 Madrid)', fmtTipEtMadrid('2026-11-03T00:30:00Z') === '7:30 p.m. ET (1:30 Madrid)' && fmtTipEtMadrid('2026-10-22T23:30:00Z') === '7:30 p.m. ET (1:30 Madrid)', fmtTipEtMadrid('2026-11-03T00:30:00Z'));
}

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
