import { useEffect, useState } from "react";
import { api } from "./api.ts";
import type { LeagueDetail, WeekView } from "./api.ts";
import { formatKickoff, useApi } from "./hooks.ts";

type GameView = WeekView["games"][number];

export function PickWeek({ leagueId, detail, onPicked }: { leagueId: string; detail: LeagueDetail; onPicked: () => void }) {
  const [week, setWeek] = useState(detail.currentWeek);
  useEffect(() => setWeek(detail.currentWeek), [detail.currentWeek]);
  const view = useApi<WeekView>(`/leagues/${leagueId}/weeks/${week}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { startWeek, endWeek } = detail.league.rules;

  const pick = async (team: string) => {
    setBusy(team);
    setError(null);
    try {
      await api.put(`/leagues/${leagueId}/picks/${week}`, { team });
      await view.reload();
      onPicked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setError(null);
    try {
      await api.del(`/leagues/${leagueId}/picks/${week}`);
      await view.reload();
      onPicked();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const v = view.data;
  const out = v?.eliminatedWeek != null && v.eliminatedWeek < week;

  return (
    <div className="stack">
      <div className="week-nav">
        <button className="ghost" disabled={week <= startWeek} onClick={() => setWeek(week - 1)} aria-label="Previous week">‹</button>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {detail.weeks.map((w) => (
            <option key={w.week} value={w.week}>
              Week {w.week}
              {w.week === detail.currentWeek ? " (this week)" : ""}
            </option>
          ))}
        </select>
        <button className="ghost" disabled={week >= endWeek} onClick={() => setWeek(week + 1)} aria-label="Next week">›</button>
      </div>

      {v && (
        <div className="card pick-summary">
          {out ? (
            <span>You were eliminated in week {v.eliminatedWeek}.</span>
          ) : v.myPick ? (
            <>
              <span>
                Your pick: <strong>{v.myPick.team}</strong> {v.myPickLocked && <span className="badge">locked</span>}
              </span>
              {!v.myPickLocked && (
                <button className="link" onClick={clear}>
                  Clear
                </button>
              )}
            </>
          ) : (
            <span className="muted">No pick yet for week {week}. Tap a team.</span>
          )}
        </div>
      )}
      {error && <div className="card error">{error}</div>}
      {view.error && <div className="card error">{view.error}</div>}
      {v && v.games.length === 0 && <div className="card muted">No games scheduled for week {week} yet.</div>}

      {v?.games.map((g) => (
        <GameCard key={g.id} game={g} view={v} disabled={out || !!busy} busy={busy} onPick={pick} />
      ))}
    </div>
  );
}

function GameCard({ game: g, view, disabled, busy, onPick }: {
  game: GameView;
  view: WeekView;
  disabled: boolean;
  busy: string | null;
  onPick: (team: string) => void;
}) {
  const scored = g.homeScore != null && g.awayScore != null;
  const statusText =
    g.status === "final" ? "Final" : g.status === "in_progress" ? "Live" : g.status === "postponed" ? "Postponed" : g.status === "canceled" ? "Canceled" : formatKickoff(g.kickoff);

  const side = (team: string, name: string, logo: string | null, score: number | null, won: boolean) => {
    const mine = view.myPick?.team === team && view.myPick.gameId === g.id;
    const usedWeek = view.usedTeams[team];
    const blocked = g.locked || usedWeek != null || g.status === "canceled";
    return (
      <button
        className={`team ${mine ? "mine" : ""} ${won ? "won" : ""}`}
        disabled={disabled || (blocked && !mine)}
        onClick={() => !mine && onPick(team)}
      >
        {logo ? <img src={logo} alt="" /> : <span className="abbr-dot">{team.slice(0, 3)}</span>}
        <span className="team-name">
          <strong>{team}</strong>
          <span className="muted small">{name}</span>
        </span>
        {scored && <span className="score">{score}</span>}
        {mine && <span className="badge accent">{busy === team ? "…" : "Your pick"}</span>}
        {!mine && usedWeek != null && <span className="badge">used wk {usedWeek}</span>}
        {g.pickCounts?.[team] ? <span className="badge">{g.pickCounts[team]} picked</span> : null}
      </button>
    );
  };

  const homeWon = g.status === "final" && scored && g.homeScore! > g.awayScore!;
  const awayWon = g.status === "final" && scored && g.awayScore! > g.homeScore!;

  return (
    <div className={`card game ${g.locked ? "locked" : ""}`}>
      <div className="game-meta">
        <span className={g.status === "in_progress" ? "live" : "muted"}>{statusText}</span>
        {g.locked && g.status === "scheduled" && <span className="badge">locked</span>}
      </div>
      {side(g.awayTeam, g.awayName, g.awayLogo, g.awayScore, awayWon)}
      <div className="at muted small">at</div>
      {side(g.homeTeam, g.homeName, g.homeLogo, g.homeScore, homeWon)}
    </div>
  );
}
