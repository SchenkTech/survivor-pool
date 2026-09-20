import { Link, match } from "../router.tsx";
import { People } from "./People.tsx";
import { Leagues } from "./Leagues.tsx";
import { LeagueAdmin } from "./LeagueAdmin.tsx";
import { SettingsAdmin } from "./SettingsAdmin.tsx";

export function Admin({ path }: { path: string }) {
  const league = match("/admin/leagues/:id", path) ?? match("/admin/leagues/:id/:section", path);
  const tab = path.split("/")[2] ?? "people";

  return (
    <div className="stack">
      <h2>Admin</h2>
      <nav className="tabs">
        <Link to="/admin" className={tab === "people" ? "active" : ""}>People</Link>
        <Link to="/admin/leagues" className={tab === "leagues" ? "active" : ""}>Leagues</Link>
        <Link to="/admin/settings" className={tab === "settings" ? "active" : ""}>Branding</Link>
      </nav>
      {league ? (
        <LeagueAdmin id={league.id} section={league.section ?? "rules"} />
      ) : tab === "leagues" ? (
        <Leagues />
      ) : tab === "settings" ? (
        <SettingsAdmin />
      ) : (
        <People />
      )}
    </div>
  );
}
