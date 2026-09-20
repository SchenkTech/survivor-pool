# survivor-pool

A self-hosted, invite-only NFL survivor / loss-tracking pool. One container,
one SQLite file, Google sign-in, installable as a PWA.

Nothing about a particular pool is baked in. League names, seasons, rules,
members and branding are all set from the Admin screens.

## Rules you can configure (per league)

| Setting | Options |
|---|---|
| Elimination | none (just count losses) · out after *N* losses (1 = classic survivor) |
| Tie counts as | push · loss · win |
| No pick for a week | counts as a loss · doesn't count |
| Picks lock | at that game's kickoff · at the week's first kickoff |
| Team reuse | once per season · allowed |
| Weeks | any start/end week |
| Schedule | ESPN feed (`espn:football/nfl`, `espn:football/college-football`, …) or entered by hand |

Standings are recomputed from picks + scores + rules on every request, so
changing a rule mid-season regrades everything consistently.

## Run it

```bash
cp .env.example .env    # fill in Google creds + ADMIN_EMAILS
docker compose up -d    # or: docker build -t survivor-pool . && docker run ...
```

The first person listed in `ADMIN_EMAILS` signs in, creates a league under
**Admin → Leagues**, and invites everyone else under **Admin → People**. Only
invited emails can sign in.

Kubernetes: `deploy/k8s/survivor-pool.yaml` (single replica, `Recreate`,
1 Gi PVC). Put an Ingress / Cloudflare Tunnel in front of the Service.

### Google OAuth setup

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External,
   add your domain. For a private pool you can leave it in *Testing* and add
   users there as well, or publish it (only the `openid email profile` scopes
   are requested, so no verification review is needed).
2. **Credentials → Create OAuth client ID → Web application.**
   Authorized redirect URI: `https://<your host>/api/auth/google/callback`
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,
   and set `PUBLIC_URL` to the same origin.

### Environment

| Var | Default | |
|---|---|---|
| `PUBLIC_URL` | derived from request | Origin for the OAuth redirect. Set it in production. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Required for sign-in. |
| `ADMIN_EMAILS` | — | Comma-separated; always admins. |
| `DATABASE_PATH` | `/data/survivor.db` | Mount a volume at `/data`. |
| `SYNC_INTERVAL_MINUTES` | `15` | `0` disables background score sync. |
| `SESSION_DAYS` | `60` | Sign-in lifetime. |
| `PORT` | `8080` | |
| `DEV_LOGIN` | `false` | Local dev only: sign in by typing an invited email. |

### Backups

Everything is in `/data/survivor.db` (plus `-wal`/`-shm` while running). For a
consistent copy of a live database:

```bash
kubectl exec deploy/survivor-pool -- node -e "new (require('node:sqlite').DatabaseSync)('/data/survivor.db').exec(\"VACUUM INTO '/data/backup.db'\")"
```

## Develop

```bash
npm install
cp .env.example apps/api/.env   # set DEV_LOGIN=true, ADMIN_EMAILS=you@example.com
npm run dev                     # API on :8080, Vite on :5173 (proxies /api)
npm test                        # rules engine tests
npm run typecheck
```

Layout: `packages/engine` (pure rules: grading, standings, pick validation,
tested) · `apps/api` (Hono on Node, `node:sqlite`, Google OAuth, ESPN sync) ·
`apps/web` (React + Vite PWA).
