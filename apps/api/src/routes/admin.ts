import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { validatePick } from "@sp/engine";
import type { AppEnv } from "../auth.ts";
import { requireAdmin } from "../auth.ts";
import { nowIso, tx } from "../db.ts";
import type { Db } from "../db.ts";
import { isEspnFeed, syncWeeks } from "../feeds.ts";
import { getLeague, getSettings, getUserByEmail, leaguePicks, putSettings, toGame, toUser } from "../store.ts";
import type { League, Settings } from "../store.ts";
import { leagueState } from "./player.ts";

/** Suggestions for the league form. Any `espn:<sport>/<league>` path works;
 *  these are just the ones worth one click. */
const FEED_PRESETS = [
  { feed: "espn:football/nfl", label: "NFL (ESPN)", seasonType: 2, startWeek: 1, endWeek: 18 },
  { feed: "espn:football/college-football", label: "College football (ESPN)", seasonType: 2, startWeek: 1, endWeek: 15 },
  { feed: "manual", label: "Manual — enter games yourself", seasonType: 2, startWeek: 1, endWeek: 18 },
];

type Row = Record<string, unknown>;

interface LeagueInput {
  name?: string;
  description?: string;
  feed?: string;
  season?: number;
  seasonType?: number;
  startWeek?: number;
  endWeek?: number;
  maxLosses?: number | null;
  tieResult?: string;
  missedPick?: string;
  teamReuse?: boolean;
  lockMode?: string;
  archived?: boolean;
}

/** Merge input over an existing league (or defaults) and check it. */
function leagueFromInput(input: LeagueInput, base?: League): { ok: true; row: Row } | { ok: false; error: string } {
  const r = {
    name: (input.name ?? base?.name ?? "").trim(),
    description: (input.description ?? base?.description ?? "").trim(),
    feed: (input.feed ?? base?.feed ?? "").trim(),
    season: Number(input.season ?? base?.season),
    season_type: Number(input.seasonType ?? base?.seasonType ?? 2),
    start_week: Number(input.startWeek ?? base?.rules.startWeek ?? 1),
    end_week: Number(input.endWeek ?? base?.rules.endWeek ?? 18),
    max_losses: input.maxLosses === undefined ? (base?.rules.maxLosses ?? null) : input.maxLosses,
    tie_result: input.tieResult ?? base?.rules.tieResult ?? "push",
    missed_pick: input.missedPick ?? base?.rules.missedPick ?? "loss",
    team_reuse: (input.teamReuse ?? base?.rules.teamReuse ?? false) ? 1 : 0,
    lock_mode: input.lockMode ?? base?.rules.lockMode ?? "kickoff",
    archived: (input.archived ?? base?.archived ?? false) ? 1 : 0,
  };
  if (!r.name) return { ok: false, error: "Give the league a name." };
  if (r.feed !== "manual" && !isEspnFeed(r.feed)) return { ok: false, error: "Feed must be 'manual' or 'espn:<sport>/<league>'." };
  if (!Number.isInteger(r.season) || r.season < 1900) return { ok: false, error: "Season must be a year." };
  if (!Number.isInteger(r.start_week) || !Number.isInteger(r.end_week) || r.start_week < 0 || r.end_week < r.start_week) {
    return { ok: false, error: "Weeks must run from a start week to an end week at or after it." };
  }
  if (r.max_losses != null && (!Number.isInteger(r.max_losses) || r.max_losses < 1)) {
    return { ok: false, error: "Losses allowed must be at least 1, or blank for no elimination." };
  }
  if (!["win", "loss", "push"].includes(r.tie_result)) return { ok: false, error: "Invalid tie rule." };
  if (!["loss", "ignore"].includes(r.missed_pick)) return { ok: false, error: "Invalid missed-pick rule." };
  if (!["kickoff", "week_start"].includes(r.lock_mode)) return { ok: false, error: "Invalid lock rule." };
  return { ok: true, row: r };
}

