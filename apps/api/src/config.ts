/**
 * Everything deployment-specific comes from the environment; everything
 * league-specific (names, seasons, rules, branding) lives in the database and
 * is edited from the Admin screens. Nothing about a particular pool is baked
 * into the image, so the same container runs anyone's league.
 */
export interface Config {
  port: number;
  /** Where the SQLite file lives. Mount a volume here. */
  databasePath: string;
  /** Public origin, e.g. https://survivor.example.com. Used for the OAuth
   *  redirect URI. When unset it is derived per-request from Host /
   *  X-Forwarded-* headers, which is fine behind a well-behaved proxy. */
  publicUrl: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  /** Emails promoted to admin on every boot, so a fresh install has
   *  someone who can sign in and invite everyone else. */
  adminEmails: string[];
  /** How often to pull scores from the feed. 0 disables background sync. */
  syncIntervalMinutes: number;
  /** Local-only sign-in without Google, for development. Refused when
   *  NODE_ENV=production. */
  devLogin: boolean;
  webDistDir: string;
  sessionDays: number;
}

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const devLogin = env.DEV_LOGIN === "true";
  if (production && devLogin) throw new Error("DEV_LOGIN cannot be enabled when NODE_ENV=production");

  return {
    port: Number(env.PORT ?? 8080),
    databasePath: env.DATABASE_PATH ?? "./data/survivor.db",
    publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, "") : null,
    googleClientId: env.GOOGLE_CLIENT_ID || null,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || null,
    adminEmails: list(env.ADMIN_EMAILS),
    syncIntervalMinutes: Number(env.SYNC_INTERVAL_MINUTES ?? 15),
    devLogin,
    webDistDir: env.WEB_DIST_DIR ?? "../web/dist",
    sessionDays: Number(env.SESSION_DAYS ?? 60),
  };
}
