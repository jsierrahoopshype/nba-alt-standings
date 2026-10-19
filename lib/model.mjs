// Joins standings, lines and payroll into one row per team, ranks each
// conference, and works out the leader lines and the movers strip.

import { teamMetrics, vsVegas, signed, fmtMoneyM, round, DASH } from './metrics.mjs';

export const CONFERENCES = ['East', 'West'];

export function buildRows(teams, standings, lines, payroll) {
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
    return { ...row, m: teamMetrics(row) };
  });
}

// Standings order: win percentage, then more wins, then fewer losses, then
// name. A team that has not played yet has no rank and sorts last.
export function rankConference(rows) {
  const sorted = [...rows].sort((a, b) => {
    const pa = a.m.value.pct, pb = b.m.value.pct;
    if ((pa === null) !== (pb === null)) return pa === null ? 1 : -1;
    if (pa !== null && pb !== pa) return pb - pa;
    if (b.w !== a.w) return b.w - a.w;
    if (a.l !== b.l) return a.l - b.l;
    return a.short.localeCompare(b.short);
  });
  return sorted.map((r) => ({ ...r, rank: r.m.value.pct === null ? null : sorted.indexOf(r) + 1 }));
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
// "Miami (+4.2 wins vs. Vegas), Portland (+3.1) and LA Lakers (+2.7)". The
// unit goes on the first team only. `keep` drops teams on the wrong side of
// zero, so "Most underachieving" never lists a team that is ahead of its line.
function leaderLine(rows, key, { dir, fmt, unit, keep = () => true, n = 3 }) {
  const pool = rows.filter((r) => r.m.value[key] !== null && keep(r.m.value[key]));
  pool.sort((a, b) => {
    const d = dir === 'desc' ? b.m.value[key] - a.m.value[key] : a.m.value[key] - b.m.value[key];
    return d !== 0 ? d : a.short.localeCompare(b.short);
  });
  const top = pool.slice(0, n);
  if (!top.length) return null;
  return joinAnd(top.map((r, i) => r.short + ' (' + fmt(r.m.value[key]) + (i === 0 ? unit : '') + ')'));
}

export function leaders(rows) {
  const pos = (v) => round(v, 1) > 0, neg = (v) => round(v, 1) < 0;
  const s = (v) => signed(v);
  return [
    { label: 'Most overachieving', text: leaderLine(rows, 'vsVegas', { dir: 'desc', fmt: s, unit: ' wins vs. Vegas', keep: pos }) },
    { label: 'Most underachieving', text: leaderLine(rows, 'vsVegas', { dir: 'asc', fmt: s, unit: ' wins vs. Vegas', keep: neg }) },
    { label: 'Most improved', text: leaderLine(rows, 'vsLastYear', { dir: 'desc', fmt: s, unit: ' wins vs. last year', keep: pos }) },
    { label: 'Most declined', text: leaderLine(rows, 'vsLastYear', { dir: 'asc', fmt: s, unit: ' wins vs. last year', keep: neg }) },
    { label: 'Best bang for the buck', text: leaderLine(rows, 'dollarsPerWin', { dir: 'asc', fmt: fmtMoneyM, unit: ' per win' }) },
    { label: 'Worst bang for the buck', text: leaderLine(rows, 'dollarsPerWin', { dir: 'desc', fmt: fmtMoneyM, unit: ' per win' }) },
    { label: 'Luckiest', text: leaderLine(rows, 'luck', { dir: 'desc', fmt: s, unit: ' wins vs. expected', keep: pos }) },
    { label: 'Unluckiest', text: leaderLine(rows, 'luck', { dir: 'asc', fmt: s, unit: ' wins vs. expected', keep: neg }) },
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
  return { delta: signed(m.delta) + ' vs. Vegas', games, record: m.w + '-' + m.l };
}

export function leagueAveragePayroll(rows) {
  const ps = rows.map((r) => r.payroll).filter((p) => p !== null);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
}

export { DASH };
