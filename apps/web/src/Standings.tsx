import type { StandingsView, VisibleCell } from "./api.ts";
import { useSession } from "./App.tsx";
import { useApi } from "./hooks.ts";

export function Standings({ leagueId }: { leagueId: string }) {
  const { me } = useSession();
  const view = useApi<StandingsView>(`/leagues/${leagueId}/standings`);
  if (view.error) return <div className="card error">{view.error}</div>;
  if (!view.data) return <div className="center muted">Loading…</div>;
  const { rows, rules, currentWeek } = view.data;
  const weeks = rows[0]?.cells.map((c) => c.week) ?? [];
  const showPushes = rules.tieResult === "push" || rows.some((r) => r.pushes > 0);

  if (rows.length === 0) return <div className="card muted">Nobody has joined this league yet.</div>;

  return (
    <div className="card table-wrap">
      <table className="standings">
        <thead>
          <tr>
            <th className="sticky">#</th>
            <th className="sticky name-col">Player</th>
            <th title="Wins">W</th>
            <th title="Losses">L</th>
            {showPushes && <th title="Pushes">P</th>}
            {weeks.map((w) => (
              <th key={w} className={w === currentWeek ? "current" : ""}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className={`${r.alive ? "" : "eliminated"} ${r.userId === me.user?.id ? "me" : ""}`}>
              <td className="sticky">{r.rank}</td>
              <td className="sticky name-col">
                {r.pictureUrl && <img className="avatar" src={r.pictureUrl} alt="" referrerPolicy="no-referrer" />}
                {r.name}
                {!r.alive && <span className="muted small"> · out wk {r.eliminatedWeek}</span>}
              </td>
              <td>{r.wins}</td>
              <td>{r.losses}</td>
              {showPushes && <td>{r.pushes}</td>}
              {r.cells.map((c) => (
                <CellView key={c.week} cell={c} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small legend">
        Picks stay hidden (•) until they lock. ✕ = missed week{rules.missedPick === "loss" ? " (counts as a loss)" : ""}.
      </p>
    </div>
  );
}

function CellView({ cell }: { cell: VisibleCell }) {
  switch (cell.kind) {
    case "pick":
      return <td className={`cell ${cell.outcome}`}>{cell.team}</td>;
    case "hidden":
      return <td className="cell hidden" title="Hidden until it locks">•</td>;
    case "missed":
      return <td className={`cell ${cell.counted ? "loss" : "missed"}`} title="Missed">✕</td>;
    case "out":
      return <td className="cell out" />;
    default:
      return <td className="cell" />;
  }
}
