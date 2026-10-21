// Every metric: a hand-checked example, GP = 0 (pre-season / opening night),
// W = 0, and the formatting rules (signs, decimals, the dash).
//
// Run: node test/metrics.test.mjs

import * as M from '../lib/metrics.mjs';

let failed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) { failed++; if (detail !== undefined) console.log('        ' + JSON.stringify(detail)); }
};
const close = (a, b, eps = 1e-9) => typeof a === 'number' && Math.abs(a - b) < eps;
const DASH = '—', MINUS = '−';

// ── 1. Known example, worked out by hand ──
// 12-8 (20 GP), line 41.5, 37 wins last season, $180M payroll, PF 2300, PA 2200,
// 7-3 at home, 5-5 on the road.
//   Pct        12/20                                 = 60.0%
//   vs. Vegas  12 - 20*41.5/82 = 12 - 10.12195       = +1.878 -> +1.9
//   vs. Last   12 - 20*37/82   = 12 - 9.02439        = +2.976 -> +3.0
//   $ per Win  180M * 20/82 / 12 = 43.902M / 12      = $3.658M -> $3.66M
//   Pt Diff    (2300-2200)/20                        = +5.0
//   Exp. W     20 * 2300^14/(2300^14+2200^14)        = 13.0149 -> 13-7
//   Luck       12 - 13.0149                          = -1.0149 -> -1.0
//   Road W - Home L   5 - 3                          = +2
const ex = { w: 12, l: 8, gp: 20, line: 41.5, last_season_wins: 37, payroll: 180e6, pf: 2300, pa: 2200,
  home_w: 7, home_l: 3, road_w: 5, road_l: 5 };
ok('example: pct 0.6', close(M.pct(ex), 0.6));
// vs. Vegas and vs. Last Year: Pct minus line / 82 (or last season's wins / 82).
ok('example: vs. Vegas 12/20 - 41.5/82 = 0.0939', close(M.vsVegas(ex), 12 / 20 - 41.5 / 82));
ok('example: vs. Last Year 12/20 - 37/82 = 0.1488', close(M.vsLastYear(ex), 12 / 20 - 37 / 82));
// $ per Win: the full payroll over wins, no proration.
ok('example: $ per win 180M / 12 = 15,000,000', close(M.dollarsPerWin(ex), 180e6 / 12, 1e-6));
ok('example: pt diff 5', close(M.ptDiff(ex), 5));
const direct = 20 * 2300 ** 14 / (2300 ** 14 + 2200 ** 14);
ok('example: expected W equals the PF^14/(PF^14+PA^14) form (13.0149)', close(M.expectedWins(ex), direct, 1e-9) && close(direct, 13.0149415, 1e-6), M.expectedWins(ex));
ok('example: luck -1.0149', close(M.luck(ex), 12 - direct, 1e-9));
ok('example: road W - home L = 2', M.roadWMinusHomeL(ex) === 2);
const tx = M.teamMetrics(ex).text;
ok('example text: Pct 60.0%', tx.pct === '60.0%', tx.pct);
ok('example text: vs. Vegas +9.4%', tx.vsVegas === '+9.4%', tx.vsVegas);
ok('example text: vs. Last Year +14.9%', tx.vsLastYear === '+14.9%', tx.vsLastYear);
ok('example text: $ per Win $15.0M', tx.dollarsPerWin === '$15.0M', tx.dollarsPerWin);
ok('example text: Pt Diff +5.0', tx.ptDiff === '+5.0', tx.ptDiff);
ok('example text: Exp. W-L 13-7', tx.expWL === '13-7', tx.expWL);
ok('example text: Luck -1.0 (minus sign)', tx.luck === MINUS + '1.0', tx.luck);
ok('example text: Road W - Home L +2', tx.roadMinusHome === '+2', tx.roadMinusHome);

// The spec's own format example: $14.33M.
ok('format: $14,330,000 -> $14.3M, $210,449,999 -> $210.4M', M.fmtMoneyM(14.33e6) === '$14.3M' && M.fmtMoneyM(210449999) === '$210.4M');
ok('format: percentage points +39.6%, minus sign, 0.0%', M.fmtPctPts(1 - 49.5 / 82) === '+39.6%' && M.fmtPctPts(-0.25) === MINUS + '25.0%' && M.fmtPctPts(0.0004) === '0.0%' && M.fmtPctPts(null) === DASH);
ok('format: 0.5 -> 50.0%', M.fmtPct(0.5) === '50.0%');
ok('format: signed 2.3 -> +2.3, -2.3 -> minus 2.3, 0 -> 0.0', M.signed(2.3) === '+2.3' && M.signed(-2.3) === MINUS + '2.3' && M.signed(0) === '0.0');
ok('format: -0.04 rounds to 0.0, never "-0.0"', M.signed(-0.04) === '0.0', M.signed(-0.04));
ok('format: 1.25 -> +1.3 (half away from zero, float-safe)', M.signed(1.25) === '+1.3' && M.signed(-1.25) === MINUS + '1.3');

