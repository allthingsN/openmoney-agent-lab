import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useReducedMotion } from "../../lib/app";
import { serverColor } from "../../lib/colors";
import { compact as compact_, ms, secs, usd } from "../../lib/format";
import { agentElapsed, inflightLlm, type AgentState } from "../../lib/reduce";
import { I, SERVER_LABEL, ServerIcon } from "../icons";
import { Counter, Glyph, IconButton, Stamp, StatusDot, STATUS_LABEL } from "../ui";
import { GridLines, useAxis, useTip } from "./timeline";

export type Selection =
  | { type: "agent"; agent: string }
  | { type: "llm"; agent: string; n: number }
  | { type: "tool"; agent: string; i: number }
  | { type: "marker"; agent: string; idx: number };

interface LaneProps {
  a: AgentState;
  now: number;
  freshTs: number;
  index: number;
  controls: boolean;
  onInspect: (s: Selection) => void;
  onControl: (agent: string, action: string) => void;
  selected?: Selection | null;
  compact?: boolean;
}

export const Lane = memo(function Lane({ a, now, freshTs, index, controls, onInspect, onControl, selected, compact }: LaneProps) {
  const app = useApp();
  const f = app.fw(a.framework);
  const color = app.color(a.framework, a.color);
  const inflight = inflightLlm(a);
  const active = a.status === "running" || a.status === "paused";
  const elapsed = agentElapsed(a, now);
  const tokens = a.totals.input + a.totals.cacheWrite + a.totals.cacheRead + a.totals.output;
  const ctl = controls && (
    <div className="lane-controls" role="group" aria-label={`Controls for ${a.label}`}>
      {a.pausedRequested || a.status === "paused" ? (
        <IconButton label="Resume" onClick={() => onControl(a.id, "resume")} disabled={!active}><I.play size={13} /></IconButton>
      ) : (
        <IconButton label="Pause before the next model call" onClick={() => onControl(a.id, "pause")} disabled={!active}><I.pause size={13} /></IconButton>
      )}
      <IconButton label="Step: release one model call" onClick={() => onControl(a.id, "step")} disabled={!active}><I.step size={13} /></IconButton>
      <IconButton label="Stop this agent" className="danger" onClick={() => onControl(a.id, "stop")} disabled={!active}><I.stop size={12} /></IconButton>
    </div>
  );
  // the proxy holds the next model call: "pausing" while a call is still in flight, "paused" once it's held
  const pausing = a.pausedRequested && a.status === "running" && !!inflight;
  const heldPaused = a.pausedRequested && a.status === "running" && !inflight;

  return (
    <article className={`lane s-${a.status} ${inflight && active ? "is-thinking" : ""} ${compact ? "is-compact" : ""}`} style={{ ["--lane" as any]: color }} aria-label={`${a.label}: ${STATUS_LABEL[a.status]}`}>
      <div className="lane-head">
        <button className="lane-id" onClick={() => onInspect({ type: "agent", agent: a.id })} aria-label={`Inspect ${a.label}`}>
          <span className="lane-n mono">{(index + 1).toString().padStart(2, "0")}</span>
          <Glyph fw={a.framework} color={color} size={compact ? 24 : 32} pulse={!!inflight && active} />
          <span className="lane-names">
            <span className="lane-label">{a.role ? a.label.split(" · ")[0] : a.label.replace(/\s*\(no framework\)/, "")}</span>
            <span className="lane-sub">{a.role ? (f?.name ?? a.framework) : `${f?.vendor ?? ""}${f?.language ? " · " + f.language : ""}${/no framework/.test(f?.name ?? "") ? " · no framework" : ""}`}</span>
          </span>
        </button>
        <div className="lane-status">
          <span className={`status s-${pausing ? "pausing" : heldPaused ? "paused" : a.status}`} title={heldPaused ? "The next model call will be held until you resume or step" : undefined}>
            <StatusDot status={pausing || heldPaused ? "paused" : a.status} />
            {pausing ? "Pausing…" : heldPaused ? "Paused" : STATUS_LABEL[a.status]}
          </span>
          {a.grade && <span className={`score-chip ${a.grade.passed ? "ok" : a.grade.score >= 50 ? "mid" : "bad"}`} title="Grader score">{Math.round(a.grade.score)}</span>}
        </div>
        {compact ? (
          <div className="lane-mini mono" aria-label="Totals">
            <span><Counter value={a.totals.cost} format={(n) => usd(n, n < 1 ? 3 : 2)} /></span>
            <span><Counter value={tokens} format={compact_} /> tok</span>
            <span><Counter value={a.totals.llmCalls} format={(n) => String(Math.round(n))} /> llm</span>
            <span><Counter value={a.totals.toolCalls} format={(n) => String(Math.round(n))} /> tools{a.totals.toolErrors > 0 && <span className="err-n">{a.totals.toolErrors}✕</span>}</span>
            <span>{secs(elapsed)}</span>
            {ctl}
          </div>
        ) : (<>
        <dl className="lane-stats">
          <div><dt>Cost</dt><dd><Counter value={a.totals.cost} format={(n) => usd(n, n < 1 ? 3 : 2)} /></dd></div>
          <div className="lane-tokens">
            <dt>Tokens in · cached · out</dt>
            <dd>
              <Counter value={a.totals.input + a.totals.cacheWrite} format={compact_} />
              <span className="sep">·</span>
              <Counter value={a.totals.cacheRead} format={compact_} />
              <span className="sep">·</span>
              <Counter value={a.totals.output} format={compact_} />
            </dd>
          </div>
          <div><dt>LLM</dt><dd><Counter value={a.totals.llmCalls} format={(n) => String(Math.round(n))} />{a.totals.llmErrors > 0 && <span className="err-n">+{a.totals.llmErrors}!</span>}</dd></div>
          <div><dt>Tools</dt><dd><Counter value={a.totals.toolCalls} format={(n) => String(Math.round(n))} />{a.totals.toolErrors > 0 && <span className="err-n" title="tool errors">{a.totals.toolErrors}✕</span>}</dd></div>
          <div><dt>Time</dt><dd className="mono">{secs(elapsed)}</dd></div>
        </dl>
        <ServerRail a={a} freshTs={freshTs} />
        {ctl}
        </>)}
      </div>
      <Track a={a} now={now} freshTs={freshTs} onInspect={onInspect} selected={selected} />
    </article>
  );
});

