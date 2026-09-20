import { gamesInWeek, isGameLocked } from "./grade.ts";
import type { Game, Pick, Rules } from "./types.ts";

export interface PickAttempt {
  userId: string;
  week: number;
  team: string;
}

export interface PickContext {
  rules: Rules;
  games: Game[];
  /** Every pick in the league (all members, all weeks). */
  picks: Pick[];
  /** Week the member was eliminated in, from computeStandings. */
  eliminatedWeek: number | null;
  now: Date;
  /** Admins correcting a pick may bypass the lock -- the rest still apply. */
  ignoreLock?: boolean;
}

export type PickResult = { ok: true; game: Game } | { ok: false; error: string };

export function validatePick(attempt: PickAttempt, ctx: PickContext): PickResult {
  const { rules, games, picks, now } = ctx;
  const { userId, week, team } = attempt;

  if (week < rules.startWeek || week > rules.endWeek) {
    return { ok: false, error: `Week ${week} is outside this league's weeks.` };
  }
  if (ctx.eliminatedWeek != null && ctx.eliminatedWeek < week) {
    return { ok: false, error: `You were eliminated in week ${ctx.eliminatedWeek}.` };
  }

  const game = gamesInWeek(games, week).find(
    (g) => (g.homeTeam === team || g.awayTeam === team) && g.status !== "canceled",
  );
  if (!game) return { ok: false, error: `${team} doesn't play in week ${week}.` };

  if (!ctx.ignoreLock) {
    if (isGameLocked(game, games, rules, now)) {
      return { ok: false, error: `${team}'s game is locked.` };
    }
    const existing = picks.find((p) => p.userId === userId && p.week === week);
    const existingGame = existing && games.find((g) => g.id === existing.gameId);
    if (existing && existingGame && existing.team !== team && isGameLocked(existingGame, games, rules, now)) {
      return { ok: false, error: `Your week ${week} pick (${existing.team}) is already locked.` };
    }
  }

  if (!rules.teamReuse) {
    const usedIn = picks.find((p) => p.userId === userId && p.team === team && p.week !== week);
    if (usedIn) return { ok: false, error: `You already used ${team} in week ${usedIn.week}.` };
  }

  return { ok: true, game };
}

export function usedTeams(userId: string, picks: Pick[], exceptWeek?: number): Map<string, number> {
  const used = new Map<string, number>();
  for (const p of picks) {
    if (p.userId === userId && p.week !== exceptWeek) used.set(p.team, p.week);
  }
  return used;
}

/** Whether other members may see this pick yet. Hidden until it is locked,
 *  so nobody can copy -- or fade -- a pick that could still change. */
export function isPickVisible(pick: Pick, games: Game[], rules: Rules, now: Date): boolean {
  const game = games.find((g) => g.id === pick.gameId);
  return game ? isGameLocked(game, games, rules, now) : false;
}