async function syncLeague(db: Db, league: League, weeks?: number[]) {
  const all: number[] = [];
  for (let w = league.rules.startWeek; w <= league.rules.endWeek; w++) all.push(w);
  return syncWeeks(db, { feed: league.feed, season: league.season, seasonType: league.seasonType }, weeks ?? all);
}

export function adminRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use("*", requireAdmin);

  // ---- Settings -----------------------------------------------------------

  app.get("/settings", (c) => c.json(getSettings(db)));
  app.put("/settings", async (c) => {
    putSettings(db, await c.req.json<Partial<Settings>>());
    return c.json(getSettings(db));
  });

  // ---- People -------------------------------------------------------------

  app.get("/users", (c) => {
    const users = (db.prepare("SELECT * FROM app_user ORDER BY name COLLATE NOCASE").all() as Row[]).map(toUser);
    const memberships = db.prepare("SELECT league_id, user_id FROM league_member").all() as Row[];
    return c.json(
      users.map((u) => ({
        ...u,
        leagueIds: memberships.filter((m) => m.user_id === u.id).map((m) => m.league_id as string),
      })),
    );
  });

  app.post("/users", async (c) => {
    const body = await c.req.json<{ email?: string; name?: string; role?: string; leagueIds?: string[] }>();
    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: "Enter a valid email." }, 400);
    if (getUserByEmail(db, email)) return c.json({ error: "That email is already invited." }, 409);
    const id = randomUUID();
    tx(db, () => {
      db.prepare("INSERT INTO app_user (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id,
        email,
        body.name?.trim() || email.split("@")[0],
        body.role === "admin" ? "admin" : "member",
        nowIso(),
      );
      setMemberships(db, id, body.leagueIds ?? []);
    });
    return c.json({ id }, 201);
  });

  app.patch("/users/:id", async (c) => {
    const me = c.get("user")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string; email?: string; role?: string; disabled?: boolean; leagueIds?: string[] }>();
    const r = db.prepare("SELECT * FROM app_user WHERE id = ?").get(id) as Row | undefined;
    if (!r) return c.json({ error: "No such person." }, 404);
    const u = toUser(r);
    if (id === me.id && (body.role === "member" || body.disabled)) {
      return c.json({ error: "You can't demote or disable yourself." }, 400);
    }
    const email = body.email?.trim().toLowerCase() ?? u.email;
    const other = getUserByEmail(db, email);
    if (other && other.id !== id) return c.json({ error: "Another person already has that email." }, 409);
    tx(db, () => {
      db.prepare("UPDATE app_user SET name = ?, email = ?, role = ?, disabled = ? WHERE id = ?").run(
        body.name?.trim() || u.name,
        email,
        body.role === "admin" || body.role === "member" ? body.role : u.role,
        (body.disabled ?? u.disabled) ? 1 : 0,
        id,
      );
      if (body.disabled) db.prepare("DELETE FROM session WHERE user_id = ?").run(id);
      if (body.leagueIds) setMemberships(db, id, body.leagueIds);
    });
    return c.json({ ok: true });
  });

  app.delete("/users/:id", (c) => {
    const id = c.req.param("id");
    if (id === c.get("user")!.id) return c.json({ error: "You can't remove yourself." }, 400);
    db.prepare("DELETE FROM app_user WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  // ---- Leagues ------------------------------------------------------------

  app.get("/feeds", (c) => c.json(FEED_PRESETS));

  app.post("/leagues", async (c) => {
    const parsed = leagueFromInput(await c.req.json<LeagueInput>());
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const id = randomUUID();
    const r = parsed.row;
    db.prepare(
      `INSERT INTO league (id, name, description, feed, season, season_type, start_week, end_week, max_losses,
                           tie_result, missed_pick, team_reuse, lock_mode, archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, r.name as string, r.description as string, r.feed as string, r.season as number, r.season_type as number,
      r.start_week as number, r.end_week as number, r.max_losses as number | null, r.tie_result as string,
      r.missed_pick as string, r.team_reuse as number, r.lock_mode as string, r.archived as number, nowIso());

    const league = getLeague(db, id)!;
    let synced = 0;
    let syncError: string | null = null;
    try {
      synced = await syncLeague(db, league);
    } catch (e) {
      syncError = String(e);
    }
    return c.json({ id, synced, syncError }, 201);
  });

  app.patch("/leagues/:id", async (c) => {
    const league = getLeague(db, c.req.param("id"));
    if (!league) return c.json({ error: "League not found." }, 404);
    const parsed = leagueFromInput(await c.req.json<LeagueInput>(), league);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const r = parsed.row;
    db.prepare(
      `UPDATE league SET name = ?, description = ?, feed = ?, season = ?, season_type = ?, start_week = ?, end_week = ?,
         max_losses = ?, tie_result = ?, missed_pick = ?, team_reuse = ?, lock_mode = ?, archived = ? WHERE id = ?`,
    ).run(r.name as string, r.description as string, r.feed as string, r.season as number, r.season_type as number,
      r.start_week as number, r.end_week as number, r.max_losses as number | null, r.tie_result as string,
      r.missed_pick as string, r.team_reuse as number, r.lock_mode as string, r.archived as number, league.id);
    return c.json({ ok: true });
  });

  app.delete("/leagues/:id", (c) => {
    db.prepare("DELETE FROM league WHERE id = ?").run(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.put("/leagues/:id/members", async (c) => {
    const leagueId = c.req.param("id");
    if (!getLeague(db, leagueId)) return c.json({ error: "League not found." }, 404);
    const { userIds } = await c.req.json<{ userIds: string[] }>();
    tx(db, () => {
      const keep = new Set(userIds);
      const current = (db.prepare("SELECT user_id FROM league_member WHERE league_id = ?").all(leagueId) as Row[]).map(
        (r) => r.user_id as string,
      );
      for (const uid of current) {
        if (!keep.has(uid)) db.prepare("DELETE FROM league_member WHERE league_id = ? AND user_id = ?").run(leagueId, uid);
      }
      for (const uid of keep) {
        db.prepare("INSERT OR IGNORE INTO league_member (league_id, user_id, joined_at) VALUES (?, ?, ?)").run(leagueId, uid, nowIso());
      }
    });
    return c.json({ ok: true });
  });

  app.post("/leagues/:id/sync", async (c) => {
    const league = getLeague(db, c.req.param("id"));
    if (!league) return c.json({ error: "League not found." }, 404);
    if (!isEspnFeed(league.feed)) return c.json({ error: "This league's games are entered by hand." }, 400);
    try {
      return c.json({ synced: await syncLeague(db, league) });
    } catch (e) {
      return c.json({ error: String(e) }, 502);
    }
  });

  // ---- Picks (on a member's behalf) --------------------------------------

  app.get("/leagues/:id/picks", (c) => {
    const league = getLeague(db, c.req.param("id"));
    if (!league) return c.json({ error: "League not found." }, 404);
    return c.json(leaguePicks(db, league.id));
  });

  app.put("/leagues/:id/picks", async (c) => {
    const admin = c.get("user")!;
    const league = getLeague(db, c.req.param("id"));
    if (!league) return c.json({ error: "League not found." }, 404);
    const { userId, week, team } = await c.req.json<{ userId: string; week: number; team: string | null }>();

    if (!team) {
      db.prepare("DELETE FROM pick WHERE league_id = ? AND user_id = ? AND week = ?").run(league.id, userId, week);
      return c.json({ ok: true });
    }
    const now = new Date();
    const { games, picks, standings } = leagueState(db, league, now);
    // Standings as they'd be without this week's pick, so correcting a
    // losing pick doesn't count its own loss against it.
    const row = standings.find((r) => r.userId === userId);
    const eliminatedBefore = row?.eliminatedWeek != null && row.eliminatedWeek < week ? row.eliminatedWeek : null;
    const result = validatePick({ userId, week, team }, {
      rules: league.rules,
      games,
      picks,
      eliminatedWeek: eliminatedBefore,
      now,
      ignoreLock: true,
    });
    if (!result.ok) return c.json({ error: result.error }, 409);
    db.prepare(
      `INSERT INTO pick (league_id, user_id, week, team, game_id, set_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(league_id, user_id, week) DO UPDATE SET
         team = excluded.team, game_id = excluded.game_id, set_by = excluded.set_by, updated_at = excluded.updated_at`,
    ).run(league.id, userId, week, team, result.game.id, admin.id, nowIso(), nowIso());
    return c.json({ ok: true });
  });

  // ---- Games --------------------------------------------------------------

  app.get("/leagues/:id/games", (c) => {
    const league = getLeague(db, c.req.param("id"));
    if (!league) return c.json({ error: "League not found." }, 404);
    return c.json(leagueState(db, league).games);
  });

  app.post("/leagues/:id/games", async (c) => {
    const league = getLeague(db, c.req.param("id"));
    if (!league) return c.json({ error: "League not found." }, 404);
    const b = await c.req.json<{ week: number; kickoff: string; homeTeam: string; awayTeam: string; homeName?: string; awayName?: string }>();
    const home = b.homeTeam?.trim().toUpperCase();
    const away = b.awayTeam?.trim().toUpperCase();
    if (!home || !away || home === away) return c.json({ error: "Enter two different teams." }, 400);
    if (!Number.isInteger(b.week) || Number.isNaN(Date.parse(b.kickoff))) return c.json({ error: "Enter a week and kickoff time." }, 400);
    const id = `${league.feed}:m:${randomUUID()}`;
    db.prepare(
      `INSERT INTO game (id, feed, season, season_type, week, kickoff, home_team, away_team, home_name, away_name,
                         status, admin_override, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 1, ?)`,
    ).run(id, league.feed, league.season, league.seasonType, b.week, new Date(b.kickoff).toISOString(), home, away,
      b.homeName?.trim() || home, b.awayName?.trim() || away, nowIso());
    return c.json({ id }, 201);
  });

  /** Editing a synced game pins it: the feed stops overwriting it until an
   *  admin sends `adminOverride: false` to hand it back. */
  app.patch("/games/:id", async (c) => {
    const r = db.prepare("SELECT * FROM game WHERE id = ?").get(c.req.param("id")) as Row | undefined;
    if (!r) return c.json({ error: "Game not found." }, 404);
    const g = toGame(r);
    const b = await c.req.json<{
      kickoff?: string; homeScore?: number | null; awayScore?: number | null; status?: string; week?: number; adminOverride?: boolean;
    }>();
    const statuses = ["scheduled", "in_progress", "final", "postponed", "canceled"];
    if (b.status && !statuses.includes(b.status)) return c.json({ error: "Invalid status." }, 400);
    if (b.kickoff && Number.isNaN(Date.parse(b.kickoff))) return c.json({ error: "Invalid kickoff." }, 400);
    db.prepare(
      `UPDATE game SET kickoff = ?, home_score = ?, away_score = ?, status = ?, week = ?, admin_override = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      b.kickoff ? new Date(b.kickoff).toISOString() : g.kickoff,
      b.homeScore === undefined ? g.homeScore : b.homeScore,
      b.awayScore === undefined ? g.awayScore : b.awayScore,
      b.status ?? g.status,
      b.week ?? g.week,
      b.adminOverride === false ? 0 : 1,
      nowIso(),
      g.id,
    );
    return c.json({ ok: true });
  });

  app.delete("/games/:id", (c) => {
    const id = c.req.param("id");
    if (db.prepare("SELECT 1 FROM pick WHERE game_id = ?").get(id)) {
      return c.json({ error: "Someone has picked this game. Cancel it instead." }, 409);
    }
    db.prepare("DELETE FROM game WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  return app;
}

function setMemberships(db: Db, userId: string, leagueIds: string[]): void {
  db.prepare("DELETE FROM league_member WHERE user_id = ?").run(userId);
  const ins = db.prepare("INSERT OR IGNORE INTO league_member (league_id, user_id, joined_at) VALUES (?, ?, ?)");
  for (const lid of leagueIds) if (getLeague(db, lid)) ins.run(lid, userId, nowIso());
}
