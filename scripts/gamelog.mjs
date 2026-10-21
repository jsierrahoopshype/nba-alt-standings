// The game log: every final regular-season game, one file per game in
// data/games/<ET date>/, written once and never edited (flag 'wx').
//
//   <AWAY>@<HOME>.json          the first final the update run saw
//   <AWAY>@<HOME>.c1.json       a later correction to the score, then .c2 ...
//   <AWAY>@<HOME>.periods.json  the period count, for a game logged before
//                               entries carried one (also written once)
//
// An entry: { key, game_id, id_source, date, away: {abbr, score},
// home: {abbr, score}, periods, final_at, correction } where periods is how
// many periods the game took (4 in regulation, 5+ after overtime; null when
// the scoreboard did not say) and final_at is when the run first recorded
// that result. A correction also carries corrects (the file it replaces) and
// previous (the scores it had). readGameLog() returns the latest entry per
// game, with the period count from the .periods.json file when the entry has
// none.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const stable = (o) => JSON.stringify(o, null, 2) + '\n';
const FILE = /^([A-Z]{3}@[A-Z]{3})(?:\.c(\d+))?\.json$/;
const PERIODS_FILE = /^([A-Z]{3}@[A-Z]{3})\.periods\.json$/;
const hasPeriods = (p) => Number.isInteger(p) && p >= 4;

async function entriesFor(dir, base) {
  let files = [];
  try { files = await readdir(dir); } catch { return []; }
  return files.map((f) => FILE.exec(f)).filter((m) => m && m[1] === base)
    .map((m) => ({ file: m[0], seq: m[2] ? Number(m[2]) : 0 })).sort((a, b) => a.seq - b.seq);
}

// Logs one final game. Returns 'new', 'correction', 'periods' (the period
// count added for a game logged without one) or null (already logged with
// these scores, or no scores to log).
export async function logFinal(dataDir, g, nowIso) {
  if (!g.final || g.home.score === null || g.away.score === null) return null;
  const dir = join(dataDir, 'games', g.date);
  const base = g.key.slice(11);
  const have = await entriesFor(dir, base);
  const periods = hasPeriods(g.periods) ? g.periods : null;
  const entry = { key: g.key, game_id: g.id, id_source: g.id_source, date: g.date,
    away: { abbr: g.away.abbr, score: g.away.score }, home: { abbr: g.home.abbr, score: g.home.score }, periods, final_at: nowIso, correction: false };
  await mkdir(dir, { recursive: true });
  if (!have.length) {
    await writeFile(join(dir, base + '.json'), stable(entry), { flag: 'wx' });
    return 'new';
  }
  const last = have[have.length - 1];
  const prev = JSON.parse(await readFile(join(dir, last.file), 'utf8'));
  if (prev.home.score === g.home.score && prev.away.score === g.away.score) {
    // Same result. A game logged without a period count gets one, once.
    if (hasPeriods(prev.periods) || periods === null) return null;
    try {
      await writeFile(join(dir, base + '.periods.json'), stable({ key: g.key, periods, id_source: g.id_source, saved_at: nowIso }), { flag: 'wx' });
      return 'periods';
    } catch (e) {
      if (e.code === 'EEXIST') return null;
      throw e;
    }
  }
  const seq = last.seq + 1;
  await writeFile(join(dir, base + '.c' + seq + '.json'), stable({ ...entry, correction: true, corrects: last.file,
    previous: { away: prev.away.score, home: prev.home.score } }), { flag: 'wx' });
  return 'correction';
}

// The latest entry for every logged game, oldest date first.
export async function readGameLog(dataDir) {
  const root = join(dataDir, 'games');
  let dates = [];
  try { dates = (await readdir(root)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(); } catch { return []; }
  const out = [];
  for (const d of dates) {
    const latest = new Map(), periodFiles = new Map();
    for (const f of await readdir(join(root, d))) {
      const p = PERIODS_FILE.exec(f);
      if (p) { periodFiles.set(p[1], f); continue; }
      const m = FILE.exec(f);
      if (!m) continue;
      const seq = m[2] ? Number(m[2]) : 0;
      if (!latest.has(m[1]) || latest.get(m[1]).seq < seq) latest.set(m[1], { seq, file: f });
    }
    for (const [base, v] of [...latest].sort()) {
      const e = JSON.parse(await readFile(join(root, d, v.file), 'utf8'));
      if (!hasPeriods(e.periods)) {
        const pf = periodFiles.get(base);
        e.periods = pf ? JSON.parse(await readFile(join(root, d, pf), 'utf8')).periods : null;
        if (!hasPeriods(e.periods)) e.periods = null;
      }
      out.push(e);
    }
  }
  return out;
}

// ET dates with a logged game that has no period count yet.
export const datesMissingPeriods = (log) => [...new Set(log.filter((e) => e.periods === null).map((e) => e.date))].sort();

// ET dates with a counted final (data/finals.json) that has no log entry:
// games counted before the log existed, or a run that died after counting.
export function missingLogDates(finals, log) {
  const logged = new Set(log.map((e) => e.key));
  return Object.entries(finals.dates || {}).filter(([, keys]) => keys.some((k) => !logged.has(k))).map(([d]) => d).sort();
}
