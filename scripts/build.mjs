// Builds the section from the committed data: index.html (/standings), one
// page per team (<slug>/index.html, served at /standings/<slug>), the saved
// nights for the date views (data/nights.json) and sitemap.xml.
//
// sitemap.xml lists every page with a <lastmod> that moves only when that
// page's numbers change: /standings follows every team's, a team page only
// its own. data/page_hashes.json keeps a hash of them per URL, and a URL's
// date is bumped to today only when that hash differs from the stored one.
// The "Updated" time is not part of it. scripts/update.mjs calls build()
// only when some file was written.
//
// Run: node scripts/build.mjs [--today YYYY-MM-DD]

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows, byConference, movers } from '../lib/model.mjs';
import { packTeams } from '../lib/timeframe.mjs';
import { PAGE_URL } from '../lib/render.mjs';
import { pageHtml } from '../lib/page.mjs';
import { rankedRows, teamSeries, teamGames, nextGame, teamPageHtml, teamPageUrl } from '../lib/team.mjs';
import { readGameLog } from './gamelog.mjs';
import { etDate } from './fetch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(root, 'data');
const SEASON = '2026-27';
export const POSSIBLE_WINS = 30 * 82 / 2;

const readJson = async (p, fallback) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
};

// The frozen lines file must be complete and its last-season wins must add
// up to exactly the wins an 82-game season hands out.
export function checkLines(lines, teams) {
  const abbrs = teams.map((t) => t.abbr).sort();
  const keys = Object.keys(lines.teams).sort();
  if (JSON.stringify(abbrs) !== JSON.stringify(keys)) throw new Error('Vegas lines: teams do not match teams.json');
  const sum = keys.reduce((s, k) => s + lines.teams[k].last_season_wins, 0);
  if (sum !== POSSIBLE_WINS) throw new Error('Vegas lines: last-season wins sum to ' + sum + ', not ' + POSSIBLE_WINS);
  return sum;
}

export async function fontsCss() {
  const face = async (family, file) => {
    const b64 = (await readFile(join(root, 'fonts', file))).toString('base64');
    // One variable font file per family covers every weight used.
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  };
  return '/* DM Sans and JetBrains Mono, latin subset, SIL Open Font License 1.1 (fonts/OFL-*.txt). */\n'
    + (await face('DM Sans', 'dm-sans-latin.woff2')) + '\n' + (await face('JetBrains Mono', 'jetbrains-mono-latin.woff2'));
}

// The saved nights, oldest first: [{ date, teams }].
export async function readSnapshots(dataDir = DATA) {
  const hist = join(dataDir, 'history');
  let files = [];
  try { files = (await readdir(hist)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort(); } catch { /* none yet */ }
  const out = [];
  for (const f of files) out.push(await readJson(join(hist, f)));
  return out;
}

// ── The page script's copy of lib/ ──
// metrics, timeframe, model and render are plain ES modules with no Node
// imports, so the page gets them as one script: import lines and the export
// keyword dropped, wrapped in a function, and the names the page script
// (src/views.js) calls exposed on window.HM. test/phase1.test.mjs runs this
// bundle and checks it renders exactly what the modules render.
export const BUNDLE_FILES = ['lib/metrics.mjs', 'lib/timeframe.mjs', 'lib/model.mjs', 'lib/render.mjs'];
export const BUNDLE_EXPORTS = ['unpackTeams', 'resolveTimeframe', 'standingsFor', 'timeframeLabel', 'timeframeParts', 'fmtDay'];
export async function bundleLib(srcRoot = root) {
  const parts = [];
  for (const f of BUNDLE_FILES) {
    const src = await readFile(join(srcRoot, f), 'utf8');
    parts.push('// ── ' + f + ' ──\n' + src
      .replace(/^import [^;]+;\n/gm, '')
      .replace(/^export \{[^}]*\};\n/gm, '')
      .replace(/^export (?=const |function |async function |let )/gm, ''));
  }
  // "</script" written as "<\/script" (the same characters inside a JS
  // string or template), so nothing in the code can end the inline script.
  // Only that sequence: a blanket "</" swap would break a regex like /</g.
  return ('(function () {\n' + parts.join('\n') + '\nwindow.HM = { ' + BUNDLE_EXPORTS.join(', ') + ' };\n})();').replace(/<\/script/gi, '<\\/script');
}

