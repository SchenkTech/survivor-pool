import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "./config.ts";
import { nowIso } from "./db.ts";
import type { Db } from "./db.ts";
import { getUserByEmail, toUser } from "./store.ts";
import type { User } from "./store.ts";

/**
 * Google sign-in, invite-only.
 *
 * Google proves who someone is; this app decides whether they are allowed
 * in. An email must already exist in app_user (an admin invited it, or it
 * is in ADMIN_EMAILS) or the callback turns them away. There is no
 * self-registration path at all.
 */

export type AppEnv = { Variables: { user: User | null } };

const SESSION_COOKIE = "sp_session";
const OAUTH_COOKIE = "sp_oauth";

const b64url = (buf: Buffer) => buf.toString("base64url");
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const hashToken = (token: string) => sha256(token).toString("hex");

function publicOrigin(c: Context, cfg: Config): string {
  if (cfg.publicUrl) return cfg.publicUrl;
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  return `${proto}://${host}`;
}

function isSecure(c: Context, cfg: Config): boolean {
  return publicOrigin(c, cfg).startsWith("https://");
}

export function sessionMiddleware(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("user", null);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const r = db
        .prepare(
          `SELECT u.* FROM session s JOIN app_user u ON u.id = s.user_id
           WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`,
        )
        .get(hashToken(token), nowIso()) as Record<string, unknown> | undefined;
      if (r) c.set("user", toUser(r));
    }
    await next();
  };
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Sign in required." }, 401);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Sign in required." }, 401);
  if (user.role !== "admin") return c.json({ error: "Admins only." }, 403);
  await next();
};

function startSession(c: Context, db: Db, cfg: Config, user: User): void {
  const token = b64url(randomBytes(32));
  const expires = new Date(Date.now() + cfg.sessionDays * 86_400_000);
  db.prepare("INSERT INTO session (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    user.id,
    expires.toISOString(),
    nowIso(),
  );
  db.prepare("DELETE FROM session WHERE expires_at <= ?").run(nowIso());
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(c, cfg),
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

/** Only same-site paths, so the sign-in round trip can't be turned into an
 *  open redirect. */
function safeReturnTo(v: string | undefined): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

/** Invite + ADMIN_EMAILS bootstrap: make sure every configured admin
 *  exists and is an admin. Never demotes anyone. */
export function bootstrapAdmins(db: Db, emails: string[]): void {
  for (const email of emails) {
    const existing = getUserByEmail(db, email);
    if (existing) {
      if (existing.role !== "admin" || existing.disabled) {
        db.prepare("UPDATE app_user SET role = 'admin', disabled = 0 WHERE id = ?").run(existing.id);
      }
    } else {
      db.prepare("INSERT INTO app_user (id, email, name, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(
        randomUUID(),
        email,
        email.split("@")[0],
        nowIso(),
      );
    }
  }
}

interface IdTokenClaims {
  iss: string;
  aud: string;
  exp: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
}

export function authRoutes(db: Db, cfg: Config) {
  const app = new Hono<AppEnv>();

  app.get("/providers", (c) =>
    c.json({ google: !!(cfg.googleClientId && cfg.googleClientSecret), dev: cfg.devLogin }),
  );

  app.get("/google/start", (c) => {
    if (!cfg.googleClientId || !cfg.googleClientSecret) return c.text("Google sign-in is not configured.", 503);

    const state = b64url(randomBytes(16));
    const verifier = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(16));
    const returnTo = safeReturnTo(c.req.query("returnTo"));
    setCookie(c, OAUTH_COOKIE, b64url(Buffer.from(JSON.stringify({ state, verifier, nonce, returnTo }))), {
      httpOnly: true,
      secure: isSecure(c, cfg),
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: 600,
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: cfg.googleClientId,
      redirect_uri: `${publicOrigin(c, cfg)}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: b64url(sha256(verifier)),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return c.redirect(url.toString());
  });

  app.get("/google/callback", async (c) => {
    const fail = (reason: string) => c.redirect(`/signin?error=${encodeURIComponent(reason)}`);

    const raw = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: "/api/auth" });
    if (!raw) return fail("expired");
    let saved: { state: string; verifier: string; nonce: string; returnTo: string };
    try {
      saved = JSON.parse(Buffer.from(raw, "base64url").toString());
    } catch {
      return fail("expired");
    }
    if (c.req.query("error")) return fail("cancelled");
    const code = c.req.query("code");
    if (!code || c.req.query("state") !== saved.state) return fail("expired");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.googleClientId!,
        client_secret: cfg.googleClientSecret!,
        redirect_uri: `${publicOrigin(c, cfg)}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: saved.verifier,
      }),
    });
    if (!res.ok) {
      console.error("google token exchange failed", res.status, await res.text());
      return fail("google");
    }
    const { id_token } = (await res.json()) as { id_token?: string };
    if (!id_token) return fail("google");

    // The ID token came straight from Google's token endpoint over TLS, in
    // exchange for our client secret, so its signature need not be checked
    // again (OpenID Connect Core 3.1.3.7). The claims still are.
    const claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString()) as IdTokenClaims;
    const valid =
      (claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com") &&
      claims.aud === cfg.googleClientId &&
      claims.exp * 1000 > Date.now() &&
      claims.nonce === saved.nonce &&
      claims.email_verified === true &&
      !!claims.email;
    if (!valid) return fail("google");

    const user = getUserByEmail(db, claims.email!);
    if (!user || user.disabled) return fail("not_invited");

    // Keep an admin-entered name; only fill it from Google when the invite
    // left the placeholder (the email's local part).
    const name = user.name === user.email.split("@")[0] && claims.name ? claims.name : user.name;
    db.prepare("UPDATE app_user SET name = ?, picture_url = ?, last_login_at = ? WHERE id = ?").run(
      name,
      claims.picture ?? null,
      nowIso(),
      user.id,
    );
    startSession(c, db, cfg, user);
    return c.redirect(saved.returnTo);
  });

  if (cfg.devLogin) {
    app.post("/dev", async (c) => {
      const { email } = await c.req.json<{ email?: string }>();
      const user = email ? getUserByEmail(db, email) : null;
      if (!user || user.disabled) return c.json({ error: "That email hasn't been invited." }, 403);
      db.prepare("UPDATE app_user SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
      startSession(c, db, cfg, user);
      return c.json({ ok: true });
    });
  }

  app.post("/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) db.prepare("DELETE FROM session WHERE id = ?").run(hashToken(token));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  return app;
}
