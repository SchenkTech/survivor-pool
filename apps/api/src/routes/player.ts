import { Hono } from "hono";
import { computeStandings, currentWeek, gamesInWeek, isGameLocked, isPickVisible, usedTeams, validatePick } from "@sp/engine";
import type { Cell } from "@sp/engine";
import type { AppEnv } from "../auth.ts";
import { requireUser } from "../auth.ts";
import { nowIso } from "../db.ts";
import type { Db } from "../db.ts";
import { getLeague, isMember, leagueGames, leagueMembers, leaguePicks, toLeague } from "../store.ts";
import type { League, User } from "../store.ts";

/** Everything one league screen needs, derived fresh. */
export function leagueState(db: Db, league: League, now = new Date()) {
  const games = leagueGames(db, league);
  const picks = leaguePicks(db, league.id);
  const members = leagueMembers(db, league.id);
  const standings = computeStandings(members, picks, games, league.rules, now);
  return { games, picks, members, standings, currentWeek: currentWeek(games, league.rules, now) };
}

function canView(db: Db, user: User, leagueId: string): boolean {
  return user.role === "admin" || isMember(db, leagueId, user.id);
}

export function playerRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.get("/leagues", (c) => {
    const user = c.get("user")!;
    const rows =
      user.role === "admin"
        ? db.prepare("SELECT * FROM league ORDER BY archived, season DESC, name").all()
        : db
            .prepare(
              `SELECT l.* FROM league l JOIN league_member m ON m.league_id = l.id
               WHERE m.user_id = ? ORDER BY l.archived, l.season DESC, l.name`,
            )
            .all(user.id);
    return c.json(
      (rows as Record<string, unknown>[]).map(toLeague).map((l) => ({
        ...l,
        isMember: isMember(db, l.id, user.id),
      })),
    );
  });

  app.get("/leagues/:id", (c) => {
    const user = c.get("user")!;
    const league = getLeague(db, c.req.param("id"));
    if (!league || !canView(db, user, league.id)) return c.json({ error: "League not found." }, 404);
    const { games, currentWeek: cw, standings } = leagueState(db, league);
    const weeks = [];
    for (let w = league.rules.startWeek; w <= league.rules.endWeek; w++) {
      const g = gamesInWeek(games, w);
      weeks.push({
        week: w,
        games: g.length,
        firstKickoff: g.map((x) => x.kickoff).sort()[0] ?? null,
      });
    }
    const me = standings.find((r) => r.userId === user.id) ?? null;
    return c.json({
      league,
      currentWeek: cw,
      weeks,
      isMember: isMember(db, league.id, user.id),
      me: me && { rank: me.rank, alive: me.alive, losses: me.losses, wins: me.wins, lossesRemaining: me.lossesRemaining, eliminatedWeek: me.eliminatedWeek },
      memberCount: standings.length,
      aliveCount: standings.filter((r) => r.alive).length,
    });
  });

  app.get("/leagues/:id/weeks/:week", (c) => {
    const user = c.get("user")!;
    const league = getLeague(db, c.req.param("id"));
    if (!league || !canView(db, user, league.id)) return c.json({ error: "League not found." }, 404);
    const week = Number(c.req.param("week"));
    const now = new Date();
    const { games, picks, standings } = leagueState(db, league, now);
    const me = standings.find((r) => r.userId === user.id);
    const myPick = picks.find((p) => p.userId === user.id && p.week === week) ?? null;
    const used = usedTeams(user.id, picks, week);

    return c.json({
      week,
      myPick,
      eliminatedWeek: me?.eliminatedWeek ?? null,
      myPickLocked: myPick ? isGameLocked(games.find((g) => g.id === myPick.gameId)!, games, league.rules, now) : false,
      usedTeams: Object.fromEntries(used),
      games: gamesInWeek(games, week).map((g) => ({
        ...g,
        locked: isGameLocked(g, games, league.rules, now),
        // How many members are on each side, once those picks are locked.
        pickCounts: countVisiblePicks(picks, g.id, games, league, now),
      })),
    });
  });

  app.put("/leagues/:id/picks/:week", async (c) => {
    const user = c.get("user")!;
    const league = getLeague(db, c.req.param("id"));
    if (!league || !isMember(db, league.id, user.id)) return c.json({ error: "You're not in this league." }, 403);
    if (league.archived) return c.json({ error: "This league is archived." }, 400);
    const week = Number(c.req.param("week"));
    const { team } = await c.req.json<{ team?: string }>();
    if (!team) return c.json({ error: "Pick a team." }, 400);

    const now = new Date();
    const { games, picks, standings } = leagueState(db, league, now);
    const me = standings.find((r) => r.userId === user.id);
    const result = validatePick({ userId: user.id, week, team }, {
      rules: league.rules,
      games,
      picks,
      eliminatedWeek: me?.eliminatedWeek ?? null,
      now,
    });
    if (!result.ok) return c.json({ error: result.error }, 409);

    db.prepare(
      `INSERT INTO pick (league_id, user_id, week, team, game_id, set_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(league_id, user_id, week) DO UPDATE SET
         team = excluded.team, game_id = excluded.game_id, set_by = NULL, updated_at = excluded.updated_at`,
    ).run(league.id, user.id, week, team, result.game.id, nowIso(), nowIso());
    return c.json({ ok: true });
  });

  app.delete("/leagues/:id/picks/:week", (c) => {
    const user = c.get("user")!;
    const league = getLeague(db, c.req.param("id"));
    if (!league || !isMember(db, league.id, user.id)) return c.json({ error: "You're not in this league." }, 403);
    const week = Number(c.req.param("week"));
    const now = new Date();
    const { games, picks } = leagueState(db, league, now);
    const mine = picks.find((p) => p.userId === user.id && p.week === week);
    if (!mine) return c.json({ ok: true });
    const game = games.find((g) => g.id === mine.gameId);
    if (game && isGameLocked(game, games, league.rules, now)) return c.json({ error: "That pick is locked." }, 409);
    db.prepare("DELETE FROM pick WHERE league_id = ? AND user_id = ? AND week = ?").run(league.id, user.id, week);
    return c.json({ ok: true });
  });

  app.get("/leagues/:id/standings", (c) => {
    const user = c.get("user")!;
    const league = getLeague(db, c.req.param("id"));
    if (!league || !canView(db, user, league.id)) return c.json({ error: "League not found." }, 404);
    const now = new Date();
    const { games, picks, standings, members, currentWeek: cw } = leagueState(db, league, now);
    const pictures = new Map(members.map((m) => [m.userId, m.pictureUrl]));

    // Hide other members' picks until they lock. Your own are always shown.
    const rows = standings.map((r) => ({
      ...r,
      pictureUrl: pictures.get(r.userId) ?? null,
      cells: r.cells.map((cell): Cell | { week: number; kind: "hidden" } => {
        if (cell.kind !== "pick" || r.userId === user.id) return cell;
        const p = picks.find((x) => x.userId === r.userId && x.week === cell.week)!;
        return isPickVisible(p, games, league.rules, now) ? cell : { week: cell.week, kind: "hidden" };
      }),
    }));
    return c.json({ rules: league.rules, currentWeek: cw, rows });
  });

  return app;
}

function countVisiblePicks(
  picks: { gameId: string; team: string }[],
  gameId: string,
  games: Parameters<typeof isGameLocked>[1],
  league: League,
  now: Date,
): Record<string, number> | null {
  const game = games.find((g) => g.id === gameId)!;
  if (!isGameLocked(game, games, league.rules, now)) return null;
  const counts: Record<string, number> = {};
  for (const p of picks) if (p.gameId === gameId) counts[p.team] = (counts[p.team] ?? 0) + 1;
  return counts;
}
