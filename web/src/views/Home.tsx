import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { I, ServerIcon } from "../components/icons";
import { Glyph, Kicker, Segmented, SectionHead } from "../components/ui";
import { useApp, useReducedMotion } from "../lib/app";
import { laneColor, serverColor } from "../lib/colors";
import { secs, usd } from "../lib/format";
import { href } from "../lib/router";
import type { AgentSummary, RunInfo } from "../types";
import { KeyGate } from "./Settings";

interface Row { fw: string; score: number; cost: number; wall: number; calls: number; n: number }

function aggregate(runs: Array<{ task: string; model: string; agents: AgentSummary[] }>) {
  const out: Record<string, Record<string, Map<string, Row & { scores: number[]; costs: number[]; walls: number[]; callsA: number[] }>>> = {};
  for (const r of runs) {
    for (const a of r.agents) {
      if (a.score === null || a.score === undefined) continue;
      const byModel = (out[r.task] ??= {});
      const m = (byModel[r.model] ??= new Map());
      const row = m.get(a.framework) ?? { fw: a.framework, score: 0, cost: 0, wall: 0, calls: 0, n: 0, scores: [], costs: [], walls: [], callsA: [] };
      row.scores.push(a.score);
      row.costs.push(a.metrics.cost_usd);
      row.walls.push(a.metrics.wall_s);
      row.callsA.push(a.metrics.llm_calls + a.metrics.tool_calls);
      m.set(a.framework, row);
    }
  }
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / (x.length || 1);
  const res: Record<string, Record<string, Row[]>> = {};
  for (const [task, models] of Object.entries(out)) {
    res[task] = {};
    for (const [model, m] of Object.entries(models)) {
      res[task][model] = [...m.values()].map((r) => ({ fw: r.fw, score: mean(r.scores), cost: mean(r.costs), wall: mean(r.walls), calls: mean(r.callsA), n: r.scores.length }))
        .sort((a, b) => b.score - a.score || a.cost - b.cost);
    }
  }
  return res;
}

