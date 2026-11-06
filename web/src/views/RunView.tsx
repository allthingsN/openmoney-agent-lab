import { useEffect, useMemo, useState } from "react";
import { api, type RunSource } from "../api";
import { Comparison, OutboxPanel } from "../components/arena/Comparison";
import { Approvals, Lanes } from "../components/arena/Lanes";
import { Markdown } from "../components/content";
import { I } from "../components/icons";
import { Board, GateDialog, MissionResult, PhaseRail, TeamGraph } from "../components/mission/Mission";
import { Button, Chip, Kicker, SectionHead, Segmented } from "../components/ui";
import { useApp } from "../lib/app";
import { ago, deliverableText } from "../lib/format";
import { href } from "../lib/router";
import { useRunStream, useTicker } from "../lib/stream";
import type { RunInfo } from "../types";

export function RunView({ src, embedded, onSpeed }: { src: RunSource; embedded?: boolean; onSpeed?: (n: number) => void }) {
  const app = useApp();
  const [info, setInfo] = useState<RunInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const stream = useRunStream(src);
  const { state, live, freshTs } = stream;
  useTicker(live, 250);
  const now = stream.now();

  useEffect(() => {
    setInfo(null);
    setMissing(false);
    (src.type === "run" ? api.run(src.id) : api.result(src.id)).then(setInfo).catch(() => setMissing(true));
  }, [src.type, src.id]);
  // refresh info once the run ends (scores, final summary)
  useEffect(() => {
    if (state.ended && src.type === "run") api.run(src.id).then(setInfo).catch(() => {});
  }, [state.ended, src.type, src.id]);

  const kind = state.kind ?? info?.kind ?? "bench";
  const title = state.title ?? info?.title ?? src.id;
  const model = state.model ?? info?.model;
  const task = kind === "bench" ? app.tasks.find((t) => t.id === info?.meta?.task) : undefined;
  const setupRows = Object.entries(state.setup).filter(([, s]) => s.ok === undefined || s.ok === false);
  const running = live && !state.ended;
  const status = running ? (state.started ? "live" : "starting") : state.ended ? "finished" : stream.status === "closed" && !state.ended ? "incomplete" : "loading";

  return (
    <div className={`runview ${embedded ? "is-embedded" : ""}`}>
      {!embedded && (
        <header className="run-head">
          <div className="run-head-main">
            <Kicker>{src.type === "result" ? "Published result" : kind === "mission" ? "Mission Control" : kind === "build" ? "Agent Builder · test run" : "Arena"}{task ? ` · ${task.domain}` : ""}</Kicker>
            <h1 className="run-title">{title}</h1>
            <div className="run-chips">
              <Chip tone={status === "live" ? "signal" : status === "finished" ? "green" : status === "incomplete" ? "ochre" : "soft"}>
                {status === "live" && <span className="live-dot" aria-hidden />}{status}
              </Chip>
              {model && <Chip><span className="mono">{model}</span></Chip>}
              {info?.interactive && <Chip tone="blue"><I.person size={11} /> interactive</Chip>}
              <Chip><span className="mono">{src.id}</span></Chip>
              {info?.created && <span className="faint small">{ago(info.created)}</span>}
            </div>
          </div>
          <div className="run-head-aside">
            {src.type === "result" && onSpeed && (
              <div className="replay-ctl">
                <span className="kicker kicker-soft">Replay speed</span>
                <Segmented label="Replay speed" value={src.speed ?? 0} onChange={onSpeed}
                  options={[{ value: 1, label: "1×" }, { value: 4, label: "4×" }, { value: 16, label: "16×" }, { value: 0, label: "Instant" }]} />
              </div>
            )}
            {src.type === "run" && kind === "bench" && info?.meta?.task && (
              <a className="btn btn-ghost btn-sm" href={href(`/arena?task=${info.meta.task}&fw=${(info.meta.frameworks ?? []).join(",")}&model=${info.model}`)}><I.replay size={13} /><span>Run again</span></a>
            )}
          </div>
        </header>
      )}
      {missing && !state.started && stream.status === "closed" && state.order.length === 0 && (
        <div className="callout callout-ochre"><I.warn size={14} /> No run with id <span className="mono">{src.id}</span> here.</div>
      )}
      {task && (
        <details className="task-brief">
          <summary><span className="kicker kicker-soft">The task, word for word</span></summary>
          <div className="task-brief-body">
            <div><h4 className="ih">Prompt</h4><Markdown src={task.prompt} /></div>
            <div><h4 className="ih">System prompt</h4><Markdown src={task.system_prompt} /></div>
          </div>
        </details>
      )}
      {kind === "build" && info?.meta?.success_criteria?.length > 0 && (
        <div className="criteria">
          <Kicker tone="soft">Judged against</Kicker>
          <ol>{(info!.meta.success_criteria as string[]).map((c, i) => <li key={i}>{c}</li>)}</ol>
        </div>
      )}
      {setupRows.length > 0 && (
        <div className="setup-logs">
          {setupRows.map(([fw, s]) => (
            <div key={fw} className="setup-log">
              <div className="kicker kicker-soft">{s.ok === false ? "Setup failed" : "Installing"} · {app.fw(fw)?.name ?? fw}</div>
              <pre className="mono">{s.lines.slice(-6).join("\n")}</pre>
            </div>
          ))}
        </div>
      )}
      {kind === "mission" ? (
        <MissionLive src={src} info={info} stream={stream} now={now} />
      ) : (
        <>
          <Lanes state={state} src={src} now={now} freshTs={freshTs} live={live} />
          {state.order.length === 0 && stream.status !== "closed" && <div className="lanes-wait"><span className="spinner" /> Waiting for the first event…</div>}
          <Comparison agents={state.order.map((id) => state.agents[id])} />
          {state.ended && <OutboxPanel src={src} agents={state.order.map((id) => state.agents[id])} />}
        </>
      )}
      <Approvals state={state} src={src} live={live} />
    </div>
  );
}

