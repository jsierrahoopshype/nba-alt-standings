// Probe: does each standings source answer from here? Runs the same source
// functions as scripts/fetch.mjs (same request code, same parsing), so a
// source that passes here is one the fetch will get. Writes nothing and
// always exits 0: it is informational, the fetch step decides.
//
// Run: node scripts/probe.mjs

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './fetch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { teams } = JSON.parse(await readFile(join(root, 'data/teams.json'), 'utf8'));
for (const src of SOURCES) {
  const t0 = Date.now();
  try {
    const parsed = await src.fetch(teams);
    const gp = Object.values(parsed.teams).reduce((s, r) => s + r.gp, 0);
    console.log(`PASS  ${src.name}: ${parsed.listed} teams listed, ${gp / 2} games counted, ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`FAIL  ${src.name}: ${e.message} (${Date.now() - t0}ms)`);
  }
}
