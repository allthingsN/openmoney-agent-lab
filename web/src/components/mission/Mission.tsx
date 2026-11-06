import { useEffect, useMemo, useState } from "react";
import { api, type RunSource } from "../../api";
import { useApp, useReducedMotion } from "../../lib/app";
import { onColor } from "../../lib/colors";
import { deliverableText } from "../../lib/format";
import { isActive, type RunState } from "../../lib/reduce";
import type { BoardTask } from "../../types";
import { FilePreview } from "../content";
import { I } from "../icons";
import { Button, Chip, Drawer, Empty, Glyph, Modal, SectionHead, Spinner, Stamp } from "../ui";

// --------------------------------------------------------------------------------------------- phase rail
const PHASES = [
  { id: "plan", label: "Plan" },
  { id: "approve", label: "Approve" },
  { id: "execute", label: "Execute" },
  { id: "review", label: "Review" },
  { id: "assemble", label: "Assemble" },
  { id: "graded", label: "Graded" },
];

export function PhaseRail({ state, interactive }: { state: RunState; interactive: boolean }) {
  const last = state.phases[state.phases.length - 1];
  let cur = last?.phase ?? (state.started ? "plan" : "");
  if (state.gate && !state.gate.decision) cur = "approve";
  const curIdx = PHASES.findIndex((p) => p.id === cur);
  const rounds = (id: string) => state.phases.filter((p) => p.phase === id).map((p) => p.round).filter(Boolean) as number[];
  const reached = (id: string) => {
    if (id === "approve") return !!state.gate || (state.phases.some((p) => p.phase === "execute"));
    return state.phases.some((p) => p.phase === id);
  };
  return (
    <ol className="phase-rail" aria-label="Mission phases">
      {PHASES.map((p, i) => {
        const done = reached(p.id) && i < curIdx;
        const on = p.id === cur && !state.ended;
        const r = rounds(p.id);
        const skipped = p.id === "approve" && !interactive;
        return (
          <li key={p.id} className={`${done || (state.ended && reached(p.id)) ? "is-done" : ""} ${on ? "is-on" : ""} ${skipped ? "is-skip" : ""}`} aria-current={on ? "step" : undefined}>
            <span className="phase-n mono">{(i + 1).toString().padStart(2, "0")}</span>
            <span className="phase-label">{p.label}</span>
            <span className="phase-sub">{skipped ? "auto" : r.length > 1 ? `round ${r[r.length - 1]}` : on ? "now" : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

// --------------------------------------------------------------------------------------------- team graph
interface RoleNode { role: string; title: string; framework: string; x: number; y: number; side?: boolean }

export function TeamGraph({ state, now, freshTs, roles }: { state: RunState; now: number; freshTs: number; roles: Array<{ role: string; title: string; framework: string }> }) {
  const app = useApp();
  const reduced = useReducedMotion();
  const W = 760, H = 400;
  const nodes = useMemo<RoleNode[]>(() => {
    const mids = roles.filter((r) => r.role !== "planner" && r.role !== "reviewer");
    const out: RoleNode[] = [];
    const p = roles.find((r) => r.role === "planner");
    const rv = roles.find((r) => r.role === "reviewer");
    if (p) out.push({ ...p, x: 92, y: H / 2 });
    mids.forEach((r, i) => {
      const t = mids.length === 1 ? 0.5 : i / (mids.length - 1);
      const y = 40 + t * (H - 80);
      const x = W / 2 + Math.sin(t * Math.PI) * 60 - 60;
      out.push({ ...r, x, y, side: true });
    });
    if (rv) out.push({ ...rv, x: W - 92, y: H / 2 });
    return out;
  }, [roles]);
  const pos = useMemo(() => Object.fromEntries(nodes.map((n) => [n.role, n])), [nodes]);

  // edges from what happened on the board
  const edges = useMemo(() => {
    const m = new Map<string, { from: string; to: string; kind: "assign" | "handoff" | "rework" | "result"; n: number; last: number; lastSeq: number }>();
    const add = (from: string, to: string, kind: "assign" | "handoff" | "rework" | "result", ts: number, seq: number) => {
      if (!pos[from] || !pos[to] || from === to) return;
      const k = `${from}>${to}>${kind}`;
      const e = m.get(k) ?? { from, to, kind, n: 0, last: 0, lastSeq: 0 };
      e.n++;
      e.last = Math.max(e.last, ts);
      e.lastSeq = Math.max(e.lastSeq, seq);
      m.set(k, e);
    };
    const roleOfAgent = (id: string) => state.agents[id]?.role ?? id.split("-")[0];
    for (const be of state.boardEvents) {
      const t = be.task;
      const by = be.by === "lab" || be.by === "person" ? be.by : roleOfAgent(be.by);
      if (be.what === "created") {
        add(by === "lab" ? "planner" : by, t.role, "assign", be.ts, be.seq);
        for (const d of t.depends_on ?? []) {
          const dr = state.tasks[d]?.role;
          if (dr) add(dr, t.role, "handoff", be.ts, be.seq);
        }
      } else if (be.what === "rework") add(by === "person" ? "planner" : "reviewer", t.role, "rework", be.ts, be.seq);
      else if (be.what === "done") add(t.role, "planner", "result", be.ts, be.seq);
    }
    return [...m.values()];
  }, [state.boardEvents, state.tasks, state.agents, pos]);

  const activeRoles = useMemo(() => {
    const s: Record<string, number> = {};
    for (const id of state.order) {
      const a = state.agents[id];
      if (a.role && isActive(a)) s[a.role] = (s[a.role] ?? 0) + 1;
    }
    return s;
  }, [state.agents, state.order]);
  const doneByRole = useMemo(() => {
    const s: Record<string, number> = {};
    for (const t of Object.values(state.tasks)) if (t.status === "done") s[t.role] = (s[t.role] ?? 0) + 1;
    return s;
  }, [state.tasks]);

  const path = (e: { from: string; to: string; kind: string }) => {
    const a = pos[e.from], b = pos[e.to];
    const bend = e.kind === "rework" ? 60 : e.kind === "result" ? -40 : e.kind === "handoff" ? 46 : 18;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
    return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  };

  return (
    <figure className="teamgraph" aria-label="Team graph: who handed work to whom">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Roles and the work flowing between them">
        <defs>
          <marker id="tg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {edges.map((e) => {
          const recent = e.last > freshTs && now - e.last < 4;
          const d = path(e);
          return (
            <g key={`${e.from}${e.to}${e.kind}`} className={`tg-edge tg-${e.kind} ${recent ? "is-flowing" : ""}`}>
              <path d={d} fill="none" strokeWidth={Math.min(1 + e.n * 0.5, 3.5)} />
              {recent && !reduced && <circle key={e.lastSeq} r={4.5} className="tg-pulse" style={{ offsetPath: `path('${d}')` } as React.CSSProperties} />}
            </g>
          );
        })}
        {nodes.map((n) => {
          const c = app.color(n.framework);
          const f = app.fw(n.framework);
          const act = activeRoles[n.role] ?? 0;
          return (
            <g key={n.role} className={`tg-node ${act ? "is-active" : ""}`} transform={`translate(${n.x},${n.y})`}>
              {act > 0 && !reduced && <circle r={34} className="tg-halo" style={{ stroke: c }} />}
              <circle r={n.side ? 22 : 26} fill={c} />
              <text className="tg-glyph" textAnchor="middle" dy="0.35em" fill={onColor(c)} fontSize={(f?.glyph ?? "").length >= 3 ? 11 : 13}>{f?.glyph ?? "?"}</text>
              <text className="tg-title" textAnchor={n.side ? "start" : "middle"} x={n.side ? 34 : 0} y={n.side ? -2 : 42}>{n.title}</text>
              <text className="tg-fw" textAnchor={n.side ? "start" : "middle"} x={n.side ? 34 : 0} y={n.side ? 12 : 56}>{f?.name?.replace(/\s*\(no framework\)/, "") ?? n.framework}</text>
              {(doneByRole[n.role] ?? 0) > 0 && (
                <g transform="translate(20,-20)"><circle r={9} className="tg-badge" /><text textAnchor="middle" dy="0.35em" className="tg-badge-t">{doneByRole[n.role]}</text></g>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="tg-legend">
        <span><i className="tg-l-assign" /> assigned</span>
        <span><i className="tg-l-handoff" /> hand-off (depends on)</span>
        <span><i className="tg-l-result" /> result back</span>
        <span><i className="tg-l-rework" /> sent back</span>
      </figcaption>
    </figure>
  );
}

// --------------------------------------------------------------------------------------------- kanban
const COLS: Array<{ id: BoardTask["status"]; label: string }> = [
  { id: "todo", label: "To do" },
  { id: "running", label: "Running" },
  { id: "done", label: "Done" },
  { id: "rework", label: "Rework" },
];

export function Board({ state, src, live, freshTs, roleFw }: { state: RunState; src: RunSource; live: boolean; freshTs: number; roleFw: (role: string) => string | undefined }) {
  const [open, setOpen] = useState<string | null>(null);
  const tasks = state.taskOrder.map((id) => state.tasks[id]);
  const lastTouch = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of state.boardEvents) m[e.task.id] = e.ts;
    return m;
  }, [state.boardEvents]);
  if (!tasks.length) {
    return <Empty title="The board is empty">The planner puts tasks here once it has read the mission.</Empty>;
  }
  return (
    <>
      <div className="kanban" role="list" aria-label="Task board"
        style={{ ["--kcols" as any]: COLS.map((c) => { const n = tasks.filter((t) => t.status === c.id).length; return `minmax(0, ${n === 0 ? 0.55 : n > 3 ? 2.2 : 1}fr)`; }).join(" ") }}>
        {COLS.map((c) => {
          const list = tasks.filter((t) => t.status === c.id);
          return (
            <div key={c.id} className={`kcol kcol-${c.id}`} role="listitem" aria-label={`${c.label}: ${list.length}`}>
              <div className="kcol-head"><span>{c.label}</span><span className="mono">{list.length}</span></div>
              <div className="kcol-body">
                {list.map((t) => <TaskCard key={t.id + t.status} t={t} fw={roleFw(t.role)} fresh={(lastTouch[t.id] ?? 0) > freshTs} onOpen={() => setOpen(t.id)} />)}
                {!list.length && <div className="kcol-empty">—</div>}
              </div>
            </div>
          );
        })}
      </div>
      {open && <TaskDrawer t={state.tasks[open]} state={state} src={src} live={live} fw={roleFw(state.tasks[open].role)} onClose={() => setOpen(null)} />}
    </>
  );
}

function TaskCard({ t, fw, fresh, onOpen }: { t: BoardTask; fw?: string; fresh: boolean; onOpen: () => void }) {
  const app = useApp();
  const c = app.color(fw);
  return (
    <button className={`tcard ${fresh ? "is-fresh" : ""} st-${t.status}`} style={{ ["--lane" as any]: c }} onClick={onOpen}>
      <div className="tcard-top">
        <span className="mono tcard-id">{t.id}</span>
        <span className="tcard-role"><Glyph fw={fw} size={16} /> {t.role}</span>
        {t.status === "running" && <span className="tcard-live" aria-label="running" />}
      </div>
      <div className="tcard-title">{t.title}</div>
      {t.depends_on?.length > 0 && <div className="tcard-deps mono">after {t.depends_on.join(", ")}</div>}
      {t.rework_reason && t.status === "rework" && <div className="tcard-rework"><I.replay size={11} /> {t.rework_reason}</div>}
      {t.result && <div className="tcard-result">{t.result}</div>}
      <div className="tcard-foot">
        {t.assignee && <span className="mono faint">{t.assignee}</span>}
        {(t.comments?.length ?? 0) > 0 && <span className="faint">· {t.comments!.length} comment{t.comments!.length > 1 ? "s" : ""}</span>}
      </div>
    </button>
  );
}

function TaskDrawer({ t, state, src, live, fw, onClose }: { t: BoardTask; state: RunState; src: RunSource; live: boolean; fw?: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canAct = live && src.type === "run" && !state.ended;
  const act = async (action: "comment" | "rework") => {
    setBusy(true);
    setMsg(null);
    try {
      await api.missionAction(src.id, action, action === "comment" ? { task_id: t.id, text } : { task_id: t.id, reason });
      setMsg(action === "comment" ? "Comment added — whoever works on it next will see it." : "Sent back. It runs again in the next round.");
      setText("");
      setReason("");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };
  const history = state.boardEvents.filter((e) => e.task.id === t.id);
  return (
    <Drawer open onClose={onClose} kicker={`${t.id} · ${t.role}`} title={t.title}>
      <div className="inspector">
        <div className="task-meta">
          <Chip tone={t.status === "done" ? "green" : t.status === "rework" ? "red" : t.status === "running" ? "signal" : "soft"}>{t.status}</Chip>
          <span className="tcard-role"><Glyph fw={fw} size={18} /> {t.role}</span>
          {t.assignee && <span className="mono faint">{t.assignee}</span>}
          {t.depends_on?.length > 0 && <span className="mono faint">depends on {t.depends_on.join(", ")}</span>}
        </div>
        <h4 className="ih">Instructions</h4>
        <div className="quote pre">{t.instructions}</div>
        {t.rework_reason && <><h4 className="ih">Sent back because</h4><div className="callout callout-red">{t.rework_reason}</div></>}
        <h4 className="ih">Result</h4>
        {t.result ? <div className="quote pre">{t.result}</div> : <p className="faint">Not finished yet.</p>}
        <h4 className="ih">Comments</h4>
        {t.comments?.length ? (
          <ul className="comments">{t.comments.map((c, i) => <li key={i}><span className="mono">{c.role}</span> {c.text}</li>)}</ul>
        ) : <p className="faint">None.</p>}
        <h4 className="ih">History</h4>
        <ol className="history mono">{history.map((h) => <li key={h.seq}><span>{h.what}</span> <span className="faint">by {h.by}</span></li>)}</ol>
        {canAct && (
          <div className="task-actions">
            <label className="field">
              <span className="field-label">Comment for the team</span>
              <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Priya prefers no autopay on the phone plan" />
            </label>
            <Button size="sm" disabled={!text.trim()} busy={busy} onClick={() => act("comment")}>Add comment</Button>
            {t.status === "done" && (
              <>
                <label className="field">
                  <span className="field-label">Send it back</span>
                  <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong, and what would fix it" />
                </label>
                <Button size="sm" variant="danger" disabled={!reason.trim()} busy={busy} onClick={() => act("rework")} icon={<I.replay size={12} />}>Send back for rework</Button>
              </>
            )}
            {msg && <p className="faint">{msg}</p>}
          </div>
        )}
      </div>
    </Drawer>
  );
}

// --------------------------------------------------------------------------------------------- gate
export function GateDialog({ state, src, live, roleFw }: { state: RunState; src: RunSource; live: boolean; roleFw: (r: string) => string | undefined }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const g = state.gate;
  const open = !!g && !g.decision && live && src.type === "run" && !dismissed;
  const decide = async (approved: boolean) => {
    setBusy(true);
    try {
      await api.missionAction(src.id, "gate", { approved, note });
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!g) return null;
  return (
    <Modal open={open} onClose={() => setDismissed(true)} kicker="The plan is waiting for you" title={`Approve the planner's ${g.tasks.length} tasks?`} size="lg"
      footer={
        <>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note — added as a comment on every open task" aria-label="Note" />
          <Button onClick={() => decide(false)} disabled={busy} icon={<I.x size={12} />}>Reject</Button>
          <Button variant="signal" onClick={() => decide(true)} busy={busy} icon={<I.check size={12} />}>Approve plan</Button>
        </>
      }>
      <ol className="gate-list">
        {g.tasks.map((t) => (
          <li key={t.id}>
            <span className="mono gate-id">{t.id}</span>
            <span className="gate-main">
              <span className="gate-title">{t.title}</span>
              <span className="gate-sub"><Glyph fw={roleFw(t.role)} size={16} /> {t.role}{t.depends_on?.length ? <span className="mono faint"> · after {t.depends_on.join(", ")}</span> : null}</span>
            </span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

// --------------------------------------------------------------------------------------------- deliverables + grade
export function MissionResult({ state, src }: { state: RunState; src: RunSource }) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const ended = state.ended;
  useEffect(() => {
    (src.type === "run" ? api.runOutbox(src.id) : api.resultOutbox(src.id, "mission")).then((r) => setFiles(r.files)).catch(() => setFiles({}));
  }, [src, ended, state.boardEvents.length]);
  const names = Object.keys(files ?? {}).sort((a, b) => order(a) - order(b));
  const cur = sel && files?.[sel] !== undefined ? sel : names[0];
  const g = state.missionGrade;
  return (
    <section className="panel" aria-labelledby="del-h">
      <SectionHead kicker="Deliverables" title={<span id="del-h">The package for Priya</span>} aside={g ? <Stamp score={g.score} passed={g.passed} fresh /> : undefined}>
        {state.deliverables ? "What the mission asked for, and what the team wrote into the shared outbox." : null}
      </SectionHead>
      {state.missionError && <div className="callout callout-red"><I.warn size={14} /> {state.missionError}</div>}
      <div className="deliv-grid">
        <div>
          {state.deliverables && (
            <ol className="deliv-list">
              {state.deliverables.map((d, i) => {
                const { head, body } = deliverableText(d);
                const file = head.replace(/^outbox\//, "");
                const has = files && files[file] !== undefined;
                return (
                  <li key={i} className={has ? "has" : ""}>
                    <span className="mono deliv-n">{(i + 1).toString().padStart(2, "0")}</span>
                    <span>
                      {head.startsWith("outbox/") ? <button className="linkish mono" disabled={!has} onClick={() => setSel(file)}>{head}</button> : <strong>{head}</strong>}
                      <span className="deliv-body">{body}</span>
                    </span>
                    {head.startsWith("outbox/") && <span className="deliv-state">{has ? <I.check size={13} /> : "—"}</span>}
                  </li>
                );
              })}
            </ol>
          )}
          {g && (
            <ul className="checks">
              {g.checks.map((c) => (
                <li key={c.id} className={c.earned >= c.points ? "ok" : c.earned > 0 ? "part" : "bad"}>
                  <span className="checks-mark">{c.earned >= c.points ? <I.check size={13} /> : <I.x size={13} />}</span>
                  <span className="checks-label">{c.label}{c.detail && <span className="checks-detail">{c.detail}</span>}</span>
                  <span className="mono">{c.earned}/{c.points}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          {files === null ? <Spinner /> : names.length === 0 ? (
            <Empty title="Nothing in the outbox yet">The writer, scheduler and planner put their files here.</Empty>
          ) : (
            <>
              <div className="file-tabs" role="tablist">
                {names.map((n) => <button key={n} role="tab" aria-selected={n === cur} className={n === cur ? "is-on" : ""} onClick={() => setSel(n)}>{n.endsWith(".ics") ? <I.calendar size={12} /> : <I.file size={12} />} {n}</button>)}
              </div>
              {cur && <FilePreview path={cur} content={files![cur]} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function order(n: string) {
  if (n.includes("move-plan")) return 0;
  if (n.includes("cancel")) return 1;
  if (n.endsWith(".ics")) return 2;
  return 3;
}

export function RoleChip({ role, fw }: { role: string; fw?: string }) {
  const app = useApp();
  const c = app.color(fw);
  return <span className="rolechip" style={{ background: c, color: onColor(c) }}>{role}</span>;
}
