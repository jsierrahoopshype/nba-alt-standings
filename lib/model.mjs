// Joins standings, lines and payroll into one row per team, ranks each
// conference, and works out the leader lines and the movers strip.

import { teamMetrics, vsVegas, signed, fmtMoneyM, fmtPctPts, round, DASH } from './metrics.mjs';
import { gameStats, recordValue, recordText } from './games.mjs';

export const CONFERENCES = ['East', 'West'];

// games: the games the view covers (lib/games.mjs shape), for the
// head-to-head tiebreaker and the Last 10, vs. .500+ and Reg. W-L-T columns;
// without them those columns show a dash and ties skip head-to-head.
// ref: the standings rows that say who is at .500 or better (default: these).
export function buildRows(teams, standings, lines, payroll, games = null, ref = null) {
  const gs = games ? gameStats(games, ref || standings.teams) : {};
  return teams.map((t) => {
    const s = standings.teams[t.abbr];
    const l = lines.teams[t.abbr];
    if (!s) throw new Error('no standings row for ' + t.abbr);
    if (!l) throw new Error('no Vegas line for ' + t.abbr);
    const p = payroll && payroll.payroll ? payroll.payroll[t.abbr] : undefined;
    const row = {
      ...t,
      ...s,
      line: l.line,
      last_season_wins: l.last_season_wins,
      payroll: Number.isFinite(p) && p > 0 ? p : null,
    };
    const m = teamMetrics(row);
    const g = gs[t.abbr] || null;
    const played = g !== null;
    // The three game-log records sit with the other metrics, so the table,
    // the team page and the sort all read them the same way.
    m.value.last10 = played ? recordValue(g.last10) : null;
    m.value.vs500 = played ? recordValue(g.vs500) : null;
    m.value.regWLT = played ? recordValue(g.reg) : null;
    m.text.last10 = played ? recordText(g.last10) : DASH;
    m.text.vs500 = played ? recordText(g.vs500) : DASH;
    m.text.regWLT = played && g.reg ? recordText(g.reg, true) : DASH;
    return { ...row, m, vs: played ? g.vs : {} };
  });
}

// Splits rows (already in order) into runs that share a key, in order.
function runs(rows, key, same = (a, b) => a === b) {
  const out = [];
  for (const r of rows) {
    const k = key(r), last = out[out.length - 1];
    if (last && same(last.k, k)) last.rows.push(r); else out.push({ k, rows: [r] });
  }
  return out.map((x) => x.rows);
}

// Puts teams that are level in order: (a) winning percentage in the games
// among just these teams, when every one of them has played at least one of
// the others; (b) point differential per game; (c) team name. When (a) or (b)
// splits the group, each smaller group that is still level starts again at
// (a). worstFirst turns (a) and (b) around for lists that start at the
// bottom ("Most underachieving"); the name stays A-Z.
export function orderTied(group, { worstFirst = false } = {}) {
  if (group.length < 2) return group;
  const dir = worstFirst ? 1 : -1;
  const split = (val) => {
    const sorted = [...group].sort((a, b) => {
      const x = val(a), y = val(b);
      if ((x === null) !== (y === null)) return x === null ? 1 : -1;
      return x === y ? 0 : (x - y) * dir;
    });
    return runs(sorted, val);
  };
  const ids = new Set(group.map((r) => r.abbr));
  const h2h = (r) => {
    let w = 0, l = 0;
    for (const o of ids) if (o !== r.abbr && r.vs && r.vs[o]) { w += r.vs[o].w; l += r.vs[o].l; }
    return w + l ? w / (w + l) : null;
  };
  if (group.every((r) => h2h(r) !== null)) {
    const parts = split(h2h);
    if (parts.length > 1) return parts.flatMap((p) => orderTied(p, { worstFirst }));
  }
  const parts = split((r) => r.m.value.ptDiff);
  if (parts.length > 1) return parts.flatMap((p) => orderTied(p, { worstFirst }));
  return [...group].sort((a, b) => a.short.localeCompare(b.short));
}

// Standings order: win percentage, with teams on the same percentage put in
// order by orderTied() (head-to-head, point differential, name). A team that
// has not played yet has no rank and sorts last, A-Z, without moving anyone.
export function rankConference(rows) {
  const played = rows.filter((r) => r.m.value.pct !== null)
    .sort((a, b) => b.w * a.gp - a.w * b.gp);               // Pct, high to low, in whole numbers
  const ordered = runs(played, (r) => r, (a, b) => a.w * b.gp === b.w * a.gp).flatMap((g) => orderTied(g));
  const unplayed = rows.filter((r) => r.m.value.pct === null).sort((a, b) => a.short.localeCompare(b.short));
  return [...ordered.map((r, i) => ({ ...r, rank: i + 1 })), ...unplayed.map((r) => ({ ...r, rank: null }))];
}

export function byConference(rows) {
  const out = {};
  for (const c of CONFERENCES) out[c] = rankConference(rows.filter((r) => r.conf === c));
  return out;
}

