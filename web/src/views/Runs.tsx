import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Chip, Empty, Glyph, Kicker, Segmented, Spinner, Stamp } from "../components/ui";
import { useApp } from "../lib/app";
import { ago, secs, usd } from "../lib/format";
import { href } from "../lib/router";
import type { RunInfo } from "../types";

export function RunRow({ r, to }: { r: RunInfo; to: string }) {
  const app = useApp();
  const cost = r.agents.reduce((s, a) => s + (a.metrics?.cost_usd ?? 0), 0);
  const wall = Math.max(0, ...r.agents.map((a) => a.metrics?.wall_s ?? 0));
  const grade = r.kind === "mission" ? r.meta?.grade : null;
  const fws = r.kind === "mission" ? [...new Set(Object.values((r.meta?.roles ?? {}) as Record<string, string>))] : [...new Set(r.agents.map((a) => a.framework))];
  return (
    <a className="runrow" href={href(to)}>
      <span className="runrow-kind kicker kicker-soft">{r.kind === "bench" ? "Arena" : r.kind === "mission" ? "Mission" : "Build test"}</span>
      <span className="runrow-title">
        <span className="runrow-name">{r.title}</span>
        <span className="faint small mono">{r.id} · {r.model} · {ago(r.created)}</span>
      </span>
      <span className="runrow-fws">{fws.slice(0, 8).map((f) => <Glyph key={f} fw={f} size={20} />)}{fws.length > 8 && <span className="faint small">+{fws.length - 8}</span>}</span>
      <span className="runrow-scores">
        {grade ? <Stamp score={grade.score} passed={grade.passed} small /> : r.agents.slice(0, 5).map((a) => (
          <span key={a.agent_id} className="mini-score" title={`${a.label}: ${a.score ?? a.status}`} style={{ ["--lane" as any]: app.color(a.framework) }}>
            {a.score !== null && a.score !== undefined ? Math.round(a.score) : a.status === "error" ? "✕" : "…"}
          </span>
        ))}
      </span>
      <span className="runrow-num mono">{usd(cost, 3)}</span>
      <span className="runrow-num mono">{secs(wall)}</span>
      <span className="runrow-status">{r.status === "running" ? <Chip tone="signal"><span className="live-dot" /> live</Chip> : <Chip tone="soft">{r.status}</Chip>}</span>
    </a>
  );
}

export function Runs() {
  const [runs, setRuns] = useState<RunInfo[] | null>(null);
  const [kind, setKind] = useState<"all" | "bench" | "mission" | "build">("all");
  useEffect(() => {
    const load = () => api.runs().then((r) => setRuns(r.runs)).catch(() => setRuns([]));
    load();
    const id = window.setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);
  const list = useMemo(() => (runs ?? []).filter((r) => kind === "all" || r.kind === kind), [runs, kind]);
  return (
    <div className="page">
      <header className="page-head">
        <Kicker>Runs</Kicker>
        <h1 className="display">Everything this lab has run</h1>
        <p className="lede">Every run keeps its full event log, so a finished run replays exactly like it ran — open one to inspect any model call or tool call.</p>
      </header>
      <div className="list-bar">
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "bench", label: "Arena" }, { value: "mission", label: "Missions" }, { value: "build", label: "Builder" }]} />
        {runs && <span className="faint small">{list.length} runs</span>}
      </div>
      {!runs ? <Spinner /> : list.length === 0 ? <Empty title="No runs yet">Start one from the Arena, Mission Control or the Builder.</Empty> : (
        <div className="runlist">
          <div className="runrow runrow-head" aria-hidden>
            <span>Kind</span><span>Run</span><span>Frameworks</span><span>Scores</span><span>Cost</span><span>Time</span><span>Status</span>
          </div>
          {list.map((r) => <RunRow key={r.id} r={r} to={`/run/${r.id}`} />)}
        </div>
      )}
    </div>
  );
}
