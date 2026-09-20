import { gradePick, isWeekClosed } from "./grade.ts";
import type { Cell, Game, Member, Pick, Rules, StandingRow } from "./types.ts";

/**
 * Standings are derived from picks + games + rules every time, never stored.
 * That is what makes the rules editable mid-season: change "ties are a push"
 * to "ties are a loss" and every table recomputes, rather than leaving stored
 * results that were graded under the old rule.
 */
export function computeStandings(
  members: Member[],
  picks: Pick[],
  games: Game[],
  rules: Rules,
  now: Date,
): StandingRow[] {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const closed = new Map<number, boolean>();
  for (let w = rules.startWeek; w <= rules.endWeek; w++) closed.set(w, isWeekClosed(games, w, now));

  const rows = members.map((m): Omit<StandingRow, "rank"> => {
    const byWeek = new Map(picks.filter((p) => p.userId === m.userId).map((p) => [p.week, p]));
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let missed = 0;
    let pending = 0;
    let eliminatedWeek: number | null = null;
    const cells: Cell[] = [];

    for (let w = rules.startWeek; w <= rules.endWeek; w++) {
      if (eliminatedWeek != null) {
        cells.push({ week: w, kind: "out" });
        continue;
      }
      const pick = byWeek.get(w);
      if (pick) {
        const outcome = gradePick(pick, gameById.get(pick.gameId), rules);
        if (outcome === "win") wins++;
        else if (outcome === "loss") losses++;
        else if (outcome === "push") pushes++;
        else pending++;
        cells.push({ week: w, kind: "pick", team: pick.team, gameId: pick.gameId, outcome });
      } else if (closed.get(w)) {
        const counted = rules.missedPick === "loss";
        missed++;
        if (counted) losses++;
        cells.push({ week: w, kind: "missed", counted });
      } else {
        cells.push({ week: w, kind: "open" });
      }
      if (rules.maxLosses != null && losses >= rules.maxLosses) eliminatedWeek = w;
    }

    return {
      userId: m.userId,
      name: m.name,
      wins,
      losses,
      pushes,
      missed,
      pending,
      alive: eliminatedWeek == null,
      eliminatedWeek,
      lossesRemaining: rules.maxLosses == null ? null : Math.max(0, rules.maxLosses - losses),
      cells,
    };
  });

  rows.sort(compareRows);

  // Standard competition ranking (1, 2, 2, 4): members level on every
  // sort key share a rank.
  const ranked: StandingRow[] = [];
  rows.forEach((r, i) => {
    const prev = ranked[i - 1];
    const rank = prev && compareRows(prev, r) === 0 ? prev.rank : i + 1;
    ranked.push({ ...r, rank });
  });
  return ranked;
}

/** Alive first; among the eliminated, whoever lasted longer; then fewest
 *  losses, then most wins. Name only breaks display order, not rank. */
function compareRows(a: Omit<StandingRow, "rank">, b: Omit<StandingRow, "rank">): number {
  if (a.alive !== b.alive) return a.alive ? -1 : 1;
  if (!a.alive && !b.alive && a.eliminatedWeek !== b.eliminatedWeek) {
    return (b.eliminatedWeek ?? 0) - (a.eliminatedWeek ?? 0);
  }
  if (a.losses !== b.losses) return a.losses - b.losses;
  if (a.wins !== b.wins) return b.wins - a.wins;
  return 0;
}

export function sortForDisplay(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}
