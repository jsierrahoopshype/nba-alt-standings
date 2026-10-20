// Phase 1: updates after every game, saved nights, timeframes.
//
//   - timeframes: "since" subtraction (a team with no games in the window
//     comes out 0-0 with dashes), "as of" exact, nearest earlier saved night
//     when a date has none, presets, labels;
//   - the update run, against stubbed feeds and a scratch copy of data/:
//     a run with nothing new commits nothing; a final the standings do not
//     count yet is left for the next run; a night's snapshot is written once
//     every game is final, rewritten while it changes, never after the next
//     game date has started, and never for a day without games;
//   - the sitemap lastmod does not move when only the "Updated" time does;
//   - the pregame archive is append-only;
//   - the page script's bundle of lib/ renders exactly what lib/ renders.
//
// Run: node test/phase1.test.mjs

import { readFile, readdir, mkdtemp, cp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { subtractStandings, nearestOnOrBefore, resolveTimeframe, standingsFor, unpackTeams, packTeams, addDays, gamesIn } from '../lib/timeframe.mjs';
import { timeframeLabel, timeframeParts, fmtUpdated } from '../lib/render.mjs';
import { teamMetrics, DASH } from '../lib/metrics.mjs';
import { parseEspnScoreboard, standingsReflect } from '../lib/scoreboard.mjs';
import { run, archivePregame } from '../scripts/update.mjs';
import { bundleLib, build } from '../scripts/build.mjs';
import { ESPN_URL, ESPN_SCOREBOARD_URL, SSF_DATA_URL } from '../scripts/fetch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Data frozen as of PR #6 (see test/fixtures/README.md), not the live data/
// folder the update bot keeps committing to.
const FIXTURE = join(root, 'test/fixtures/data');
const J = async (p) => JSON.parse(await readFile(p, 'utf8'));

let failed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) { failed++; if (detail !== undefined) console.log('        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))); }
};

const { teams } = await J(join(FIXTURE, 'teams.json'));
const lines = await J(join(FIXTURE, 'vegas_lines_2026-27.json'));
const payroll = await J(join(FIXTURE, 'payroll_2026-27.json'));
const order = teams.map((t) => t.abbr);
const zero = () => ({ w: 0, l: 0, gp: 0, pf: 0, pa: 0, home_w: 0, home_l: 0, road_w: 0, road_l: 0 });
const row = (w, l, pf, pa, hw, hl, rw, rl) => ({ w, l, gp: w + l, pf, pa, home_w: hw, home_l: hl, road_w: rw, road_l: rl });
const league = (over = {}) => Object.fromEntries(order.map((a) => [a, over[a] || zero()]));

// ── 1. Timeframes ──
{
  const base = league({ MIA: row(10, 5, 1700, 1600, 6, 2, 4, 3), POR: row(3, 12, 1600, 1750, 2, 5, 1, 7), NYK: row(8, 7, 1650, 1640, 4, 4, 4, 3) });
  const cur = league({ MIA: row(14, 6, 2290, 2150, 8, 2, 6, 4), POR: row(4, 16, 2100, 2340, 2, 7, 2, 9), NYK: row(8, 7, 1650, 1640, 4, 4, 4, 3) });
  const win = subtractStandings(cur, base);
  ok('since: Miami 4-1, PF 590, PA 550, home 2-0, road 2-1', JSON.stringify(win.MIA) === JSON.stringify(row(4, 1, 590, 550, 2, 0, 2, 1)), win.MIA);
  ok('since: Portland 1-4, home 0-2, road 1-2', JSON.stringify(win.POR) === JSON.stringify(row(1, 4, 500, 590, 0, 2, 1, 2)), win.POR);
  ok('since: New York played no games in the window -> 0-0, GP 0', JSON.stringify(win.NYK) === JSON.stringify(zero()));
  const nyk = teamMetrics({ ...win.NYK, line: 52.5, last_season_wins: 53, payroll: 200e6 });
  ok('since: zero games in the window -> every metric is the dash', Object.values(nyk.text).every((t) => t === DASH), nyk.text);
  const mia = teamMetrics({ ...win.MIA, line: 46.5, last_season_wins: 43, payroll: 209e6 });
  ok('since: metrics recomputed from the window (Miami 4-1: Pct 80.0%, vs. Vegas 4 - 5*46.5/82 = +1.2, $ per Win 209M*5/82/4 = $3.19M, Pt Diff +8.0)',
     mia.text.pct === '80.0%' && mia.text.vsVegas === '+1.2' && mia.text.dollarsPerWin === '$3.19M' && mia.text.ptDiff === '+8.0', mia.text);
  ok('since: whole league in the window is 5 games + 5 games / 2 = 5 games', gamesIn(win) === 5);
  const neg = subtractStandings(league({ MIA: row(3, 1, 400, 380, 2, 0, 1, 1) }), league({ MIA: row(4, 1, 500, 470, 3, 0, 1, 1) }));
  ok('since: a feed correction that would go negative is held at 0', neg.MIA.w === 0 && neg.MIA.l === 0 && neg.MIA.gp === 0 && neg.MIA.pf === 0, neg.MIA);

  const dates = ['2026-10-20', '2026-10-21', '2026-10-23', '2026-10-25'];
  ok('nearest: exact date', nearestOnOrBefore(dates, '2026-10-23') === '2026-10-23');
  ok('nearest: Oct 24 (no games) -> Oct 23', nearestOnOrBefore(dates, '2026-10-24') === '2026-10-23');
  ok('nearest: before the first saved night -> null', nearestOnOrBefore(dates, '2026-10-19') === null);
  const ctx = { dates, gameDate: '2026-10-25' };
  const t1 = resolveTimeframe({ asof: '2026-10-24' }, ctx);
  ok('asof Oct 24 -> uses Oct 23, flagged as a fallback', t1.kind === 'asof' && t1.used === '2026-10-23' && t1.fallback === true);
  ok('asof Oct 24 label says so', /Nothing was saved for Oct\. 24, so this uses Oct\. 23, the nearest earlier date\./.test(timeframeLabel(t1, cur).note), timeframeLabel(t1, cur));
  const t2 = resolveTimeframe({ since: '2026-10-21' }, ctx);
  ok('since Oct 21 exact, no note; label "Since Oct. 21: N games"', t2.used === '2026-10-21' && !t2.fallback && timeframeLabel(t2, win).label === 'Since Oct. 21: 5 games' && timeframeLabel(t2, win).note === '');
  const t3 = resolveTimeframe({ since: 'last7' }, ctx);
  ok('last7: counts back from the latest game date (Oct 25 - 7 = Oct 18) -> nothing saved -> whole season', t3.preset === 'last7' && t3.requested === '2026-10-18' && t3.used === null);
  ok('last7 label: "Last 7 days (the season so far): N games"', timeframeLabel(t3, cur).label === 'Last 7 days (the season so far): ' + gamesIn(cur) + ' games', timeframeLabel(t3, cur).label);
  const t4 = resolveTimeframe({ since: 'last15' }, { dates: [...dates, '2026-11-01', '2026-11-09'], gameDate: '2026-11-09' });
  ok('last15 from Nov 9 -> after Oct 25 (nearest on or before Oct 25)', t4.used === '2026-10-25' && /^Last 15 days \(games after Oct\. 25\): /.test(timeframeLabel(t4, win).label));
  ok('nothing saved on or before: since covers the whole season, as of is the 0-0 start', /covers the whole season/.test(timeframeLabel(resolveTimeframe({ since: '2026-10-01' }, ctx), cur).note)
     && JSON.stringify(standingsFor(resolveTimeframe({ asof: '2026-10-01' }, ctx), cur, {})) === JSON.stringify(league()));
  const early = resolveTimeframe({ since: 'last7' }, { dates: [], gameDate: null });
  ok('last7 before any game: its own view (not the season), the season so far', early.kind === 'since' && early.preset === 'last7' && early.used === null
     && timeframeLabel(early, league()).label === 'Last 7 days (the season so far): 0 games' && JSON.stringify(standingsFor(early, cur, {})) === JSON.stringify(subtractStandings(cur, null)));
  ok('bad parameters fall back to the season', resolveTimeframe({ since: 'yesterday' }, ctx).kind === 'season' && resolveTimeframe({ asof: '21-10-2026' }, ctx).kind === 'season');
  const snaps = { '2026-10-23': base };
  ok('standingsFor: asof is the snapshot exactly, since is current minus snapshot', JSON.stringify(standingsFor(resolveTimeframe({ asof: '2026-10-23' }, ctx), cur, snaps)) === JSON.stringify(base)
     && JSON.stringify(standingsFor(resolveTimeframe({ since: '2026-10-23' }, ctx), cur, snaps)) === JSON.stringify(win));
  ok('pack/unpack round trip', JSON.stringify(unpackTeams(packTeams(cur, order), order)) === JSON.stringify(cur));
  ok('addDays across a month', addDays('2026-10-31', 1) === '2026-11-01' && addDays('2026-11-01', -7) === '2026-10-25');
  ok('Updated stamp: Oct. 21, 1:42 a.m. ET (7:42 Madrid)', fmtUpdated('2026-10-21T05:42:00Z') === 'Oct. 21, 1:42 a.m. ET (7:42 Madrid)', fmtUpdated('2026-10-21T05:42:00Z'));
  ok('Updated stamp: afternoon and after the clocks change (Nov 2: ET -5, Madrid +1)', fmtUpdated('2026-10-20T13:12:58Z') === 'Oct. 20, 9:12 a.m. ET (15:12 Madrid)'
     && fmtUpdated('2026-11-03T03:05:00Z') === 'Nov. 2, 10:05 p.m. ET (4:05 Madrid)', [fmtUpdated('2026-10-20T13:12:58Z'), fmtUpdated('2026-11-03T03:05:00Z')]);
}

// ── 2. The page script's bundle renders what lib/ renders ──
{
  const code = await bundleLib(root);
  const sandbox = { window: {}, Intl, URLSearchParams };
  vm.runInNewContext(code, sandbox);
  const HM = sandbox.window.HM;
  ok('bundle: defines window.HM with every function src/views.js calls', HM && ['unpackTeams', 'resolveTimeframe', 'standingsFor', 'timeframeLabel', 'timeframeParts', 'fmtDay'].every((k) => typeof HM[k] === 'function'));
  const st = league({ MIA: row(4, 1, 590, 550, 2, 0, 2, 1), POR: row(1, 4, 500, 590, 0, 2, 1, 2) });
  const a = timeframeParts(teams, st, lines, { payroll: payroll.payroll });
  const b = HM.timeframeParts(teams, st, lines, { payroll: payroll.payroll });
  ok('bundle: leader lines, tables and charts identical to lib/', a.leaders === b.leaders && a.tables === b.tables && a.charts === b.charts);
  ok('bundle: no "</script" anywhere (cannot end the inline script)', !/<\/script/i.test(code));
  const views = await readFile(join(root, 'src/views.js'), 'utf8');
  ok('views.js: variants get robots noindex,follow, canonical and og:url to themselves', /m\.content = 'noindex,follow'/.test(views) && /c\.href = self/.test(views) && /og\.content = self/.test(views));
  ok('views.js: the plain page (season) returns before touching anything', views.indexOf("if (tf.kind === 'season') return;") < views.indexOf("createElement('meta')"));
}

// ── 3. Update runs against stubbed feeds ──
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), 'standings-p1-'));
  await cp(FIXTURE, join(dir, 'data'), { recursive: true });
  // The pages as that data builds them, so a run with nothing new leaves
  // them byte for byte the same.
  await build({ today: '2026-10-20', dataDir: join(dir, 'data'), outDir: dir, srcRoot: root });
  return { data: join(dir, 'data'), out: dir };
}
async function files(dir) {
  const out = {};
  const walk = async (d, pre) => {
    for (const f of await readdir(d)) {
      const p = join(d, f);
      if ((await stat(p)).isDirectory()) await walk(p, pre + f + '/');
      else out[pre + f] = await readFile(p, 'utf8');
    }
  };
  await walk(dir, '');
  return out;
}
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();

