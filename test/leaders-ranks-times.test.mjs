// Leader pairs, ranks before a team's first game, and ET/Madrid times, all
// against the frozen fixture (test/fixtures/data, see its README):
//   1. a Best/Worst pair shows only with at least 6 qualifying teams (for
//      $ per win, teams with a win), otherwise both lines read "After a few
//      more games."; a team is never named in both lines of a pair
//   2. a team with no games has no rank and does not push down the teams
//      that have played; its page header says "Not ranked yet"
//   3. Madrid times in "1 a.m." style, with the Madrid date when it is not
//      the ET date
// Run: node test/leaders-ranks-times.test.mjs

import { readFile, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows, rankConference, byConference, leaders, LEADER_PAIR_MIN } from '../lib/model.mjs';
import { leadersHtml, fmtTipEtMadrid, fmtUpdated } from '../lib/render.mjs';
import { renderAll } from '../scripts/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(root, 'test/fixtures/data');
const J = async (p) => JSON.parse(await readFile(p, 'utf8'));
let failed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) { failed++; if (detail !== undefined) console.log('        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))); }
};

const { teams } = await J(join(FIXTURE, 'teams.json'));
const lines = await J(join(FIXTURE, 'vegas_lines_2026-27.json'));
const payroll = await J(join(FIXTURE, 'payroll_2026-27.json'));
const fixtureStandings = await J(join(FIXTURE, 'standings.json'));
const order = teams.map((t) => t.abbr);
const byAbbr = Object.fromEntries(teams.map((t) => [t.abbr, t]));
const mk = (w, l) => ({ w, l, gp: w + l, pf: 105 * (w + l) + 3 * (w - l), pa: 105 * (w + l), home_w: w, home_l: 0, road_w: 0, road_l: l });
const league = (over = {}) => ({ teams: Object.fromEntries(order.map((a) => [a, over[a] || mk(0, 0)])) });
const rowsFor = (over) => buildRows(teams, league(over), lines, payroll);
const pair = (L, label) => { const i = L.findIndex((x) => x.label === label); return [L[i], L[i + 1]]; };
// The team names a leader sentence lists, in order.
const named = (text) => (text ? [...text.matchAll(/(?:^|, | and )([A-Za-z .]+?) \(/g)].map((m) => m[1]) : []);
const PAIRS = ['Most overachieving', 'Most improved', 'Best bang for the buck', 'Luckiest'];

// ── 1. Leader pairs ──
ok('leaders: a pair needs 6 teams', LEADER_PAIR_MIN === 6);
{
  // The fixture as committed: nobody has played.
  const L = leaders(buildRows(teams, fixtureStandings, lines, payroll));
  ok('leaders, fixture (no games): all 8 lines wait', L.length === 8 && L.every((x) => x.text === null && x.wait === true), L);
  const html = leadersHtml(buildRows(teams, fixtureStandings, lines, payroll));
  ok('leaders, fixture (no games): "After a few more games." 8 times', (html.match(/<dd class="none">After a few more games\.<\/dd>/g) || []).length === 8 && !html.includes('After the first games'), html);
}
{
  // Opening night as it happened: three 1-0 teams, three 0-1 teams.
  const L = leaders(rowsFor({ DET: mk(1, 0), PHI: mk(1, 0), OKC: mk(1, 0), BOS: mk(0, 1), NYK: mk(0, 1), SAS: mk(0, 1) }));
  const [best, worst] = pair(L, 'Best bang for the buck');
  ok('leaders, 6 teams played but 3 with a win: $ per win pair waits on both lines', best.text === null && worst.text === null && best.wait && worst.wait, [best, worst]);
  const [over, under] = pair(L, 'Most overachieving');
  ok('leaders, 6 teams played: vs. Vegas pair shows', over.text !== null && under.text !== null && !over.wait && !under.wait, [over, under]);
  const html = leadersHtml(rowsFor({ DET: mk(1, 0), PHI: mk(1, 0), OKC: mk(1, 0), BOS: mk(0, 1), NYK: mk(0, 1), SAS: mk(0, 1) }));
  ok('leaders, opening night: exactly the $ per win pair says "After a few more games."', (html.match(/After a few more games\./g) || []).length === 2
     && /<dt>Best bang for the buck<\/dt><dd class="none">After a few more games\.<\/dd>/.test(html) && /<dt>Worst bang for the buck<\/dt><dd class="none">After a few more games\.<\/dd>/.test(html));
}
{
  // Five played: no pair shows.
  const five = { DET: mk(1, 0), PHI: mk(1, 0), OKC: mk(1, 0), BOS: mk(0, 1), NYK: mk(0, 1) };
  ok('leaders, 5 teams played: every pair waits', leaders(rowsFor(five)).every((x) => x.text === null && x.wait));
  // Five winners plus losers: $ per win waits at 5, shows at 6.
  const w5 = { ...five, BOS: mk(1, 1), NYK: mk(1, 1), SAS: mk(0, 2), LAL: mk(0, 1) };
  const r5 = rowsFor(w5);
  const [b5, x5] = pair(leaders(r5), 'Best bang for the buck');
  ok('leaders, 5 teams with a win (7 played): $ per win waits, vs. Vegas shows', r5.filter((r) => r.w > 0).length === 5 && b5.text === null && x5.text === null && b5.wait
     && pair(leaders(r5), 'Most overachieving').every((x) => !x.wait), [b5, x5]);
  const w6 = { ...w5, LAL: mk(1, 1) };
  const [b6, x6] = pair(leaders(rowsFor(w6)), 'Best bang for the buck');
  ok('leaders, 6 teams with a win: $ per win shows, 3 and 3, nobody in both', b6.text !== null && x6.text !== null && named(b6.text).length === 3 && named(x6.text).length === 3
     && named(b6.text).every((t) => !named(x6.text).includes(t)), [b6.text, x6.text]);
}
{
  // Many leagues, from 6 to 30 teams played: no team is ever in both lines.
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const clashes = [];
  for (let k = 6; k <= 30; k++) {
    for (let trial = 0; trial < 8; trial++) {
      const over = {};
      for (const a of order.slice(0, k)) { const gp = 1 + rnd(12); const w = rnd(gp + 1); over[a] = mk(w, gp - w); }
      const L = leaders(rowsFor(over));
      for (const p of PAIRS) {
        const [a, b] = pair(L, p);
        const both = named(a.text).filter((t) => named(b.text).includes(t));
        if (both.length) clashes.push(k + ' ' + p + ': ' + both.join());
      }
    }
  }
  ok('leaders: 200 random leagues, no team in both lines of any pair', clashes.length === 0, clashes.slice(0, 5));
}

// ── 2. Ranks ──
{
  const over = { NYK: mk(0, 1), BOS: mk(0, 1), DET: mk(1, 0), PHI: mk(1, 0), OKC: mk(1, 0), SAS: mk(0, 1) };
  const conf = byConference(rowsFor(over));
  const east = conf.East.map((r) => [r.abbr, r.rank]);
  ok('ranks: East played teams 1-4 (DET, PHI, BOS, NYK), the other 11 unranked', JSON.stringify(east.slice(0, 4)) === JSON.stringify([['DET', 1], ['PHI', 2], ['BOS', 3], ['NYK', 4]])
     && east.slice(4).every(([, r]) => r === null) && east.length === 15, east);
  const playedOnly = rankConference(rowsFor(over).filter((r) => r.conf === 'East' && r.gp > 0)).map((r) => [r.abbr, r.rank]);
  ok('ranks: teams without games do not change the ranks of teams that played', JSON.stringify(playedOnly) === JSON.stringify(east.slice(0, 4)), playedOnly);
  const all = rankConference(rowsFor(over)).map((r) => [r.abbr, r.rank]);
  ok('ranks: league 1-6 for the six teams that played, 24 unranked', all.slice(0, 6).map(([, r]) => r).join() === '1,2,3,4,5,6' && all.slice(6).every(([, r]) => r === null), all);
  ok('ranks: a team with 0 games has no rank even in a conference where nobody has played', conf.West.filter((r) => r.gp === 0).every((r) => r.rank === null));
}
{
  // Team pages built from the fixture, with the Knicks 0-1 and everyone else
  // yet to play.
  const dir = await mkdtemp(join(tmpdir(), 'standings-lrt-'));
  await cp(FIXTURE, join(dir, 'data'), { recursive: true });
  const st = JSON.parse(JSON.stringify(fixtureStandings));
  st.teams.NYK = mk(0, 1); st.teams.PHI = mk(1, 0);
  await writeFile(join(dir, 'data/standings.json'), JSON.stringify(st));
  const all = await renderAll({ dataDir: join(dir, 'data'), srcRoot: root, today: '2026-10-20' });
  const page = (slug) => all.teamPages.find((t) => t.slug === slug).html;
  const cell = (html, k) => (new RegExp('<div class="num" data-k="' + k + '">([^<]*)<').exec(html) || [])[1];
  ok('team page, no games: Conference and League say "Not ranked yet"', cell(page('lakers'), 'confRank') === 'Not ranked yet' && cell(page('lakers'), 'leagueRank') === 'Not ranked yet',
     [cell(page('lakers'), 'confRank'), cell(page('lakers'), 'leagueRank')]);
  ok('team page, no games: no dash in the rank cells, for all 28 teams yet to play',
     all.teamPages.filter((t) => !['knicks', '76ers'].includes(t.slug)).every((t) => cell(t.html, 'confRank') === 'Not ranked yet' && cell(t.html, 'leagueRank') === 'Not ranked yet'));
  ok('team page, played: Knicks 2nd in the East, 2nd in the NBA (behind 1-0 Philadelphia)', cell(page('knicks'), 'confRank') === '2nd in the East' && cell(page('knicks'), 'leagueRank') === '2nd in the NBA',
     [cell(page('knicks'), 'confRank'), cell(page('knicks'), 'leagueRank')]);
  // 3. on the page too: the fixture's PHI@NYK tip, 2026-10-20T23:00Z, is
  // 7 p.m. EDT on Oct. 20 and 1 a.m. CEST on Oct. 21.
  ok('team page: next game "Oct. 20, 7 p.m. ET (1 a.m. Oct. 21 Madrid)"',
     page('knicks').includes('Next game: vs. <a href="https://hoopsmatic.com/standings/76ers">Philadelphia</a>, Oct. 20, 7 p.m. ET (1 a.m. Oct. 21 Madrid)</p>'),
     (page('knicks').match(/<p class="next">[\s\S]*?<\/p>/) || [''])[0]);
  ok('team page: back link reads "Full standings"', page('knicks').includes('<a href="https://hoopsmatic.com/standings">Full standings</a> · ') && !page('knicks').includes('Full NBA Real Standings'));
}

// ── 3. ET and Madrid times ──
// Each expected string worked out by hand: EDT is UTC-4 until Nov. 1, EST
// UTC-5 after; CEST is UTC+2 until Oct. 25, CET UTC+1 after.
const tips = [
  ['2026-10-23T23:00:00Z', '7 p.m. ET (1 a.m. Oct. 24 Madrid)'],          // the request's example
  ['2026-10-22T23:30:00Z', '7:30 p.m. ET (1:30 a.m. Oct. 23 Madrid)'],
  ['2026-10-22T02:00:00Z', '10 p.m. ET (4 a.m. Oct. 22 Madrid)'],         // 10 p.m. Oct. 21 ET
  ['2026-10-24T19:30:00Z', '3:30 p.m. ET (9:30 p.m. Madrid)'],            // same day: no Madrid date
  ['2026-10-24T21:59:00Z', '5:59 p.m. ET (11:59 p.m. Madrid)'],           // last minute before Madrid's midnight
  ['2026-10-28T23:00:00Z', '7 p.m. ET (12 a.m. Oct. 29 Madrid)'],         // Europe off DST, US not yet: 5 hours
  ['2026-11-03T00:30:00Z', '7:30 p.m. ET (1:30 a.m. Nov. 3 Madrid)'],     // both off DST: 6 hours
  ['2027-01-01T01:00:00Z', '8 p.m. ET (2 a.m. Jan. 1 Madrid)'],           // across the new year
];
for (const [iso, want] of tips) ok('tip time ' + iso + ': ' + want, fmtTipEtMadrid(iso) === want, fmtTipEtMadrid(iso));
ok('tip times: Madrid never in 24-hour style', tips.every(([iso]) => /\((\d{1,2}(:\d\d)? [ap]\.m\.)( [A-Z][a-z]+\.? \d{1,2})? Madrid\)$/.test(fmtTipEtMadrid(iso)) && !/\b(1[3-9]|2[0-3]):\d\d/.test(fmtTipEtMadrid(iso))));
const stamps = [
  ['2026-10-21T05:42:00Z', 'Oct. 21, 1:42 a.m. ET (7:42 a.m. Madrid)'],
  ['2026-10-20T13:12:58Z', 'Oct. 20, 9:12 a.m. ET (3:12 p.m. Madrid)'],
  ['2026-10-21T02:15:00Z', 'Oct. 20, 10:15 p.m. ET (4:15 a.m. Oct. 21 Madrid)'],
  ['2026-11-03T03:05:00Z', 'Nov. 2, 10:05 p.m. ET (4:05 a.m. Nov. 3 Madrid)'],
];
for (const [iso, want] of stamps) ok('Updated stamp ' + iso + ': ' + want, fmtUpdated(iso) === want, fmtUpdated(iso));
ok('times: bad input gives an empty string', fmtTipEtMadrid('nope') === '' && fmtUpdated('nope') === '');

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
