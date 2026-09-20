import { useEffect } from "react";
import { useSession } from "./App.tsx";
import { Link, navigate } from "./router.tsx";

/** One league: go straight to it. Several: pick one. None: say so. */
export function Home() {
  const { me } = useSession();
  const leagues = me.leagues ?? [];

  useEffect(() => {
    if (leagues.length === 1) navigate(`/leagues/${leagues[0].id}`, true);
  }, [leagues]);

  if (leagues.length === 1) return null;

  return (
    <div className="stack">
      <h2>Your leagues</h2>
      {leagues.length === 0 && (
        <div className="card">
          <p>You're not in any leagues yet.</p>
          {me.user?.role === "admin" ? (
            <Link to="/admin/leagues">Create a league</Link>
          ) : (
            <p className="muted">Ask the pool admin to add you to one.</p>
          )}
        </div>
      )}
      {leagues.map((l) => (
        <Link key={l.id} to={`/leagues/${l.id}`} className="card league-link">
          <strong>{l.name}</strong>
          <span className="muted">{l.season}</span>
        </Link>
      ))}
    </div>
  );
}
