import type { GameStatus } from "@sp/engine";
import { nowIso, tx } from "./db.ts";
import type { Db } from "./db.ts";
import { currentWeek } from "@sp/engine";
import { leagueGames, toLeague } from "./store.ts";

/**
 * Schedules and scores come from a feed named on the league. Today that is
 * ESPN's public scoreboard, which covers every sport ESPN does -- so
 * `espn:football/nfl` and `espn:football/college-football` both work with
 * no code change. A league on the `manual` feed gets no sync; its admin
 * enters games by hand.
 *
 * ESPN's endpoint is unofficial and undocumented. If it changes shape, the
 * fix belongs here, and admins can keep a season going by hand meanwhile.
 */

export interface FeedSpec {
  feed: string;
  season: number;
  seasonType: number;
}

export function isEspnFeed(feed: string): boolean {
  return /^espn:[a-z-]+\/[a-z-]+$/.test(feed);
}

interface EspnCompetitor {
  homeAway: "home" | "away";
  score?: string;
  team: { abbreviation: string; displayName: string; logo?: string };
}
interface EspnEvent {
  id: string;
  date: string;
  week?: { number: number };
  competitions: {
    competitors: EspnCompetitor[];
    status: { type: { name: string; state: "pre" | "in" | "post"; completed: boolean } };
  }[];
}

function espnStatus(t: { name: string; state: string; completed: boolean }): GameStatus {
  if (t.name === "STATUS_POSTPONED") return "postponed";
  if (t.name === "STATUS_CANCELED") return "canceled";
  if (t.state === "post" && t.completed) return "final";
  if (t.state === "in" || t.state === "post") return "in_progress";
  return "scheduled";
}

export async function syncWeeks(db: Db, spec: FeedSpec, weeks: number[]): Promise<number> {
  if (!isEspnFeed(spec.feed)) return 0;
  const path = spec.feed.slice("espn:".length);
  let count = 0;

  for (const week of weeks) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${spec.season}&seasontype=${spec.seasonType}&week=${week}&limit=100`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`ESPN ${res.status} for ${spec.feed} ${spec.season} week ${week}`);
    const body = (await res.json()) as { events?: EspnEvent[] };

    const upsert = db.prepare(`
      INSERT INTO game (id, feed, season, season_type, week, kickoff, home_team, away_team, home_name, away_name,
                        home_logo, away_logo, home_score, away_score, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        week = excluded.week, kickoff = excluded.kickoff,
        home_team = excluded.home_team, away_team = excluded.away_team,
        home_name = excluded.home_name, away_name = excluded.away_name,
        home_logo = excluded.home_logo, away_logo = excluded.away_logo,
        home_score = excluded.home_score, away_score = excluded.away_score,
        status = excluded.status, updated_at = excluded.updated_at
      WHERE game.admin_override = 0`);

    tx(db, () => {
      for (const ev of body.events ?? []) {
        const comp = ev.competitions[0];
        const home = comp?.competitors.find((t) => t.homeAway === "home");
        const away = comp?.competitors.find((t) => t.homeAway === "away");
        if (!comp || !home || !away) continue;
        const status = espnStatus(comp.status.type);
        const scored = status === "in_progress" || status === "final";
        upsert.run(
          `${spec.feed}:${ev.id}`,
          spec.feed,
          spec.season,
          spec.seasonType,
          ev.week?.number ?? week,
          new Date(ev.date).toISOString(),
          home.team.abbreviation,
          away.team.abbreviation,
          home.team.displayName,
          away.team.displayName,
          home.team.logo ?? null,
          away.team.logo ?? null,
          scored && home.score != null ? Number(home.score) : null,
          scored && away.score != null ? Number(away.score) : null,
          status,
          nowIso(),
        );
        count++;
      }
    });
  }
  return count;
}

/** Background sync: for every active league, refresh last week and this
 *  week. The full season is pulled when a league is created or an admin
 *  presses Sync. Feeds shared by several leagues are fetched once. */
export async function syncActive(db: Db): Promise<void> {
  const leagues = (db.prepare("SELECT * FROM league WHERE archived = 0").all() as Record<string, unknown>[]).map(toLeague);
  const todo = new Map<string, { spec: FeedSpec; weeks: Set<number> }>();
  const now = new Date();

  for (const l of leagues) {
    if (!isEspnFeed(l.feed)) continue;
    const key = `${l.feed}|${l.season}|${l.seasonType}`;
    const entry = todo.get(key) ?? { spec: { feed: l.feed, season: l.season, seasonType: l.seasonType }, weeks: new Set() };
    const games = leagueGames(db, l);
    if (games.length === 0) {
      for (let w = l.rules.startWeek; w <= l.rules.endWeek; w++) entry.weeks.add(w);
    } else {
      const cw = currentWeek(games, l.rules, now);
      entry.weeks.add(cw);
      if (cw > l.rules.startWeek) entry.weeks.add(cw - 1);
    }
    todo.set(key, entry);
  }

  for (const { spec, weeks } of todo.values()) {
    try {
      await syncWeeks(db, spec, [...weeks].sort((a, b) => a - b));
    } catch (e) {
      console.error("sync failed", spec, e);
    }
  }
}