function Leaderboard() {
  const app = useApp();
  const [source, setSource] = useState<"published" | "local" | null>(null);
  const [data, setData] = useState<Record<string, Record<string, Row[]>>>({});
  const [task, setTask] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [count, setCount] = useState(0);
  const [links, setLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      let rows: Array<{ task: string; model: string; agents: AgentSummary[] }> = [];
      try {
        const idx = await api.results();
        // published results carry a ready-made per-framework leaderboard (mean over trials)
        const withBoard = (idx.benchmarks ?? []).filter((b) => Array.isArray(b.leaderboard) && b.leaderboard.length);
        if (withBoard.length) {
          const agg: Record<string, Record<string, Row[]>> = {};
          const ln: Record<string, string> = {};
          for (const b of withBoard) {
            ln[`${b.task ?? b.title ?? b.id}|${b.model ?? ""}`] ??= b.id;
            const t = (agg[b.task ?? b.title ?? b.id] ??= {});
            if (t[b.model ?? ""]) continue; // newest first
            t[b.model ?? ""] = (b.leaderboard as any[]).map((l) => ({ fw: l.framework, score: l.score_mean ?? 0, cost: l.cost_mean ?? 0, wall: l.wall_mean ?? 0, calls: (l.llm_calls_mean ?? 0) + (l.tool_calls_mean ?? 0), n: l.trials ?? 1 }))
              .sort((x, y) => y.score - x.score || x.cost - y.cost);
          }
          setSource("published");
          setLinks(ln);
          setCount(withBoard.length);
          setData(agg);
          setTask(Object.keys(agg).sort()[0] ?? "");
          return;
        }
        const pubs = (idx.benchmarks ?? []).slice(0, 12);
        const full = await Promise.all(pubs.map((p) => (p.agents ? Promise.resolve(p as unknown as RunInfo) : api.result(p.id).catch(() => null))));
        rows = full.filter(Boolean).map((r) => ({ task: r!.meta?.task ?? (r as any).task ?? r!.title, model: r!.model, agents: r!.agents ?? [] }));
        if (rows.some((r) => r.agents.length)) setSource("published");
      } catch {
        /* none */
      }
      if (!rows.some((r) => r.agents.length)) {
        const local = await api.runs().catch(() => ({ runs: [] as RunInfo[] }));
        rows = local.runs.filter((r) => r.kind === "bench" && r.status === "done").map((r) => ({ task: r.meta?.task ?? r.title, model: r.model, agents: r.agents }));
        setSource("local");
      }
      setCount(rows.length);
      const agg = aggregate(rows);
      setData(agg);
      const firstTask = Object.keys(agg).sort()[0] ?? "";
      setTask(firstTask);
    })();
  }, []);

  const models = useMemo(() => Object.entries(data[task] ?? {}).sort((a, b) => b[1].length - a[1].length).map(([m]) => m), [data, task]);
  useEffect(() => {
    if (!models.includes(model)) setModel(models[0] ?? "");
  }, [models, model]);
  const rows = data[task]?.[model] ?? [];
  const tasks = Object.keys(data).sort();
  const taskTitle = (id: string) => app.tasks.find((t) => t.id === id)?.title ?? id;

  return (
    <div className="receipt" aria-label="Leaderboard">
      <div className="receipt-head">
        <div>
          <div className="kicker">Leaderboard</div>
          <div className="receipt-title">{task ? taskTitle(task) : "No finished runs yet"}</div>
        </div>
        {models.length > 1 ? (
          <select className="input input-sm input-auto mono" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
        ) : <span className="mono small faint">{model}</span>}
      </div>
      {tasks.length > 1 && <Segmented label="Task" value={task} onChange={setTask} options={tasks.map((t) => ({ value: t, label: taskTitle(t) }))} />}
      {rows.length === 0 ? (
        <p className="faint small receipt-empty">Run the Arena once and the scores land here.</p>
      ) : (
        <ol className="receipt-rows">
          <li className="receipt-row receipt-row-head" aria-hidden><span>#</span><span>Framework</span><span>Score</span><span>Cost</span><span>Time</span></li>
          {rows.slice(0, 10).map((r, i) => {
            const f = app.fw(r.fw);
            return (
              <li key={r.fw} className="receipt-row">
                <span className="mono faint">{(i + 1).toString().padStart(2, "0")}</span>
                <span className="receipt-fw"><Glyph fw={r.fw} size={20} color={laneColor(f?.color, "paper")} /><span>{(f?.name ?? r.fw).replace(/\s*\(no framework\)/, "")}</span></span>
                <span className={`mono receipt-score ${r.score >= 80 ? "ok" : r.score >= 50 ? "mid" : "bad"}`}>{Math.round(r.score)}</span>
                <span className="mono">{usd(r.cost, 3)}</span>
                <span className="mono">{secs(r.wall)}</span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="receipt-foot">
        <span>{source === "published" ? `Published results · ${rows[0]?.n ?? 1} trial${(rows[0]?.n ?? 1) === 1 ? "" : "s"} each` : `${count} local run${count === 1 ? "" : "s"}`} · mean per framework</span>
        {links[`${task}|${model}`] ? (
          <a className="receipt-mark" href={href(`/results/${links[`${task}|${model}`]}`)}><I.replay size={11} /> replay this run</a>
        ) : <span className="receipt-mark"><I.check size={11} /> measured outside the framework</span>}
      </div>
      <div className="receipt-tear" aria-hidden />
    </div>
  );
}

function MeasureDiagram() {
  const app = useApp();
  const reduced = useReducedMotion();
  const fws = app.frameworks.slice(0, 10);
  const servers = ["files", "offers", "ops", "skills", "board"];
  const llmPath = "M182,96 C260,96 270,70 352,70";
  const upPath = "M512,70 L600,70";
  const mcpPaths = servers.map((_, i) => `M182,${128 + i * 20} C262,${128 + i * 20} 272,${150 + i * 34} 352,${150 + i * 34}`);
  return (
    <figure className="measure">
      <svg viewBox="0 0 720 340" role="img" aria-label="Agents call Claude only through the lab's metering proxy and use tools only through the lab's MCP servers; a grader scores the result from what was recorded.">
        {/* agent box */}
        <g className="m-box">
          <rect x="16" y="40" width="166" height="200" rx="6" />
          <text x="30" y="64" className="m-k">YOUR FRAMEWORK</text>
          <text x="30" y="88" className="m-t">The agent</text>
          {fws.map((f, i) => (
            <g key={f.id} transform={`translate(${32 + (i % 5) * 28},${112 + Math.floor(i / 5) * 30})`}>
              <rect width="22" height="22" rx="4" fill={app.color(f.id)} />
            </g>
          ))}
          <text x="30" y="200" className="m-s">reads agent.json,</text>
          <text x="30" y="216" className="m-s">runs its own loop</text>
        </g>
        {/* proxy */}
        <g className="m-box m-signal">
          <rect x="352" y="40" width="160" height="60" rx="6" />
          <text x="366" y="62" className="m-k">/llm · METERING PROXY</text>
          <text x="366" y="86" className="m-t">tokens · $ · latency</text>
        </g>
        <g className="m-box">
          <rect x="600" y="40" width="104" height="60" rx="6" />
          <text x="614" y="62" className="m-k">UPSTREAM</text>
          <text x="614" y="86" className="m-t">Claude</text>
        </g>
        {/* MCP servers */}
        {servers.map((s, i) => (
          <g key={s} className="m-srv" transform={`translate(352,${136 + i * 34})`}>
            <rect width="160" height="28" rx="5" style={{ stroke: serverColor(s) }} />
            <foreignObject x="8" y="6" width="16" height="16"><span style={{ color: serverColor(s), display: "block" }}><ServerIcon server={s} size={16} /></span></foreignObject>
            <text x="30" y="19" className="m-s">/mcp · {s}</text>
          </g>
        ))}
        {/* grader */}
        <g className="m-box m-grade">
          <rect x="600" y="196" width="104" height="96" rx="6" />
          <text x="614" y="218" className="m-k">GRADER</text>
          <text x="614" y="242" className="m-t">same checks</text>
          <text x="614" y="262" className="m-s">for everyone</text>
        </g>
        <path d={llmPath} className="m-line m-line-llm" />
        <path d={upPath} className="m-line m-line-llm" />
        {mcpPaths.map((d, i) => <path key={i} d={d} className="m-line" style={{ stroke: serverColor(servers[i]) }} />)}
        <path d="M512,150 C560,150 560,240 600,240" className="m-line m-line-grade" />
        <path d="M512,70 C560,110 560,210 600,214" className="m-line m-line-grade" />
        {!reduced && (
          <>
            <circle r="4" className="m-dot m-dot-llm" style={{ offsetPath: `path('${llmPath}')` } as React.CSSProperties} />
            <circle r="4" className="m-dot m-dot-llm m-dot-2" style={{ offsetPath: `path('${upPath}')` } as React.CSSProperties} />
            {mcpPaths.map((d, i) => <circle key={i} r="3.5" className="m-dot" style={{ offsetPath: `path('${d}')`, fill: serverColor(servers[i]), animationDelay: `${0.6 + i * 0.45}s` } as React.CSSProperties} />)}
          </>
        )}
      </svg>
    </figure>
  );
}

export function Home() {
  const app = useApp();
  const totalLoc = app.frameworks.reduce((s, f) => s + f.loc, 0);
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-main">
          <Kicker>OpenMoney Agent Lab</Kicker>
          <h1 className="hero-title">Same task.<br />Every framework.<br /><em>Measured from the outside.</em></h1>
          <p className="hero-lede">
            Run one hard, realistic job on {app.frameworks.length || "ten"} agent frameworks at once and watch every model call, tool call and skill load as it happens. The lab meters Claude through its own proxy, serves every tool itself, and grades every result with the same checks — so the numbers mean the same thing for everyone.
          </p>
          <div className="hero-cta">
            <a className="btn btn-signal btn-lg" href={href("/arena")}><I.play size={14} /><span>Run the arena</span></a>
            <a className="btn btn-ghost btn-lg" href={href("/results")}><I.replay size={14} /><span>Replay a published run</span></a>
          </div>
          <KeyGate compact><span /></KeyGate>
          <dl className="hero-facts">
            <div><dt>Frameworks</dt><dd>{app.frameworks.length || "—"}</dd></div>
            <div><dt>Tasks</dt><dd>{app.tasks.length || "—"}</dd></div>
            <div><dt>Adapters</dt><dd>{totalLoc ? `${totalLoc.toLocaleString()} LOC` : "—"}</dd></div>
          </dl>
        </div>
        <div className="hero-side">
          <Leaderboard />
        </div>
      </section>

      <section className="home-section">
        <SectionHead kicker="Three ways in" title="Compare, coordinate, or build your own" />
        <ol className="modes">
          <li>
            <a className="mode" href={href("/arena")}>
              <span className="mode-n mono">01</span>
              <span className="mode-art mode-art-arena" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} style={{ ["--i" as any]: i }}><i /><i /><i /></span>)}</span>
              <span className="kicker">Arena</span>
              <span className="mode-title">One task, many frameworks, side by side</span>
              <span className="mode-body">Bill Doctor and Incident Commander: privacy traps, red herrings, real arithmetic. Pause, step and inspect any agent; compare score, cost, tokens, time and framework overhead.</span>
              <span className="mode-go">Set up a run <I.arrow size={13} /></span>
            </a>
          </li>
          <li>
            <a className="mode" href={href("/mission")}>
              <span className="mode-n mono">02</span>
              <span className="mode-art mode-art-mission" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ ["--i" as any]: i }} />)}</span>
              <span className="kicker">Mission Control</span>
              <span className="mode-title">A team of agents, each on a different framework</span>
              <span className="mode-body">Moving Day: a planner, five specialists and a reviewer coordinate through a shared task board. Approve the plan, comment on tasks, send work back.</span>
              <span className="mode-go">Assemble the team <I.arrow size={13} /></span>
            </a>
          </li>
          <li>
            <a className="mode" href={href("/builder")}>
              <span className="mode-n mono">03</span>
              <span className="mode-art mode-art-builder" aria-hidden><span>describe</span><span>design</span><span>build ×N</span><span>test</span></span>
              <span className="kicker">Agent Builder</span>
              <span className="mode-title">Describe a job, get a runnable agent on every framework</span>
              <span className="mode-body">Claude designs it; you review the instructions, tools and generated code; the lab writes a project per framework and tests them against your success criteria.</span>
              <span className="mode-go">Start building <I.arrow size={13} /></span>
            </a>
          </li>
        </ol>
      </section>

      <section className="home-section measure-section">
        <SectionHead kicker="How it's measured" title="Nothing is self-reported" />
        <div className="measure-grid">
          <MeasureDiagram />
          <ol className="measure-rows">
            <li><span className="mono">01</span><div><strong>Metering proxy.</strong> Each agent gets <span className="mono">ANTHROPIC_BASE_URL</span> pointing at the lab and a per-agent token. Every request and response is recorded: tokens, cache, cost, latency, time-to-first-token — and the exact system prompt and tool list the framework sent.</div></li>
            <li><span className="mono">02</span><div><strong>MCP tool servers.</strong> Files, offers, ops, skills and the mission board are served by the lab over MCP. Every call, its arguments and its result are logged before the framework sees them.</div></li>
            <li><span className="mono">03</span><div><strong>Deterministic grader.</strong> The same checks for every framework — right answers to the cent, traps avoided, no personal data leaked — computed from what the servers recorded and what the agent wrote.</div></li>
          </ol>
        </div>
      </section>

      <section className="home-section">
        <SectionHead kicker="The field" title="One contract, written idiomatically for each framework" aside={<a className="linkish" href={href("/arena")}>View the code on any card →</a>} />
        <ol className="field-strip">
          {app.frameworks.map((f) => (
            <li key={f.id}>
              <Glyph fw={f.id} size={34} />
              <span className="field-name">{f.name.replace(/\s*\(no framework\)/, "")}</span>
              <span className="faint small">{f.vendor} · {f.language === "typescript" ? "TS" : "Py"} · {f.loc} LOC</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
