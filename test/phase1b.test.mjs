// Phase 1b: game log, team pages, saved nights out of the page, AP dates.
//
//   - game log: append-only; a corrected score is a new .cN entry noted as a
//     correction, the original file untouched; the update run logs finals
//     from its scoreboards and backfills counted dates with no entry;
//   - team pages: every metric matches the team's row in the main table for
//     the same night; title, description, canonical, links, footer;
//     "Charts fill in after a few games" under 5 saved nights;
//   - sitemap: a team page's lastmod moves only with that team's numbers;
//   - AP dates everywhere on the built pages;
//   - the saved nights load from data/nights.json for the date views.
//
// Run: node test/phase1b.test.mjs

import { readFile, readdir, mkdtemp, cp, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logFinal, readGameLog, missingLogDates } from '../scripts/gamelog.mjs';
import { build, renderAll, hash } from '../scripts/build.mjs';
import { run } from '../scripts/update.mjs';
import { ESPN_URL, ESPN_SCOREBOARD_URL, SSF_DATA_URL } from '../scripts/fetch.mjs';
import { fmtDay, fmtDate, fmtUpdated, AP_MONTHS } from '../lib/render.mjs';
import { unpackTeams } from '../lib/timeframe.mjs';
import { ordinal, MIN_CHART_POINTS } from '../lib/team.mjs';

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
const order = teams.map((t) => t.abbr);
const zero = () => ({ w: 0, l: 0, gp: 0, pf: 0, pa: 0, home_w: 0, home_l: 0, road_w: 0, road_l: 0 });

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), 'standings-p1b-'));
  await cp(FIXTURE, join(dir, 'data'), { recursive: true });
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

// ── 1. Game log ──
const fin = (date, away, home, as, hs) => ({ key: date + '_' + away + '@' + home, id: 'g1', id_source: 'espn', date, final: true, state: 'post',
  away: { abbr: away, w: null, l: null, score: as }, home: { abbr: home, w: null, l: null, score: hs } });
{
  const d = await scratch();
  const g = fin('2026-10-20', 'BOS', 'DET', 101, 99);
  ok('game log: first final is written', (await logFinal(d.data, g, '2026-10-21T02:00:00.000Z')) === 'new');
  const p0 = join(d.data, 'games/2026-10-20/BOS@DET.json');
  const first = await readFile(p0, 'utf8');
  const e0 = JSON.parse(first);
  ok('game log entry: game id, ET date, home, away, scores, final timestamp', e0.game_id === 'g1' && e0.date === '2026-10-20' && e0.home.abbr === 'DET' && e0.home.score === 99
     && e0.away.abbr === 'BOS' && e0.away.score === 101 && e0.final_at === '2026-10-21T02:00:00.000Z' && e0.correction === false, e0);
  ok('game log: the same final again writes nothing', (await logFinal(d.data, g, '2026-10-21T02:30:00.000Z')) === null && (await readdir(join(d.data, 'games/2026-10-20'))).length === 1);
  const fixed = fin('2026-10-20', 'BOS', 'DET', 101, 100);
  ok('game log: a corrected score is a new entry', (await logFinal(d.data, fixed, '2026-10-21T09:00:00.000Z')) === 'correction');
  const c1 = await J(join(d.data, 'games/2026-10-20/BOS@DET.c1.json'));
  ok('correction entry: noted as a correction, names what it corrects and the old scores', c1.correction === true && c1.corrects === 'BOS@DET.json' && c1.previous.home === 99 && c1.home.score === 100, c1);
  ok('correction: the original entry is byte for byte as it was', (await readFile(p0, 'utf8')) === first);
  ok('readGameLog: one game, the latest entry', JSON.stringify((await readGameLog(d.data)).map((e) => [e.key, e.home.score])) === '[["2026-10-20_BOS@DET",100]]');
  ok('game log: no scores, nothing logged', (await logFinal(d.data, { ...fin('2026-10-20', 'PHI', 'NYK', null, null) }, 'x')) === null);
  ok('missingLogDates: a counted final with no entry', JSON.stringify(missingLogDates({ dates: { '2026-10-20': ['2026-10-20_BOS@DET', '2026-10-20_PHI@NYK'], '2026-10-19': [] } }, await readGameLog(d.data))) === '["2026-10-20"]');
}