// A world the stub serves: ESPN standings (team -> row) and scoreboards
// (ET date -> games). A game: { away, home, state, final, aw, al, hw, hl }.
const espnAbbr = Object.fromEntries(teams.map((t) => [t.abbr, t.espn[0]]));
function espnStandings(st) {
  const e = (conf) => teams.filter((t) => t.conf === conf).map((t) => {
    const r = st[t.abbr];
    return { team: { abbreviation: espnAbbr[t.abbr] }, stats: [{ name: 'wins', value: r.w }, { name: 'losses', value: r.l },
      { name: 'pointsFor', value: r.pf }, { name: 'pointsAgainst', value: r.pa },
      { name: 'Home', type: 'home', summary: r.home_w + '-' + r.home_l }, { name: 'Road', type: 'road', summary: r.road_w + '-' + r.road_l }] };
  });
  return { children: [{ standings: { season: 2027, entries: e('East') } }, { standings: { season: 2027, entries: e('West') } }] };
}
function espnBoard(games, date) {
  return { events: games.map((g, i) => ({
    id: date.replace(/-/g, '') + i, date: date + 'T23:30:00Z', season: { type: 2 },
    status: { type: { state: g.state, completed: !!g.final, name: g.final ? 'STATUS_FINAL' : 'STATUS_SCHEDULED' } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { abbreviation: espnAbbr[g.home] }, records: [{ type: 'total', summary: g.hw + '-' + g.hl }] },
      { homeAway: 'away', team: { abbreviation: espnAbbr[g.away] }, records: [{ type: 'total', summary: g.aw + '-' + g.al }] }] }],
  })) };
}
const realFetch = globalThis.fetch;
let world, calls;
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if (u === ESPN_URL) return new Response(JSON.stringify(espnStandings(world.standings)));
  if (u.startsWith(ESPN_SCOREBOARD_URL)) {
    const d = u.slice(ESPN_SCOREBOARD_URL.length);
    const date = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
    return new Response(JSON.stringify(espnBoard(world.boards[date] || [], date)));
  }
  if (u === SSF_DATA_URL) return world.payroll ? new Response(JSON.stringify(world.payroll)) : new Response('down', { status: 503 });
  return new Response('not stubbed', { status: 404 });
};
const quiet = console.log;
async function go(d, now, opts = {}) {
  calls = [];
  console.log = () => {};
  try { return await run({ dataDir: d.data, outDir: d.out, now: new Date(now), ...opts }); } finally { console.log = quiet; }
}

