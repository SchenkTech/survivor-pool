import type { Cell, GameStatus, Rules, StandingRow } from "@sp/engine";

export type { Rules, StandingRow, Cell };

export interface Settings {
  appName: string;
  shortName: string;
  accentColor: string;
  iconUrl: string;
  welcome: string;
}

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
  rules: Rules;
  isMember?: boolean;
}

export interface Game {
  id: string;
  feed: string;
  week: number;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
  adminOverride: boolean;
}

export interface Me {
  user: User | null;
  leagues?: { id: string; name: string; season: number }[];
}

export interface LeagueDetail {
  league: League;
  currentWeek: number;
  weeks: { week: number; games: number; firstKickoff: string | null }[];
  isMember: boolean;
  me: { rank: number; alive: boolean; losses: number; wins: number; lossesRemaining: number | null; eliminatedWeek: number | null } | null;
  memberCount: number;
  aliveCount: number;
}

export interface Pick {
  userId: string;
  week: number;
  team: string;
  gameId: string;
  setBy?: string | null;
}

export interface WeekView {
  week: number;
  myPick: Pick | null;
  myPickLocked: boolean;
  eliminatedWeek: number | null;
  usedTeams: Record<string, number>;
  games: (Game & { locked: boolean; pickCounts: Record<string, number> | null })[];
}

export type VisibleCell = Cell | { week: number; kind: "hidden" };
export interface StandingsView {
  rules: Rules;
  currentWeek: number;
  rows: (Omit<StandingRow, "cells"> & { pictureUrl: string | null; cells: VisibleCell[] })[];
}

export interface AdminUser extends User {
  leagueIds: string[];
}

export interface FeedPreset {
  feed: string;
  label: string;
  seasonType: number;
  startWeek: number;
  endWeek: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => call<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => call<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => call<T>("DELETE", path),
};
