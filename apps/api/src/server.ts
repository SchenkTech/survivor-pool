import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { authRoutes, bootstrapAdmins, sessionMiddleware } from "./auth.ts";
import type { AppEnv } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { syncActive } from "./feeds.ts";
import { adminRoutes } from "./routes/admin.ts";
import { playerRoutes } from "./routes/player.ts";
import { getSettings, toLeague } from "./store.ts";

const cfg = loadConfig();
const db = openDb(cfg.databasePath);
bootstrapAdmins(db, cfg.adminEmails);

const app = new Hono<AppEnv>();
app.use("/api/*", csrf());
app.use("/api/*", sessionMiddleware(db));

app.get("/api/health", (c) => c.json({ ok: true }));

/** Public: the sign-in screen needs the pool's name and colors before
 *  anyone has signed in. */
app.get("/api/settings", (c) => c.json(getSettings(db)));

app.get("/api/me", (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  const leagues = (
    db
      .prepare(
        `SELECT l.* FROM league l JOIN league_member m ON m.league_id = l.id
         WHERE m.user_id = ? AND l.archived = 0 ORDER BY l.season DESC, l.name`,
      )
      .all(user.id) as Record<string, unknown>[]
  ).map(toLeague);
  return c.json({ user, leagues: leagues.map((l) => ({ id: l.id, name: l.name, season: l.season })) });
});

app.route("/api/auth", authRoutes(db, cfg));
app.route("/api/admin", adminRoutes(db));
app.route("/api", playerRoutes(db));
app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

/* The manifest and icon are generated from settings so the installed PWA
 * carries this pool's name and colors -- nothing in the image is specific
 * to one league. */
app.get("/manifest.webmanifest", (c) => {
  const s = getSettings(db);
  const icons = s.iconUrl
    ? [{ src: s.iconUrl, sizes: "512x512", purpose: "any" }]
    : [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }];
  return c.json(
    {
      name: s.appName,
      short_name: s.shortName || s.appName,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: s.accentColor,
      icons,
    },
    200,
    { "content-type": "application/manifest+json", "cache-control": "no-cache" },
  );
});

app.get("/icon.svg", (c) => {
  const s = getSettings(db);
  const letter = (s.shortName || s.appName || "S").trim().charAt(0).toUpperCase();
  const color = /^#[0-9a-f]{3,8}$/i.test(s.accentColor) ? s.accentColor : "#2f6fdf";
  const esc = letter.replace(/[<>&"']/g, "");
  return c.body(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${color}"/>` +
      `<text x="256" y="340" font-family="system-ui,sans-serif" font-size="280" font-weight="700" fill="#fff" text-anchor="middle">${esc}</text></svg>`,
    200,
    { "content-type": "image/svg+xml", "cache-control": "no-cache" },
  );
});

// Everything else is the built SPA, with index.html as the fallback so
// client-side routes survive a reload.
app.use("*", serveStatic({ root: cfg.webDistDir }));
app.use("*", serveStatic({ path: `${cfg.webDistDir}/index.html` }));

if (cfg.syncIntervalMinutes > 0) {
  const run = () => syncActive(db).catch((e) => console.error("background sync", e));
  setTimeout(run, 5_000);
  setInterval(run, cfg.syncIntervalMinutes * 60_000);
}

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`survivor-pool listening on :${info.port}`);
  if (!cfg.googleClientId) console.warn("GOOGLE_CLIENT_ID is not set -- Google sign-in is disabled.");
  if (cfg.adminEmails.length === 0) console.warn("ADMIN_EMAILS is empty -- nobody will be able to sign in on a fresh install.");
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}
