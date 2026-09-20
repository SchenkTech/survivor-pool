import type { LeagueDetail, Rules } from "./api.ts";
import { useApi } from "./hooks.ts";
import { Link } from "./router.tsx";
import { PickWeek } from "./PickWeek.tsx";
import { Standings } from "./Standings.tsx";

export function LeagueScreen({ id, tab }: { id: string; tab: string }) {
  const detail = useApi<LeagueDetail>(`/leagues/${id}`);
  if (detail.error) return <div className="card error">{detail.error}</div>;
  if (!detail.data) return <div className="center muted">Loading…</div>;
  const d = detail.data;
  const base = `/leagues/${id}`;

  return (
    <div className="stack">
      <div className="league-head">
        <div>
          <h2>{d.league.name}</h2>
          <span className="muted">
            {d.league.season} · {d.league.rules.maxLosses == null ? `${d.memberCount} players` : `${d.aliveCount} of ${d.memberCount} still alive`}
          </span>
        </div>
        {d.me && <MyStatus me={d.me} rules={d.league.rules} />}
      </div>

      <nav className="tabs">
        <Link to={base} className={tab === "pick" ? "active" : ""}>Pick</Link>
        <Link to={`${base}/standings`} className={tab === "standings" ? "active" : ""}>Standings</Link>
        <Link to={`${base}/rules`} className={tab === "rules" ? "active" : ""}>Rules</Link>
      </nav>

      {tab === "pick" &&
        (d.isMember ? (
          <PickWeek leagueId={id} detail={d} onPicked={detail.reload} />
        ) : (
          <div className="card muted">You're viewing this league as an admin, not a player.</div>
        ))}
      {tab === "standings" && <Standings leagueId={id} />}
      {tab === "rules" && <RulesCard rules={d.league.rules} description={d.league.description} />}
    </div>
  );
}

function MyStatus({ me, rules }: { me: NonNullable<LeagueDetail["me"]>; rules: Rules }) {
  if (!me.alive) return <div className="status out">Out · week {me.eliminatedWeek}</div>;
  const record = `${me.wins}–${me.losses}`;
  if (rules.maxLosses == null) return <div className="status">#{me.rank} · {record}</div>;
  const left = me.lossesRemaining ?? 0;
  return (
    <div className={`status ${left === 1 ? "warn" : "alive"}`}>
      #{me.rank} · {record} · {left === 1 ? "no losses left to spare" : `${left - 1} loss${left - 1 === 1 ? "" : "es"} to spare`}
    </div>
  );
}

export function describeRules(rules: Rules): string[] {
  const out: string[] = [];
  out.push(`Pick one team to win each week, weeks ${rules.startWeek}–${rules.endWeek}.`);
  if (rules.maxLosses == null) out.push("Nobody is eliminated. Losses are tracked and the fewest losses wins.");
  else if (rules.maxLosses === 1) out.push("One loss and you're out. Last one standing wins.");
  else out.push(`You're out after ${rules.maxLosses} losses.`);
  out.push(
    rules.tieResult === "push"
      ? "A tie is a push: it counts as neither a win nor a loss."
      : `A tie counts as a ${rules.tieResult}.`,
  );
  out.push(
    rules.missedPick === "loss"
      ? "No pick by the time every game has kicked off counts as a loss."
      : "A missed week doesn't count against you.",
  );
  out.push(rules.teamReuse ? "You can pick the same team more than once." : "You can only use each team once all season.");
  out.push(
    rules.lockMode === "kickoff"
      ? "Each pick locks when its game kicks off. You can change it until then."
      : "All picks for the week lock at the week's first kickoff.",
  );
  out.push("Other players' picks stay hidden until they lock.");
  return out;
}

function RulesCard({ rules, description }: { rules: Rules; description: string }) {
  return (
    <div className="card">
      {description && <p>{description}</p>}
      <ul className="rules">
        {describeRules(rules).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
