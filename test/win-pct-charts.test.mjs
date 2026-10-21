// Oct. 21, second round, against the frozen fixture (test/fixtures/data):
//   1. no Reg. W-L-T anywhere a reader sees it (tables, team pages, date
//      views, header explanations, methodology); the game log still stores
//      each final's period count
//   2. team-page charts that match the table: "Win % vs. Vegas" (win % per
//      night against a flat dashed line at the preseason line / 82) in place
//      of "Wins vs. Vegas pace", and "vs. Last Year" in the same style
//      against 2025-26 wins / 82; the methodology says the Vegas number is
//      frozen before opening night and never updated
// Run: node test/win-pct-charts.test.mjs

import { readFile, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { COLUMNS, tableHtml, timeframeParts } from '../lib/render.mjs';
import { buildRows, byConference } from '../lib/model.mjs';
import { nightRowsFor, teamSeries, teamChartsHtml } from '../lib/team.mjs';
import { methodologyHtml } from '../lib/page.mjs';
import { logFinal, readGameLog } from '../scripts/gamelog.mjs';
import { renderAll, bundleLib } from '../scripts/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
// Words that would mean the regulation record is still on show.
const REG = /Reg\. W-L-T|regWLT|48 minutes|counts as a tie/;

// ── 1. Reg. W-L-T is gone ──
{
  // An overtime game, so a regulation record would have something to show.
  const games = [G('2026-10-20', 'PHI', 'NYK', 106, 100), G('2026-10-21', 'NYK', 'BOS', 120, 118, 5)];
  const st = standingsFrom(games);
  const rows = buildRows(teams, { teams: st }, lines, payroll, games);
  const t = tableHtml('East', byConference(rows).East);
  ok('columns: no Reg. W-L-T column defined, Last 10 and vs. .500+ last', !COLUMNS.some((c) => c.k === 'regWLT' || REG.test(c.label) || REG.test(c.tip)) && COLUMNS.slice(-2).map((c) => c.k).join() === 'last10,vs500');
  ok('table: 14 headers, no Reg. W-L-T header, cell or explanation', (t.match(/<th /g) || []).length === 14 && !REG.test(t));
  ok('rows: no regulation record among the values the page reads', rows.every((r) => !('regWLT' in r.m.value) && !('regWLT' in r.m.text)));
  ok('methodology: no Reg. W-L-T entry', !REG.test(methodologyHtml(lines)));
  // The date views draw with the bundled copy of lib/: nothing there either.
  const sandbox = { window: {}, Intl, URLSearchParams };
  vm.runInNewContext(await bundleLib(root), sandbox);
  const parts = sandbox.window.HM.timeframeParts(teams, st, lines, payroll, games, st);
  ok('date views (bundle): no Reg. W-L-T in tables or leader lines', !REG.test(parts.tables) && !REG.test(parts.leaders) && parts.tables === timeframeParts(teams, st, lines, payroll, games, st).tables);

  // The build, from a scratch log with the period counts stored.
  const dir = await mkdtemp(join(tmpdir(), 'standings-wpc-'));
  const data = join(dir, 'data');
  await cp(FIXTURE, data, { recursive: true });
  for (const g of games) {
    await logFinal(data, { key: g.date + '_' + g.away + '@' + g.home, id: g.away, id_source: 'espn', date: g.date, final: true, periods: g.periods,
      away: { abbr: g.away, score: g.as }, home: { abbr: g.home, score: g.hs } }, '2026-10-22T04:00:00.000Z');
  }
  const s = await J(join(data, 'standings.json'));
  s.teams = st; s.game_date = '2026-10-21';
  await writeFile(join(data, 'standings.json'), JSON.stringify(s));
  const all = await renderAll({ dataDir: data, srcRoot: root, today: '2026-10-22' });
  ok('page and 30 team pages: no Reg. W-L-T anywhere', !REG.test(all.index) && all.teamPages.length === 30 && all.teamPages.every((p) => !REG.test(p.html)));
  ok('team page: stats end with Last 10 and vs. .500+', /data-k="last10">[\s\S]*data-k="vs500"><span class="lbl">vs\. \.500\+<\/span><span class="num">[^<]*<\/span><\/div><\/div>/.test(all.teamPages.find((p) => p.slug === 'knicks').html));
  const log = await readGameLog(data);
  ok('game log: still stores the period count (4, and 5 for the overtime game)', log.map((e) => e.periods).join() === '4,5', log.map((e) => e.periods));
  ok('committed /standings: no Reg. W-L-T', !REG.test(await readFile(join(root, 'index.html'), 'utf8')));
}

// ── 2. Team-page charts ──
{
  // Philadelphia over six saved nights: W, W, L, W, L, W (win % 100, 100, 66.7, 75, 60, 66.7).
  const results = [true, true, false, true, false, true];
  const nights = [];
  let acc = [];
  results.forEach((won, i) => {
    const d = '2026-10-' + String(20 + i).padStart(2, '0');
    acc = [...acc, won ? G(d, 'ATL', 'PHI', 90, 100) : G(d, 'ATL', 'PHI', 100, 90)];
    nights.push({ date: d, teams: standingsFrom(acc) });
  });
  const series = teamSeries('PHI', nightRowsFor(nights, teams, lines, payroll, acc));
  const html = teamChartsHtml(series);
  const chart = (title) => { const i = html.indexOf('<h3>' + title + '</h3>'); return i < 0 ? null : html.slice(i, html.indexOf('</figure>', i)); };
  ok('charts: "Wins vs. Vegas pace" replaced by "Win % vs. Vegas", still 8 charts', chart('Wins vs. Vegas pace') === null && chart('Win % vs. Vegas') !== null && (html.match(/<figure class="mchart">/g) || []).length === 8);
  // The box: 170 tall, 12 top and 26 bottom margins, so y = 12 + (1 - pct / 100) * 132 on a 0-100% axis.
  const y = (pct) => (12 + (1 - pct / 100) * 132).toFixed(1);
  const path = (c, cls) => ((new RegExp('<path class="ln ' + cls + '" d="([^"]*)"').exec(c) || [])[1] || '').split(/[ML]/).map((p) => p.trim()).filter(Boolean).map((p) => p.split(' ')[1]);
  const vegas = chart('Win % vs. Vegas');
  // 49.5 / 82 = 60.37% -> y 64.3, on every night.
  ok('Win % vs. Vegas: a flat dashed line at 60.4% (49.5 / 82) on all six nights', JSON.stringify(path(vegas, 'b')) === JSON.stringify(Array(6).fill(y(49.5 / 82 * 100))), path(vegas, 'b'));
  ok('Win % vs. Vegas: the legend names it "Preseason Vegas line: 60.4%"', vegas.includes('<span class="key b">Preseason Vegas line: 60.4%</span>') && vegas.includes('<span class="key a">Win %</span>'));
  ok('Win % vs. Vegas: the win % line night by night (100, 100, 66.7, 75, 60, 66.7)', JSON.stringify(path(vegas, 'a')) === JSON.stringify([100, 100, 200 / 3, 75, 60, 200 / 3].map(y)), path(vegas, 'a'));
  ok('Win % vs. Vegas: y axis in %, 0% to 100%', /<text class="ax"[^>]*>100%<\/text>/.test(vegas) && /<text class="ax"[^>]*>0%<\/text>/.test(vegas));
  const last = chart('vs. Last Year');
  // 45 / 82 = 54.88% -> y 71.6.
  ok('vs. Last Year: win % against a flat dashed line at 54.9% (45 / 82), legend "2025-26: 54.9%"', JSON.stringify(path(last, 'b')) === JSON.stringify(Array(6).fill(y(45 / 82 * 100)))
     && JSON.stringify(path(last, 'a')) === JSON.stringify(path(vegas, 'a')) && last.includes('<span class="key b">2025-26: 54.9%</span>') && /<text class="ax"[^>]*>100%<\/text>/.test(last), path(last, 'b'));
  ok('the vs. Vegas chart in percentage points is still there', chart('vs. Vegas') !== null && /<text class="ax"[^>]*>[+−]\d+\.\d%<\/text>/.test(chart('vs. Vegas')));
  ok('series: win % and the two fixed marks per night, no pace', series.every((p) => p.vegasPct === 49.5 / 82 && p.lastPct === 45 / 82 && !('pace' in p)) && series[2].pct === 2 / 3);

  const meth = methodologyHtml(lines);
  ok('methodology: the Vegas number is the preseason win total, frozen before opening night and never updated',
     /<dt>vs\. Vegas<\/dt><dd>The Vegas number is each team’s preseason win total, frozen on Oct\. 17, 2026, before opening night, and never updated during the season\./.test(meth));
}

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