// ── 2. The update run logs finals and backfills ──
{
  const d = await scratch();
  await build({ today: '2026-10-20', dataDir: d.data, outDir: d.out, srcRoot: root });
  const st = Object.fromEntries(order.map((a) => [a, zero()]));
  Object.assign(st, { DET: { ...zero(), w: 0, l: 1, gp: 1, pf: 99, pa: 101, home_l: 1 }, BOS: { ...zero(), w: 1, gp: 1, pf: 101, pa: 99, road_w: 1 } });
  const espnAbbr = Object.fromEntries(teams.map((t) => [t.abbr, t.espn[0]]));
  const standingsBody = { children: ['East', 'West'].map((c) => ({ standings: { season: 2027, entries: teams.filter((t) => t.conf === c).map((t) => ({ team: { abbreviation: espnAbbr[t.abbr] },
    stats: [{ name: 'wins', value: st[t.abbr].w }, { name: 'losses', value: st[t.abbr].l }, { name: 'pointsFor', value: st[t.abbr].pf }, { name: 'pointsAgainst', value: st[t.abbr].pa },
      { name: 'Home', type: 'home', summary: st[t.abbr].home_w + '-' + st[t.abbr].home_l }, { name: 'Road', type: 'road', summary: st[t.abbr].road_w + '-' + st[t.abbr].road_l }] })) } })) };
  const board = (games) => ({ events: games.map((g, i) => ({ id: String(900 + i), date: g.date + 'T23:00:00Z', season: { type: 2 },
    status: { type: { state: 'post', completed: true, name: 'STATUS_FINAL' } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { abbreviation: espnAbbr[g.home] }, score: String(g.hs), records: [{ type: 'total', summary: g.hr }] },
      { homeAway: 'away', team: { abbreviation: espnAbbr[g.away] }, score: String(g.as), records: [{ type: 'total', summary: g.ar }] }] }] })) });
  const boards = {
    '20261020': board([{ date: '2026-10-20', away: 'BOS', home: 'DET', as: 101, hs: 99, ar: '1-0', hr: '0-1' }]),
    '20261021': board([]),
    '20261018': board([{ date: '2026-10-18', away: 'PHI', home: 'NYK', as: 90, hs: 95, ar: '0-0', hr: '0-0' }]),
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u === ESPN_URL) return new Response(JSON.stringify(standingsBody));
    if (u.startsWith(ESPN_SCOREBOARD_URL)) return new Response(JSON.stringify(boards[u.slice(ESPN_SCOREBOARD_URL.length)] || { events: [] }));
    if (u === SSF_DATA_URL) return new Response('down', { status: 503 });
    return new Response('x', { status: 404 });
  };
  // A date counted before the log existed: Oct 18 is in finals.json with no entry.
  await writeFile(join(d.data, 'finals.json'), JSON.stringify({ dates: { '2026-10-18': ['2026-10-18_PHI@NYK'] } }));
  const quiet = console.log; console.log = () => {};
  const r = await run({ dataDir: d.data, outDir: d.out, now: new Date('2026-10-21T04:00:00Z') });
  console.log = quiet;
  globalThis.fetch = real;
  const log = await readGameLog(d.data);
  ok('update run: tonight\'s final logged from the scoreboard', log.some((e) => e.key === '2026-10-20_BOS@DET' && e.away.score === 101 && e.final_at === '2026-10-21T04:00:00.000Z'), log);
  ok('update run: a counted date with no log entry is backfilled (Oct 18)', log.some((e) => e.key === '2026-10-18_PHI@NYK' && e.home.score === 95), log.map((e) => e.key));
  ok('update run: result counts them', r.logged === 2, r);
  const det = await readFile(join(d.out, 'pistons/index.html'), 'utf8');
  ok('team page after the run: Detroit\'s game log shows the loss', /<td class="left">Oct\. 20<\/td><td class="left">vs\. <a href="https:\/\/hoopsmatic\.com\/standings\/celtics">Boston<\/a><\/td><td class="neg">L 99-101<\/td>/.test(det));
}

