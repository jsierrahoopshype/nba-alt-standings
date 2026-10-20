// Nightly fetch. Writes, each only when its content changed:
//   data/standings.json          records, points for/against, home/road W-L
//   data/payroll_2026-27.json    payroll per team from Salary Season Finder
//   data/history/<date>.json     a snapshot of the standings, the day they changed
//
// Standings come from ESPN's public feed; if that fails from wherever this
// runs (or answers for the wrong season, or with the wrong teams), the
// standings are rebuilt from cdn.nba.com's season schedule instead.
// stats.nba.com is never used: it blocks cloud servers. Every request goes
// through lib/http.mjs (browser-like headers, 30s, one retry), the same code
// scripts/probe.mjs uses.
//
// IF EVERY STANDINGS SOURCE FAILS, nothing is written: the committed data and
// page stay as they are, and the process exits 1 so the run fails and GitHub
// sends its failure email.
//
// Run: node scripts/fetch.mjs [--today YYYY-MM-DD]

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEspn, parseNbaSchedule, payrollByTeam } from '../lib/sources.mjs';
import { getJson } from '../lib/http.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA = join(root, 'data');
const SEASON = '2026-27';
const ESPN_SEASON = 2027;               // ESPN names a season by the year it ends
const NBA_SEASON_YEAR = '2026-27';

export const ESPN_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=' + ESPN_SEASON + '&seasontype=2';
export const NBA_SCHEDULE_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
export const SSF_DATA_URL = 'https://jsierrahoopshype.github.io/salary-season-finder/data/data.json';

// Today in New York: the run after a night of games is dated the next morning.
export function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const readJson = async (p, fallback = null) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
};
const stable = (o) => JSON.stringify(o, null, 2) + '\n';

async function writeIfChanged(path, obj, same) {
  const old = await readJson(path);
  if (old && same(old, obj)) return false;
  await writeFile(path, stable(obj));
  return true;
}

// The standings sources in the order they are tried. Each fetches and
// parses, so a source that answers with the wrong season or teams fails
// here too. scripts/probe.mjs runs these same functions.
export const SOURCES = [
  { name: 'ESPN', fetch: async (teams) => {
    const parsed = parseEspn(await getJson(ESPN_URL), teams, { season: ESPN_SEASON });
    if (parsed.listed < 30) throw new Error('ESPN listed ' + parsed.listed + ' teams');
    return parsed;
  } },
  { name: 'cdn.nba.com', fetch: async (teams) => parseNbaSchedule(await getJson(NBA_SCHEDULE_URL), teams, { seasonYear: NBA_SEASON_YEAR }) },
];

export async function standings(teams) {
  const errors = [];
  for (const src of SOURCES) {
    try {
      const parsed = await src.fetch(teams);
      console.log('standings: ' + src.name + ' ok (' + parsed.listed + ' teams listed)');
      return parsed;
    } catch (e) {
      errors.push(src.name + ': ' + e.message);
      console.log('standings: ' + src.name + ' failed: ' + e.message);
    }
  }
  throw new Error('no standings source worked:\n  ' + errors.join('\n  '));
}

export async function run({ today = etDate(), dataDir = DEFAULT_DATA } = {}) {
  const DATA = dataDir;
  const { teams } = await readJson(join(DATA, 'teams.json'));

  // ── Standings ──
  const st = await standings(teams);
  const stPath = join(DATA, 'standings.json');
  const prev = await readJson(stPath);
  const sameTeams = (a, b) => JSON.stringify(a.teams) === JSON.stringify(b.teams);
  const next = {
    season: SEASON,
    source: st.source,
    // The date of the last successful fetch, which the page shows as
    // "Updated": a night with no games still moves it.
    updated_on: today,
    teams: st.teams,
  };
  const stChanged = await writeIfChanged(stPath, next, (a, b) => sameTeams(a, b) && a.source === b.source && a.updated_on === b.updated_on);
  console.log('standings.json ' + (stChanged ? 'updated' : 'unchanged') + ' (source ' + st.source + ')' + (prev && sameTeams(prev, st) ? ', same records as before' : ''));

  // ── History: one snapshot per day the standings changed ──
  const hist = join(DATA, 'history');
  await mkdir(hist, { recursive: true });
  const files = (await readdir(hist)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const latest = files.length ? await readJson(join(hist, files[files.length - 1])) : null;
  if (!latest || !sameTeams(latest, st)) {
    await writeFile(join(hist, today + '.json'), stable({ date: today, source: st.source, teams: st.teams }));
    console.log('history/' + today + '.json written');
  }

  // ── Payroll ──
  try {
    const ssf = await getJson(SSF_DATA_URL);
    const pr = payrollByTeam(ssf, teams, SEASON);
    for (const w of pr.warnings) console.log('payroll warning: ' + w);
    const missing = Object.entries(pr.payroll).filter(([, v]) => !(v > 0)).map(([k]) => k);
    if (missing.length) throw new Error('no payroll for ' + missing.join(','));
    const out = { season: SEASON, source: SSF_DATA_URL, ssf_built: ssf.meta?.built ?? null, records: pr.records, payroll: pr.payroll };
    const changed = await writeIfChanged(join(DATA, 'payroll_' + SEASON + '.json'), out,
      (a, b) => JSON.stringify(a.payroll) === JSON.stringify(b.payroll));
    console.log('payroll ' + (changed ? 'updated' : 'unchanged'));
  } catch (e) {
    // Keep yesterday's payroll rather than failing the whole run.
    console.log('payroll: kept the committed file: ' + e.message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--today');
  run(i > 0 ? { today: process.argv[i + 1] } : {}).catch((e) => { console.error(e.message); process.exit(1); });
}
