import { useState } from "react";
import { api } from "../api.ts";
import type { AdminUser, League } from "../api.ts";
import { useSession } from "../App.tsx";
import { useApi } from "../hooks.ts";

/** The invite list *is* the allow-list: Google sign-in only succeeds for an
 *  email that appears here and isn't disabled. */
export function People() {
  const { me } = useSession();
  const users = useApi<AdminUser[]>("/admin/users");
  const leagues = useApi<League[]>("/leagues");
  const [editing, setEditing] = useState<string | null>(null);

  if (!users.data || !leagues.data) return <div className="center muted">{users.error ?? leagues.error ?? "Loading…"}</div>;
  const active = leagues.data.filter((l) => !l.archived);

  return (
    <div className="stack">
      <InviteForm leagues={active} onDone={users.reload} />
      <div className="card">
        <h3>People ({users.data.length})</h3>
        <ul className="list">
          {users.data.map((u) =>
            editing === u.id ? (
              <li key={u.id}>
                <EditUser
                  user={u}
                  leagues={leagues.data!}
                  isSelf={u.id === me.user?.id}
                  onDone={() => {
                    setEditing(null);
                    void users.reload();
                  }}
                />
              </li>
            ) : (
              <li key={u.id} className={`person ${u.disabled ? "disabled" : ""}`}>
                <div>
                  <strong>{u.name}</strong> {u.role === "admin" && <span className="badge accent">admin</span>}
                  {u.disabled && <span className="badge">disabled</span>}
                  <div className="muted small">
                    {u.email} · {u.lastLoginAt ? `last in ${new Date(u.lastLoginAt).toLocaleDateString()}` : "hasn't signed in yet"}
                  </div>
                  <div className="muted small">
                    {u.leagueIds.map((id) => leagues.data!.find((l) => l.id === id)?.name).filter(Boolean).join(", ") || "No leagues"}
                  </div>
                </div>
                <button className="ghost" onClick={() => setEditing(u.id)}>Edit</button>
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

function InviteForm({ leagues, onDone }: { leagues: League[]; onDone: () => void }) {
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [leagueIds, setLeagueIds] = useState<string[]>(leagues.length === 1 ? [leagues[0].id] : []);
  const [msg, setMsg] = useState<string | null>(null);

  // Paste a whole list at once: one per line, or comma separated, with an
  // optional name as "Name <email>".
  const submit = async () => {
    const entries = emails.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const results: string[] = [];
    for (const entry of entries) {
      const m = entry.match(/^(.*)<([^>]+)>$/);
      const email = (m ? m[2] : entry).trim();
      const name = m ? m[1].trim().replace(/^"|"$/g, "") : undefined;
      try {
        await api.post("/admin/users", { email, name, role, leagueIds });
        results.push(`✓ ${email}`);
      } catch (e) {
        results.push(`✗ ${email}: ${(e as Error).message}`);
      }
    }
    setMsg(results.join("\n"));
    setEmails("");
    onDone();
  };

  return (
    <div className="card">
      <h3>Invite</h3>
      <p className="muted small">They sign in with Google using exactly this email. One per line; "Name &lt;email&gt;" also works.</p>
      <textarea rows={3} value={emails} placeholder={"pat@gmail.com\nSam Smith <sam@example.com>"} onChange={(e) => setEmails(e.target.value)} />
      <div className="row wrap">
        <label>
          Role{" "}
          <select value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
            <option value="member">Player</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <LeagueChecks leagues={leagues} value={leagueIds} onChange={setLeagueIds} />
      </div>
      <button disabled={!emails.trim()} onClick={submit}>Invite</button>
      {msg && <pre className="small">{msg}</pre>}
    </div>
  );
}

export function LeagueChecks({ leagues, value, onChange }: { leagues: League[]; value: string[]; onChange: (v: string[]) => void }) {
  if (leagues.length === 0) return <span className="muted small">No leagues yet</span>;
  return (
    <span className="checks">
      {leagues.map((l) => (
        <label key={l.id}>
          <input
            type="checkbox"
            checked={value.includes(l.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, l.id] : value.filter((x) => x !== l.id))}
          />{" "}
          {l.name}
        </label>
      ))}
    </span>
  );
}

function EditUser({ user, leagues, isSelf, onDone }: { user: AdminUser; leagues: League[]; isSelf: boolean; onDone: () => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [disabled, setDisabled] = useState(user.disabled);
  const [leagueIds, setLeagueIds] = useState(user.leagueIds);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await api.patch(`/admin/users/${user.id}`, { name, email, role, disabled, leagueIds });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${user.name} and all of their picks? Disabling keeps their history.`)) return;
    try {
      await api.del(`/admin/users/${user.id}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stack edit">
      <div className="grid2">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
      <div className="row wrap">
        <label>
          Role{" "}
          <select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
            <option value="member">Player</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={disabled} disabled={isSelf} onChange={(e) => setDisabled(e.target.checked)} /> Disabled (can't sign in)
        </label>
      </div>
      <LeagueChecks leagues={leagues} value={leagueIds} onChange={setLeagueIds} />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={save}>Save</button>
        <button className="ghost" onClick={onDone}>Cancel</button>
        {!isSelf && <button className="danger ghost" onClick={remove}>Remove</button>}
      </div>
    </div>
  );
}
