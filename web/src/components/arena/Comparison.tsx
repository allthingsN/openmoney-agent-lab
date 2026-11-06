import { useEffect, useMemo, useState } from "react";
import { api, type RunSource } from "../../api";
import { useApp } from "../../lib/app";
import { chars, compact, secs, usd } from "../../lib/format";
import { overheadChars, totalTokens, type AgentState } from "../../lib/reduce";
import { Bars, type BarRow } from "../charts";
import { FilePreview } from "../content";
import { I } from "../icons";
import { Empty, Glyph, SectionHead, Spinner, Stamp } from "../ui";

interface Unit {
  id: string;
  label: string;
  framework: string;
  color: string;
  agents: AgentState[];
}

const mean = (xs: Array<number | null | undefined>): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export function Comparison({ agents }: { agents: AgentState[] }) {
  const app = useApp();
  const done = agents.filter((a) => a.status === "done" || a.status === "error");
  // with several trials per framework, compare frameworks (mean of trials) rather than 30 separate rows
  const units = useMemo<Unit[]>(() => {
    const byFw = new Map<string, AgentState[]>();
    for (const a of done) byFw.set(a.framework, [...(byFw.get(a.framework) ?? []), a]);
    const grouped = [...byFw.values()].some((g) => g.length > 1) && !done.some((a) => a.role);
    if (!grouped) return done.map((a) => ({ id: a.id, label: shortLabel(a, app.fw(a.framework)?.name), framework: a.framework, color: app.color(a.framework, a.color), agents: [a] }));
    return [...byFw.entries()].map(([fw, g]) => ({
      id: fw, label: (app.fw(fw)?.name ?? fw).replace(/\s*\(no framework\)/, "") + (g.length > 1 ? ` ×${g.length}` : ""), framework: fw, color: app.color(fw), agents: g,
    }));
  }, [done, app]);
  const checkIds = useMemo(() => {
    const m = new Map<string, { label: string; points: number }>();
    for (const a of done) for (const c of a.grade?.checks ?? []) if (!m.has(c.id)) m.set(c.id, { label: c.label, points: c.points });
    return [...m.entries()];
  }, [done]);
  if (!done.length) return null;
  const grouped = units.some((u) => u.agents.length > 1);
  const loc = (a: AgentState) => app.fw(a.framework)?.loc ?? a.summary?.loc ?? null;
  const wall = (a: AgentState) => a.summary?.metrics?.wall_s ?? (a.endTs && a.startTs ? a.endTs - a.startTs : null);
  const row = (u: Unit, f: (a: AgentState) => number | null, fmt: (n: number) => string): BarRow => {
    const vals = u.agents.map(f).filter((x): x is number => x !== null);
    const v = mean(vals);
    const sub = vals.length > 1 ? `range ${fmt(Math.min(...vals))} – ${fmt(Math.max(...vals))} over ${vals.length} trials` : undefined;
    return { id: u.id, label: u.label, color: u.color, value: v, display: v === null ? "—" : fmt(v), sub };
  };
  const score = (u: Unit) => mean(u.agents.map((a) => a.grade?.score));
  const passes = (u: Unit) => u.agents.filter((a) => a.grade?.passed).length;
  const sorted = [...units].sort((x, y) => (score(y) ?? -1) - (score(x) ?? -1) || (mean(x.agents.map((a) => a.totals.cost)) ?? 0) - (mean(y.agents.map((a) => a.totals.cost)) ?? 0));
  const n1 = (n: number) => (Math.round(n * 10) / 10).toString();
  return (
    <section className="panel compare" aria-labelledby="cmp-h">
      <SectionHead kicker="Comparison" title={<span id="cmp-h">How they did, measured from the outside</span>}>
        Every number comes from the metering proxy, the tool servers or the grader — never from the framework itself.{grouped ? " Frameworks with several trials show the mean; hover a bar for the range." : ""}
      </SectionHead>
      {checkIds.length > 0 && (
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col" className="matrix-check">Check</th>
                {sorted.map((u) => (
                  <th key={u.id} scope="col"><span className="matrix-agent"><Glyph fw={u.framework} size={22} /><span>{u.label}</span></span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="matrix-score">
                <th scope="row">Score{grouped && <span className="faint mono"> · mean, passes</span>}</th>
                {sorted.map((u) => {
                  const sc = score(u);
                  return (
                    <td key={u.id}>
                      {sc !== null ? <Stamp score={sc} passed={passes(u) === u.agents.length} small label={u.agents.length > 1 ? `${passes(u)}/${u.agents.length}` : undefined} /> : <span className="faint">error</span>}
                    </td>
                  );
                })}
              </tr>
              {checkIds.map(([id, c]) => (
                <tr key={id}>
                  <th scope="row">{c.label}<span className="faint mono"> · {c.points} pts</span></th>
                  {sorted.map((u) => {
                    const gs = u.agents.map((a) => a.grade?.checks.find((x) => x.id === id)).filter(Boolean);
                    if (!gs.length) return <td key={u.id} className="faint">—</td>;
                    const earned = mean(gs.map((g) => g!.earned)) ?? 0;
                    const tone = earned >= c.points ? "ok" : earned > 0 ? "part" : "bad";
                    return (
                      <td key={u.id} className={`cell-${tone}`} title={gs.map((g) => g!.detail).filter(Boolean).join("\n")}>
                        <span className="cell-mark">{tone === "ok" ? <I.check size={12} /> : <I.x size={12} />}</span>
                        <span className="mono">{n1(earned)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="bars-grid">
        <Bars title="Cost" unit="USD" rows={sorted.map((u) => row(u, (a) => a.totals.cost, (n) => usd(n, 3)))} />
        <Bars title="Tokens" unit="in + cached + out" rows={sorted.map((u) => row(u, totalTokens, compact))} />
        <Bars title="Wall time" unit="seconds" rows={sorted.map((u) => row(u, wall, secs))} />
        <Bars title="Model calls" rows={sorted.map((u) => row(u, (a) => a.totals.llmCalls, n1))} />
        <Bars title="Tool calls" rows={sorted.map((u) => row(u, (a) => a.totals.toolCalls, n1))} />
        <Bars title="Tool errors" rows={sorted.map((u) => row(u, (a) => a.totals.toolErrors, n1))} />
        <Bars title="Framework overhead" unit="system + tool schema chars, call #1" rows={sorted.map((u) => row(u, overheadChars, chars))}
          note="What the framework adds before the model reads a word of the task: its system prompt plus every tool schema it offers." />
        <Bars title="Adapter size" unit="lines of code" rows={sorted.map((u) => row(u, loc, (n) => String(Math.round(n))))} />
      </div>
    </section>
  );
}

function shortLabel(a: AgentState, fwName?: string): string {
  if (a.role) return a.label.split(" · ")[0];
  return (a.label || fwName || a.id).replace(/\s*\(no framework\)/, "");
}

export function OutboxPanel({ src, agents }: { src: RunSource; agents: AgentState[] }) {
  const app = useApp();
  const finished = agents.filter((a) => a.status === "done" || a.status === "error");
  const [agent, setAgent] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, Record<string, string>>>({});
  const [file, setFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cur = agent ?? finished[0]?.id ?? null;
  const key = finished.map((a) => a.id).join(",");
  useEffect(() => {
    if (!cur || files[cur]) return;
    setLoading(true);
    (src.type === "run" ? api.outbox(src.id, cur) : api.resultOutbox(src.id, cur)).then((r) => setFiles((f) => ({ ...f, [cur]: r.files }))).catch(() => setFiles((f) => ({ ...f, [cur]: {} }))).finally(() => setLoading(false));
  }, [cur, src, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!finished.length) return null;
  const list = cur ? files[cur] : undefined;
  const names = Object.keys(list ?? {});
  const sel = file && list?.[file] !== undefined ? file : names[0];
  return (
    <section className="panel outbox" aria-labelledby="ob-h">
      <SectionHead kicker="Outbox" title={<span id="ob-h">What each agent handed back</span>}>Files the agents wrote to <span className="mono">outbox/</span>, exactly as written.</SectionHead>
      {(
        <div className="outbox-body">
          <div className="outbox-agents" role="tablist" aria-label="Agents">
            {finished.map((a) => (
              <button key={a.id} role="tab" aria-selected={a.id === cur} className={a.id === cur ? "is-on" : ""} onClick={() => { setAgent(a.id); setFile(null); }}>
                <Glyph fw={a.framework} size={20} color={app.color(a.framework, a.color)} />
                <span>{shortLabel(a, app.fw(a.framework)?.name)}</span>
              </button>
            ))}
          </div>
          <div className="outbox-files">
            {loading && !list && <Spinner />}
            {list && names.length === 0 && <Empty title="No files">This agent didn't write anything to outbox/.</Empty>}
            {names.length > 0 && (
              <>
                {names.length > 1 && (
                  <div className="file-tabs" role="tablist">
                    {names.map((n) => <button key={n} role="tab" aria-selected={n === sel} className={n === sel ? "is-on" : ""} onClick={() => setFile(n)}><I.file size={12} /> {n}</button>)}
                  </div>
                )}
                {sel && <FilePreview path={sel} content={list![sel]} />}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
