// Scoreboards: which games are on a given ET date, which have started and
// which are final. Pure parsers over already-fetched JSON, like sources.mjs.
//
// Every game comes out in one shape, whichever feed it came from:
//   { key, id, id_source, date, tip, state, final, home: {abbr, w, l, score}, away: {...} }
// key is "<ET date>_<AWAY>@<HOME>", the same for ESPN and cdn.nba.com, so
// the processed-finals list and the pregame archive never depend on which
// feed answered. state is 'pre', 'in' or 'post'. w and l are the team's
// record as the feed shows it at that moment (null when it shows none);
// score is the team's points (null before tip or when the feed has none).
// Only regular-season games are returned; postponed and canceled games are
// dropped (they never go final, and would hold a night's snapshot forever).

import { teamIndex, parseWL } from './sources.mjs';

export const gameKey = (date, away, home) => date + '_' + away + '@' + home;

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
    out.push({ key: gameKey(date, away.abbr, home.abbr), id: String(ev.id), id_source: 'espn', date, tip: ev.date || null,
      state, final: st.completed === true, home, away });
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
      if (/postpon|cancel/i.test(String(g.gameStatusText || ''))) continue;
      const h = idx.byNbaId.get(Number(g.homeTeam?.teamId)), a = idx.byNbaId.get(Number(g.awayTeam?.teamId));
      if (!h || !a) continue;
      const rec = (t) => (Number.isFinite(Number(t?.wins)) && Number.isFinite(Number(t?.losses)) ? [Number(t.wins), Number(t.losses)] : [null, null]);
      const [hw, hl] = rec(g.homeTeam), [aw, al] = rec(g.awayTeam);
      const score = (t) => (t && t.score !== undefined && t.score !== null && Number.isFinite(Number(t.score)) ? Number(t.score) : null);
      const s = Number(g.gameStatus);
      out.push({ key: gameKey(date, a.abbr, h.abbr), id: String(g.gameId), id_source: 'cdn.nba.com', date, tip: g.gameDateTimeUTC || null,
        state: s === 3 ? 'post' : s === 2 ? 'in' : 'pre', final: s === 3,
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
