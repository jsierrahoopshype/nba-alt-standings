// Small line charts for the team pages: inline SVG, no library. One x step
// per saved game night; one or two lines; nulls leave a gap. Drawn in a
// 340x170 box that scales to the column, so at 360px it is close to 1:1.

import { esc, fmtDay } from './render.mjs';

const W = 340, H = 170, ML = 44, MR = 12, MT = 12, MB = 26;

// The drawn range: the data (and 0 for a signed metric) plus a little air,
// never below 0 for a metric that never goes negative (wins, $ per Win).
function niceDomain(vals, { zero, invert, fixed }) {
  if (fixed) return fixed;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  if (invert) return [lo, hi];
  return [Math.min(...vals) >= 0 && !zero ? Math.max(0, lo - pad) : lo - pad, hi + pad];
}

// series: [{ name, values: [number|null per date], cls }]
// opts: { fmt(v) for axis labels, zero: draw a 0 line, invert: low values
// at the top (ranks), fixed: [lo, hi] }
export function lineChart(title, dates, series, opts = {}) {
  const fmt = opts.fmt || ((v) => String(v));
  const vals = series.flatMap((s) => s.values).filter((v) => v !== null && Number.isFinite(v));
  const head = `<figure class="mchart"><h3>${esc(title)}</h3>`;
  if (!vals.length) return head + '<p class="mchart-empty">No data yet.</p></figure>';
  const [lo, hi] = niceDomain(vals, opts);
  const n = dates.length;
  const X = (i) => ML + (n === 1 ? (W - ML - MR) / 2 : (i / (n - 1)) * (W - ML - MR));
  const Y = (v) => {
    const f = (v - lo) / (hi - lo);
    return MT + (opts.invert ? f : 1 - f) * (H - MT - MB);
  };
  const out = [head, `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`];
  // Axis labels at the lowest and highest values actually reached (the
  // ends of a fixed range), and at 0 for a signed metric; a label that would
  // sit on top of another is dropped (its grid line stays).
  const dlo = opts.fixed ? opts.fixed[0] : Math.min(...vals), dhi = opts.fixed ? opts.fixed[1] : Math.max(...vals);
  const ticks = opts.zero && lo < 0 && hi > 0 ? [0, dhi, dlo] : [dhi, dlo];
  const placed = [];
  for (const t of ticks) {
    const y = Y(t);
    if (t === 0 && opts.zero) out.push(`<line class="grid" x1="${ML}" x2="${W - MR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke-dasharray="4 3"/>`);
    else out.push(`<line class="grid" x1="${ML}" x2="${W - MR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    if (placed.some((p) => Math.abs(p - y) < 12)) continue;
    placed.push(y);
    out.push(`<text class="ax" x="${ML - 5}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`);
  }
  out.push(`<text class="ax" x="${ML}" y="${H - 8}">${esc(fmtDay(dates[0]))}</text>`);
  if (n > 1) out.push(`<text class="ax" x="${W - MR}" y="${H - 8}" text-anchor="end">${esc(fmtDay(dates[n - 1]))}</text>`);
  for (const s of series) {
    // One path per run of non-null values.
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return; }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ';
      pen = true;
    });
    out.push(`<path class="ln ${s.cls || ''}" d="${d.trim()}"/>`);
    const li = s.values.map((v, i) => (v !== null && Number.isFinite(v) ? i : -1)).filter((i) => i >= 0).pop();
    if (li !== undefined) out.push(`<circle class="dot ${s.cls || ''}" cx="${X(li).toFixed(1)}" cy="${Y(s.values[li]).toFixed(1)}" r="3"/>`);
  }
  out.push('</svg>');
  if (series.length > 1) {
    out.push('<figcaption class="legend">' + series.map((s) => `<span class="key ${s.cls || ''}">${esc(s.name)}</span>`).join('') + '</figcaption>');
  }
  out.push('</figure>');
  return out.join('');
}
