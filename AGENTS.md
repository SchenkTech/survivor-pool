# survivor-pool

Self-hosted, invite-only NFL survivor / loss-tracking pool: one container, SQLite, Google OAuth, PWA.
See `docs/APP_DESIGN.md` for the why.

## Stack

- npm workspaces: `packages/engine` (pure TS rules, `node --test`), `apps/api` (Hono + `@hono/node-server`),
  `apps/web` (React 19 + Vite + vite-plugin-pwa).
- Node 24+ runs the API's `.ts` directly (type stripping) — no build step for the server. Keep to
  erasable syntax: no `enum`, no parameter properties, `import type` for types, `.ts` extensions on imports.
- Database is Node's built-in `node:sqlite` — no ORM, no native modules. Migrations are the append-only
  `MIGRATIONS` array in `apps/api/src/db.ts`, tracked by `PRAGMA user_version`. Never edit a shipped one.
- Image: multi-stage `Dockerfile`, Alpine runtime, runs as uid 1000, works with a read-only root fs;
  only `/data` is writable.

## Conventions

- **Nothing pool-specific in code.** Names, seasons, rules, branding, members live in the DB and are
  edited in Admin. Deployment concerns (OAuth creds, URL, admin bootstrap) are env vars. If you're about
  to hardcode a team, a week count or a name, it belongs in a league or setting instead.
- **Standings are derived, never stored.** `computeStandings` regrades from picks + games + rules each
  request, so rule changes apply retroactively and consistently. Don't add a stored "losses" column.
- **Invite list is the allow-list.** Google proves identity; `app_user` decides access. No
  self-registration path, ever.
- Rules logic goes in `packages/engine` with a test; routes only load data and call it.
- Games are shared across leagues by `(feed, season, season_type)`. Admin edits set `admin_override`
  so the ESPN sync stops overwriting them.
- Single replica only (SQLite). k8s manifest uses `strategy: Recreate` for that reason.
