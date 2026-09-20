import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite through Node's built-in driver: no native module to compile, no
 * separate database container, and a backup is copying one file. The
 * trade-off is one replica -- run a single pod with a persistent volume.
 *
 * Migrations are append-only SQL, tracked with PRAGMA user_version. Never
 * edit one that has shipped; add another.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE setting (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE app_user (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    picture_url   TEXT,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  -- id is a SHA-256 of the cookie value, so a leaked database file does
  -- not hand out live sessions.
  CREATE TABLE session (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE league (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- Where games come from: 'espn:<sport>/<league>' (e.g. espn:football/nfl)
    -- or 'manual' for a schedule the admin enters by hand.
    feed        TEXT NOT NULL,
    season      INTEGER NOT NULL,
    season_type INTEGER NOT NULL DEFAULT 2,
    start_week  INTEGER NOT NULL,
    end_week    INTEGER NOT NULL,
    max_losses  INTEGER,
    tie_result  TEXT NOT NULL DEFAULT 'push' CHECK (tie_result IN ('win', 'loss', 'push')),
    missed_pick TEXT NOT NULL DEFAULT 'loss' CHECK (missed_pick IN ('loss', 'ignore')),
    team_reuse  INTEGER NOT NULL DEFAULT 0,
    lock_mode   TEXT NOT NULL DEFAULT 'kickoff' CHECK (lock_mode IN ('kickoff', 'week_start')),
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE league_member (
    league_id TEXT NOT NULL REFERENCES league(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (league_id, user_id)
  );

  -- Games are shared by every league on the same feed + season, so two
  -- pools on the NFL pull the schedule once.
  CREATE TABLE game (
    id          TEXT PRIMARY KEY,
    feed        TEXT NOT NULL,
    season      INTEGER NOT NULL,
    season_type INTEGER NOT NULL,
    week        INTEGER NOT NULL,
    kickoff     TEXT NOT NULL,
    home_team   TEXT NOT NULL,
    away_team   TEXT NOT NULL,
    home_name   TEXT NOT NULL,
    away_name   TEXT NOT NULL,
    home_logo   TEXT,
    away_logo   TEXT,
    home_score  INTEGER,
    away_score  INTEGER,
    status      TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'in_progress', 'final', 'postponed', 'canceled')),
    -- Set when an admin edits a game by hand; sync then leaves it alone.
    admin_override INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX game_by_feed ON game (feed, season, season_type, week);

  CREATE TABLE pick (
    league_id  TEXT NOT NULL REFERENCES league(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    week       INTEGER NOT NULL,
    team       TEXT NOT NULL,
    game_id    TEXT NOT NULL REFERENCES game(id),
    -- Who last set it, when that was an admin on the member's behalf.
    set_by     TEXT REFERENCES app_user(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (league_id, user_id, week)
  );
  `,
];

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();
