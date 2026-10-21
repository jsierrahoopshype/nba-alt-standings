// Scoreboards: which games are on a given ET date, which have started and
// which are final. Pure parsers over already-fetched JSON, like sources.mjs.
//
// Every game comes out in one shape, whichever feed it came from:
//   { key, id, id_source, date, tip, state, final, periods, home: {abbr, w, l, score}, away: {...} }
// key is "<ET date>_<AWAY>@<HOME>", the same for ESPN and cdn.nba.com, so
// the processed-finals list and the pregame archive never depend on which
// feed answered. state is 'pre', 'in' or 'post'. w and l are the team's
// record as the feed shows it at that moment (null when it shows none);
// score is the team's points (null before tip or when the feed has none).
// periods is how many periods a final game took (4 in regulation, 5 for one
// overtime, ...), null before the final or when the feed does not say.
// Only regular-season games are returned; postponed and canceled games are
// dropped (they never go final, and would hold a night's snapshot forever).

import { teamIndex, parseWL } from './sources.mjs';

export const gameKey = (date, away, home) => date + '_' + away + '@' + home;

// The period count of a final game: the feed's period number when it has
// one, else its status text ("Final" 4, "Final/OT" 5, "Final/2OT" 6).
export function finalPeriods(period, text) {
  const p = Number(period);
  if (Number.isInteger(p) && p >= 4) return p;
  const t = String(text || '');
  const ot = /(\d*)\s*OT\b/i.exec(t);
  if (ot) return 4 + (ot[1] ? Number(ot[1]) : 1);
  return /^\s*final\s*$/i.test(t) ? 4 : null;
}

// ── ESPN: site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD ──
export function parseEspnScoreboard(json, teams, date) {
  const idx = teamIndex(teams);
  const out = [];
  for (const ev of json?.events || []) {
    if (Number(ev.season?.type) !== 2) continue;                       // 1 preseason, 3 playoffs, 5 play-in
    const st = ev.status?.type || {};
    if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/i.test(String(st.name || ''))) continue;
    const comp = (ev.competitions || [])[0] || {};
    const side = (ha) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === ha);
      if (!c) return null;
      const t = idx.byEspn.get(String(c.team?.abbreviation || '').toUpperCase());
      if (!t) throw new Error('ESPN scoreboard: unknown team ' + JSON.stringify(c.team?.abbreviation));
      const rec = (c.records || []).find((r) => r.type === 'total' || r.name === 'overall') || (c.records || [])[0];
      const wl = rec ? parseWL(rec.summary) : null;
      const sc = Number(c.score);
      return { abbr: t.abbr, w: wl ? wl[0] : null, l: wl ? wl[1] : null, score: c.score !== undefined && c.score !== null && c.score !== '' && Number.isFinite(sc) ? sc : null };
    };
    const home = side('home'), away = side('away');
    if (!home || !away) continue;
    const state = st.state === 'post' || st.state === 'in' ? st.state : 'pre';
    const final = st.completed === true;
    out.push({ key: gameKey(date, away.abbr, home.abbr), id: String(ev.id), id_source: 'espn', date, tip: ev.date || null,
      state, final, periods: final ? finalPeriods(ev.status?.period ?? comp.status?.period, st.detail || st.shortDetail || st.description) : null, home, away });
  }
  return out;
}

// ── cdn.nba.com: staticData/scheduleLeagueV2.json (fallback) ──
// gameDateEst is the ET game date; gameStatus 1 scheduled, 2 live, 3 final;
// regular-season ids start "002".
export function parseNbaScheduleDay(json, teams, date) {
  const idx = teamIndex(teams);
  const ls = json?.leagueSchedule;
  if (!ls || !Array.isArray(ls.gameDates)) throw new Error('cdn.nba.com: no leagueSchedule.gameDates');
  const out = [];
  for (const d of ls.gameDates) {
    for (const g of d.games || []) {
      if (!String(g.gameId || '').startsWith('002')) continue;
      if (String(g.gameDateEst || '').slice(0, 10) !== date) continue;
      if (/postpon|cancel|^\s*ppd\s*$/i.test(String(g.gameStatusText || ''))) continue;
      const h = idx.byNbaId.get(Number(g.homeTeam?.teamId)), a = idx.byNbaId.get(Number(g.awayTeam?.teamId));
      if (!h || !a) continue;
      const rec = (t) => (Number.isFinite(Number(t?.wins)) && Number.isFinite(Number(t?.losses)) ? [Number(t.wins), Number(t.losses)] : [null, null]);
      const [hw, hl] = rec(g.homeTeam), [aw, al] = rec(g.awayTeam);
      const score = (t) => (t && t.score !== undefined && t.score !== null && Number.isFinite(Number(t.score)) ? Number(t.score) : null);
      const s = Number(g.gameStatus);
      out.push({ key: gameKey(date, a.abbr, h.abbr), id: String(g.gameId), id_source: 'cdn.nba.com', date, tip: g.gameDateTimeUTC || null,
        state: s === 3 ? 'post' : s === 2 ? 'in' : 'pre', final: s === 3, periods: s === 3 ? finalPeriods(g.period, g.gameStatusText) : null,
        home: { abbr: h.abbr, w: hw, l: hl, score: score(g.homeTeam) }, away: { abbr: a.abbr, w: aw, l: al, score: score(g.awayTeam) } });
    }
  }
  return out;
}

// True when the standings already count this final: both teams have played
// at least as many games as the scoreboard's post-game record says. A feed
// that shows no record cannot be checked, and is taken as counted.
export function standingsReflect(game, standingsTeams) {
  for (const side of [game.home, game.away]) {
    if (side.w === null || side.l === null) continue;
    const row = standingsTeams[side.abbr];
    if (!row || row.gp < side.w + side.l) return false;
  }
  return true;
}

// ── cdn.nba.com: the whole regular season, for "next game" ──
// Every regular-season game ("002" ids) with its ET date, tip time (UTC)
// and teams, in tip order: { season_year, games: [{ key, id, date, tip,
// home, away }] }. Postponed ("PPD") and canceled games are left out.
export function parseSeasonSchedule(json, teams, { seasonYear } = {}) {
  const idx = teamIndex(teams);
  const ls = json?.leagueSchedule;
  if (!ls || !Array.isArray(ls.gameDates)) throw new Error('cdn.nba.com: no leagueSchedule.gameDates');
  if (seasonYear && ls.seasonYear && ls.seasonYear !== seasonYear) {
    throw new Error('cdn.nba.com: schedule is for ' + ls.seasonYear + ', wanted ' + seasonYear);
  }
  const games = [];
  for (const d of ls.gameDates) {
    for (const g of d.games || []) {
      if (!String(g.gameId || '').startsWith('002')) continue;
      if (/postpon|cancel|^\s*ppd\s*$/i.test(String(g.gameStatusText || ''))) continue;
      const h = idx.byNbaId.get(Number(g.homeTeam?.teamId)), a = idx.byNbaId.get(Number(g.awayTeam?.teamId));
      const date = String(g.gameDateEst || '').slice(0, 10);
      if (!h || !a || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      games.push({ key: gameKey(date, a.abbr, h.abbr), id: String(g.gameId), date, tip: g.gameDateTimeUTC || null, home: h.abbr, away: a.abbr });
    }
  }
  games.sort((x, y) => (x.tip || x.date).localeCompare(y.tip || y.date) || x.key.localeCompare(y.key));
  if (games.length < 1000) throw new Error('cdn.nba.com: only ' + games.length + ' regular-season games');
  return { season_year: ls.seasonYear || null, games };
}
