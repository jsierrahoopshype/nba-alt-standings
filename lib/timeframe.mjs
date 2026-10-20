// Timeframes: Season (the current standings), "As of" a saved night, and
// "Since" a saved night (the current standings minus that night's). Pure
// functions over the standings shape { ABBR: { w, l, gp, pf, pa, home_w,
// home_l, road_w, road_l } }, shared by the build, the page script and the
// tests. Dates are ET game dates, "YYYY-MM-DD".

export const FIELDS = ['w', 'l', 'pf', 'pa', 'home_w', 'home_l', 'road_w', 'road_l'];
export const PRESETS = { last7: 7, last15: 15 };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The latest saved date on or before `target`, or null.
export function nearestOnOrBefore(dates, target) {
  let best = null;
  for (const d of dates) if (d <= target && (best === null || d > best)) best = d;
  return best;
}

const zeroRow = () => ({ w: 0, l: 0, gp: 0, pf: 0, pa: 0, home_w: 0, home_l: 0, road_w: 0, road_l: 0 });

// latest minus base, per team. A team with no games in between comes out
// 0-0 (GP 0), which every metric already shows as a dash. A field that would
// go negative (a feed correction between the two nights) is held at 0.
export function subtractStandings(latest, base) {
  const out = {};
  for (const [abbr, cur] of Object.entries(latest)) {
    const b = (base && base[abbr]) || zeroRow();
    const r = zeroRow();
    for (const f of FIELDS) r[f] = Math.max(0, (cur[f] || 0) - (b[f] || 0));
    r.gp = r.w + r.l;
    out[abbr] = r;
  }
  return out;
}

// Compact form for the page: one array of FIELDS per team, in teams order.
export const packTeams = (teamsStandings, order) => order.map((a) => FIELDS.map((f) => teamsStandings[a][f] || 0));
export function unpackTeams(packed, order) {
  const out = {};
  order.forEach((a, i) => {
    const r = zeroRow();
    FIELDS.forEach((f, j) => { r[f] = packed[i][j]; });
    r.gp = r.w + r.l;
    out[a] = r;
  });
  return out;
}

// Reads ?asof= / ?since= into what to show. Returns:
//   { kind: 'season' }
//   { kind: 'asof' | 'since', requested, used, fallback, preset, invalid }
// used is the saved date actually used (null: nothing saved on or before
// the request, so "as of" is the 0-0 start and "since" is the whole season).
// fallback is true when used differs from the requested date. A preset
// (last7, last15) counts back from the latest game date: "last 7 days" is
// every game after the night 7 days before it.
export function resolveTimeframe(params, { dates, gameDate }) {
  const asof = params.asof, since = params.since;
  let kind, requested, preset = null;
  if (asof && ISO.test(asof)) { kind = 'asof'; requested = asof; }
  else if (since && PRESETS[since]) {
    // Before the first game there is nothing to count back from: the window
    // is the season so far (still its own view, noindex like the others).
    if (!gameDate) return { kind: 'since', requested: null, used: null, fallback: false, preset: since };
    kind = 'since'; preset = since; requested = addDays(gameDate, -PRESETS[since]);
  } else if (since && ISO.test(since)) { kind = 'since'; requested = since; }
  else return { kind: 'season', invalid: asof || since || null };
  const used = nearestOnOrBefore(dates, requested);
  return { kind, requested, used, fallback: used !== requested, preset };
}

// The standings a timeframe shows, from the current standings and the
// saved nights (date -> standings).
export function standingsFor(tf, current, snapshots) {
  if (tf.kind === 'season') return current;
  const snap = tf.used ? snapshots[tf.used] : null;
  if (tf.kind === 'asof') return snap ? subtractStandings(snap, null) : subtractStandings(current, current);
  return subtractStandings(current, snap);
}

export const gamesIn = (standings) => Object.values(standings).reduce((s, r) => s + (r.gp || 0), 0) / 2;
