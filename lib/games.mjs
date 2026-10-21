// Games from the log, for what the standings alone cannot say: the
// head-to-head tiebreaker, Last 10, vs. .500+ and the regulation record.
// Pure functions shared by the build, the page script (bundled by
// scripts/build.mjs) and the tests.
//
// A game here: { date, away, home, as, hs, periods } with team abbreviations,
// the away and home scores, and the number of periods played (4 in
// regulation, 5 or more after overtime; null when the log has no count).

import { DASH } from './metrics.mjs';

export const REGULATION_PERIODS = 4;
const known = (p) => typeof p === 'number' && Number.isFinite(p) && p >= REGULATION_PERIODS;

// The game log's latest entries (scripts/gamelog.mjs readGameLog) in this
// shape, oldest first.
export function fromLog(log) {
  return log.map((e) => ({ date: e.date, away: e.away.abbr, home: e.home.abbr, as: e.away.score, hs: e.home.score,
    periods: known(e.periods) ? e.periods : null }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.away + a.home).localeCompare(b.away + b.home)));
}

// Compact form for data/nights.json: [date, away index, home index, away
// score, home score, periods] in teams order.
export const packGames = (games, order) => games.map((g) => [g.date, order.indexOf(g.away), order.indexOf(g.home), g.as, g.hs, g.periods]);
export const unpackGames = (packed, order) => (packed || []).map((p) => ({ date: p[0], away: order[p[1]], home: order[p[2]], as: p[3], hs: p[4], periods: known(p[5]) ? p[5] : null }));

// The games a timeframe covers: the season, every game through the As of
// night, or every game after the Since night (the whole season when no night
// was saved before it).
export function gamesForTimeframe(tf, games) {
  if (tf.kind === 'asof') return tf.used ? games.filter((g) => g.date <= tf.used) : [];
  if (tf.kind === 'since') return tf.used ? games.filter((g) => g.date > tf.used) : games;
  return games;
}

// The standings that say which teams are at .500 or better: the season as
// it stands at the end of the view. For Season and Since that is now; for
// As of, that night.
export const refStandingsFor = (tf, standings, current) => (tf.kind === 'since' ? current : standings);

// A W-L or W-L-T record as a sort value: winning percentage with a tie as
// half a win. null with no games.
export function recordValue(r) {
  if (!r) return null;
  const n = r.w + r.l + (r.t || 0);
  return n ? (r.w + (r.t || 0) / 2) / n : null;
}
export const recordText = (r, withTies = false) => (r ? r.w + '-' + r.l + (withTies ? '-' + r.t : '') : DASH);

// Per team, from the games in a view: its record against each opponent
// (vs, for the head-to-head tiebreaker), over its last 10 games, against
// teams at .500 or better in `ref` (standings rows), and in regulation
// (W-L-T, a game that went past 4 periods is a tie; a game without a period
// count is left out of this one record). A team with no games gets null for
// all three records.
export function gameStats(games, ref) {
  const out = {};
  const get = (a) => (out[a] = out[a] || { vs: {}, results: [], vs500: { w: 0, l: 0 }, reg: { w: 0, l: 0, t: 0 }, regGames: 0 });
  const above500 = (a) => { const r = ref && ref[a]; return !!r && r.gp > 0 && r.w * 2 >= r.gp; };
  for (const g of games) {
    if (g.hs === g.as) continue;                    // no NBA game ends level; a bad row counts for nothing
    for (const [us, them, won] of [[g.home, g.away, g.hs > g.as], [g.away, g.home, g.as > g.hs]]) {
      const s = get(us);
      const h = (s.vs[them] = s.vs[them] || { w: 0, l: 0 });
      won ? h.w++ : h.l++;
      s.results.push(won);
      if (above500(them)) won ? s.vs500.w++ : s.vs500.l++;
      if (g.periods !== null) {
        s.regGames++;
        if (g.periods > REGULATION_PERIODS) s.reg.t++;
        else won ? s.reg.w++ : s.reg.l++;
      }
    }
  }
  for (const s of Object.values(out)) {
    const last = s.results.slice(-10);
    s.last10 = { w: last.filter(Boolean).length, l: last.filter((x) => !x).length };
    if (!s.regGames) s.reg = null;
    delete s.results; delete s.regGames;
  }
  return out;
}
