// The feeds the update run reads, each fetched and parsed in one place:
//   standings  ESPN's standings feed, else rebuilt from cdn.nba.com's schedule
//   scoreboard ESPN's scoreboard for an ET date, else cdn.nba.com's schedule
//   payroll    Salary Season Finder's data/data.json
// stats.nba.com is never used: it blocks cloud servers. Every request goes
// through lib/http.mjs (browser-like headers, 30s, one retry), the same code
// scripts/probe.mjs uses. scripts/update.mjs decides when to call these and
// what to write.

import { parseEspn, parseNbaSchedule, payrollByTeam } from '../lib/sources.mjs';
import { parseEspnScoreboard, parseNbaScheduleDay } from '../lib/scoreboard.mjs';
import { getJson } from '../lib/http.mjs';

export const SEASON = '2026-27';
const ESPN_SEASON = 2027;               // ESPN names a season by the year it ends
const NBA_SEASON_YEAR = '2026-27';

export const ESPN_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=' + ESPN_SEASON + '&seasontype=2';
export const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=';
export const NBA_SCHEDULE_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
export const SSF_DATA_URL = 'https://jsierrahoopshype.github.io/salary-season-finder/data/data.json';

// The ET calendar date of an instant: a game's date, and "today" for a run.
export function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// The standings sources in the order they are tried. Each fetches and
// parses, so a source that answers with the wrong season or teams fails
// here too. scripts/probe.mjs runs these same functions.
export const SOURCES = [
  { name: 'ESPN', fetch: async (teams) => {
    const parsed = parseEspn(await getJson(ESPN_URL), teams, { season: ESPN_SEASON });
    if (parsed.listed < 30) throw new Error('ESPN listed ' + parsed.listed + ' teams');
    return parsed;
  } },
  { name: 'cdn.nba.com', fetch: async (teams) => parseNbaSchedule(await getJson(NBA_SCHEDULE_URL), teams, { seasonYear: NBA_SEASON_YEAR }) },
];

export async function standings(teams) {
  const errors = [];
  for (const src of SOURCES) {
    try {
      const parsed = await src.fetch(teams);
      console.log('standings: ' + src.name + ' ok (' + parsed.listed + ' teams listed)');
      return parsed;
    } catch (e) {
      errors.push(src.name + ': ' + e.message);
      console.log('standings: ' + src.name + ' failed: ' + e.message);
    }
  }
  throw new Error('no standings source worked:\n  ' + errors.join('\n  '));
}

// Scoreboards for a list of ET dates, from the first source that answers
// for all of them: { source, games } (games in lib/scoreboard.mjs's shape).
// scripts/probe.mjs runs these too.
export const SCOREBOARD_SOURCES = [
  { name: 'ESPN', fetch: async (teams, dates) => {
    const games = [];
    for (const d of dates) games.push(...parseEspnScoreboard(await getJson(ESPN_SCOREBOARD_URL + d.replace(/-/g, '')), teams, d));
    return games;
  } },
  { name: 'cdn.nba.com', fetch: async (teams, dates) => {
    const sched = await getJson(NBA_SCHEDULE_URL);
    return dates.flatMap((d) => parseNbaScheduleDay(sched, teams, d));
  } },
];

export async function scoreboards(teams, dates) {
  const errors = [];
  for (const src of SCOREBOARD_SOURCES) {
    try {
      const games = await src.fetch(teams, dates);
      console.log('scoreboard: ' + src.name + ' ok (' + dates.join(', ') + ': ' + games.length + ' regular-season games)');
      return { source: src.name, games };
    } catch (e) {
      errors.push(src.name + ': ' + e.message);
      console.log('scoreboard: ' + src.name + ' failed: ' + e.message);
    }
  }
  throw new Error('no scoreboard source worked:\n  ' + errors.join('\n  '));
}

// Payroll per team, or null (reason logged): the caller then keeps the
// committed file rather than failing the run.
export async function payroll(teams) {
  try {
    const ssf = await getJson(SSF_DATA_URL);
    const pr = payrollByTeam(ssf, teams, SEASON);
    for (const w of pr.warnings) console.log('payroll warning: ' + w);
    const missing = Object.entries(pr.payroll).filter(([, v]) => !(v > 0)).map(([k]) => k);
    if (missing.length) throw new Error('no payroll for ' + missing.join(','));
    return { season: SEASON, source: SSF_DATA_URL, ssf_built: ssf.meta?.built ?? null, records: pr.records, payroll: pr.payroll };
  } catch (e) {
    console.log('payroll: kept the committed file: ' + e.message);
    return null;
  }
}
