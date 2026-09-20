# App design

## What it is

A weekly pick'em where each member picks one team to win. Leagues choose whether a loss eliminates
you (classic survivor, or *N* strikes) or is simply counted (a loss-tracking league — fewest losses
wins). Built for a group of friends, self-hosted, and reusable by anyone else running a pool.

## Decisions

### One container, SQLite
The target is "runs on Docker or k8s with no other moving parts." A pool is tens of members and a few
hundred picks a season; SQLite on a volume is more than enough, backs up as one file, and removes a
database server from the deployment. Cost: one replica. Postgres was considered and rejected as
infrastructure the data size doesn't justify.

`node:sqlite` (built into Node) rather than better-sqlite3/libSQL so the image has no native modules
and builds identically on amd64 and arm64.

### Configurable rules, derived standings
Every rule a real pool has argued about is a league setting: elimination threshold, ties, missed picks,
lock timing, team reuse, week range. Because standings are computed from raw picks and scores each
time, an admin can change a rule mid-season and every table regrades — there are no stored results to
migrate.

### Invite-only Google sign-in
No passwords to reset. Google verifies the email; the `app_user` table is the allow-list. Admins invite
by email (bulk paste supported), assign leagues, and can disable someone without losing their history.
`ADMIN_EMAILS` bootstraps the first admin on a fresh install.

The OAuth flow is hand-written (authorization code + PKCE + nonce) rather than a library: it's ~100
lines, and the ID token comes straight from Google's token endpoint over TLS, so claim checks suffice
(OIDC Core 3.1.3.7).

### Schedule from a feed, with a manual escape hatch
ESPN's public scoreboard supplies schedule and scores for any ESPN sport path. It is unofficial, so:
admins can edit any game (which pins it against sync), add games by hand, or run a league entirely on
the `manual` feed.

### Pick visibility
Other members' picks are hidden until they lock, so nobody can copy or fade a pick that could still
change. After lock, each game shows how many members took each side.

## Screens

- **Pick** — week selector, games as two big team buttons, used teams and locked games disabled.
- **Standings** — rank, W/L/P, and a week-by-week grid colored by result.
- **Rules** — the league's settings in plain English (same text the admin previews while editing).
- **Admin** — People (invite / roles / disable / leagues), Leagues (rules, members, games, picks on a
  member's behalf), Branding (name, color, icon → PWA manifest).

## Not yet

- Buy-backs / re-entry, and "if everyone is eliminated in the same week, they all survive."
- Multiple picks per week (two-team survivor weeks late in the season).
- Push/email reminders for members without a pick.
- Postgres, if anyone ever needs more than one replica.