// "A, B and C"
export function joinAnd(parts) {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

// The three teams at one end of a metric, best first, as one sentence:
// "Miami (+14.2% vs. Vegas), Portland (+9.1%) and LA Lakers (+6.7%)". The
// unit goes on the first team only. `keep` drops teams on the wrong side of
// zero, so "Most underachieving" never lists a team that is ahead of its line.
// `skip` drops teams already named in the other line of the pair. Teams on
// the same number are put in order by orderTied(), turned around for the
// second line of a pair (`worst`), which starts from the bottom. Returns the
// sentence (null when no team is left) and the teams it names.
function leaderLine(rows, key, { dir, fmt, unit, keep = () => true, skip = new Set(), worst = false, n = 3 }) {
  const val = (r) => r.m.value[key];
  const pool = rows.filter((r) => val(r) !== null && keep(val(r)) && !skip.has(r.abbr))
    .sort((a, b) => (dir === 'desc' ? val(b) - val(a) : val(a) - val(b)));
  const top = runs(pool, val, (a, b) => Math.abs(a - b) < 1e-12).flatMap((g) => orderTied(g, { worstFirst: worst })).slice(0, n);
  return {
    text: top.length ? joinAnd(top.map((r, i) => r.short + ' (' + fmt(r.m.value[key]) + (i === 0 ? unit : '') + ')')) : null,
    abbrs: new Set(top.map((r) => r.abbr)),
  };
}

// A team counts for the leader lines once it has played LEADER_MIN_GAMES
// games and has a number for the metric (for $ per win, a win). A Best/Worst
// pair shows only once LEADER_PAIR_MIN teams count. Before that both lines
// are { text: null, wait: true } and the page says "After a few more games."
export const LEADER_MIN_GAMES = 5;
export const LEADER_PAIR_MIN = 6;

// One Best/Worst pair. A team named in the first line is never named in the
// second. With six teams and three per line that already holds; the skip
// keeps it true if either number changes.
function leaderPair(rows, key, first, second) {
  const qualified = rows.filter((r) => r.gp >= LEADER_MIN_GAMES && r.m.value[key] !== null);
  if (qualified.length < LEADER_PAIR_MIN) {
    return [{ label: first.label, text: null, wait: true }, { label: second.label, text: null, wait: true }];
  }
  const a = leaderLine(qualified, key, first);
  const b = leaderLine(qualified, key, { ...second, skip: a.abbrs, worst: true });
  return [{ label: first.label, text: a.text }, { label: second.label, text: b.text }];
}

export function leaders(rows) {
  const pos = (v) => round(v, 1) > 0, neg = (v) => round(v, 1) < 0;
  // vs. Vegas and vs. Last Year are fractions shown in percentage points.
  const posPts = (v) => pos(v * 100), negPts = (v) => neg(v * 100);
  const s = (v) => signed(v);
  return [
    ...leaderPair(rows, 'vsVegas',
      { label: 'Most overachieving', dir: 'desc', fmt: fmtPctPts, unit: ' vs. Vegas', keep: posPts },
      { label: 'Most underachieving', dir: 'asc', fmt: fmtPctPts, unit: ' vs. Vegas', keep: negPts }),
    ...leaderPair(rows, 'vsLastYear',
      { label: 'Most improved', dir: 'desc', fmt: fmtPctPts, unit: ' vs. last year', keep: posPts },
      { label: 'Most declined', dir: 'asc', fmt: fmtPctPts, unit: ' vs. last year', keep: negPts }),
    ...leaderPair(rows, 'dollarsPerWin',
      { label: 'Best bang for the buck', dir: 'asc', fmt: fmtMoneyM, unit: ' per win' },
      { label: 'Worst bang for the buck', dir: 'desc', fmt: fmtMoneyM, unit: ' per win' }),
    ...leaderPair(rows, 'luck',
      { label: 'Luckiest', dir: 'desc', fmt: s, unit: ' wins vs. expected', keep: pos },
      { label: 'Unluckiest', dir: 'asc', fmt: s, unit: ' wins vs. expected', keep: neg }),
  ];
}

// Movers: the change in "vs. Vegas" between the previous snapshot and now,
// for every team that played in between, biggest change first.
export function movers(rows, prev, { n = 6 } = {}) {
  if (!prev || !prev.teams) return null;
  const out = [];
  for (const r of rows) {
    const p = prev.teams[r.abbr];
    if (!p || r.gp === p.gp) continue;
    const before = vsVegas({ ...p, line: r.line });
    const after = r.m.value.vsVegas;
    const delta = (after ?? 0) - (before ?? 0);
    out.push({ abbr: r.abbr, short: r.short, name: r.name, nba_id: r.nba_id, delta,
      dw: r.w - p.w, dl: r.l - p.l, w: r.w, l: r.l });
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.short.localeCompare(b.short));
  return out.slice(0, n);
}

export function moverText(m) {
  // A feed correction can take a game away; say so rather than "won -1".
  const games = m.dw < 0 || m.dl < 0 ? 'record revised' : m.dw && m.dl ? 'went ' + m.dw + '-' + m.dl : m.dw ? (m.dw === 1 ? 'won' : 'won ' + m.dw) : (m.dl === 1 ? 'lost' : 'lost ' + m.dl);
  return { delta: fmtPctPts(m.delta) + ' vs. Vegas', games, record: m.w + '-' + m.l };
}

export function leagueAveragePayroll(rows) {
  const ps = rows.map((r) => r.payroll).filter((p) => p !== null);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
}

export { DASH };