// `<` written as <, so nothing in the data can close the script tag.
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// The saved nights for the date views, in the page script's compact form.
// Written to data/nights.json and fetched only when a reader picks As of,
// Since or a preset; the page carries only its version (a hash of the
// file), which the script adds to the URL so a new file is never served
// from an old cache.
export function nightsJson(snapshots, order) {
  return JSON.stringify({ order, dates: snapshots.map((s) => s.date), snapshots: Object.fromEntries(snapshots.map((s) => [s.date, packTeams(s.teams, order)])) });
}

async function readPregames(dataDir) {
  const root = join(dataDir, 'pregame');
  const out = [];
  let dates = [];
  try { dates = (await readdir(root)).sort(); } catch { return out; }
  for (const d of dates) for (const f of (await readdir(join(root, d))).sort()) if (f.endsWith('.json')) out.push(await readJson(join(root, d, f)));
  return out;
}

// Everything the build writes, as strings: index.html, data/nights.json and
// one page per team ({ slug, html, key }), plus the sitemap key of each URL.
export async function renderAll({ dataDir = DATA, srcRoot = root } = {}) {
  const { teams } = await readJson(join(dataDir, 'teams.json'));
  const lines = await readJson(join(dataDir, 'vegas_lines_2026-27.json'));
  checkLines(lines, teams);
  const standings = await readJson(join(dataDir, 'standings.json'));
  const payroll = await readJson(join(dataDir, 'payroll_' + SEASON + '.json'), null);
  const rows = buildRows(teams, standings, lines, payroll);
  const conferences = byConference(rows);
  const snapshots = await readSnapshots(dataDir);
  // Movers: now against the last saved night before the latest night with
  // games (game_date), so a night in progress is compared with the one before.
  const gameDate = standings.game_date || null;
  const before = gameDate ? snapshots.filter((s) => s.date < gameDate) : [];
  const prev = before.length ? before[before.length - 1] : null;
  const order = teams.map((t) => t.abbr);
  const nights = nightsJson(snapshots, order);
  const styles = await readFile(join(srcRoot, 'src/styles.css'), 'utf8');
  const fonts = await fontsCss();
  const data = {
    pageUrl: PAGE_URL,
    gameDate,
    teams: teams.map(({ abbr, nba_id, conf, short, name, ssf_slug }) => ({ abbr, nba_id, conf, short, name, ssf_slug })),
    lines: { teams: lines.teams },
    payroll: payroll ? { payroll: payroll.payroll } : null,
    current: packTeams(standings.teams, order),
    nightsPath: 'data/nights.json',
    nightsVersion: hash(nights),
  };
  const index = pageHtml({
    rows, conferences, lines,
    movers: movers(rows, prev),
    prevDate: prev ? prev.date : null,
    gameDate,
    updatedOn: standings.updated_on,
    updatedAt: standings.updated_at || null,
    dates: snapshots.map((s) => s.date),
    dataJson: jsonForScript(data),
    bundleJs: await bundleLib(srcRoot),
    viewsJs: await readFile(join(srcRoot, 'src/views.js'), 'utf8'),
    styles, fontsCss: fonts,
    sortJs: await readFile(join(srcRoot, 'src/sort.js'), 'utf8'),
  });

  // ── Team pages ──
  const pay = payroll ? { payroll: payroll.payroll } : null;
  const now = rankedRows(teams, standings.teams, lines, pay);
  const base = prev ? rankedRows(teams, prev.teams, lines, pay) : null;
  const nightRows = snapshots.map((sn) => ({ date: sn.date, rows: rankedRows(teams, sn.teams, lines, pay) }));
  const log = await readGameLog(dataDir);
  const pregames = await readPregames(dataDir);
  const byAbbr = Object.fromEntries(teams.map((t) => [t.abbr, t]));
  const teamPages = teams.map((t) => ({
    slug: t.ssf_slug,
    url: teamPageUrl(t),
    key: JSON.stringify(standings.teams[t.abbr]),
    html: teamPageHtml({
      team: t, row: now[t.abbr], base: base ? base[t.abbr] : null, baseDate: prev ? prev.date : null,
      series: teamSeries(t.abbr, nightRows), games: teamGames(t.abbr, log), next: nextGame(t.abbr, pregames, log, gameDate),
      peers: teams.filter((p) => p.conf === t.conf && p.abbr !== t.abbr), byAbbr,
      line: lines.teams[t.abbr].line, last: lines.teams[t.abbr].last_season_wins, styles, fontsCss: fonts,
    }),
  }));
  return { index, nights, teamPages, standings };
}

