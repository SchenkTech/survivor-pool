import { useState } from "react";
import type { FeedPreset, League, Rules } from "../api.ts";
import { useApi } from "../hooks.ts";
import { describeRules } from "../LeagueScreen.tsx";

export interface LeagueBody {
  name: string;
  description: string;
  feed: string;
  season: number;
  seasonType: number;
  startWeek: number;
  endWeek: number;
  maxLosses: number | null;
  tieResult: Rules["tieResult"];
  missedPick: Rules["missedPick"];
  teamReuse: boolean;
  lockMode: Rules["lockMode"];
  archived: boolean;
}

function defaults(l?: League): LeagueBody {
  return {
    name: l?.name ?? "",
    description: l?.description ?? "",
    feed: l?.feed ?? "espn:football/nfl",
    season: l?.season ?? new Date().getFullYear(),
    seasonType: l?.seasonType ?? 2,
    startWeek: l?.rules.startWeek ?? 1,
    endWeek: l?.rules.endWeek ?? 18,
    maxLosses: l ? l.rules.maxLosses : null,
    tieResult: l?.rules.tieResult ?? "push",
    missedPick: l?.rules.missedPick ?? "loss",
    teamReuse: l?.rules.teamReuse ?? false,
    lockMode: l?.rules.lockMode ?? "kickoff",
    archived: l?.archived ?? false,
  };
}

export function LeagueForm({ league, submitLabel, onSubmit, onCancel }: {
  league?: League;
  submitLabel: string;
  onSubmit: (b: LeagueBody) => Promise<void>;
  onCancel?: () => void;
}) {
  const presets = useApi<FeedPreset[]>("/admin/feeds");
  const [b, setB] = useState<LeagueBody>(defaults(league));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof LeagueBody>(k: K, v: LeagueBody[K]) => setB((x) => ({ ...x, [k]: v }));
  const custom = !presets.data?.some((p) => p.feed === b.feed);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack form">
      <label>Name<input value={b.name} onChange={(e) => set("name", e.target.value)} placeholder="Office Survivor 2026" /></label>
      <label>
        Description <span className="muted small">(shown on the Rules tab — buy-in, prizes, whatever)</span>
        <textarea rows={2} value={b.description} onChange={(e) => set("description", e.target.value)} />
      </label>

      <fieldset>
        <legend>Schedule</legend>
        <label>
          Games from
          <select
            value={custom ? "__custom" : b.feed}
            onChange={(e) => {
              const p = presets.data?.find((x) => x.feed === e.target.value);
              if (p) setB((x) => ({ ...x, feed: p.feed, seasonType: p.seasonType, startWeek: p.startWeek, endWeek: p.endWeek }));
              else set("feed", "espn:");
            }}
          >
            {presets.data?.map((p) => (
              <option key={p.feed} value={p.feed}>{p.label}</option>
            ))}
            <option value="__custom">Other ESPN feed…</option>
          </select>
        </label>
        {custom && (
          <label>
            Feed <span className="muted small">espn:&lt;sport&gt;/&lt;league&gt;</span>
            <input value={b.feed} onChange={(e) => set("feed", e.target.value)} />
          </label>
        )}
        <div className="grid3">
          <label>Season<input type="number" value={b.season} onChange={(e) => set("season", Number(e.target.value))} /></label>
          <label>First week<input type="number" value={b.startWeek} onChange={(e) => set("startWeek", Number(e.target.value))} /></label>
          <label>Last week<input type="number" value={b.endWeek} onChange={(e) => set("endWeek", Number(e.target.value))} /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Rules</legend>
        <label>
          Elimination
          <select
            value={b.maxLosses == null ? "none" : "limit"}
            onChange={(e) => set("maxLosses", e.target.value === "none" ? null : 1)}
          >
            <option value="none">None — just track losses</option>
            <option value="limit">Eliminate after a number of losses</option>
          </select>
        </label>
        {b.maxLosses != null && (
          <label>
            Losses allowed before you're out
            <input type="number" min={1} value={b.maxLosses} onChange={(e) => set("maxLosses", Math.max(1, Number(e.target.value)))} />
          </label>
        )}
        <label>
          A tie counts as
          <select value={b.tieResult} onChange={(e) => set("tieResult", e.target.value as LeagueBody["tieResult"])}>
            <option value="push">Push (neither)</option>
            <option value="loss">Loss</option>
            <option value="win">Win</option>
          </select>
        </label>
        <label>
          No pick for a week
          <select value={b.missedPick} onChange={(e) => set("missedPick", e.target.value as LeagueBody["missedPick"])}>
            <option value="loss">Counts as a loss</option>
            <option value="ignore">Doesn't count</option>
          </select>
        </label>
        <label>
          Picks lock
          <select value={b.lockMode} onChange={(e) => set("lockMode", e.target.value as LeagueBody["lockMode"])}>
            <option value="kickoff">When that game kicks off</option>
            <option value="week_start">At the week's first kickoff</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={b.teamReuse} onChange={(e) => set("teamReuse", e.target.checked)} /> Allow picking the same team more than once
        </label>
        {league && (
          <label>
            <input type="checkbox" checked={b.archived} onChange={(e) => set("archived", e.target.checked)} /> Archived (read-only, hidden from players' home)
          </label>
        )}
      </fieldset>

      <div className="card inset">
        <p className="muted small">Players will see:</p>
        <ul className="rules small">
          {describeRules({ ...b }).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={saving} onClick={submit}>{saving ? "Saving…" : submitLabel}</button>
        {onCancel && <button className="ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
