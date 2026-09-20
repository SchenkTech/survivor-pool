import type { Game, GameStatus, LockMode, MissedPick, Pick, Rules, TieResult } from "@sp/engine";
import type { Db } from "./db.ts";

/** Row <-> domain mapping and the queries more than one route needs. */

export interface User {
  id: string;
  email: string;
  name: string;
  pictureUrl: string | null;
  role: "admin" | "member";
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface League {
  id: string;
  name: string;
  description: string;
  feed: string;
  season: number;
  seasonType: number;
  archived: boolean;
  createdAt: string;
  rules: Rules;
}

export interface GameRow extends Game {
  feed: string;
  season: number;
  seasonType: number;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  adminOverride: boolean;
}

type Row = Record<string, unknown>;

export function toUser(r: Row): User {
  return {
    id: r.id as string,
    email: r.email as string,
    name: r.name as string,
    pictureUrl: (r.picture_url as string) ?? null,
    role: r.role as User["role"],
    disabled: !!r.disabled,
    createdAt: r.created_at as string,
    lastLoginAt: (r.last_login_at as string) ?? null,
  };
}

export function toLeague(r: Row): League {
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    feed: r.feed as string,
    season: Number(r.season),
    seasonType: Number(r.season_type),
    archived: !!r.archived,
    createdAt: r.created_at as string,
    rules: {
      startWeek: Number(r.start_week),
      endWeek: Number(r.end_week),
      maxLosses: r.max_losses == null ? null : Number(r.max_losses),
      tieResult: r.tie_result as TieResult,
      missedPick: r.missed_pick as MissedPick,
      teamReuse: !!r.team_reuse,
      lockMode: r.lock_mode as LockMode,
    },
  };
}

export function toGame(r: Row): GameRow {
  return {
    id: r.id as string,
    feed: r.feed as string,
    season: Number(r.season),
    seasonType: Number(r.season_type),
    week: Number(r.week),
    kickoff: r.kickoff as string,
    homeTeam: r.home_team as string,
    awayTeam: r.away_team as string,
    homeName: r.home_name as string,
    awayName: r.away_name as string,
    homeLogo: (r.home_logo as string) ?? null,
    awayLogo: (r.away_logo as string) ?? null,
    homeScore: r.home_score == null ? null : Number(r.home_score),
    awayScore: r.away_score == null ? null : Number(r.away_score),
    status: r.status as GameStatus,
    adminOverride: !!r.admin_override,
  };
}

export function getUserByEmail(db: Db, email: string): User | null {
  const r = db.prepare("SELECT * FROM app_user WHERE email = ?").get(email.trim()) as Row | undefined;
  return r ? toUser(r) : null;
}

export function getLeague(db: Db, id: string): League | null {
  const r = db.prepare("SELECT * FROM league WHERE id = ?").get(id) as Row | undefined;
  return r ? toLeague(r) : null;
}

export function isMember(db: Db, leagueId: string, userId: string): boolean {
  return !!db.prepare("SELECT 1 FROM league_member WHERE league_id = ? AND user_id = ?").get(leagueId, userId);
}

export function leagueGames(db: Db, league: League): GameRow[] {
  return (
    db
      .prepare(
        `SELECT * FROM game WHERE feed = ? AND season = ? AND season_type = ? AND week BETWEEN ? AND ?
         ORDER BY week, kickoff, id`,
      )
      .all(league.feed, league.season, league.seasonType, league.rules.startWeek, league.rules.endWeek) as Row[]
  ).map(toGame);
}

export function leaguePicks(db: Db, leagueId: string): (Pick & { setBy: string | null; updatedAt: string })[] {
  return (db.prepare("SELECT * FROM pick WHERE league_id = ?").all(leagueId) as Row[]).map((r) => ({
    userId: r.user_id as string,
    week: Number(r.week),
    team: r.team as string,
    gameId: r.game_id as string,
    setBy: (r.set_by as string) ?? null,
    updatedAt: r.updated_at as string,
  }));
}

export function leagueMembers(db: Db, leagueId: string): { userId: string; name: string; pictureUrl: string | null }[] {
  return (
    db
      .prepare(
        `SELECT u.id, u.name, u.picture_url FROM league_member m JOIN app_user u ON u.id = m.user_id
         WHERE m.league_id = ? AND u.disabled = 0 ORDER BY u.name`,
      )
      .all(leagueId) as Row[]
  ).map((r) => ({ userId: r.id as string, name: r.name as string, pictureUrl: (r.picture_url as string) ?? null }));
}

/** Branding and other install-wide settings, all admin-editable. */
export const SETTING_DEFAULTS = {
  appName: "Survivor Pool",
  shortName: "Survivor",
  accentColor: "#2f6fdf",
  iconUrl: "",
  welcome: "Pick one team each week.",
} as const;
export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: string };

export function getSettings(db: Db): Settings {
  const out: Settings = { ...SETTING_DEFAULTS };
  for (const r of db.prepare("SELECT key, value FROM setting").all() as Row[]) {
    if ((r.key as string) in out) out[r.key as keyof Settings] = r.value as string;
  }
  return out;
}

export function putSettings(db: Db, patch: Partial<Settings>): void {
  const stmt = db.prepare("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries(patch)) {
    if (k in SETTING_DEFAULTS && typeof v === "string") stmt.run(k, v);
  }
}
