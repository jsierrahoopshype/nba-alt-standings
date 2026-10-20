// One update run. The workflow calls it every 30 minutes through the game
// window, once a day as a safety net (--force) and on "Run workflow" (--force).
//
//   1. Scoreboards for yesterday and today (ET).
//   2. Pregame archive: every game not yet started gets data/pregame/<date>/
//      <AWAY>@<HOME>.json, written once and never edited (flag 'wx').
//      Game log: every final gets data/games/<date>/<AWAY>@<HOME>.json, a
//      later score correction a new .cN entry (scripts/gamelog.mjs). Dates
//      counted in data/finals.json with no log entry are fetched and logged.
//   3. If no regular-season game has gone final since the last committed
//      update (data/finals.json), stop: nothing else is written. --force
//      skips this check; so does a run whose scoreboards all failed.
//   4. Standings. A new final counts once the standings reflect it (both
//      teams have played as many games as the scoreboard's record says); a
//      final the feed has not caught up with is left for the next run.
//   5. Snapshots: data/history/<date>.json (standings and that night's
//      payroll) for a game date whose games are all final and counted,
//      rewritten while it changes, and never again once a game of a later
//      date has started. No games, no snapshot.
//   Schedule: the full regular-season schedule (cdn.nba.com) is cached in
//      data/schedule_2026-27.json, refreshed with --schedule (the 10:23 UTC
//      run) or when there is no cached copy; a failed fetch keeps the cache.
//   6. Payroll, then the pages (/standings, the 30 team pages, the saved
//      nights file) and the sitemap, only when some file was written. The
//      "Updated" time (standings.updated_at) moves only when the standings
//      numbers or the payroll changed.
//
// If every standings source fails, the run throws: nothing past the
// pregame archive is written and the workflow step fails (failure email).
//
// Run: node scripts/update.mjs [--force] [--schedule]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { etDate, standings, scoreboards, payroll, seasonSchedule, SEASON } from './fetch.mjs';
import { standingsReflect } from '../lib/scoreboard.mjs';
import { addDays } from '../lib/timeframe.mjs';
import { build } from './build.mjs';
import { logFinal, readGameLog, missingLogDates } from './gamelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA = join(root, 'data');

const readJson = async (p, fallback = null) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
};
const stable = (o) => JSON.stringify(o, null, 2) + '\n';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Writes a pregame entry unless one exists: 'wx' fails on an existing file,
// so an archived entry is never edited, whatever the caller does.
export async function archivePregame(dataDir, entry) {
  const dir = join(dataDir, 'pregame', entry.date);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, entry.key.slice(11) + '.json'), stable(entry), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

