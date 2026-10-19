// Builds index.html and sitemap.xml from the committed data.
//
// sitemap.xml lists every page of the section with a <lastmod> that moves
// only when that page's content changes: data/page_hashes.json keeps a
// content hash per URL, and a URL's date is bumped to today only when its
// hash differs from the stored one. The page carries no build time of its
// own, so an unchanged night produces byte-identical output.
//
// Run: node scripts/build.mjs [--today YYYY-MM-DD]

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows, byConference, movers } from '../lib/model.mjs';
import { pageHtml, PAGE_URL } from '../lib/render.mjs';
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

export async function previousSnapshot(updatedOn) {
  const hist = join(DATA, 'history');
  let files = [];
  try { files = (await readdir(hist)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort(); } catch { /* none yet */ }
  const before = files.filter((f) => f.slice(0, 10) < updatedOn);
  if (!before.length) return null;
  return readJson(join(hist, before[before.length - 1]));
}

export async function renderPage() {
  const { teams } = await readJson(join(DATA, 'teams.json'));
  const lines = await readJson(join(DATA, 'vegas_lines_2026-27.json'));
  checkLines(lines, teams);
  const standings = await readJson(join(DATA, 'standings.json'));
  const payroll = await readJson(join(DATA, 'payroll_' + SEASON + '.json'), null);
  const rows = buildRows(teams, standings, lines, payroll);
  const conferences = byConference(rows);
  const prev = await previousSnapshot(standings.updated_on);
  return pageHtml({
    rows, conferences, lines,
    movers: movers(rows, prev),
    prevDate: prev ? prev.date : null,
    updatedOn: standings.updated_on,
    styles: await readFile(join(root, 'src/styles.css'), 'utf8'),
    fontsCss: await fontsCss(),
    sortJs: await readFile(join(root, 'src/sort.js'), 'utf8'),
  });
}

export const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// pages: [{ url, html }]. Returns the new state and the sitemap text.
export function updateSitemap(state, pages, today) {
  const next = { _readme: state._readme || 'Content hash and lastmod per sitemap URL. A lastmod moves only when that page’s hash changes. Written by scripts/build.mjs.', pages: {} };
  for (const p of pages) {
    const h = hash(p.html);
    const old = state.pages ? state.pages[p.url] : null;
    next.pages[p.url] = old && old.hash === h ? old : { hash: h, lastmod: today };
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + pages.map((p) => `  <url><loc>${p.url}</loc><lastmod>${next.pages[p.url].lastmod}</lastmod></url>`).join('\n')
    + '\n</urlset>\n';
  return { state: next, xml };
}

async function main() {
  const i = process.argv.indexOf('--today');
  const today = i > 0 ? process.argv[i + 1] : etDate();
  const html = await renderPage();
  await writeFile(join(root, 'index.html'), html);
  const statePath = join(DATA, 'page_hashes.json');
  const { state, xml } = updateSitemap(await readJson(statePath, {}), [{ url: PAGE_URL, html }], today);
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
  await writeFile(join(root, 'sitemap.xml'), xml);
  console.log('built index.html (' + html.length + ' bytes), sitemap lastmod ' + state.pages[PAGE_URL].lastmod);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
