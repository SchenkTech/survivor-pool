import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { AdminUser, Game, LeagueDetail, Pick } from "../api.ts";
import { formatKickoff, toLocalInput, useApi } from "../hooks.ts";
import { Link, navigate } from "../router.tsx";
import { LeagueForm } from "./LeagueForm.tsx";

export function LeagueAdmin({ id, section }: { id: string; section: string }) {
  const detail = useApi<LeagueDetail>(`/leagues/${id}`);
  if (!detail.data) return <div className="center muted">{detail.error ?? "Loading…"}</div>;
  const d = detail.data;
  const base = `/admin/leagues/${id}`;

  return (
    <div className="stack">
      <div className="row between">
        <h3>{d.league.name}</h3>
        <Link to={`/leagues/${id}`}>View as player →</Link>
      </div>
      <nav className="tabs small">
        <Link to={base} className={section === "rules" ? "active" : ""}>Rules</Link>
        <Link to={`${base}/members`} className={section === "members" ? "active" : ""}>Members</Link>
        <Link to={`${base}/games`} className={section === "games" ? "active" : ""}>Games</Link>
        <Link to={`${base}/picks`} className={section === "picks" ? "active" : ""}>Picks</Link>
      </nav>
      {section === "rules" && (
        <div className="card">
          <LeagueForm
            key={d.league.id}
            league={d.league}
            submitLabel="Save"
            onSubmit={async (body) => {
              await api.patch(`/admin/leagues/${id}`, body);
              await detail.reload();
            }}
          />
          <hr />
          <button
            className="danger ghost"
            onClick={async () => {
              if (!window.confirm(`Delete ${d.league.name} and every pick in it? Archiving keeps the history.`)) return;
              await api.del(`/admin/leagues/${id}`);
              navigate("/admin/leagues");
            }}
          >
            Delete league
          </button>
        </div>
      )}
      {section === "members" && <Members leagueId={id} />}
      {section === "games" && <Games detail={d} />}
      {section === "picks" && <Picks detail={d} />}
    </div>
  );
}