export async function renderPage(opts = {}) {
  return (await renderAll(opts)).index;
}

export const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// What a page's lastmod follows: the standings numbers and nothing else, so
// a rebuild that only moves the "Updated" time (or the template) never
// moves it. /standings follows every team's numbers, a team page its own.
export const standingsKey = (standings) => JSON.stringify(standings.teams);

// pages: [{ url, key }]. Returns the new state and the sitemap text.
export function updateSitemap(state, pages, today) {
  const next = { _readme: 'Hash of the standings numbers and lastmod per sitemap URL: /standings follows every team, a team page only its own team. A lastmod moves only when those numbers change, never for the "Updated" time alone. Written by scripts/build.mjs.', pages: {} };
  for (const p of pages) {
    const h = hash(p.key);
    const old = state.pages ? state.pages[p.url] : null;
    next.pages[p.url] = old && old.hash === h ? old : { hash: h, lastmod: today };
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + pages.map((p) => `  <url><loc>${p.url}</loc><lastmod>${next.pages[p.url].lastmod}</lastmod></url>`).join('\n')
    + '\n</urlset>\n';
  return { state: next, xml };
}

// Writes index.html, <slug>/index.html for every team, data/nights.json,
// sitemap.xml and data/page_hashes.json. A file whose content did not
// change is left as it is.
export async function build({ today = etDate(), dataDir = DATA, outDir = root, srcRoot = root } = {}) {
  const all = await renderAll({ dataDir, srcRoot });
  const put = async (path, text) => {
    let old = null;
    try { old = await readFile(path, 'utf8'); } catch { /* new */ }
    if (old !== text) await writeFile(path, text);
  };
  await put(join(outDir, 'index.html'), all.index);
  await put(join(dataDir, 'nights.json'), all.nights + '\n');
  for (const tp of all.teamPages) {
    await mkdir(join(outDir, tp.slug), { recursive: true });
    await put(join(outDir, tp.slug, 'index.html'), tp.html);
  }
  const statePath = join(dataDir, 'page_hashes.json');
  const pages = [{ url: PAGE_URL, key: standingsKey(all.standings) }, ...all.teamPages.map((tp) => ({ url: tp.url, key: tp.key }))];
  const { state, xml } = updateSitemap(await readJson(statePath, {}), pages, today);
  await put(statePath, JSON.stringify(state, null, 2) + '\n');
  await put(join(outDir, 'sitemap.xml'), xml);
  return { html: all.index, lastmod: state.pages[PAGE_URL].lastmod, teams: all.teamPages.length };
}

async function main() {
  const i = process.argv.indexOf('--today');
  const { html, lastmod, teams } = await build(i > 0 ? { today: process.argv[i + 1] } : {});
  console.log('built index.html (' + html.length + ' bytes) and ' + teams + ' team pages, /standings lastmod ' + lastmod);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
