// The data files, the feed parsers, the leader lines and the built page.
//
//   - all 30 teams appear exactly once across the two conferences (in
//     teams.json, in the standings and in the rendered tables);
//   - the frozen Vegas file: 30 teams, last-season wins sum to 1,230, lines
//     to 1,237;
//   - ESPN and cdn.nba.com parsers on small fixtures, payroll splits;
//   - leader-line wording, movers;
//   - the page: title, description, canonical and og:url on hoopsmatic.com,
//     the exact footer, no em dash in copy, nothing third-party loaded except
//     the nba-headshots logos, team links to Salary Season Finder team pages;
//   - sitemap lastmod moves only when the page's content hash changes.
//
// Run: node test/data-and-page.test.mjs

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEspn, parseNbaSchedule, payrollByTeam, parseWL } from '../lib/sources.mjs';
import { buildRows, byConference, leaders, movers, moverText, joinAnd } from '../lib/model.mjs';
import { pageHtml, PAGE_URL, LOGO_BASE, SSF_TEAM_BASE, TITLE, DESCRIPTION } from '../lib/render.mjs';
import { checkLines, updateSitemap, fontsCss, renderPage, POSSIBLE_WINS } from '../scripts/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));

let failed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) { failed++; if (detail !== undefined) console.log('        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))); }
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const { teams } = await J('data/teams.json');
const lines = await J('data/vegas_lines_2026-27.json');
const payroll = await J('data/payroll_2026-27.json');
const MINUS = '−';

// ── 1. Teams ──
const abbrs = teams.map((t) => t.abbr);
ok('teams.json: 30 teams, 30 distinct abbreviations', teams.length === 30 && new Set(abbrs).size === 30);
ok('teams.json: 30 distinct NBA ids (1610612737..66)', new Set(teams.map((t) => t.nba_id)).size === 30 && teams.every((t) => t.nba_id >= 1610612737 && t.nba_id <= 1610612766));
const east = teams.filter((t) => t.conf === 'East'), west = teams.filter((t) => t.conf === 'West');
ok('teams.json: 15 East + 15 West, nothing else', east.length === 15 && west.length === 15);
ok('teams.json: every Salary Season Finder slug distinct', new Set(teams.map((t) => t.ssf_slug)).size === 30);
const espnAll = teams.flatMap((t) => t.espn);
ok('teams.json: no ESPN abbreviation maps to two teams', new Set(espnAll).size === espnAll.length);

// ── 2. Frozen Vegas lines ──
const lsum = Object.values(lines.teams).reduce((s, t) => s + t.line, 0);
const wsum = Object.values(lines.teams).reduce((s, t) => s + t.last_season_wins, 0);
ok('vegas: last-season wins sum to 1,230', wsum === 1230 && POSSIBLE_WINS === 1230, wsum);
ok('vegas: lines sum to 1,237', lsum === 1237, lsum);
ok('vegas: checkLines passes on the committed file', !throws(() => checkLines(lines, teams)));
const bad = JSON.parse(JSON.stringify(lines)); bad.teams.NYK.last_season_wins = 54;
ok('vegas: checkLines rejects a file that sums to 1,231', throws(() => checkLines(bad, teams)));
const missing = JSON.parse(JSON.stringify(lines)); delete missing.teams.SAC;
ok('vegas: checkLines rejects a file missing a team', throws(() => checkLines(missing, teams)));
ok('vegas: spot checks (Knicks 52.5/53, Pacers 44.5/19, Kings 20.5/22)',
  lines.teams.NYK.line === 52.5 && lines.teams.NYK.last_season_wins === 53 && lines.teams.IND.line === 44.5
  && lines.teams.IND.last_season_wins === 19 && lines.teams.SAC.line === 20.5 && lines.teams.SAC.last_season_wins === 22);
ok('vegas: as of 2026-10-17, Boyd’s Bets', lines.as_of === '2026-10-17' && /Boyd's Bets/.test(lines.source));

// ── 3. ESPN parser ──
const espnEntry = (abbr, w, l, pf, pa, home, road) => ({
  team: { abbreviation: abbr, displayName: abbr },
  stats: [
    { name: 'wins', value: w }, { name: 'losses', value: l },
    { name: 'pointsFor', value: pf }, { name: 'pointsAgainst', value: pa },
    { name: 'avgPointsFor', value: pf / Math.max(1, w + l) },
    { name: 'Home', type: 'home', summary: home }, { name: 'Road', type: 'road', summary: road },
  ],
});
const espn = {
  children: [
    { name: 'Eastern Conference', standings: { season: 2027, entries: [espnEntry('NY', 2, 0, 230, 210, '1-0', '1-0'), espnEntry('BKN', 0, 2, 200, 225, '0-1', '0-1')] } },
    { name: 'Western Conference', standings: { season: 2027, entries: [espnEntry('GS', 1, 1, 220, 221, '1-0', '0-1'), espnEntry('UTAH', 1, 1, 225, 224, '0-1', '1-0')] } },
  ],
};
const pe = parseEspn(espn, teams, { season: 2027 });
ok('ESPN: NY -> NYK 2-0, PF 230, PA 210, home 1-0, road 1-0', JSON.stringify(pe.teams.NYK) === JSON.stringify({ w: 2, l: 0, gp: 2, pf: 230, pa: 210, home_w: 1, home_l: 0, road_w: 1, road_l: 0 }), pe.teams.NYK);
ok('ESPN: GS -> GSW, UTAH -> UTA', pe.teams.GSW.w === 1 && pe.teams.UTA.road_w === 1);
ok('ESPN: all 30 teams present, unlisted ones 0-0', Object.keys(pe.teams).length === 30 && pe.teams.LAL.gp === 0 && pe.listed === 4);
ok('ESPN: wrong season is rejected', throws(() => parseEspn(espn, teams, { season: 2026 })));
const unknown = JSON.parse(JSON.stringify(espn)); unknown.children[0].standings.entries[0].team = { abbreviation: 'SEA', displayName: 'Seattle' };
ok('ESPN: unknown team is rejected', throws(() => parseEspn(unknown, teams, {})));
const avgOnly = JSON.parse(JSON.stringify(espn));
for (const c of avgOnly.children) for (const e of c.standings.entries) e.stats = e.stats.filter((s) => s.name !== 'pointsFor');
ok('ESPN: totals rebuilt from averages when pointsFor is absent', parseEspn(avgOnly, teams, {}).teams.NYK.pf === 230);
ok('parseWL: "12-8" and "12-8-0"', JSON.stringify(parseWL('12-8')) === '[12,8]' && JSON.stringify(parseWL('12-8-0')) === '[12,8]' && parseWL('') === null);

// ── 4. cdn.nba.com schedule parser ──
const g = (id, status, home, hs, away, as) => ({ gameId: id, gameStatus: status, homeTeam: { teamId: home, score: hs }, awayTeam: { teamId: away, score: as } });
const sched = { leagueSchedule: { seasonYear: '2026-27', gameDates: [{ games: [
  g('0022600001', 3, 1610612752, 110, 1610612738, 100),   // NYK beat BOS at home
  g('0022600002', 3, 1610612747, 99, 1610612744, 101),    // GSW won at LAL
  g('0022600003', 1, 1610612748, 0, 1610612753, 0),       // not played yet
  g('0062600001', 3, 1610612752, 120, 1610612747, 110),   // NBA Cup final: not in the standings
  g('0012600001', 3, 1610612752, 120, 1610612747, 110),   // preseason
] }] } };
const ps = parseNbaSchedule(sched, teams, { seasonYear: '2026-27' });
ok('schedule: NYK 1-0 home, PF 110 PA 100', ps.teams.NYK.w === 1 && ps.teams.NYK.home_w === 1 && ps.teams.NYK.pf === 110 && ps.teams.NYK.pa === 100 && ps.teams.NYK.gp === 1);
ok('schedule: BOS 0-1 road loss', ps.teams.BOS.l === 1 && ps.teams.BOS.road_l === 1);
ok('schedule: GSW road win, LAL home loss', ps.teams.GSW.road_w === 1 && ps.teams.LAL.home_l === 1);
ok('schedule: Cup final, preseason and unplayed games ignored', ps.teams.LAL.gp === 1 && ps.teams.MIA.gp === 0);
ok('schedule: wrong season rejected', throws(() => parseNbaSchedule(sched, teams, { seasonYear: '2027-28' })));

// ── 5. Payroll ──
const ssf = { seasons: [
  { player: 'A', season: '2026-27', team: 'MIA', salary: 10e6 },
  { player: 'B', season: '2026-27', team: 'MIL, POR', salary: 30e6, team_salaries: { MIL: 20e6, POR: 10e6 } },
  { player: 'C', season: '2025-26', team: 'MIA', salary: 99e6 },
  { player: 'D', season: '2026-27', team: 'MIA', salary: null },
] };
const pr = payrollByTeam(ssf, teams, '2026-27');
ok('payroll: only 2026-27 counted, split records by team_salaries', pr.payroll.MIA === 10e6 && pr.payroll.MIL === 20e6 && pr.payroll.POR === 10e6 && pr.records === 2, pr.payroll);
ok('payroll: committed file has all 30 teams above $100M', teams.every((t) => payroll.payroll[t.abbr] > 100e6), payroll.payroll);

// ── 6. Rows, conferences, leaders, movers ──
const mk = (w, l, pf, pa, hw, hl, rw, rl) => ({ w, l, gp: w + l, pf, pa, home_w: hw, home_l: hl, road_w: rw, road_l: rl });
const st = { teams: Object.fromEntries(teams.map((t) => [t.abbr, mk(0, 0, 0, 0, 0, 0, 0, 0)])) };
Object.assign(st.teams, {
  MIA: mk(14, 6, 2300, 2200, 8, 2, 6, 4), POR: mk(13, 7, 2280, 2240, 6, 4, 7, 3), LAL: mk(13, 7, 2250, 2250, 7, 3, 6, 4),
  IND: mk(0, 20, 2000, 2300, 0, 10, 0, 10), SAC: mk(2, 18, 2050, 2350, 1, 9, 1, 9),
});
const rows = buildRows(teams, st, lines, payroll);
const conf = byConference(rows);
const inTables = [...conf.East, ...conf.West].map((r) => r.abbr);
ok('conferences: all 30 teams exactly once across East and West', inTables.length === 30 && new Set(inTables).size === 30 && abbrs.every((a) => inTables.includes(a)));
ok('conferences: 15 each', conf.East.length === 15 && conf.West.length === 15);
ok('ranks: East #1 Miami, teams without games unranked and last', conf.East[0].abbr === 'MIA' && conf.East[0].rank === 1 && conf.East.at(-1).rank === null);
const L = leaders(rows);
const over = L.find((x) => x.label === 'Most overachieving').text;
ok('leaders: "Most overachieving" names the unit once, "A (x), B (y) and C (z)"', /^[A-Za-z .]+ \(\+\d+\.\d wins vs\. Vegas\), [A-Za-z .]+ \(\+\d+\.\d\) and [A-Za-z .]+ \(\+\d+\.\d\)$/.test(over), over);
// Portland 13 - 20*41.5/82 = +2.88, Miami 14 - 20*46.5/82 = +2.66, LA Lakers 13 - 20*45.5/82 = +1.90.
ok('leaders: exact sentence', over === 'Portland (+2.9 wins vs. Vegas), Miami (+2.7) and LA Lakers (+1.9)', over);
const under = L.find((x) => x.label === 'Most underachieving').text;
ok('leaders: underachieving lists only teams behind their line, most behind first, minus sign', under.startsWith('Indiana (' + MINUS) && !under.includes('(+'), under);
const best = L.find((x) => x.label === 'Best bang for the buck').text;
ok('leaders: bang for the buck in $xx.xxM, Indiana (0 wins) never listed', /^\w[\w .]* \(\$\d+\.\d\dM per win\)/.test(best) && !best.includes('Indiana') && !L.find((x) => x.label === 'Worst bang for the buck').text.includes('Indiana'), best);
ok('leaders: luckiest/unluckiest present', L.find((x) => x.label === 'Luckiest').text && L.find((x) => x.label === 'Unluckiest').text);
ok('leaders: no em dash in any line', L.every((x) => !String(x.text).includes('—')));
const preseason = leaders(buildRows(teams, { teams: Object.fromEntries(teams.map((t) => [t.abbr, mk(0, 0, 0, 0, 0, 0, 0, 0)])) }, lines, payroll));
ok('leaders: before any game every line is empty (no NaN, no fake leader)', preseason.every((x) => x.text === null));
ok('joinAnd: 1, 2 and 3 items', joinAnd(['A']) === 'A' && joinAnd(['A', 'B']) === 'A and B' && joinAnd(['A', 'B', 'C']) === 'A, B and C');
const prevSt = JSON.parse(JSON.stringify(st)); prevSt.teams.MIA = mk(13, 6, 2190, 2100, 8, 2, 5, 4); prevSt.teams.IND = mk(0, 19, 1900, 2190, 0, 9, 0, 10);
const mv = movers(rows, prevSt);
ok('movers: only teams that played since, biggest change first', mv.length === 2 && mv.map((m) => m.abbr).sort().join() === 'IND,MIA', mv);
const mia = mv.find((m) => m.abbr === 'MIA');
ok('movers: Miami won, +(1 - 46.5/82) vs. Vegas', Math.abs(mia.delta - (1 - 46.5 / 82)) < 1e-9 && moverText(mia).games === 'won' && moverText(mia).delta === '+0.4 vs. Vegas', moverText(mia));
ok('movers: no previous snapshot -> null', movers(rows, null) === null);

// ── 7. The built page ──
const page = await renderPage();
const sample = pageHtml({ rows, conferences: conf, lines, movers: mv, prevDate: '2026-11-30', updatedOn: '2026-12-01',
  styles: await readFile(join(root, 'src/styles.css'), 'utf8'), fontsCss: await fontsCss(), sortJs: await readFile(join(root, 'src/sort.js'), 'utf8') });
const committed = await readFile(join(root, 'index.html'), 'utf8');
ok('index.html is what the build produces from the committed data', committed === page, 'run: node scripts/build.mjs');
for (const [name, html] of [['committed page', page], ['mid-season sample', sample]]) {
  const count = (re) => (html.match(re) || []).length;
  ok(name + ': one canonical, https://hoopsmatic.com/standings', count(/<link rel="canonical"/g) === 1 && html.includes('<link rel="canonical" href="https://hoopsmatic.com/standings">'));
  ok(name + ': one og:url, https://hoopsmatic.com/standings', count(/property="og:url"/g) === 1 && html.includes('<meta property="og:url" content="https://hoopsmatic.com/standings">'));
  ok(name + ': no github.io canonical or og:url', !/rel="canonical" href="[^"]*github\.io|og:url" content="[^"]*github\.io/.test(html));
  ok(name + ': title and description', html.includes('<title>' + TITLE.replace(/&/g, '&amp;') + '</title>') && count(/<meta name="description"/g) === 1 && (html.split('</head>')[0].match(/<title>/g) || []).length === 1);
  ok(name + ': H1 "NBA Real Standings", no eyebrow before it', /<div class="hdr"><h1>NBA Real Standings<\/h1><\/div>/.test(html) && !/class="(?:brand|eyebrow|kicker)/.test(html));
  const foot = html.match(/<footer class="foot">([\s\S]*?)<\/footer>/);
  const footText = foot ? foot[1].replace(/<[^>]+>/g, '').split('\n').map((s) => s.trim()).filter(Boolean) : [];
  ok(name + ': footer is exactly the two lines', JSON.stringify(footText) === JSON.stringify(['Anything wrong? Email us at hoopshype@hoopshype.com', 'For business inquiries, contact us at ads@hoopshype.com']) && count(/<footer/g) === 1, footText);
  // Copy = the visible text outside table cells (where the dash is the
  // requested empty-value marker), styles and scripts.
  const copy = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<td\b[^>]*>[\s\S]*?<\/td>|<dd class="none">[\s\S]*?<\/dd>/g, '');
  ok(name + ': no em dash in copy', !copy.includes('—') && !copy.includes('&mdash;'), (copy.match(/.{30}—.{30}/) || [''])[0]);
  ok(name + ': no NaN, Infinity or undefined anywhere', !/\bNaN\b|Infinity|undefined/.test(html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '')));
  // Nothing third-party: no external script, stylesheet, font or frame. The
  // only external fetches are the nba-headshots logos.
  ok(name + ': no <script src>, <link rel=stylesheet>, <iframe>, @import', !/<script[^>]+src=|<link[^>]+stylesheet|<iframe|@import/i.test(html));
  ok(name + ': fonts inlined as data: URLs only', !/url\((?!data:)/.test(html));
  const srcs = [...html.matchAll(/\b(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  const fetched = [...html.matchAll(/<(?:img|image)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  ok(name + ': every image is an nba-headshots logo', fetched.length > 0 && fetched.every((u) => u.startsWith(LOGO_BASE) && /\/16106127\d\d\.svg$/.test(u)), fetched.filter((u) => !u.startsWith(LOGO_BASE)));
  ok(name + ': every link is hoopsmatic.com or mailto', srcs.filter((u) => !u.startsWith(LOGO_BASE)).every((u) => u.startsWith('https://hoopsmatic.com/')), srcs.filter((u) => !u.startsWith(LOGO_BASE) && !u.startsWith('https://hoopsmatic.com/')));
  const teamLinks = [...html.matchAll(/<a class="tm" href="([^"]+)"/g)].map((m) => m[1]);
  ok(name + ': 30 team links, each a Salary Season Finder team page', teamLinks.length === 30 && new Set(teamLinks).size === 30 && teamLinks.every((u) => /^https:\/\/hoopsmatic\.com\/salary-season-finder\/team\/[a-z0-9-]+\/$/.test(u)));
  ok(name + ': Lakers link -> /salary-season-finder/team/lakers/, Blazers -> trail-blazers', teamLinks.includes(SSF_TEAM_BASE + 'lakers/') && teamLinks.includes(SSF_TEAM_BASE + 'trail-blazers/'));
  const tables = [...html.matchAll(/<table class="lb"[\s\S]*?<\/table>/g)].map((m) => m[0]);
  ok(name + ': two tables, East then West', tables.length === 2 && tables[0].includes('Eastern Conference') && tables[1].includes('Western Conference') && html.indexOf('Eastern Conference</h2>') < html.indexOf('Western Conference</h2>'));
  const rowTeams = tables.flatMap((t) => [...t.matchAll(/<td class="c-team" data-v="([^"]+)"/g)].map((m) => m[1]));
  ok(name + ': all 30 teams exactly once across the two tables', rowTeams.length === 30 && new Set(rowTeams).size === 30);
  const heads = [...tables[0].matchAll(/<button type="button">([^<]+)</g)].map((m) => m[1]);
  ok(name + ': columns in order', JSON.stringify(heads) === JSON.stringify(['Rank', 'Team', 'W', 'L', 'Pct', 'vs. Vegas', 'vs. Last Year', '$ per Win', 'Pt Diff', 'Exp. W-L', 'Luck', 'Road W − Home L']), heads);
  ok(name + ': default sort is Pct descending', /data-k="pct"[^>]*aria-sort="descending"/.test(tables[0]) && tables.every((t) => (t.match(/aria-sort="descending"/g) || []).length === 1));
  ok(name + ': every column header is a button (tap to sort)', tables.every((t) => (t.match(/<th /g) || []).length === 12 && (t.match(/<button type="button">/g) || []).length === 12));
  ok(name + ': two scatter charts with .500 and league-average lines', (html.match(/<figure class="chart">/g) || []).length === 2 && (html.match(/>\.500</g) || []).length === 2 && (html.match(/>avg \$/g) || []).length === 2);
  ok(name + ': methodology names the frozen Oct 17 lines and 1,237 vs 1,230', html.includes('Oct 17, 2026') && html.includes('1,237') && html.includes('1,230'));
}
// Opening night: nobody has played. Built from a fixture, not the committed
// data, so this keeps testing the 0-0 case all season.
const zeroRows = buildRows(teams, { teams: Object.fromEntries(teams.map((t) => [t.abbr, mk(0, 0, 0, 0, 0, 0, 0, 0)])) }, lines, payroll);
const pre = pageHtml({ rows: zeroRows, conferences: byConference(zeroRows), lines, movers: null, prevDate: null, updatedOn: '2026-10-20',
  styles: '', fontsCss: '', sortJs: '' });
const preCells = [...pre.matchAll(/<td class="pct" data-v="([^"]*)">([^<]*)</g)];
ok('GP=0 page: every Pct cell is the dash, charts show the empty note, leaders say "After the first games."',
  preCells.length === 30 && preCells.every((m) => m[1] === '' && m[2] === '\u2014') && (pre.match(/Teams appear here after their first game\./g) || []).length === 2
  && (pre.match(/After the first games\./g) || []).length === 8);
ok('GP=0 page: no NaN, Infinity or undefined', !/\bNaN\b|Infinity|undefined/.test(pre));
ok('GP=0 page: all 30 teams once, unranked', (pre.match(/<td class="c-rank" data-v="">\u2014<\/td>/g) || []).length === 30);
ok('sample page: Miami row shows Pct 70.0%', /data-v="Miami"[\s\S]*?<td class="pct" data-v="0\.7">70\.0%<\/td>/.test(sample));
ok('sample page: Indiana $ per Win is the dash', /data-v="Indiana"[\s\S]*?<td data-v="" class="dash">—<\/td>/.test(sample));

// ── 8. Sitemap lastmod ──
const s1 = updateSitemap({}, [{ url: PAGE_URL, html: 'a' }], '2026-10-19');
const s2 = updateSitemap(s1.state, [{ url: PAGE_URL, html: 'a' }], '2026-10-20');
const s3 = updateSitemap(s2.state, [{ url: PAGE_URL, html: 'b' }], '2026-10-21');
ok('sitemap: first build dates the page today', s1.state.pages[PAGE_URL].lastmod === '2026-10-19');
ok('sitemap: same content next day keeps the date', s2.state.pages[PAGE_URL].lastmod === '2026-10-19' && s2.xml === s1.xml);
ok('sitemap: changed content moves the date', s3.state.pages[PAGE_URL].lastmod === '2026-10-21' && s3.xml.includes('<lastmod>2026-10-21</lastmod>'));
const sm = await readFile(join(root, 'sitemap.xml'), 'utf8');
const hashes = await J('data/page_hashes.json');
ok('sitemap.xml: one URL, https://hoopsmatic.com/standings, lastmod from page_hashes.json', (sm.match(/<loc>/g) || []).length === 1
  && sm.includes('<loc>https://hoopsmatic.com/standings</loc><lastmod>' + hashes.pages[PAGE_URL].lastmod + '</lastmod>'));
ok('page_hashes.json: hash matches the committed index.html', updateSitemap(hashes, [{ url: PAGE_URL, html: committed }], '2099-01-01').state.pages[PAGE_URL].lastmod === hashes.pages[PAGE_URL].lastmod);
ok('description is unique to this page and names the section', DESCRIPTION.includes('Vegas') && DESCRIPTION.length < 170);

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
