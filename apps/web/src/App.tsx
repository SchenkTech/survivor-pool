import { createContext, useContext, useEffect } from "react";
import { api } from "./api.ts";
import type { Me, Settings } from "./api.ts";
import { useApi } from "./hooks.ts";
import { Link, match, navigate, usePath } from "./router.tsx";
import { SignIn } from "./SignIn.tsx";
import { Home } from "./Home.tsx";
import { LeagueScreen } from "./LeagueScreen.tsx";
import { Admin } from "./admin/Admin.tsx";

interface Session {
  me: Me;
  settings: Settings;
  reloadSettings: () => Promise<void>;
}
const SessionContext = createContext<Session | null>(null);
export const useSession = () => useContext(SessionContext)!;

export function App() {
  const path = usePath();
  const me = useApi<Me>("/me");
  const settings = useApi<Settings>("/settings");

  // Branding is data, not code: apply the pool's name and accent at runtime.
  useEffect(() => {
    if (!settings.data) return;
    document.title = settings.data.appName;
    document.documentElement.style.setProperty("--accent", settings.data.accentColor);
  }, [settings.data]);

  const user = me.data?.user ?? null;
  useEffect(() => {
    if (me.loading || !me.data) return;
    if (!user && path !== "/signin") navigate(`/signin?returnTo=${encodeURIComponent(path)}`, true);
    if (user && path === "/signin") navigate("/", true);
  }, [me.loading, me.data, user, path]);

  if (!me.data || !settings.data) {
    return <div className="center muted">{me.error ?? settings.error ?? "Loading…"}</div>;
  }

  const session: Session = { me: me.data, settings: settings.data, reloadSettings: settings.reload };

  if (!user) {
    return (
      <SessionContext.Provider value={session}>
        <SignIn />
      </SessionContext.Provider>
    );
  }

  let screen;
  let params;
  if (path === "/") screen = <Home />;
  else if ((params = match("/leagues/:id", path))) screen = <LeagueScreen id={params.id} tab="pick" />;
  else if ((params = match("/leagues/:id/:tab", path))) screen = <LeagueScreen id={params.id} tab={params.tab} />;
  else if (path === "/admin" || path.startsWith("/admin/")) screen = user.role === "admin" ? <Admin path={path} /> : <NotFound />;
  else screen = <NotFound />;

  const signOut = async () => {
    await api.post("/auth/logout");
    window.location.href = "/signin";
  };

  return (
    <SessionContext.Provider value={session}>
      <header className="topbar">
        <Link to="/" className="brand">
          <img src={settings.data.iconUrl || "/icon.svg"} alt="" />
          <span>{settings.data.appName}</span>
        </Link>
        <nav>
          {user.role === "admin" && (
            <Link to="/admin" className={path.startsWith("/admin") ? "active" : ""}>
              Admin
            </Link>
          )}
          <button className="link" onClick={signOut} title={user.email}>
            {user.pictureUrl ? <img className="avatar" src={user.pictureUrl} alt="" referrerPolicy="no-referrer" /> : null}
            Sign out
          </button>
        </nav>
      </header>
      <main>{screen}</main>
    </SessionContext.Provider>
  );
}

function NotFound() {
  return (
    <div className="card">
      <p>Nothing here.</p>
      <Link to="/">Go home</Link>
    </div>
  );
}