const OCT20 = '2026-10-20', OCT21 = '2026-10-21';
const pre = (away, home, aw = 0, al = 0, hw = 0, hl = 0) => ({ away, home, state: 'pre', final: false, aw, al, hw, hl });
const fin = (away, home, aw, al, hw, hl) => ({ away, home, state: 'post', final: true, aw, al, hw, hl });
const zeroLeague = league();

{
  const d = await scratch();
  // Morning of opening night: two games, not started.
  world = { standings: zeroLeague, boards: { [OCT20]: [pre('BOS', 'NYK'), pre('GSW', 'LAL')] }, payroll: null };
  const before = await files(d.out);
  const r1 = await go(d, '2026-10-20T14:00:00Z');
  const after1 = await files(d.out);
  // The four teams' pages now show their next game; nothing else changes.
  // (Celtics and Knicks may already show tonight's real games from the
  // committed archive, so their pages need not change.)
  const allowed = ['celtics/index.html', 'data/pregame/2026-10-20/BOS@NYK.json', 'data/pregame/2026-10-20/GSW@LAL.json', 'knicks/index.html', 'lakers/index.html', 'warriors/index.html'];
  ok('pregame: both games archived, those teams\' pages show the next game, nothing else written', r1.pregame === 2
     && changed(before, after1).every((f) => allowed.includes(f)) && ['data/pregame/2026-10-20/BOS@NYK.json', 'data/pregame/2026-10-20/GSW@LAL.json', 'lakers/index.html'].every((f) => changed(before, after1).includes(f))
     && after1['lakers/index.html'].includes('Next game: vs. <a href="https://hoopsmatic.com/standings/warriors">Golden State</a>, Oct. 20, 7:30 p.m. ET'), changed(before, after1));
  const pg = JSON.parse(after1['data/pregame/2026-10-20/BOS@NYK.json']);
  ok('pregame entry: game id, teams, tip, saved time, both records', pg.game_id === '202610200' && pg.away.abbr === 'BOS' && pg.home.abbr === 'NYK' && pg.tip === '2026-10-20T23:30:00Z'
     && pg.saved_at === '2026-10-20T14:00:00.000Z' && pg.away.w === 0 && pg.home.l === 0 && !('prob' in pg), pg);
  ok('no new finals: standings never fetched', !calls.includes(ESPN_URL));

  // Same scoreboard 30 minutes later: nothing changes at all.
  const r2 = await go(d, '2026-10-20T14:30:00Z');
  const after2 = await files(d.out);
  ok('no-change run: commits nothing (every file identical)', changed(after1, after2).length === 0 && r2.pregame === 0 && !r2.built, changed(after1, after2));

  // Pregame is append-only: a later run that sees other records leaves the entry alone.
  world.boards[OCT20] = [pre('BOS', 'NYK', 5, 5, 5, 5), pre('GSW', 'LAL')];
  await go(d, '2026-10-20T15:00:00Z');
  const after3 = await files(d.out);
  ok('pregame append-only: a later run with other records does not touch the archived entry', after3['data/pregame/2026-10-20/BOS@NYK.json'] === after1['data/pregame/2026-10-20/BOS@NYK.json']);
  ok('archivePregame: an existing entry is never overwritten (returns false, file unchanged)',
     (await archivePregame(d.data, { key: '2026-10-20_BOS@NYK', date: OCT20, away: { abbr: 'BOS', w: 9 } })) === false
     && (await readFile(join(d.data, 'pregame/2026-10-20/BOS@NYK.json'), 'utf8')) === after1['data/pregame/2026-10-20/BOS@NYK.json']);

  // 9:45 p.m. ET: BOS@NYK final, but the standings feed has not caught up.
  world.boards[OCT20] = [fin('BOS', 'NYK', 0, 1, 1, 0), { ...pre('GSW', 'LAL'), state: 'in' }];
  const r4 = await go(d, '2026-10-21T01:45:00Z');
  const after4 = await files(d.out);
  ok('lagging feed: the final is not counted, nothing written', r4.newFinals === 1 && r4.counted === 0 && changed(after3, after4).length === 0, changed(after3, after4));

  // Feed catches up: standings, finals and page; no snapshot (GSW@LAL live).
  world.standings = league({ NYK: row(1, 0, 112, 104, 1, 0, 0, 0), BOS: row(0, 1, 104, 112, 0, 0, 0, 1) });
  const r5 = await go(d, '2026-10-21T02:15:00Z');
  const after5 = await files(d.out);
  const st5 = JSON.parse(after5['data/standings.json']);
  // sitemap.xml itself reads the same: its lastmod was already Oct 20 (ET).
  ok('final counted: standings, finals, page, the two teams\' pages and sitemap hashes written; no snapshot while a game is live',
     r5.counted === 1 && r5.standingsChanged && JSON.stringify(changed(after4, after5)) === JSON.stringify(['celtics/index.html', 'data/finals.json', 'data/page_hashes.json', 'data/standings.json', 'index.html', 'knicks/index.html']), changed(after4, after5));
  ok('final counted: updated_at is the run time, game_date Oct 20', st5.updated_at === '2026-10-21T02:15:00.000Z' && st5.game_date === OCT20);
  ok('final counted: page says "Updated Oct. 20, 10:15 p.m. ET (4:15 Madrid)"', after5['index.html'].includes('Updated Oct. 20, 10:15 p.m. ET (4:15 Madrid)'));
  ok('sitemap lastmod moved with the numbers', after5['sitemap.xml'].includes('<lastmod>2026-10-20</lastmod>') && JSON.parse(after5['data/page_hashes.json']).pages['https://hoopsmatic.com/standings'].hash !== JSON.parse(after4['data/page_hashes.json']).pages['https://hoopsmatic.com/standings'].hash);

  // 1:05 a.m. ET Oct 21: GSW@LAL final, every Oct 20 game final -> snapshot.
  world.boards[OCT20] = [fin('BOS', 'NYK', 0, 1, 1, 0), fin('GSW', 'LAL', 1, 0, 0, 1)];
  world.boards[OCT21] = [pre('MIA', 'ORL')];
  world.standings = { ...world.standings, GSW: row(1, 0, 120, 110, 0, 0, 1, 0), LAL: row(0, 1, 110, 120, 0, 1, 0, 0) };
  const r6 = await go(d, '2026-10-21T05:05:00Z');
  const after6 = await files(d.out);
  ok('night complete: history/2026-10-20.json written with the full night', r6.snapshots.join() === OCT20 && JSON.parse(after6['data/history/2026-10-20.json']).teams.LAL.l === 1);
  ok('night complete: tomorrow\'s game archived pregame', 'data/pregame/2026-10-21/MIA@ORL.json' in after6);
  ok('no snapshot for Oct 21 (no game final yet)', !('data/history/2026-10-21.json' in after6));

  // Same night, a stat correction: Oct 20 snapshot rewritten.
  world.standings = { ...world.standings, GSW: row(1, 0, 121, 110, 0, 0, 1, 0), LAL: row(0, 1, 110, 121, 0, 1, 0, 0) };
  const r7 = await go(d, '2026-10-21T06:00:00Z', { force: true });
  const after7 = await files(d.out);
  ok('same night, numbers change: the snapshot is rewritten', r7.snapshots.join() === OCT20 && JSON.parse(after7['data/history/2026-10-20.json']).teams.GSW.pf === 121);

  // Next game date started: MIA@ORL live. A correction now must not touch Oct 20.
  world.boards[OCT21] = [{ ...pre('MIA', 'ORL'), state: 'in' }];
  world.standings = { ...world.standings, GSW: row(1, 0, 122, 110, 0, 0, 1, 0), LAL: row(0, 1, 110, 122, 0, 1, 0, 0) };
  const r8 = await go(d, '2026-10-21T23:45:00Z', { force: true });
  const after8 = await files(d.out);
  ok('next game date started: the snapshot is never rewritten', r8.snapshots.length === 0 && after8['data/history/2026-10-20.json'] === after7['data/history/2026-10-20.json']);

  // Lastmod: a payroll-only change moves "Updated" and rebuilds the page, not the lastmod.
  world.payroll = { meta: { built: 'x' }, seasons: teams.map((t) => ({ player: t.abbr, season: '2026-27', team: t.abbr, salary: 150e6 })) };
  const r9 = await go(d, '2026-10-22T14:23:00Z', { force: true });
  const after9 = await files(d.out);
  ok('only "Updated" (and payroll) changed: page rebuilt with the new time', r9.payrollChanged && !r9.standingsChanged && after9['index.html'].includes('Updated Oct. 22, 10:23 a.m. ET (16:23 Madrid)'), [r9, (after9['index.html'].match(/Updated Oct[^<]*/) || [])[0]]);
  ok('only "Updated" changed: sitemap lastmod and hash unchanged', after9['sitemap.xml'] === after8['sitemap.xml'] && after9['data/page_hashes.json'] === after8['data/page_hashes.json']);

  // A day with no games: no snapshot.
  world.boards = { '2026-10-22': [], '2026-10-23': [] };
  const r10 = await go(d, '2026-10-23T14:00:00Z', { force: true });
  ok('a day without games gets no snapshot', r10.snapshots.length === 0 && !('data/history/2026-10-22.json' in await files(d.out)));
}

// ── 4. Scoreboard parsing ──
{
  const g = parseEspnScoreboard(espnBoard([fin('BOS', 'NYK', 0, 1, 1, 0)], OCT20), teams, OCT20)[0];
  ok('scoreboard: key, state, final, records', g.key === '2026-10-20_BOS@NYK' && g.final && g.state === 'post' && g.home.w === 1 && g.away.l === 1);
  ok('standingsReflect: false until both teams show the game', !standingsReflect(g, zeroLeague) && standingsReflect(g, league({ NYK: row(1, 0, 1, 0, 1, 0, 0, 0), BOS: row(0, 1, 0, 1, 0, 0, 0, 1) })));
  const preseason = espnBoard([fin('BOS', 'NYK', 0, 1, 1, 0)], OCT20); preseason.events[0].season.type = 1;
  const postponed = espnBoard([pre('BOS', 'NYK')], OCT20); postponed.events[0].status.type.name = 'STATUS_POSTPONED';
  ok('scoreboard: preseason and postponed games dropped', parseEspnScoreboard(preseason, teams, OCT20).length === 0 && parseEspnScoreboard(postponed, teams, OCT20).length === 0);
}

globalThis.fetch = realFetch;
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
