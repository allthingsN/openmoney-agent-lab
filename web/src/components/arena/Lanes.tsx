import { useCallback, useMemo, useState } from "react";
import { api, type RunSource } from "../../api";
import { compact, secs, usd } from "../../lib/format";
import { isActive, type AgentState, type RunState } from "../../lib/reduce";
import { serverColor } from "../../lib/colors";
import { I, SERVER_LABEL, ServerIcon } from "../icons";
import { Button, Counter, Segmented } from "../ui";
import { Inspector } from "./Inspector";
import { Lane, type Selection } from "./Lane";
import { AxisProvider, AxisRuler, TipProvider } from "./timeline";

interface Props {
  state: RunState;
  src: RunSource;
  now: number;
  freshTs: number;
  live: boolean;
  agentIds?: string[];
  title?: React.ReactNode;
}

/** Every agent on one shared time axis, with per-lane and global controls and the inspector drawer. */
export function Lanes({ state, src, now, freshTs, live, agentIds, title }: Props) {
  const [zoom, setZoom] = useState(1);
  const [density, setDensity] = useState<"auto" | "cozy" | "compact">("auto");
  const [sel, setSel] = useState<Selection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ids = agentIds ?? state.order;
  const agents = useMemo(() => ids.map((id) => state.agents[id]).filter(Boolean) as AgentState[], [ids, state.agents]);
  const controls = live && src.type === "run";
  const anyActive = agents.some(isActive);
  const t0 = useMemo(() => {
    const starts = agents.map((a) => a.startTs ?? a.createdTs ?? Infinity);
    return Math.min(state.t0 ?? Infinity, ...starts);
  }, [agents, state.t0]);
  const t1 = useMemo(() => {
    const ends = agents.map((a) => (isActive(a) ? now : a.endTs ?? a.lastEventTs));
    const end = Math.max(...ends, (state.lastTs ?? t0) + 0.5, live ? now : 0);
    // finished lanes get a little room on the right for the score stamp
    return agents.some(isActive) ? end : end + (end - t0) * 0.1;
  }, [agents, now, state.lastTs, t0, live]);

  const control = useCallback(async (agent: string, action: string) => {
    if (src.type !== "run") return;
    setBusy(agent + action);
    try {
      await api.control(src.id, agent, action);
    } finally {
      setBusy(null);
    }
  }, [src]);

  const tot = useMemo(() => agents.reduce((s, a) => ({
    cost: s.cost + a.totals.cost,
    tokens: s.tokens + a.totals.input + a.totals.output + a.totals.cacheRead + a.totals.cacheWrite,
    llm: s.llm + a.totals.llmCalls,
    tools: s.tools + a.totals.toolCalls,
  }), { cost: 0, tokens: 0, llm: 0, tools: 0 }), [agents]);

  const servers = useMemo(() => {
    const s = new Set<string>();
    for (const a of agents) for (const t of a.tools) s.add(t.server);
    return [...s];
  }, [agents]);

  if (!Number.isFinite(t0)) return null;
  const dense = density === "compact" || (density === "auto" && agents.length > 6);

  return (
    <TipProvider>
      <section className="lanes-panel" aria-label="Agents">
        <div className="lanes-bar">
          {title && <div className="lanes-title">{title}</div>}
          <dl className="totals">
            <div><dt>Spend</dt><dd><Counter value={tot.cost} format={(n) => usd(n, 3)} /></dd></div>
            <div><dt>Tokens</dt><dd><Counter value={tot.tokens} format={compact} /></dd></div>
            <div><dt>Model calls</dt><dd><Counter value={tot.llm} format={(n) => String(Math.round(n))} /></dd></div>
            <div><dt>Tool calls</dt><dd><Counter value={tot.tools} format={(n) => String(Math.round(n))} /></dd></div>
            <div><dt>Elapsed</dt><dd className="mono">{secs(Math.max(0, Math.max(...agents.map((a) => (isActive(a) ? now : a.endTs ?? a.lastEventTs))) - t0))}</dd></div>
          </dl>
          <div className="lanes-tools">
            {controls && (
              <div className="global-controls" role="group" aria-label="All agents">
                <Button size="sm" icon={<I.pause size={12} />} onClick={() => control("*", "pause")} disabled={!anyActive} busy={busy === "*pause"}>Pause all</Button>
                <Button size="sm" icon={<I.step size={12} />} onClick={() => control("*", "step")} disabled={!anyActive}>Step</Button>
                <Button size="sm" icon={<I.play size={12} />} onClick={() => control("*", "resume")} disabled={!anyActive}>Resume</Button>
                <Button size="sm" variant="danger" icon={<I.stop size={11} />} onClick={() => { if (confirm("Stop every running agent?")) control("*", "stop"); }} disabled={!anyActive}>Stop</Button>
              </div>
            )}
 <Segmented label="Lane density" value={dense ? "compact" : "cozy"} onChange={(v) => setDensity(v)} options={[{ value: "cozy", label: "Detailed" }, { value: "compact", label: "Compact" }]} />
            <Segmented label="Timeline zoom" value={zoom} onChange={setZoom} options={[{ value: 1, label: "Fit" }, { value: 2, label: "2×" }, { value: 4, label: "4×" }, { value: 8, label: "8×" }]} />
          </div>
        </div>
        {controls && agents.some((a) => a.status === "paused") && (
          <div className="callout callout-ochre paused-banner" role="status">
            <I.pause size={13} />
            <span>
              {agents.filter((a) => a.status === "paused").map((a) => a.label).join(", ")}{" "}
              {agents.filter((a) => a.status === "paused").length === 1 ? "is" : "are"} paused and holding the next model call. The run waits until you resume, step or stop.
            </span>
            <Button size="sm" icon={<I.play size={12} />} onClick={() => control("*", "resume")}>Resume</Button>
          </div>
        )}
        <div className="legend" aria-label="Legend">
          <span className="legend-item"><span className="lg-llm" /> model call (width = latency)</span>
          {servers.map((s) => (
            <span key={s} className="legend-item"><span className="lg-tool" style={{ background: serverColor(s) }} /><ServerIcon server={s} size={11} /> {SERVER_LABEL[s] ?? s}</span>
          ))}
          <span className="legend-item"><span className="lg-skill"><I.skills size={9} /></span> skill load</span>
          <span className="legend-item"><span className="lg-err">!</span> error</span>
        </div>
        <AxisProvider t0={t0} t1={t1} zoom={zoom}>
          <div className={`lanes ${dense ? "is-compact" : ""}`}>
            <div className="lanes-ruler"><div className="lanes-ruler-pad" /><AxisRuler /></div>
            {agents.map((a, i) => (
              <Lane key={a.id} a={a} index={i} now={now} freshTs={freshTs} controls={controls} onInspect={setSel} onControl={control} selected={sel} compact={dense} />
            ))}
          </div>
        </AxisProvider>
        <Inspector sel={sel} state={state} src={src} onClose={() => setSel(null)} onSelect={setSel} />
      </section>
    </TipProvider>
  );
}

