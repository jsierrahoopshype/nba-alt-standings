// Probe: does each source answer from here? Runs the same source functions
// as the update run (scripts/fetch.mjs: same request code, same parsing), so
// a source that passes here is one the update will get. Writes nothing and
// always exits 0: it is informational, the update step decides.
//
// Run: node scripts/probe.mjs

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, SCOREBOARD_SOURCES, etDate } from './fetch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { teams } = JSON.parse(await readFile(join(root, 'data/teams.json'), 'utf8'));
for (const src of SOURCES) {
  const t0 = Date.now();
  try {
    const parsed = await src.fetch(teams);
    const gp = Object.values(parsed.teams).reduce((s, r) => s + r.gp, 0);
    console.log(`PASS  standings ${src.name}: ${parsed.listed} teams listed, ${gp / 2} games counted, ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`FAIL  standings ${src.name}: ${e.message} (${Date.now() - t0}ms)`);
  }
}
const today = etDate();
for (const src of SCOREBOARD_SOURCES) {
  const t0 = Date.now();
  try {
    const games = await src.fetch(teams, [today]);
    const by = (s) => games.filter((g) => g.state === s).length;
    console.log(`PASS  scoreboard ${src.name} ${today}: ${games.length} games (${by('pre')} not started, ${by('in')} live, ${games.filter((g) => g.final).length} final), ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`FAIL  scoreboard ${src.name} ${today}: ${e.message} (${Date.now() - t0}ms)`);
  }
}
