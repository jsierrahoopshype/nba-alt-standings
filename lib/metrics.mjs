// The metrics behind every column. Each compute function returns a number, or
// null when it cannot be computed (no games played, no wins, missing input).
// Each format function turns that into what the page shows, and null always
// becomes DASH: nothing on the page can read NaN or Infinity.

export const SEASON_GAMES = 82;
export const PYTHAG_EXP = 14;
export const DASH = '—';
const MINUS = '−';

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const hasGames = (t) => num(t.gp) && t.gp > 0;

// Rounds half away from zero at `d` decimals, after nudging off binary float
// error (1.25 stored as 1.2499999 must still round to 1.3).
export function round(x, d = 1) {
  if (!num(x)) return null;
  const f = 10 ** d;
  const r = Math.round(Math.abs(x) * f + 1e-9) / f;
  return x < 0 ? -r : r;
}

export function pct(t) {
  return hasGames(t) ? t.w / t.gp : null;
}

// Wins above the pace of a full-season total, over the games played so far.
export function vsPace(t, total) {
  return hasGames(t) && num(total) ? t.w - t.gp * (total / SEASON_GAMES) : null;
}
export const vsVegas = (t) => vsPace(t, t.line);
export const vsLastYear = (t) => vsPace(t, t.last_season_wins);

// Payroll prorated to the games played, per win. No wins, no number.
export function dollarsPerWin(t) {
  if (!hasGames(t) || !num(t.payroll) || !num(t.w) || t.w <= 0) return null;
  return t.payroll * (t.gp / SEASON_GAMES) / t.w;
}

export function ptDiff(t) {
  return hasGames(t) && num(t.pf) && num(t.pa) ? (t.pf - t.pa) / t.gp : null;
}

// Pythagorean expectation, exponent 14, written as 1 / (1 + (PA/PF)^14) so
// season-long point totals never get raised to the 14th power directly.
export function expectedWins(t) {
  if (!hasGames(t) || !num(t.pf) || !num(t.pa) || t.pf < 0 || t.pa < 0) return null;
  if (t.pf + t.pa === 0) return null;
  if (t.pf === 0) return 0;
  return t.gp / (1 + (t.pa / t.pf) ** PYTHAG_EXP);
}

export function expectedRecord(t) {
  const e = expectedWins(t);
  if (e === null) return null;
  const w = Math.round(e);
  return { w, l: t.gp - w };
}

export function luck(t) {
  const e = expectedWins(t);
  return e === null ? null : t.w - e;
}

export function roadWMinusHomeL(t) {
  return hasGames(t) && num(t.road_w) && num(t.home_l) ? t.road_w - t.home_l : null;
}

// ── Formatting ──

export function signed(x, d = 1) {
  const r = round(x, d);
  if (r === null) return DASH;
  const s = Math.abs(r).toFixed(d);
  if (r > 0) return '+' + s;
  if (r < 0) return MINUS + s;
  return (0).toFixed(d);
}

export const fmtPct = (x) => (x === null || !num(x) ? DASH : round(x * 100, 1).toFixed(1) + '%');
export const fmtMoneyM = (x) => (x === null || !num(x) ? DASH : '$' + round(x / 1e6, 2).toFixed(2) + 'M');
export const fmtRecord = (r) => (r ? r.w + '-' + r.l : DASH);
export const fmtSignedInt = (x) => (x === null || !num(x) ? DASH : signed(x, 0));

// Every metric for one team: the raw value (for sorting and the leader
// lines) and the text the page shows.
export function teamMetrics(t) {
  const exp = expectedRecord(t);
  const v = {
    pct: pct(t),
    vsVegas: vsVegas(t),
    vsLastYear: vsLastYear(t),
    dollarsPerWin: dollarsPerWin(t),
    ptDiff: ptDiff(t),
    expW: exp ? exp.w : null,
    luck: luck(t),
    roadMinusHome: roadWMinusHomeL(t),
  };
  return {
    value: v,
    text: {
      pct: fmtPct(v.pct),
      vsVegas: signed(v.vsVegas),
      vsLastYear: signed(v.vsLastYear),
      dollarsPerWin: fmtMoneyM(v.dollarsPerWin),
      ptDiff: signed(v.ptDiff),
      expWL: fmtRecord(exp),
      luck: signed(v.luck),
      roadMinusHome: fmtSignedInt(v.roadMinusHome),
    },
  };
}