export async function run({ dataDir = DEFAULT_DATA, outDir = root, now = new Date(), force = false, refreshSchedule = false } = {}) {
  const today = etDate(now);
  const dates = [addDays(today, -1), today];
  const { teams } = await readJson(join(dataDir, 'teams.json'));
  const prev = await readJson(join(dataDir, 'standings.json'));
  const finalsPath = join(dataDir, 'finals.json');
  const finals = await readJson(finalsPath, { dates: {} });
  const result = { pregame: 0, logged: 0, corrections: 0, newFinals: 0, counted: 0, standingsChanged: false, payrollChanged: false, scheduleChanged: false, snapshots: [], built: false };

  // ── 0. Schedule: once a day, or when there is no cached copy ──
  const schedPath = join(dataDir, 'schedule_' + SEASON + '.json');
  const cached = await readJson(schedPath);
  if (refreshSchedule || !cached) {
    try {
      const sched = await seasonSchedule(teams);
      if (!cached || !same(cached.games, sched.games)) {
        await writeFile(schedPath, stable({ _readme: 'The 2026-27 regular-season schedule from cdn.nba.com (scheduleLeagueV2), for each team page\'s next game. Refreshed by scripts/update.mjs on the 10:23 UTC run; a failed fetch keeps this copy.', ...sched }));
        result.scheduleChanged = true;
      }
      console.log('schedule: ' + sched.games.length + ' games, ' + (result.scheduleChanged ? 'updated' : 'unchanged'));
    } catch (e) {
      console.log('schedule: kept the cached copy: ' + e.message);
    }
  }

  // ── 1. Scoreboards ──
  let sb = null;
  try { sb = await scoreboards(teams, dates); } catch (e) { console.log(e.message + '\n(falling back to comparing the standings)'); }

  // ── 2. Pregame archive ──
  if (sb) {
    for (const g of sb.games.filter((x) => x.state === 'pre')) {
      // A feed without records: the committed standings are the record now.
      const rec = (side) => (side.w !== null ? { abbr: side.abbr, w: side.w, l: side.l, record_source: sb.source }
        : { abbr: side.abbr, w: prev.teams[side.abbr].w, l: prev.teams[side.abbr].l, record_source: 'standings.json' });
      const wrote = await archivePregame(dataDir, { key: g.key, game_id: g.id, id_source: g.id_source, date: g.date, tip: g.tip,
        saved_at: now.toISOString(), away: rec(g.away), home: rec(g.home) });
      if (wrote) result.pregame++;
    }
    if (result.pregame) console.log('pregame: archived ' + result.pregame + ' game(s)');
    await logGames(sb.games);
  }
  // Dates already counted but missing from the game log (at most 10 a run).
  const missing = missingLogDates(finals, await readGameLog(dataDir)).filter((d) => !dates.includes(d)).slice(0, 10);
  if (missing.length) {
    try { await logGames((await scoreboards(teams, missing)).games); } catch (e) { console.log('game log backfill: ' + e.message); }
  }
  // Anything written so far (or a forced run, which rebuilds so each team
  // page's next game moves on with the calendar) means a rebuild.
  const wroteLogs = () => result.pregame + result.logged + result.corrections > 0 || result.scheduleChanged || force;

  // ── 3. Anything new? ──
  const counted = new Set(Object.values(finals.dates).flat());
  const newFinals = sb ? sb.games.filter((g) => g.final && !counted.has(g.key)) : [];
  result.newFinals = newFinals.length;
  if (sb && !newFinals.length && !force) {
    console.log('no game has gone final since the last update');
    await snapshots(dataDir, sb, finals, prev, result);
    if (result.snapshots.length || wroteLogs()) await rebuild();
    return result;
  }

  // ── 4. Standings ──
  const st = await standings(teams);                       // throws when every source fails
  const reflected = newFinals.filter((g) => standingsReflect(g, st.teams));
  const lagging = newFinals.filter((g) => !reflected.includes(g));
  if (lagging.length) console.log('standings do not count yet: ' + lagging.map((g) => g.key).join(', ') + ' (next run)');
  for (const g of reflected) (finals.dates[g.date] = finals.dates[g.date] || []).push(g.key);
  for (const d of Object.keys(finals.dates)) finals.dates[d].sort();
  result.counted = reflected.length;
  // Without a scoreboard, or with every new final still lagging, only a
  // change in the numbers themselves is taken (a forced run takes it too).
  const numbersChanged = !same(st.teams, prev.teams);
  const take = numbersChanged && (force || !sb || reflected.length > 0);
  const gameDates = reflected.map((g) => g.date).concat(prev.game_date ? [prev.game_date] : []).sort();
  let current = { ...prev };                               // a copy: compared with prev below
  if (take || reflected.length) {
    current = {
      season: SEASON,
      source: take ? st.source : prev.source,
      updated_on: prev.updated_on,
      updated_at: prev.updated_at || null,
      game_date: gameDates.length ? gameDates[gameDates.length - 1] : null,
      teams: take ? st.teams : prev.teams,
    };
  }
  if (reflected.length) await writeFile(finalsPath, stable({ _readme: finals._readme || 'Regular-season finals already counted in standings.json, by ET game date. Written by scripts/update.mjs.', dates: finals.dates }));
  result.standingsChanged = take;

  // ── 6a. Payroll: with new numbers, or on a forced run ──
  if (take || force) {
    const pr = await payroll(teams);
    const prPath = join(dataDir, 'payroll_' + SEASON + '.json');
    const old = await readJson(prPath);
    if (pr && !(old && same(old.payroll, pr.payroll))) {
      await writeFile(prPath, stable(pr));
      result.payrollChanged = true;
    }
  }
  if (take || result.payrollChanged) {
    current.updated_at = now.toISOString();
    current.updated_on = today;
  }
  if (!same(current, prev)) await writeFile(join(dataDir, 'standings.json'), stable(current));
  console.log('standings ' + (take ? 'updated (' + st.source + ')' : 'unchanged') + ', payroll ' + (result.payrollChanged ? 'updated' : 'unchanged'));

  // ── 5. Snapshots ──
  if (sb) await snapshots(dataDir, sb, finals, current, result);

  if (take || result.payrollChanged || result.snapshots.length || wroteLogs()) await rebuild();
  return result;

  async function logGames(games) {
    for (const g of games) {
      const r = await logFinal(dataDir, g, now.toISOString());
      if (r === 'new') result.logged++;
      if (r === 'correction') { result.corrections++; console.log('game log: score correction for ' + g.key); }
    }
    if (result.logged) console.log('game log: ' + result.logged + ' final(s) logged');
  }

  async function rebuild() {
    await build({ today, dataDir, outDir });
    result.built = true;
    console.log('pages and sitemap rebuilt');
  }
}

async function snapshots(dataDir, sb, finals, current, result) {
  const counted = new Set(Object.values(finals.dates).flat());
  const hist = join(dataDir, 'history');
  for (const d of [...new Set(sb.games.map((g) => g.date))].sort()) {
    const games = sb.games.filter((g) => g.date === d);
    if (!games.every((g) => g.final && counted.has(g.key))) continue;
    if (sb.games.some((g) => g.date > d && g.state !== 'pre')) continue;   // the next game date has started
    const path = join(hist, d + '.json');
    const old = await readJson(path);
    // The night's payroll goes with it, so $ per Win for that night (its
    // chart point, its As of / Since view) uses the payroll of that night.
    const pr = await readJson(join(dataDir, 'payroll_' + SEASON + '.json'));
    const payroll = pr ? pr.payroll : null;
    if (old && same(old.teams, current.teams) && same(old.payroll ?? null, payroll)) continue;
    await mkdir(hist, { recursive: true });
    await writeFile(path, stable({ date: d, source: current.source, teams: current.teams, payroll }));
    result.snapshots.push(d);
    console.log('history/' + d + '.json ' + (old ? 'rewritten' : 'written'));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run({ force: process.argv.includes('--force'), refreshSchedule: process.argv.includes('--schedule') })
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
