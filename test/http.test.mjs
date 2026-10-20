// The request code the nightly run uses (lib/http.mjs), and what scripts/
// fetch.mjs does with it:
//
//   - every request carries desktop Chrome's User-Agent, Accept:
//     application/json and Accept-Language: en-US; cdn.nba.com requests also
//     carry Referer https://www.nba.com/ and Origin https://www.nba.com;
//   - 30s per attempt, one retry, then an error naming both attempts;
//   - the probe runs the fetch's own sources, and nothing in scripts/ calls
//     fetch() directly;
//   - when every standings source fails, run() rejects and writes nothing;
//   - a successful run dates the standings today even when no game changed.
//
// Run: node test/http.test.mjs

import { readFile, readdir, mkdtemp, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestHeaders, getJson, CHROME_UA, REQUEST_TIMEOUT_MS } from '../lib/http.mjs';
import { run, SOURCES, ESPN_URL, NBA_SCHEDULE_URL, SSF_DATA_URL } from '../scripts/fetch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) { failed++; if (detail !== undefined) console.log('        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))); }
};
const rejects = async (p) => { try { await p; return null; } catch (e) { return e; } };

// ── 1. Headers ──
const espn = requestHeaders(ESPN_URL);
ok('ESPN: desktop Chrome User-Agent', espn['User-Agent'] === CHROME_UA && /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/.test(CHROME_UA), CHROME_UA);
ok('ESPN: no bot marker in the User-Agent', !/bot|compatible|hoopsmatic|\+https?:/i.test(CHROME_UA));
ok('ESPN: Accept application/json, Accept-Language en-US', espn.Accept === 'application/json' && espn['Accept-Language'] === 'en-US');
ok('ESPN: no Referer or Origin', !('Referer' in espn) && !('Origin' in espn));
const nba = requestHeaders(NBA_SCHEDULE_URL);
ok('cdn.nba.com: same three headers', nba['User-Agent'] === CHROME_UA && nba.Accept === 'application/json' && nba['Accept-Language'] === 'en-US');
ok('cdn.nba.com: Referer https://www.nba.com/ and Origin https://www.nba.com', nba.Referer === 'https://www.nba.com/' && nba.Origin === 'https://www.nba.com', nba);
ok('salary-season-finder: browser headers, no nba.com Referer', requestHeaders(SSF_DATA_URL)['User-Agent'] === CHROME_UA && !('Referer' in requestHeaders(SSF_DATA_URL)));
ok('a lookalike host (cdn.nba.com.evil.example) gets no nba.com Referer', !('Referer' in requestHeaders('https://cdn.nba.com.evil.example/x.json')));

// ── 2. getJson: what it sends, timeout, retry ──
const realFetch = globalThis.fetch;
let calls = [];
const stub = (answers) => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a === 'timeout') { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
    return new Response(typeof a === 'number' ? 'nope' : JSON.stringify(a), { status: typeof a === 'number' ? a : 200 });
  };
};
ok('timeout is 30s', REQUEST_TIMEOUT_MS === 30000);

stub([{ ok: 1 }]);
const one = await getJson(NBA_SCHEDULE_URL, { retryDelayMs: 0 });
ok('getJson: one request on success, JSON returned', calls.length === 1 && one.ok === 1);
ok('getJson: sends requestHeaders(url) exactly', JSON.stringify(calls[0].init.headers) === JSON.stringify(requestHeaders(NBA_SCHEDULE_URL)), calls[0].init.headers);
ok('getJson: sends an abort signal (the timeout)', calls[0].init.signal instanceof AbortSignal);

stub([403, { ok: 2 }]);
const two = await getJson(ESPN_URL, { retryDelayMs: 0 });
ok('getJson: a 403 is retried once, and the retry\'s answer is used', calls.length === 2 && two.ok === 2);
ok('getJson: the retry sends the same headers', JSON.stringify(calls[1].init.headers) === JSON.stringify(calls[0].init.headers));

