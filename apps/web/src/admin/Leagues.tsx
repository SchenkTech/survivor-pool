import { useState } from "react";
import { api } from "../api.ts";
import type { League } from "../api.ts";
import { useApi } from "../hooks.ts";
import { Link, navigate } from "../router.tsx";
import { LeagueForm } from "./LeagueForm.tsx";

export function Leagues() {
  const leagues = useApi<League[]>("/leagues");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!leagues.data) return <div className="center muted">{leagues.error ?? "Loading…"}</div>;

  return (
    <div className="stack">
      {creating ? (
        <div className="card">
          <h3>New league</h3>
          <LeagueForm
            submitLabel="Create league"
            onCancel={() => setCreating(false)}
            onSubmit={async (body) => {
              const res = await api.post<{ id: string; synced: number; syncError: string | null }>("/admin/leagues", body);
              if (res.syncError) {
                // Stay here so the message is seen; Sync on the league's
                // Games page retries.
                setMsg(`Created, but the schedule didn't load: ${res.syncError}`);
                setCreating(false);
                await leagues.reload();
              } else {
                navigate(`/admin/leagues/${res.id}/members`);
              }
            }}
          />
        </div>
      ) : (
        <button onClick={() => setCreating(true)}>+ New league</button>
      )}
      {msg && <div className="card error">{msg}</div>}
      {leagues.data.map((l) => (
        <Link key={l.id} to={`/admin/leagues/${l.id}`} className="card league-link">
          <strong>{l.name}</strong>
          <span className="muted">
            {l.season} · {l.feed}
            {l.archived ? " · archived" : ""}
          </span>
        </Link>
      ))}
    </div>
  );
}
