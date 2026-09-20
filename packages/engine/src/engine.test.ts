import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStandings, currentWeek, gradePick, isWeekClosed, validatePick } from "./index.ts";
import type { Game, Pick, Rules } from "./index.ts";

const base: Rules = {
  startWeek: 1,
  endWeek: 3,
  maxLosses: null,
  tieResult: "push",
  missedPick: "loss",
  teamReuse: false,
  lockMode: "kickoff",
};

function game(id: string, week: number, home: string, away: string, hs: number | null, as: number | null, kickoff: string): Game {
  return {
    id,
    week,
    kickoff,
    homeTeam: home,
    awayTeam: away,
    homeScore: hs,
    awayScore: as,
    status: hs == null ? "scheduled" : "final",
  };
}

const games: Game[] = [
  game("g1", 1, "BUF", "DET", 30, 20, "2026-09-10T20:00:00Z"),
  game("g2", 1, "KC", "LV", 17, 17, "2026-09-13T17:00:00Z"),
  game("g3", 2, "BUF", "NE", 10, 24, "2026-09-17T20:00:00Z"),
  game("g4", 2, "KC", "DEN", 27, 3, "2026-09-20T17:00:00Z"),
  game("g5", 3, "BUF", "MIA", null, null, "2026-09-27T17:00:00Z"),
  game("g6", 3, "KC", "LAC", null, null, "2026-09-28T00:15:00Z"),
];
const now = new Date("2026-09-24T12:00:00Z");
const members = [
  { userId: "a", name: "Alice" },
  { userId: "b", name: "Bob" },
  { userId: "c", name: "Cara" },
];
const pk = (userId: string, week: number, team: string, gameId: string): Pick => ({ userId, week, team, gameId });

test("grading: win, loss, tie follows the rule", () => {
  assert.equal(gradePick(pk("a", 1, "BUF", "g1"), games[0], base), "win");
  assert.equal(gradePick(pk("a", 1, "DET", "g1"), games[0], base), "loss");
  assert.equal(gradePick(pk("a", 1, "KC", "g2"), games[1], base), "push");
  assert.equal(gradePick(pk("a", 1, "KC", "g2"), games[1], { ...base, tieResult: "loss" }), "loss");
  assert.equal(gradePick(pk("a", 3, "BUF", "g5"), games[4], base), "pending");
});

test("loss-tracking league: nobody is eliminated, losses just accumulate", () => {
  const picks = [pk("a", 1, "BUF", "g1"), pk("a", 2, "BUF", "g3"), pk("b", 1, "DET", "g1"), pk("b", 2, "KC", "g4")];
  const rows = computeStandings(members, picks, games, base, now);
  assert.ok(rows.every((r) => r.alive));
  const byId = Object.fromEntries(rows.map((r) => [r.userId, r]));
  assert.equal(byId.a.losses, 1);
  assert.equal(byId.b.losses, 1);
  // Cara never picked: two closed weeks, both missed, both counted.
  assert.equal(byId.c.losses, 2);
  assert.equal(byId.c.missed, 2);
  assert.equal(byId.c.rank, 3);
  assert.equal(byId.a.rank, 1);
  assert.equal(byId.b.rank, 1);
});

test("classic survivor: one loss and you're out, later weeks show out", () => {
  const picks = [pk("a", 1, "DET", "g1"), pk("b", 1, "BUF", "g1"), pk("b", 2, "KC", "g4")];
  const rows = computeStandings(members, picks, games, { ...base, maxLosses: 1 }, now);
  const byId = Object.fromEntries(rows.map((r) => [r.userId, r]));
  assert.equal(byId.a.alive, false);
  assert.equal(byId.a.eliminatedWeek, 1);
  assert.deepEqual(byId.a.cells[1], { week: 2, kind: "out" });
  assert.equal(byId.b.alive, true);
  assert.equal(rows[0].userId, "b");
});

test("missed picks can be ignored", () => {
  const rows = computeStandings(members, [], games, { ...base, missedPick: "ignore", maxLosses: 1 }, now);
  assert.ok(rows.every((r) => r.alive && r.losses === 0 && r.missed === 2));
});

test("two-strike league outlasts a one-strike one", () => {
  const picks = [pk("a", 1, "DET", "g1"), pk("a", 2, "KC", "g4"), pk("a", 3, "BUF", "g5")];
  const rows = computeStandings([members[0]], picks, games, { ...base, maxLosses: 2 }, now);
  assert.equal(rows[0].alive, true);
  assert.equal(rows[0].lossesRemaining, 1);
  assert.equal(rows[0].pending, 1);
});

test("week closes once every game has kicked off", () => {
  assert.equal(isWeekClosed(games, 2, now), true);
  assert.equal(isWeekClosed(games, 3, now), false);
  assert.equal(currentWeek(games, base, now), 3);
});

test("pick validation: reuse, lock, elimination", () => {
  const picks = [pk("a", 1, "BUF", "g1")];
  const ctx = { rules: base, games, picks, eliminatedWeek: null, now };
  assert.deepEqual(validatePick({ userId: "a", week: 3, team: "KC" }, ctx).ok, true);
  const reuse = validatePick({ userId: "a", week: 3, team: "BUF" }, ctx);
  assert.equal(reuse.ok, false);
  assert.equal(validatePick({ userId: "a", week: 3, team: "BUF" }, { ...ctx, rules: { ...base, teamReuse: true } }).ok, true);
  assert.equal(validatePick({ userId: "a", week: 2, team: "KC" }, ctx).ok, false, "week 2 already kicked off");
  assert.equal(validatePick({ userId: "a", week: 2, team: "KC" }, { ...ctx, ignoreLock: true }).ok, true);
  assert.equal(validatePick({ userId: "a", week: 3, team: "NYJ" }, ctx).ok, false);
  assert.equal(validatePick({ userId: "a", week: 3, team: "KC" }, { ...ctx, eliminatedWeek: 1 }).ok, false);
});

test("kickoff lock vs week_start lock", () => {
  // Saturday: BUF-MIA (Sunday) still open, but it's after nothing in week 3 has started.
  const sat = new Date("2026-09-27T18:00:00Z"); // BUF-MIA has kicked off, KC-LAC has not
  const ctx = { rules: base, games, picks: [], eliminatedWeek: null, now: sat };
  assert.equal(validatePick({ userId: "a", week: 3, team: "KC" }, ctx).ok, true);
  assert.equal(validatePick({ userId: "a", week: 3, team: "KC" }, { ...ctx, rules: { ...base, lockMode: "week_start" } }).ok, false);
});