// ── 3. Team pages vs. the main table, from a mid-season fixture ──
const fx = await scratch();
{
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const st = Object.fromEntries(order.map((a) => [a, zero()]));
  await mkdir(join(fx.data, 'history'), { recursive: true });
  const finals = { dates: {} };
  let last;
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(2026, 9, 20 + i)).toISOString().slice(0, 10);
    const pool = [...teams].sort(() => rnd() - 0.5).slice(0, 10);
    for (let k = 0; k < pool.length; k += 2) {
      const a = pool[k].abbr, h = pool[k + 1].abbr, hs = 100 + Math.round(rnd() * 20);
      const as = rnd() < 0.5 ? hs - 1 - Math.round(rnd() * 9) : hs + 1 + Math.round(rnd() * 9);
      const H = st[h], A = st[a];
      H.pf += hs; H.pa += as; A.pf += as; A.pa += hs; H.gp++; A.gp++;
      if (hs > as) { H.w++; H.home_w++; A.l++; A.road_l++; } else { A.w++; A.road_w++; H.l++; H.home_l++; }
      await logFinal(fx.data, fin(d, a, h, as, hs), d + 'T04:00:00.000Z');
      (finals.dates[d] = finals.dates[d] || []).push(d + '_' + a + '@' + h);
    }
    await writeFile(join(fx.data, 'history', d + '.json'), JSON.stringify({ date: d, source: 'espn', teams: st }));
    last = d;
  }
  await writeFile(join(fx.data, 'finals.json'), JSON.stringify(finals));
  const s = await J(join(fx.data, 'standings.json'));
  await writeFile(join(fx.data, 'standings.json'), JSON.stringify({ ...s, teams: st, game_date: last, updated_at: '2026-10-28T05:00:00Z' }));
  await build({ dataDir: fx.data, outDir: fx.out, today: last });
}
const fxFiles = await files(fx.out);
const main = fxFiles['index.html'];
const cellText = (html) => html.replace(/<[^>]+>/g, '').trim();
let mismatches = [];
for (const t of teams) {
  const page = fxFiles[t.ssf_slug + '/index.html'];
  const row = new RegExp('<tr data-o="\\d+"><td class="c-rank" data-v="(\\d*)">[^<]*</td><td class="c-team" data-v="' + t.short.replace(/\./g, '\\.') + '">[\\s\\S]*?</tr>').exec(main);
  const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]));
  // Main table columns: Rank, Team, W, L, Pct, vs. Vegas, vs. Last Year, $ per Win, Pt Diff, Exp. W-L, Luck, Road W − Home L
  const stat = (k) => (new RegExp('<div class="stat" data-k="' + k + '"><span class="lbl">[^<]*</span><span class="num">([^<]*)</span>').exec(page) || [])[1];
  const want = { pct: cells[4], vsVegas: cells[5], vsLastYear: cells[6], dollarsPerWin: cells[7], ptDiff: cells[8], expWL: cells[9], luck: cells[10], roadMinusHome: cells[11] };
  for (const [k, v] of Object.entries(want)) if (stat(k) !== v) mismatches.push(t.abbr + ' ' + k + ' ' + stat(k) + ' != ' + v);
  const rec = (/<div class="num" data-k="record">([^<]*)</.exec(page) || [])[1];
  if (rec !== cells[2] + '-' + cells[3]) mismatches.push(t.abbr + ' record ' + rec);
  const cr = (/<div class="num" data-k="confRank">([^<]*)</.exec(page) || [])[1];
  if (row[1] && cr !== ordinal(Number(row[1])) + ' in the ' + t.conf) mismatches.push(t.abbr + ' conf rank ' + cr + ' vs ' + row[1]);
}
ok('team pages: record, conference rank and all 8 metrics match the main table row for the same night (30 teams)', mismatches.length === 0, mismatches.slice(0, 5));
{
  const lal = fxFiles['lakers/index.html'];
  ok('team page: title and unique description', lal.includes('<title>Los Angeles Lakers 2026-27: Record vs. Vegas, Point Differential and Luck | HoopsMatic</title>')
     && /<meta name="description" content="How the Los Angeles Lakers’ 2026-27 season compares with its Vegas win total of 45\.5/.test(lal));
  const descs = teams.map((t) => (/<meta name="description" content="([^"]*)"/.exec(fxFiles[t.ssf_slug + '/index.html']) || [])[1]);
  ok('team pages: 30 different descriptions and titles', new Set(descs).size === 30 && new Set(teams.map((t) => (/<title>([^<]*)/.exec(fxFiles[t.ssf_slug + '/index.html']) || [])[1])).size === 30);
  ok('team page: canonical and og:url are its hoopsmatic.com URL, no noindex', lal.includes('<link rel="canonical" href="https://hoopsmatic.com/standings/lakers">')
     && lal.includes('<meta property="og:url" content="https://hoopsmatic.com/standings/lakers">') && !/name="robots"/.test(lal));
  ok('team page: H1 is the team, no eyebrow', /<div class="hdr team-hdr"><img [^>]*><h1>Los Angeles Lakers<\/h1><\/div>/.test(lal) && !/class="(?:brand|eyebrow|kicker)/.test(lal));
  ok('team page: links to full standings and its Salary Season Finder page', lal.includes('href="https://hoopsmatic.com/standings"') && lal.includes('href="https://hoopsmatic.com/salary-season-finder/team/lakers/"'));
  const peers = [...lal.split('<ul class="peers">')[1].split('</ul>')[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  ok('team page: the other 14 West teams, not itself', peers.length === 14 && !peers.includes('https://hoopsmatic.com/standings/lakers') && peers.includes('https://hoopsmatic.com/standings/trail-blazers') && !peers.includes('https://hoopsmatic.com/standings/celtics'));
  const foot = (/<footer class="foot">([\s\S]*?)<\/footer>/.exec(lal) || [])[1] || '';
  ok('team page: the same two-line footer', JSON.stringify(cellText(foot).split('\n').map((x) => x.trim()).filter(Boolean)) === JSON.stringify(['Anything wrong? Email us at hoopshype@hoopshype.com', 'For business inquiries, contact us at ads@hoopshype.com']));
  ok('team page: 8 charts (8 saved nights), inline SVG, conference rank inverted with 1 at the top', (lal.match(/<figure class="mchart">/g) || []).length === 8 && !/<script/.test(lal)
     && /Conference rank<\/h3><svg[\s\S]*?<text class="ax" x="39" y="16\.0" text-anchor="end">1<\/text>/.test(lal));
  ok('team page: game log newest first', (() => { const ds = [...lal.split('class="lb glog"')[1].matchAll(/<tr><td class="left">([^<]+)</g)].map((m) => m[1]); return ds.length > 0 && ds.join() === [...ds].sort((a, b) => Number(b.split(' ')[1]) - Number(a.split(' ')[1])).join(); })());
  ok('team page: game log record column agrees with the standings', (() => { const r = (/<td>(\d+-\d+)<\/td><\/tr>/.exec(lal.split('class="lb glog"')[1]) || [])[1]; return r === (/data-k="record">([^<]*)</.exec(lal) || [])[1]; })());
  ok('team page: no NaN, Infinity or undefined', !/\bNaN\b|Infinity|undefined/.test(lal));
}
{
  // Under 5 saved nights: the placeholder instead of charts.
  const few = await scratch();
  const all = await renderAll({ dataDir: few.data });
  const lal = all.teamPages.find((p) => p.slug === 'lakers').html;
  ok('under ' + MIN_CHART_POINTS + ' saved nights: "Charts fill in after a few games", no charts', lal.includes('Charts fill in after a few games.') && !lal.includes('class="mchart"'));
}

// ── 4. Sitemap: per team ──
{
  const before = await J(join(fx.data, 'page_hashes.json'));
  const st = await J(join(fx.data, 'standings.json'));
  st.updated_at = '2026-10-29T05:00:00Z';                       // only "Updated" moves
  await writeFile(join(fx.data, 'standings.json'), JSON.stringify(st));
  await build({ dataDir: fx.data, outDir: fx.out, today: '2026-10-29' });
  const mid = await J(join(fx.data, 'page_hashes.json'));
  ok('sitemap: only "Updated" changed -> no lastmod moves (31 URLs)', JSON.stringify(mid) === JSON.stringify(before) && Object.keys(mid.pages).length === 31);
  st.teams.LAL = { ...st.teams.LAL, w: st.teams.LAL.w + 1, gp: st.teams.LAL.gp + 1, pf: st.teams.LAL.pf + 110, pa: st.teams.LAL.pa + 100, home_w: st.teams.LAL.home_w + 1 };
  await writeFile(join(fx.data, 'standings.json'), JSON.stringify(st));
  await build({ dataDir: fx.data, outDir: fx.out, today: '2026-10-30' });
  const after = await J(join(fx.data, 'page_hashes.json'));
  const moved = Object.keys(after.pages).filter((u) => after.pages[u].lastmod !== before.pages[u].lastmod).sort();
  ok('sitemap: a Lakers-only change moves /standings and /standings/lakers, nothing else', JSON.stringify(moved) === JSON.stringify(['https://hoopsmatic.com/standings', 'https://hoopsmatic.com/standings/lakers']), moved);
  const sm = await readFile(join(fx.out, 'sitemap.xml'), 'utf8');
  ok('sitemap.xml: the Lakers page carries its own lastmod', sm.includes('<loc>https://hoopsmatic.com/standings/lakers</loc><lastmod>2026-10-30</lastmod>') && sm.includes('<loc>https://hoopsmatic.com/standings/celtics</loc><lastmod>' + before.pages['https://hoopsmatic.com/standings/celtics'].lastmod + '</lastmod>'));
}

// ── 5. AP dates ──
{
  const days = ['2027-01-05', '2027-02-05', '2027-03-05', '2027-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05', '2026-12-05'].map(fmtDay);
  ok('AP months: Jan. Feb. March April May June July Aug. Sept. Oct. Nov. Dec.', days.join('|') === 'Jan. 5|Feb. 5|March 5|April 5|May 5|June 5|July 5|Aug. 5|Sept. 5|Oct. 5|Nov. 5|Dec. 5', days.join('|'));
  ok('AP: fmtDate "Oct. 20, 2026", fmtUpdated "Sept. 30, ..."', fmtDate('2026-10-20') === 'Oct. 20, 2026' && fmtUpdated('2026-09-30T16:05:00Z').startsWith('Sept. 30, 12:05 p.m. ET'), fmtUpdated('2026-09-30T16:05:00Z'));
  const bad = /\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec) \d/;
  const strip = (h) => h.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  const offenders = Object.entries(fxFiles).filter(([f, h]) => f.endsWith('index.html') && bad.test(strip(h))).map(([f, h]) => f + ': ' + strip(h).match(new RegExp('.{20}' + bad.source + '.{10}'))[0]);
  ok('AP: no month without its period on /standings or any team page', offenders.length === 0, offenders.slice(0, 3));
  ok('AP: the main page and a team page use "Oct. 2x" dates', /Oct\. 2\d/.test(strip(main)) && /Oct\. 2\d/.test(strip(fxFiles['lakers/index.html'])));
}

// ── 6. Saved nights load from data/nights.json ──
{
  const nights = await readFile(join(fx.data, 'nights.json'), 'utf8');
  const N = JSON.parse(nights);
  const D = JSON.parse(/<script type="application\/json" id="hm-data">([\s\S]*?)<\/script>/.exec(main)[1]);
  ok('page data: no saved nights inside the page, only the file path and its version', !('snapshots' in D) && !('dates' in D) && D.nightsPath === 'data/nights.json' && D.nightsVersion === hash(nights.trim()));
  const hist = (await readdir(join(fx.data, 'history'))).sort().map((f) => f.slice(0, 10));
  ok('nights.json: every saved night, in order', JSON.stringify(N.dates) === JSON.stringify(hist) && JSON.stringify(N.order) === JSON.stringify(order));
  const h0 = await J(join(fx.data, 'history', hist[3] + '.json'));
  ok('nights.json: a night unpacks to exactly the saved standings', JSON.stringify(unpackTeams(N.snapshots[hist[3]], N.order)) === JSON.stringify(h0.teams));
  const views = await readFile(join(root, 'src/views.js'), 'utf8');
  ok('views.js: fetches the nights file only for a date view, with the version, from /standings/ on hoopsmatic.com',
     views.indexOf("if (tf.kind === 'season') return;") < views.indexOf('fetch(') && /fetch\(base \+ D\.nightsPath \+ '\?v=' \+ D\.nightsVersion\)/.test(views) && /'\/standings\/'/.test(views));
  ok('the committed page does not carry the saved nights either', !/"snapshots"/.test(await readFile(join(root, 'index.html'), 'utf8')));
}

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