function Members({ leagueId }: { leagueId: string }) {
  const users = useApi<AdminUser[]>("/admin/users");
  const [selected, setSelected] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (users.data) setSelected(users.data.filter((u) => u.leagueIds.includes(leagueId)).map((u) => u.id));
  }, [users.data, leagueId]);
  if (!users.data || !selected) return <div className="center muted">Loading…</div>;

  const save = async () => {
    await api.put(`/admin/leagues/${leagueId}/members`, { userIds: selected });
    setSaved(true);
    void users.reload();
  };

  return (
    <div className="card stack">
      <p className="muted small">
        Who plays in this league. To add someone new, invite them on the <Link to="/admin">People</Link> tab first.
      </p>
      <ul className="list">
        {users.data.map((u) => (
          <li key={u.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(u.id)}
                onChange={(e) => {
                  setSaved(false);
                  setSelected(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id));
                }}
              />{" "}
              {u.name} <span className="muted small">{u.email}</span> {u.disabled && <span className="badge">disabled</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="row">
        <button onClick={save}>Save members ({selected.length})</button>
        {saved && <span className="muted">Saved.</span>}
      </div>
    </div>
  );
}

function Games({ detail }: { detail: LeagueDetail }) {
  const { league } = detail;
  const games = useApi<Game[]>(`/admin/leagues/${league.id}/games`);
  const [week, setWeek] = useState(detail.currentWeek);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const manual = league.feed === "manual";

  const sync = async () => {
    setMsg("Syncing…");
    try {
      const r = await api.post<{ synced: number }>(`/admin/leagues/${league.id}/sync`);
      setMsg(`Synced ${r.synced} games.`);
      void games.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const weekGames = (games.data ?? []).filter((g) => g.week === week);

  return (
    <div className="stack">
      <div className="card row wrap between">
        <label>
          Week{" "}
          <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {detail.weeks.map((w) => (
              <option key={w.week} value={w.week}>{w.week} ({w.games} games)</option>
            ))}
          </select>
        </label>
        {!manual && <button onClick={sync}>Sync schedule & scores</button>}
        {msg && <span className="muted small">{msg}</span>}
      </div>
      <p className="muted small">
        {manual
          ? "This league's games are entered by hand. Enter final scores as games finish."
          : `Pulled from ${league.feed} automatically. Editing a game pins your version so the feed stops overwriting it.`}
      </p>
      <AddGame leagueId={league.id} week={week} onDone={games.reload} />
      {weekGames.map((g) =>
        editing === g.id ? (
          <EditGame key={g.id} game={g} onDone={() => { setEditing(null); void games.reload(); }} />
        ) : (
          <div key={g.id} className="card row between">
            <div>
              <strong>{g.awayTeam} {g.awayScore ?? ""}</strong> at <strong>{g.homeTeam} {g.homeScore ?? ""}</strong>
              <div className="muted small">
                {formatKickoff(g.kickoff)} · {g.status}
                {g.adminOverride && !manual && " · edited by admin"}
              </div>
            </div>
            <button className="ghost" onClick={() => setEditing(g.id)}>Edit</button>
          </div>
        ),
      )}
    </div>
  );
}

function AddGame({ leagueId, week, onDone }: { leagueId: string; week: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ awayTeam: "", awayName: "", homeTeam: "", homeName: "", kickoff: "" });
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button className="ghost" onClick={() => setOpen(true)}>+ Add a game to week {week}</button>;

  const save = async () => {
    try {
      await api.post(`/admin/leagues/${leagueId}/games`, { ...f, week, kickoff: new Date(f.kickoff).toISOString() });
      setF({ awayTeam: "", awayName: "", homeTeam: "", homeName: "", kickoff: "" });
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card stack">
      <div className="grid2">
        <label>Away code<input value={f.awayTeam} placeholder="DAL" onChange={(e) => setF({ ...f, awayTeam: e.target.value })} /></label>
        <label>Away name<input value={f.awayName} placeholder="Dallas Cowboys" onChange={(e) => setF({ ...f, awayName: e.target.value })} /></label>
        <label>Home code<input value={f.homeTeam} placeholder="NYG" onChange={(e) => setF({ ...f, homeTeam: e.target.value })} /></label>
        <label>Home name<input value={f.homeName} placeholder="New York Giants" onChange={(e) => setF({ ...f, homeName: e.target.value })} /></label>
      </div>
      <label>Kickoff<input type="datetime-local" value={f.kickoff} onChange={(e) => setF({ ...f, kickoff: e.target.value })} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={!f.kickoff} onClick={save}>Add game</button>
        <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function EditGame({ game, onDone }: { game: Game; onDone: () => void }) {
  const [homeScore, setHomeScore] = useState(game.homeScore?.toString() ?? "");
  const [awayScore, setAwayScore] = useState(game.awayScore?.toString() ?? "");
  const [status, setStatus] = useState(game.status);
  const [kickoff, setKickoff] = useState(toLocalInput(game.kickoff));
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const save = async (adminOverride = true) => {
    try {
      await api.patch(`/admin/games/${encodeURIComponent(game.id)}`, {
        homeScore: num(homeScore),
        awayScore: num(awayScore),
        status,
        kickoff: new Date(kickoff).toISOString(),
        adminOverride,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    try {
      await api.del(`/admin/games/${encodeURIComponent(game.id)}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card stack">
      <strong>{game.awayName} at {game.homeName}</strong>
      <div className="grid2">
        <label>{game.awayTeam} score<input type="number" value={awayScore} onChange={(e) => setAwayScore(e.target.value)} /></label>
        <label>{game.homeTeam} score<input type="number" value={homeScore} onChange={(e) => setHomeScore(e.target.value)} /></label>
      </div>
      <div className="grid2">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as Game["status"])}>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="final">Final</option>
            <option value="postponed">Postponed</option>
            <option value="canceled">Canceled (picks push)</option>
          </select>
        </label>
        <label>Kickoff<input type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        <button onClick={() => save(true)}>Save</button>
        {game.adminOverride && game.feed !== "manual" && (
          <button className="ghost" onClick={() => save(false)} title="Let the next sync overwrite this game">
            Hand back to feed
          </button>
        )}
        <button className="ghost" onClick={onDone}>Cancel</button>
        <button className="danger ghost" onClick={remove}>Delete</button>
      </div>
    </div>
  );
}

/** Set or fix a pick on someone's behalf -- forgot to pick, texted it in,
 *  or a tap on the wrong team. Ignores the lock; the rest of the rules
 *  (team reuse, elimination) still apply. */
function Picks({ detail }: { detail: LeagueDetail }) {
  const { league } = detail;
  const [week, setWeek] = useState(detail.currentWeek);
  const users = useApi<AdminUser[]>("/admin/users");
  const picks = useApi<Pick[]>(`/admin/leagues/${league.id}/picks`);
  const games = useApi<Game[]>(`/admin/leagues/${league.id}/games`);
  const [error, setError] = useState<string | null>(null);

  if (!users.data || !picks.data || !games.data) return <div className="center muted">Loading…</div>;
  const members = users.data.filter((u) => u.leagueIds.includes(league.id));
  const weekGames = games.data.filter((g) => g.week === week);
  const teams = weekGames.flatMap((g) => [g.awayTeam, g.homeTeam]).sort();

  const set = async (userId: string, team: string) => {
    setError(null);
    try {
      await api.put(`/admin/leagues/${league.id}/picks`, { userId, week, team: team || null });
      await picks.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card stack">
      <label>
        Week{" "}
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {detail.weeks.map((w) => (
            <option key={w.week} value={w.week}>{w.week}</option>
          ))}
        </select>
      </label>
      <p className="muted small">Admin picks ignore the lock. Team reuse and elimination rules still apply.</p>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {members.map((m) => {
          const p = picks.data!.find((x) => x.userId === m.id && x.week === week);
          return (
            <li key={m.id} className="row between">
              <span>
                {m.name} {p?.setBy && <span className="badge">set by admin</span>}
              </span>
              <select value={p?.team ?? ""} onChange={(e) => set(m.id, e.target.value)}>
                <option value="">— no pick —</option>
                {teams.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
