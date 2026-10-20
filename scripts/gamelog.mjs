// The game log: every final regular-season game, one file per game in
// data/games/<ET date>/, written once and never edited (flag 'wx').
//
//   <AWAY>@<HOME>.json       the first final the update run saw
//   <AWAY>@<HOME>.c1.json    a later correction to the score, then .c2 ...
//
// An entry: { key, game_id, id_source, date, away: {abbr, score},
// home: {abbr, score}, final_at, correction } where final_at is when the run
// first recorded that result. A correction also carries corrects (the file
// it replaces) and previous (the scores it had). readGameLog() returns the
// latest entry per game.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const stable = (o) => JSON.stringify(o, null, 2) + '\n';
const FILE = /^([A-Z]{3}@[A-Z]{3})(?:\.c(\d+))?\.json$/;

async function entriesFor(dir, base) {
  let files = [];
  try { files = await readdir(dir); } catch { return []; }
  return files.map((f) => FILE.exec(f)).filter((m) => m && m[1] === base)
    .map((m) => ({ file: m[0], seq: m[2] ? Number(m[2]) : 0 })).sort((a, b) => a.seq - b.seq);
}

// Logs one final game. Returns 'new', 'correction' or null (already logged
// with these scores, or no scores to log).
export async function logFinal(dataDir, g, nowIso) {
  if (!g.final || g.home.score === null || g.away.score === null) return null;
  const dir = join(dataDir, 'games', g.date);
  const base = g.key.slice(11);
  const have = await entriesFor(dir, base);
  const entry = { key: g.key, game_id: g.id, id_source: g.id_source, date: g.date,
    away: { abbr: g.away.abbr, score: g.away.score }, home: { abbr: g.home.abbr, score: g.home.score }, final_at: nowIso, correction: false };
  await mkdir(dir, { recursive: true });
  if (!have.length) {
    await writeFile(join(dir, base + '.json'), stable(entry), { flag: 'wx' });
    return 'new';
  }
  const last = have[have.length - 1];
  const prev = JSON.parse(await readFile(join(dir, last.file), 'utf8'));
  if (prev.home.score === g.home.score && prev.away.score === g.away.score) return null;
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
    const latest = new Map();
    for (const f of await readdir(join(root, d))) {
      const m = FILE.exec(f);
      if (!m) continue;
      const seq = m[2] ? Number(m[2]) : 0;
      if (!latest.has(m[1]) || latest.get(m[1]).seq < seq) latest.set(m[1], { seq, file: f });
    }
    for (const [, v] of [...latest].sort()) out.push(JSON.parse(await readFile(join(root, d, v.file), 'utf8')));
  }
  return out;
}

// ET dates with a counted final (data/finals.json) that has no log entry:
// games counted before the log existed, or a run that died after counting.
export function missingLogDates(finals, log) {
  const logged = new Set(log.map((e) => e.key));
  return Object.entries(finals.dates || {}).filter(([, keys]) => keys.some((k) => !logged.has(k))).map(([d]) => d).sort();
}