function MissionLive({ src, info, stream, now }: { src: RunSource; info: RunInfo | null; stream: ReturnType<typeof useRunStream>; now: number }) {
  const app = useApp();
  const { state, live, freshTs } = stream;
  const roles = useMemo(() => {
    if (state.roles?.length) return state.roles;
    const assign = (info?.meta?.roles ?? {}) as Record<string, string>;
    return Object.entries(assign).map(([role, fw]) => ({ role, title: role[0].toUpperCase() + role.slice(1), does: "", framework: fw, framework_name: app.fw(fw)?.name ?? fw }));
  }, [state.roles, info, app]);
  const roleFw = (r: string) => roles.find((x) => x.role === r)?.framework;
  const [showAll, setShowAll] = useState(false);
  const active = state.order.filter((id) => ["running", "paused"].includes(state.agents[id].status));
  const laneIds = showAll || !live ? state.order : state.order.slice(-Math.max(6, active.length));

  return (
    <div className="mission-live">
      <PhaseRail state={state} interactive={!!info?.interactive} />
      <div className="mission-top">
        <section className="panel mission-brief">
          <Kicker tone="soft">The brief</Kicker>
          <p className="brief-text">{state.brief ?? "—"}</p>
          <ul className="role-list">
            {roles.map((r) => (
              <li key={r.role}>
                <span className="role-swatch" style={{ background: app.color(r.framework) }} />
                <span className="role-title">{r.title}</span>
                <span className="faint">{r.framework_name ?? app.fw(r.framework)?.name}</span>
              </li>
            ))}
          </ul>
          {state.deliverables && (
            <details>
              <summary className="faint small">Deliverables ({state.deliverables.length})</summary>
              <ul className="small">{state.deliverables.map((d, i) => <li key={i}><span className="mono">{deliverableText(d).head}</span> {deliverableText(d).body}</li>)}</ul>
            </details>
          )}
        </section>
        <section className="panel mission-graph">
          <Kicker tone="soft">The team</Kicker>
          {roles.length > 0 && <TeamGraph state={state} now={now} freshTs={freshTs} roles={roles} />}
        </section>
      </div>
      <section className="panel">
        <SectionHead kicker="Task board" title="Shared board" aside={<span className="faint small">{state.taskOrder.length} tasks · click a card for details{live && src.type === "run" ? ", comments and send-back" : ""}</span>} />
        <Board state={state} src={src} live={live} freshTs={freshTs} roleFw={roleFw} />
      </section>
      <Lanes state={state} src={src} now={now} freshTs={freshTs} live={live} agentIds={laneIds}
        title={
          <div className="lanes-title-row">
            <span className="kicker">Agent activity · {state.order.length} agent runs</span>
            {live && state.order.length > laneIds.length && <Button size="sm" variant="quiet" onClick={() => setShowAll(true)}>Show all {state.order.length}</Button>}
          </div>
        } />
      {(state.ended || state.missionGrade) && <MissionResult state={state} src={src} />}
      <GateDialog state={state} src={src} live={live} roleFw={roleFw} />
    </div>
  );
}