/** Interactive runs: destructive tool calls wait here for a person. */
export function Approvals({ state, src, live }: { state: RunState; src: RunSource; live: boolean }) {
  const pending = Object.values(state.approvals).filter((a) => !a.decision);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!pending.length || !live || src.type !== "run") return null;
  const decide = async (id: string, ok: boolean) => {
    setBusy(id);
    try {
      await api.approve(src.id, id, ok, notes[id] ?? "");
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="toasts" role="region" aria-label="Approvals" aria-live="assertive">
      {pending.map((p) => {
        const a = p.agent ? state.agents[p.agent] : undefined;
        return (
          <div key={p.id} className="toast toast-approval">
            <div className="kicker">Approval needed · {a?.label ?? p.agent}</div>
            <div className="toast-title">{p.action}</div>
            <pre className="toast-detail mono">{JSON.stringify(p.detail, null, 1).slice(0, 600)}</pre>
            <input className="input input-sm" placeholder="Note for the agent (optional)" value={notes[p.id] ?? ""} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} />
            <div className="toast-actions">
              <Button variant="signal" size="sm" icon={<I.check size={12} />} busy={busy === p.id} onClick={() => decide(p.id, true)}>Approve</Button>
              <Button size="sm" icon={<I.x size={12} />} disabled={busy === p.id} onClick={() => decide(p.id, false)}>Decline</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
