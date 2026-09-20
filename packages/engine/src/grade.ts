import type { Game, Outcome, Pick, Rules } from "./types.ts";

/** Grade one pick against its game. Anything short of a final score is
 *  pending -- including a postponed game, which will be played later and
 *  graded then. A canceled game is a push: the member did nothing wrong. */
export function gradePick(pick: Pick, game: Game | undefined, rules: Rules): Outcome {
  if (!game) return "pending";
  if (game.status === "canceled") return "push";
  if (game.status !== "final" || game.homeScore == null || game.awayScore == null) return "pending";

  if (game.homeScore === game.awayScore) return rules.tieResult;

  const winner = game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
  return pick.team === winner ? "win" : "loss";
}

export function gamesInWeek(games: Game[], week: number): Game[] {
  return games.filter((g) => g.week === week);
}

/** A week is closed once every game in it has kicked off: nobody can pick
 *  any more, so an absent pick is now a missed pick rather than a late one.
 *  A week with no games at all is never closed -- there is nothing to miss. */
export function isWeekClosed(games: Game[], week: number, now: Date): boolean {
  const weekGames = gamesInWeek(games, week).filter((g) => g.status !== "canceled");
  if (weekGames.length === 0) return false;
  return weekGames.every((g) => hasStarted(g, now));
}

export function hasStarted(game: Game, now: Date): boolean {
  if (game.status === "in_progress" || game.status === "final") return true;
  // A postponed game has a stale kickoff until the feed reschedules it.
  if (game.status === "postponed") return false;
  return new Date(game.kickoff).getTime() <= now.getTime();
}

/** Whether a pick on `game` is locked under the league's lock mode. */
export function isGameLocked(game: Game, games: Game[], rules: Rules, now: Date): boolean {
  if (rules.lockMode === "kickoff") return hasStarted(game, now);
  const first = firstKickoff(gamesInWeek(games, game.week));
  return first != null && first.getTime() <= now.getTime();
}

function firstKickoff(games: Game[]): Date | null {
  let min: number | null = null;
  for (const g of games) {
    if (g.status === "canceled" || g.status === "postponed") continue;
    const t = new Date(g.kickoff).getTime();
    if (min == null || t < min) min = t;
  }
  return min == null ? null : new Date(min);
}

/** The week members should be looking at: the first week in range with a
 *  game still to start or still being played. Between Monday night and
 *  Thursday that is next week; after the season it is the last week. */
export function currentWeek(games: Game[], rules: Rules, now: Date): number {
  for (let w = rules.startWeek; w <= rules.endWeek; w++) {
    const live = gamesInWeek(games, w).some(
      (g) => g.status === "in_progress" || (g.status === "scheduled" && new Date(g.kickoff) > now),
    );
    if (live) return w;
  }
  return rules.endWeek;
}