// ── 2. GP = 0: every metric is null and every cell a dash ──
const zero = { w: 0, l: 0, gp: 0, line: 41.5, last_season_wins: 37, payroll: 180e6, pf: 0, pa: 0, home_w: 0, home_l: 0, road_w: 0, road_l: 0 };
const z = M.teamMetrics(zero);
ok('GP=0: every value is null', Object.values(z.value).every((v) => v === null), z.value);
ok('GP=0: every text is the dash', Object.values(z.text).every((v) => v === DASH), z.text);
const noNaN = (o) => !Object.values(o).some((v) => /NaN|Infinity/.test(String(v)));
ok('GP=0: no NaN or Infinity anywhere', noNaN(z.value) && noNaN(z.text));
// A team whose row is missing fields entirely (feed skipped it) is also safe.
const bare = M.teamMetrics({ w: 0, l: 0, gp: 0 });
ok('GP=0, missing line/payroll/points: dashes, no NaN', Object.values(bare.text).every((v) => v === DASH) && noNaN(bare.text));

// ── 3. W = 0 after games: $ per Win is a dash, the rest are numbers ──
const winless = { w: 0, l: 5, gp: 5, line: 20.5, last_season_wins: 22, payroll: 150e6, pf: 500, pa: 600, home_w: 0, home_l: 3, road_w: 0, road_l: 2 };
const wl = M.teamMetrics(winless);
ok('W=0: $ per Win is null and shows the dash', wl.value.dollarsPerWin === null && wl.text.dollarsPerWin === DASH);
ok('W=0: Pct 0.0%', wl.text.pct === '0.0%', wl.text.pct);
ok('W=0: vs. Vegas = 0 - 20.5/82 = -0.25 -> minus 25.0%', close(wl.value.vsVegas, -0.25) && wl.text.vsVegas === MINUS + '25.0%', wl.text.vsVegas);
ok('W=0: vs. Last Year = 0 - 22/82 -> minus 26.8%', close(wl.value.vsLastYear, -22 / 82) && wl.text.vsLastYear === MINUS + '26.8%', wl.text.vsLastYear);
ok('W=0: Pt Diff -20.0', wl.text.ptDiff === MINUS + '20.0', wl.text.ptDiff);
const e0 = 5 * 500 ** 14 / (500 ** 14 + 600 ** 14);
ok('W=0: Exp W-L 0-5 (expected ' + e0.toFixed(3) + ')', wl.text.expWL === '0-5', wl.text.expWL);
ok('W=0: luck = -expected', close(wl.value.luck, -e0, 1e-9));
ok('W=0: road W - home L = -3', wl.value.roadMinusHome === -3 && wl.text.roadMinusHome === MINUS + '3');
ok('W=0: no NaN or Infinity', noNaN(wl.value) && noNaN(wl.text));

// ── 4. Edge cases ──
ok('payroll missing: $ per Win dash', M.teamMetrics({ ...ex, payroll: null }).text.dollarsPerWin === DASH);
ok('PF 0 after a game (impossible, but safe): expected W 0, no NaN', M.expectedWins({ gp: 1, w: 0, pf: 0, pa: 100 }) === 0);
ok('PF = PA = 0 after games: expected W dash', M.teamMetrics({ ...zero, gp: 1, l: 1 }).text.expWL === DASH);
ok('season-long totals do not overflow (9,500 vs 9,200 over 82 GP)', Number.isFinite(M.expectedWins({ gp: 82, w: 50, pf: 9500, pa: 9200 })));
ok('perfect PF/PA symmetry: expected W = GP/2', close(M.expectedWins({ gp: 10, w: 5, pf: 1100, pa: 1100 }), 5));
ok('Exp W-L rounds half up: 10.5 -> 11', M.fmtRecord({ w: Math.round(10.5), l: 21 - Math.round(10.5) }) === '11-10');

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed');
process.exit(failed ? 1 : 0);