stub([403, 403, { ok: 3 }]);
let e = await rejects(getJson(ESPN_URL, { retryDelayMs: 0 }));
ok('getJson: two failures -> error, no third request', e && calls.length === 2, calls.length);
ok('getJson: the error names both attempts and the URL', e && /attempt 1: HTTP 403; attempt 2: HTTP 403 \(https:\/\/site\.api\.espn\.com\//.test(e.message), e && e.message);

stub(['timeout', 'timeout']);
e = await rejects(getJson(NBA_SCHEDULE_URL, { retryDelayMs: 0 }));
ok('getJson: a timeout is retried and reported as "timed out after 30s"', e && calls.length === 2 && /attempt 2: timed out after 30s/.test(e.message), e && e.message);
globalThis.fetch = realFetch;

// ── 3. One request path: probe and fetch share it ──
const probeSrc = await readFile(join(root, 'scripts/probe.mjs'), 'utf8');
const fetchSrc = await readFile(join(root, 'scripts/fetch.mjs'), 'utf8');
ok('probe runs fetch.mjs\'s SOURCES', /import \{ SOURCES \} from '\.\/fetch\.mjs'/.test(probeSrc) && SOURCES.map((s) => s.name).join() === 'ESPN,cdn.nba.com');
ok('fetch.mjs gets every URL through lib/http.mjs getJson', /import \{ getJson \} from '\.\.\/lib\/http\.mjs'/.test(fetchSrc));
const scripts = await readdir(join(root, 'scripts'));
const direct = [];
for (const f of scripts) if ((await readFile(join(root, 'scripts', f), 'utf8')).match(/(?<![.\w])fetch\(/)) direct.push(f);
ok('nothing in scripts/ calls fetch() directly', direct.length === 0, direct);
const wf = await readFile(join(root, '.github/workflows/nightly.yml'), 'utf8');
ok('nightly: the probe step is node scripts/probe.mjs, no curl', /name: Probe feeds[\s\S]*?run: node scripts\/probe\.mjs/.test(wf) && !/curl/.test(wf));

// ── 4. run(): all sources down -> nothing written, rejects ──
async function scratchData() {
  const dir = await mkdtemp(join(tmpdir(), 'standings-run-'));
  await cp(join(root, 'data'), dir, { recursive: true });
  return dir;
}
async function snapshot(dir) {
  const out = {};
  const walk = async (d, pre) => {
    for (const f of await readdir(d)) {
      const p = join(d, f);
      if ((await stat(p)).isDirectory()) await walk(p, pre + f + '/');
      else out[pre + f] = await readFile(p, 'utf8');
    }
  };
  await walk(dir, '');
  return out;
}
const quiet = console.log;
{
  const dir = await scratchData();
  const before = await snapshot(dir);
  stub([403]);
  console.log = () => {};
  e = await rejects(run({ dataDir: dir, today: '2026-10-21' }));
  console.log = quiet;
  const after = await snapshot(dir);
  ok('all sources fail: run() rejects (the step exits 1, so the run fails)', e && /no standings source worked/.test(e.message), e && e.message);
  ok('all sources fail: each source retried once (2 x 2 requests), payroll never fetched', calls.length === 4 && calls.every((c) => c.url !== SSF_DATA_URL), calls.map((c) => c.url));
  ok('all sources fail: every data file byte for byte as before, no history file added', JSON.stringify(before) === JSON.stringify(after), Object.keys(after).filter((k) => before[k] !== after[k]));
  globalThis.fetch = realFetch;
}

// ── 5. run(): a good night with no games still moves "Updated" to today ──
{
  const dir = await scratchData();
  const { teams } = JSON.parse(await readFile(join(dir, 'teams.json'), 'utf8'));
  const prev = JSON.parse(await readFile(join(dir, 'standings.json'), 'utf8'));
  const zero = { wins: 0, losses: 0 };
  const entries = (conf) => teams.filter((t) => t.conf === conf).map((t) => ({ team: { abbreviation: t.espn[0] }, stats: [{ name: 'wins', value: zero.wins }, { name: 'losses', value: zero.losses }] }));
  const espnBody = { children: [{ standings: { season: 2027, entries: entries('East') } }, { standings: { season: 2027, entries: entries('West') } }] };
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === ESPN_URL) return new Response(JSON.stringify(espnBody));
    return new Response('down', { status: 503 });
  };
  console.log = () => {};
  await run({ dataDir: dir, today: '2026-10-21' });
  console.log = quiet;
  globalThis.fetch = realFetch;
  const st = JSON.parse(await readFile(join(dir, 'standings.json'), 'utf8'));
  ok('good run, same 0-0 records: updated_on is today, source espn', st.updated_on === '2026-10-21' && st.source === 'espn' && JSON.stringify(st.teams) === JSON.stringify(prev.teams), { updated_on: st.updated_on, source: st.source });
  ok('good run: ESPN asked once, with the browser headers', calls.filter((c) => c.url === ESPN_URL).length === 1 && calls[0].init.headers['User-Agent'] === CHROME_UA);
  ok('good run: payroll down (503 twice) keeps the committed payroll file', JSON.stringify(JSON.parse(await readFile(join(dir, 'payroll_2026-27.json'), 'utf8')))
     === JSON.stringify(JSON.parse(await readFile(join(root, 'data/payroll_2026-27.json'), 'utf8'))));
}

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
