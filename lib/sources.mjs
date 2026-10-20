// Parsers for the three inputs the nightly run fetches. Pure functions over
// already-fetched JSON, so the tests can feed them fixtures.

// ── Team lookup ──

export function teamIndex(teams) {
  const byAbbr = new Map(), byEspn = new Map(), byNbaId = new Map(), byName = new Map();
  for (const t of teams) {
    byAbbr.set(t.abbr, t);
    byNbaId.set(t.nba_id, t);
    byName.set(t.name.toLowerCase(), t);
    for (const a of t.espn) byEspn.set(a.toUpperCase(), t);
  }
  return { byAbbr, byEspn, byNbaId, byName };
}

const emptyRow = () => ({ w: 0, l: 0, gp: 0, pf: 0, pa: 0, home_w: 0, home_l: 0, road_w: 0, road_l: 0 });

// "12-8" (or "12-8-0") -> [12, 8]
export function parseWL(s) {
  const m = /^\s*(\d+)\s*-\s*(\d+)/.exec(String(s ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// ── ESPN: site.api.espn.com/apis/v2/sports/basketball/nba/standings ──
//
// children[] are the two conferences; each entry is a team with a stats[]
// array. Stats are looked up by name OR type, case-insensitively, because the
// feed has used both spellings over the years. pointsFor/pointsAgainst are
// season totals; when only the per-game averages are present the totals are
// rebuilt from them (and the average itself is a rounded figure, so the
// totals are then approximate to within half a point per game).
export function parseEspn(json, teams, { season } = {}) {
  const idx = teamIndex(teams);
  const out = {};
  const children = Array.isArray(json?.children) ? json.children : [];
  const seasons = new Set();
  for (const conf of children) {
    const st = conf.standings || {};
    if (st.season != null) seasons.add(Number(st.season));
    for (const e of st.entries || []) {
      const tm = e.team || {};
      const team = idx.byEspn.get(String(tm.abbreviation || '').toUpperCase())
        || idx.byName.get(String(tm.displayName || '').toLowerCase());
      if (!team) throw new Error('ESPN: unknown team ' + JSON.stringify(tm.abbreviation || tm.displayName));
      const stat = (...keys) => {
        const want = keys.map((k) => k.toLowerCase());
        return (e.stats || []).find((s) => want.includes(String(s.name || '').toLowerCase())
          || want.includes(String(s.type || '').toLowerCase()));
      };
      const val = (...keys) => {
        const s = stat(...keys);
        const v = s ? Number(s.value) : NaN;
        return Number.isFinite(v) ? v : null;
      };
      const row = emptyRow();
      row.w = val('wins') ?? 0;
      row.l = val('losses') ?? 0;
      row.gp = row.w + row.l;
      const pf = val('pointsFor'), pa = val('pointsAgainst');
      const apf = val('avgPointsFor'), apa = val('avgPointsAgainst');
      row.pf = pf ?? (apf !== null ? Math.round(apf * row.gp) : 0);
      row.pa = pa ?? (apa !== null ? Math.round(apa * row.gp) : 0);
      // A feed that ever sends pointsFor as a per-game figure is caught here:
      // a total can only be below 200 when fewer than two games were played.
      if (row.gp >= 2 && row.pf > 0 && row.pf < 200) row.pf = Math.round(row.pf * row.gp);
      if (row.gp >= 2 && row.pa > 0 && row.pa < 200) row.pa = Math.round(row.pa * row.gp);
      const home = parseWL((stat('home') || {}).summary ?? (stat('home') || {}).displayValue);
      const road = parseWL((stat('road', 'away') || {}).summary ?? (stat('road', 'away') || {}).displayValue);
      if (home) [row.home_w, row.home_l] = home;
      if (road) [row.road_w, row.road_l] = road;
      out[team.abbr] = row;
    }
  }
  if (season != null && seasons.size && !seasons.has(Number(season))) {
    throw new Error('ESPN: feed is for season ' + [...seasons].join(',') + ', wanted ' + season);
  }
  return finish(out, teams, 'espn');
}

// ── cdn.nba.com: staticData/scheduleLeagueV2.json ──
//
// The fallback. No standings file there, so the standings are rebuilt from
// every final regular-season game in the season schedule: game ids starting
// "002" are the regular season (the NBA Cup final, which does not count in
// the standings, is "006"); gameStatus 3 is final.
export function parseNbaSchedule(json, teams, { seasonYear } = {}) {
  const idx = teamIndex(teams);
  const ls = json?.leagueSchedule;
  if (!ls || !Array.isArray(ls.gameDates)) throw new Error('cdn.nba.com: no leagueSchedule.gameDates');
  if (seasonYear && ls.seasonYear && ls.seasonYear !== seasonYear) {
    throw new Error('cdn.nba.com: schedule is for ' + ls.seasonYear + ', wanted ' + seasonYear);
  }
  const out = {};
  for (const t of teams) out[t.abbr] = emptyRow();
  for (const d of ls.gameDates) {
    for (const g of d.games || []) {
      if (!String(g.gameId || '').startsWith('002') || Number(g.gameStatus) !== 3) continue;
      const h = idx.byNbaId.get(Number(g.homeTeam?.teamId)), a = idx.byNbaId.get(Number(g.awayTeam?.teamId));
      if (!h || !a) continue;
      const hs = Number(g.homeTeam.score), as = Number(g.awayTeam.score);
      if (!Number.isFinite(hs) || !Number.isFinite(as) || hs === as) continue;
      const H = out[h.abbr], A = out[a.abbr];
      H.pf += hs; H.pa += as; A.pf += as; A.pa += hs;
      if (hs > as) { H.w++; H.home_w++; A.l++; A.road_l++; }
      else { A.w++; A.road_w++; H.l++; H.home_l++; }
    }
  }
  for (const r of Object.values(out)) r.gp = r.w + r.l;
  return finish(out, teams, 'cdn.nba.com');
}

// Every team present exactly once, nothing extra. A team the feed skipped
// (it happens before opening night) is 0-0 rather than missing.
function finish(out, teams, source) {
  const extra = Object.keys(out).filter((k) => !teams.some((t) => t.abbr === k));
  if (extra.length) throw new Error(source + ': unexpected teams ' + extra.join(','));
  const rows = {};
  for (const t of teams) rows[t.abbr] = out[t.abbr] || emptyRow();
  const listed = Object.keys(out).length;
  const totW = Object.values(rows).reduce((s, r) => s + r.w, 0);
  const totL = Object.values(rows).reduce((s, r) => s + r.l, 0);
  if (totW !== totL) throw new Error(source + ': league wins ' + totW + ' != losses ' + totL);
  return { source, listed, teams: rows };
}

// ── Salary Season Finder: data/data.json ──
//
// One record per player per season. A player whose salary that season is
// split between teams (traded, or waived and stretched) has team "A, B" and a
// team_salaries map; that map is what gets summed, so each team carries only
// its own share. A multi-team record without the map is split evenly, which
// has not happened in the data so far and is reported if it does.
export function payrollByTeam(json, teams, season) {
  const valid = new Set(teams.map((t) => t.abbr));
  const total = Object.fromEntries(teams.map((t) => [t.abbr, 0]));
  const warnings = [];
  let records = 0;
  for (const r of json?.seasons || []) {
    if (r.season !== season) continue;
    const salary = Number(r.salary);
    if (!Number.isFinite(salary) || salary <= 0) continue;
    records++;
    if (r.team_salaries && typeof r.team_salaries === 'object') {
      for (const [abbr, amt] of Object.entries(r.team_salaries)) {
        if (valid.has(abbr) && Number.isFinite(Number(amt))) total[abbr] += Number(amt);
        else warnings.push('unknown team ' + abbr + ' for ' + r.player);
      }
      continue;
    }
    const codes = String(r.team || '').split(',').map((s) => s.trim()).filter(Boolean);
    const known = codes.filter((c) => valid.has(c));
    if (!known.length) { warnings.push('no team for ' + r.player); continue; }
    if (known.length > 1) warnings.push('split evenly: ' + r.player + ' ' + r.team);
    for (const c of known) total[c] += salary / known.length;
  }
  for (const k of Object.keys(total)) total[k] = Math.round(total[k]);
  return { season, records, payroll: total, warnings };
}
