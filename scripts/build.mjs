// Builds index.html and sitemap.xml from the committed data.
//
// sitemap.xml lists every page of the section with a <lastmod> that moves
// only when the standings numbers change: data/page_hashes.json keeps a hash
// of them per URL, and a URL's date is bumped to today only when that hash
// differs from the stored one. The page's "Updated" time is not part of it.
// scripts/update.mjs calls build() only when the standings or payroll changed.
//
// Run: node scripts/build.mjs [--today YYYY-MM-DD]

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows, byConference, movers } from '../lib/model.mjs';
import { packTeams } from '../lib/timeframe.mjs';
import { PAGE_URL } from '../lib/render.mjs';
import { pageHtml } from '../lib/page.mjs';
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

export async function renderPage({ dataDir = DATA, srcRoot = root } = {}) {
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
  const data = {
    pageUrl: PAGE_URL,
    gameDate,
    teams: teams.map(({ abbr, nba_id, conf, short, name, ssf_slug }) => ({ abbr, nba_id, conf, short, name, ssf_slug })),
    lines: { teams: lines.teams },
    payroll: payroll ? { payroll: payroll.payroll } : null,
    current: packTeams(standings.teams, order),
    dates: snapshots.map((s) => s.date),
    snapshots: Object.fromEntries(snapshots.map((s) => [s.date, packTeams(s.teams, order)])),
  };
  return pageHtml({
    rows, conferences, lines,
    movers: movers(rows, prev),
    prevDate: prev ? prev.date : null,
    gameDate,
    updatedOn: standings.updated_on,
    updatedAt: standings.updated_at || null,
    dates: data.dates,
    dataJson: jsonForScript(data),
    bundleJs: await bundleLib(srcRoot),
    viewsJs: await readFile(join(srcRoot, 'src/views.js'), 'utf8'),
    styles: await readFile(join(srcRoot, 'src/styles.css'), 'utf8'),
    fontsCss: await fontsCss(),
    sortJs: await readFile(join(srcRoot, 'src/sort.js'), 'utf8'),
  });
}

export const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// What a page's lastmod follows: the standings numbers and nothing else, so
// a rebuild that only moves the "Updated" time (or the template) never
// moves it.
export const standingsKey = (standings) => JSON.stringify(standings.teams);

// pages: [{ url, key }]. Returns the new state and the sitemap text.
export function updateSitemap(state, pages, today) {
  const next = { _readme: 'Hash of the standings numbers and lastmod per sitemap URL. A lastmod moves only when the standings numbers change, never for the "Updated" time alone. Written by scripts/build.mjs.', pages: {} };
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

// Writes index.html, sitemap.xml and data/page_hashes.json.
export async function build({ today = etDate(), dataDir = DATA, outDir = root, srcRoot = root } = {}) {
  const html = await renderPage({ dataDir, srcRoot });
  await writeFile(join(outDir, 'index.html'), html);
  const statePath = join(dataDir, 'page_hashes.json');
  const standings = await readJson(join(dataDir, 'standings.json'));
  const { state, xml } = updateSitemap(await readJson(statePath, {}), [{ url: PAGE_URL, key: standingsKey(standings) }], today);
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
  await writeFile(join(outDir, 'sitemap.xml'), xml);
  return { html, lastmod: state.pages[PAGE_URL].lastmod };
}

async function main() {
  const i = process.argv.indexOf('--today');
  const { html, lastmod } = await build(i > 0 ? { today: process.argv[i + 1] } : {});
  console.log('built index.html (' + html.length + ' bytes), sitemap lastmod ' + lastmod);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
