/** How a tie is graded. Leagues genuinely differ here: classic survivor
 *  treats a tie as a loss (you needed a win), loss-tracking leagues often
 *  call it a push. */
export type TieResult = "win" | "loss" | "push";

/** What happens to a member who never submits a pick for a week. */
export type MissedPick = "loss" | "ignore";

/** When a pick stops being changeable.
 *  - kickoff: each pick locks when its own game starts (you can still pick
 *    Sunday's game after Thursday night's has kicked off).
 *  - week_start: every pick for the week locks at the week's first kickoff. */
export type LockMode = "kickoff" | "week_start";

export interface Rules {
  startWeek: number;
  endWeek: number;
  /** Losses allowed before a member is out. `null` means nobody is ever
   *  eliminated -- the league just counts losses. `1` is classic survivor. */
  maxLosses: number | null;
  tieResult: TieResult;
  missedPick: MissedPick;
  /** Whether a team may be picked more than once in a season. */
  teamReuse: boolean;
  lockMode: LockMode;
}

export type GameStatus = "scheduled" | "in_progress" | "final" | "postponed" | "canceled";

export interface Game {
  id: string;
  week: number;
  /** ISO 8601. */
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
}

export interface Pick {
  userId: string;
  week: number;
  team: string;
  gameId: string;
}

export interface Member {
  userId: string;
  name: string;
}

export type Outcome = "win" | "loss" | "push" | "pending";

/** One member's week, as the standings grid shows it. */
export type Cell =
  | { week: number; kind: "pick"; team: string; gameId: string; outcome: Outcome }
  /** Week is closed and there was no pick. `counted` says whether the
   *  league's rules turned it into a loss. */
  | { week: number; kind: "missed"; counted: boolean }
  /** Week still open and no pick yet. */
  | { week: number; kind: "open" }
  /** Member was already out before this week. */
  | { week: number; kind: "out" };

export interface StandingRow {
  userId: string;
  name: string;
  rank: number;
  wins: number;
  losses: number;
  pushes: number;
  missed: number;
  pending: number;
  alive: boolean;
  /** Week the member was eliminated in, or null if still alive (or the
   *  league never eliminates anyone). */
  eliminatedWeek: number | null;
  /** Losses left before elimination, or null when there is no limit. */
  lossesRemaining: number | null;
  cells: Cell[];
}