// --------------------------------------------------------------------------------------------- server rail + fly-outs
function ServerRail({ a, freshTs }: { a: AgentState; freshTs: number }) {
  const reduced = useReducedMotion();
  const servers = useMemo(() => {
    const s = new Set<string>(a.servers);
    for (const t of a.tools) s.add(t.server);
    if (a.skillMode === "native" || a.markers.some((m) => m.kind === "skill")) s.add("skills");
    s.add("native");
    return [...s];
  }, [a.servers, a.tools, a.skillMode, a.markers]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of a.tools) c[t.server] = (c[t.server] ?? 0) + 1;
    c.skills = (c.skills ?? 0) + a.markers.filter((m) => m.kind === "skill" && a.skillMode === "native").length;
    return c;
  }, [a.tools, a.markers, a.skillMode]);

  const railRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const seen = useRef(a.tools.length);
  const seenSkills = useRef(a.markers.length);
  const [flights, setFlights] = useState<Array<{ id: number; server: string; dx: number; err?: boolean }>>([]);
  const [hits, setHits] = useState<Record<string, number>>({});
  const fid = useRef(0);

  useEffect(() => {
    const fresh: Array<{ server: string; err?: boolean }> = [];
    for (let i = seen.current; i < a.tools.length; i++) {
      const t = a.tools[i];
      if (t.startTs > freshTs) fresh.push({ server: t.server, err: t.error });
    }
    for (let i = seenSkills.current; i < a.markers.length; i++) {
      const m = a.markers[i];
      if (m.kind === "skill" && m.ts > freshTs && a.skillMode === "native") fresh.push({ server: "skills" });
    }
    seen.current = a.tools.length;
    seenSkills.current = a.markers.length;
    if (!fresh.length || reduced) {
      if (fresh.length) setHits((h) => ({ ...h, ...Object.fromEntries(fresh.map((f) => [f.server, Date.now()])) }));
      return;
    }
    const rail = railRef.current;
    const add = fresh.slice(-5).map((f) => {
      const chip = chipRefs.current[f.server];
      const dx = chip && rail ? chip.offsetLeft + chip.offsetWidth / 2 - 6 : 60;
      return { id: ++fid.current, server: f.server, dx, err: f.err };
    });
    setFlights((fl) => [...fl.slice(-8), ...add]);
    const ids = new Set(add.map((x) => x.id));
    const t1 = window.setTimeout(() => setHits((h) => ({ ...h, ...Object.fromEntries(add.map((x) => [x.server, Date.now()])) })), 420);
    const t2 = window.setTimeout(() => setFlights((fl) => fl.filter((x) => !ids.has(x.id))), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [a.tools, a.markers, freshTs, reduced, a.skillMode]);

  const [, force] = useState(0);
  useEffect(() => {
    if (!Object.keys(hits).length) return;
    const t = window.setTimeout(() => force((x) => x + 1), 700);
    return () => clearTimeout(t);
  }, [hits]);

  return (
    <div className="rail" ref={railRef} aria-label="Tool calls by server">
      <span className="rail-origin" aria-hidden />
      <span className="rail-line" aria-hidden />
      {servers.map((s) => (
        <span key={s} ref={(el) => (chipRefs.current[s] = el)} className={`rail-chip ${Date.now() - (hits[s] ?? 0) < 650 ? "is-hit" : ""} ${counts[s] ? "" : "is-idle"}`}
          style={{ ["--srv" as any]: serverColor(s) }} title={`${SERVER_LABEL[s] ?? s}: ${counts[s] ?? 0} calls`}>
          <ServerIcon server={s} size={12} />
          <span className="rail-name">{SERVER_LABEL[s] ?? s}</span>
          <span className="rail-count mono">{counts[s] ?? 0}</span>
        </span>
      ))}
      {flights.map((fl) => (
        <span key={fl.id} className={`flight ${fl.err ? "is-err" : ""}`} style={{ ["--dx" as any]: `${fl.dx}px`, ["--srv" as any]: serverColor(fl.server) }} aria-hidden />
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------------------------- the timeline track
const MAX_TOOL_ROWS = 3;

function Track({ a, now, freshTs, onInspect, selected }: { a: AgentState; now: number; freshTs: number; onInspect: (s: Selection) => void; selected?: Selection | null }) {
  const ax = useAxis();
  const tip = useTip();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ax.register(ref.current), [ax]);
  const minPct = 0.32 / ax.zoom;

  const toolRows = useMemo(() => {
    const ends: number[] = [];
    return a.tools.map((t) => {
      const left = ax.x(t.startTs);
      const w = Math.max(minPct, ax.x(t.endTs ?? now) - left);
      let row = ends.findIndex((e) => e <= left - 0.05);
      if (row < 0) row = ends.length < MAX_TOOL_ROWS ? ends.length : ends.indexOf(Math.min(...ends));
      ends[row] = left + w;
      return { t, left, w, row };
    });
  }, [a.tools, ax, minPct, now]);

  const isSel = (s: Selection) => selected && JSON.stringify(selected) === JSON.stringify(s);
  const start = a.startTs ?? a.createdTs;
  const active = a.status === "running" || a.status === "paused";

  return (
    <div className="track-scroll" ref={ref}>
      <div className="track" style={{ width: `${ax.zoom * 100}%` }}>
        <GridLines />
        {start !== undefined && (
          <span className="track-life" style={{ left: `${ax.x(start)}%`, width: `${Math.max(0, ax.x(a.endTs ?? now) - ax.x(start))}%` }} aria-hidden />
        )}
        {/* model calls */}
        <div className="track-row track-llm" aria-label="Model calls">
          {a.llm.map((c) => {
            const left = ax.x(c.reqTs);
            const end = c.resTs ?? (active ? now : c.reqTs);
            const w = Math.max(minPct * 1.4, ax.x(end) - left);
            const sel = isSel({ type: "llm", agent: a.id, n: c.n });
            const fresh = c.reqTs > freshTs;
            return (
              <button key={c.n} className={`llm-bar ${c.resTs === undefined ? "is-inflight" : ""} ${c.error ? "is-error" : ""} ${sel ? "is-sel" : ""} ${fresh ? "is-fresh" : ""}`}
                style={{ left: `${left}%`, width: `${w}%` }}
                onClick={() => onInspect({ type: "llm", agent: a.id, n: c.n })}
                aria-label={`Model call ${c.n}${c.latencyMs ? `, ${ms(c.latencyMs)}` : ", in flight"}`}
                {...tip(
                  <div>
                    <div className="tip-k">Model call #{c.n}</div>
                    {c.resTs === undefined ? <div>in flight…</div> : (
                      <>
                        <div>{ms(c.latencyMs)} {c.ttftMs ? <span className="faint">· TTFT {ms(c.ttftMs)}</span> : null}</div>
                        <div className="mono">in {compact_(c.inputTokens + c.cacheWrite)} · cached {compact_(c.cacheRead)} · out {compact_(c.outputTokens)}</div>
                        <div className="mono">{usd(c.costUsd, 4)} · {c.stopReason ?? (c.error ? "error" : "")}</div>
                        {c.toolUses && c.toolUses.length > 0 && <div className="faint">→ {c.toolUses.map((u) => u.name).join(", ").slice(0, 120)}</div>}
                      </>
                    )}
                  </div>,
                )}
              >
                {w > 3 && <span className="llm-bar-n mono">{c.n}</span>}
              </button>
            );
          })}
        </div>
        {/* tool calls */}
        <div className="track-row track-tools" aria-label="Tool calls">
          {toolRows.map(({ t, left, w, row }) => (
            <button key={t.i} className={`tool-tick ${t.error ? "is-error" : ""} ${t.endTs === undefined ? "is-open" : ""} ${isSel({ type: "tool", agent: a.id, i: t.i }) ? "is-sel" : ""} ${t.startTs > freshTs ? "is-fresh" : ""}`}
              style={{ left: `${left}%`, width: `${w}%`, top: `${row * 9}px`, ["--srv" as any]: serverColor(t.server) }}
              onClick={() => onInspect({ type: "tool", agent: a.id, i: t.i })}
              aria-label={`${t.server} ${t.name}`}
              {...tip(
                <div>
                  <div className="tip-k"><ServerIcon server={t.server} size={11} /> {SERVER_LABEL[t.server] ?? t.server}</div>
                  <div className="mono">{t.name}</div>
                  <div className="faint">{t.ms !== undefined ? ms(t.ms) : "running…"}{t.error ? " · error" : ""}</div>
                </div>,
              )}
            />
          ))}
        </div>
        {/* markers: skill loads, errors, shims, approvals, controls */}
        <div className="track-row track-marks">
          {a.markers.map((m, idx) => (
            <button key={idx} className={`mark mark-${m.kind} ${m.ts > freshTs ? "is-fresh" : ""}`} style={{ left: `${ax.x(m.ts)}%` }}
              onClick={() => onInspect({ type: "marker", agent: a.id, idx })}
              aria-label={`${m.kind}: ${m.label}`}
              {...tip(<div><div className="tip-k">{m.kind === "skill" ? "Skill loaded" : m.kind}</div><div>{m.label}</div></div>)}
            >
              {m.kind === "skill" ? <I.skills size={10} /> : m.kind === "error" ? "!" : m.kind === "approval" ? <I.person size={10} /> : m.kind === "control" ? "‖" : "~"}
            </button>
          ))}
          {a.endTs && (
            <span className={`track-end ${a.status === "error" ? "is-error" : ""} ${ax.x(a.endTs) < 92 ? "is-right" : ""}`} style={{ left: `${ax.x(a.endTs)}%` }}>
              {a.grade ? <Stamp score={a.grade.score} passed={a.grade.passed} small fresh={(a.endTs ?? 0) > freshTs} /> : a.status === "error" ? <span className="end-err">error</span> : null}
            </span>
          )}
        </div>
        {active && <span className="track-now" style={{ left: `${ax.x(now)}%` }} aria-hidden />}
      </div>
    </div>
  );
}
