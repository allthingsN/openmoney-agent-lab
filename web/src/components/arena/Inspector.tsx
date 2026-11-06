import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import { api, llmUrl, type RunSource } from "../../api";
import { useApp } from "../../lib/app";
import { serverColor } from "../../lib/colors";
import { chars, compact, int, ms, secs, tryJson, usd } from "../../lib/format";
import { overheadChars, type AgentState, type RunState } from "../../lib/reduce";
import { CodeView, JsonView, Markdown } from "../content";
import { I, SERVER_LABEL, ServerIcon } from "../icons";
import { Chip, Drawer, Glyph, Segmented, Spinner, Stamp } from "../ui";
import type { Selection } from "./Lane";

export function Inspector({ sel, state, src, onClose, onSelect }: { sel: Selection | null; state: RunState; src: RunSource; onClose: () => void; onSelect: (s: Selection) => void }) {
  const a = sel ? state.agents[sel.agent] : undefined;
  if (!sel || !a) return null;
  let kicker = a.label;
  let title = "";
  let body: JSX.Element | null = null;
  if (sel.type === "llm") {
    title = `Model call #${sel.n}`;
    body = <LlmDetail a={a} n={sel.n} src={src} onSelect={onSelect} />;
  } else if (sel.type === "tool") {
    const t = a.tools[sel.i];
    title = t ? `${t.name}` : "Tool call";
    body = t ? <ToolDetail a={a} i={sel.i} onSelect={onSelect} /> : null;
  } else if (sel.type === "marker") {
    const m = a.markers[sel.idx];
    title = m?.kind === "skill" ? `Skill · ${m.label}` : m ? `${m.kind}: ${m.label}` : "Event";
    body = m ? <MarkerDetail m={m} /> : null;
  } else {
    title = a.label;
    kicker = "Agent";
    body = <AgentDetail a={a} />;
  }
  return (
    <Drawer open onClose={onClose} title={title} kicker={kicker} wide>
      {body}
    </Drawer>
  );
}

function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="istat">
      <div className="istat-k">{k}</div>
      <div className="istat-v">{v}</div>
      {sub && <div className="istat-sub">{sub}</div>}
    </div>
  );
}

function systemText(sys: unknown): string {
  if (!sys) return "";
  if (typeof sys === "string") return sys;
  if (Array.isArray(sys)) return sys.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join("\n\n");
  return JSON.stringify(sys);
}

function Pager({ a, n, onSelect }: { a: AgentState; n: number; onSelect: (s: Selection) => void }) {
  const idx = a.llm.findIndex((c) => c.n === n);
  const prev = a.llm[idx - 1];
  const next = a.llm[idx + 1];
  return (
    <div className="pager">
      <button className="btn btn-quiet btn-sm" disabled={!prev} onClick={() => prev && onSelect({ type: "llm", agent: a.id, n: prev.n })}>← {prev ? `#${prev.n}` : "prev"}</button>
      <span className="mono faint">{idx + 1} / {a.llm.length}</span>
      <button className="btn btn-quiet btn-sm" disabled={!next} onClick={() => next && onSelect({ type: "llm", agent: a.id, n: next.n })}>{next ? `#${next.n}` : "next"} →</button>
    </div>
  );
}

function LlmDetail({ a, n, src, onSelect }: { a: AgentState; n: number; src: RunSource; onSelect: (s: Selection) => void }) {
  const c = a.llm.find((x) => x.n === n);
  const [bodies, setBodies] = useState<{ request?: any; response?: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "request" | "response">("overview");
  useEffect(() => {
    setBodies(null);
    setErr(null);
    if (!c?.resTs) return;
    let off = false;
    fetch(llmUrl(src, a.id, n))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => !off && setBodies(j.request || j.response ? j : { request: j }))
      .catch((e) => !off && setErr(String(e.message ?? e)));
    return () => { off = true; };
  }, [a.id, n, src, c?.resTs]);
  if (!c) return null;
  const req = bodies?.request;
  const res = bodies?.response;
  const sys = systemText(req?.system);
  const tools: any[] = req?.tools ?? [];
  const sysMsg = (req?.messages ?? []).filter((m: any) => m.role === "system");
  return (
    <div className="inspector">
      <Pager a={a} n={n} onSelect={onSelect} />
      <div className="istats">
        <Stat k="Latency" v={ms(c.latencyMs)} sub={c.ttftMs ? `TTFT ${ms(c.ttftMs)}` : c.stream === false ? "not streamed" : undefined} />
        <Stat k="Input" v={int(c.inputTokens)} sub={`+${int(c.cacheWrite)} cache write`} />
        <Stat k="Cache read" v={int(c.cacheRead)} />
        <Stat k="Output" v={int(c.outputTokens)} sub={c.thinkingTokens ? `${int(c.thinkingTokens)} thinking` : undefined} />
        <Stat k="Cost" v={usd(c.costUsd, 4)} />
        <Stat k="Stop" v={<span className="mono">{c.stopReason ?? (c.error ? "error" : c.resTs ? "—" : "in flight")}</span>} />
      </div>
      {c.error && <div className="callout callout-red"><I.warn size={14} /> <span className="mono">{c.error}</span></div>}
      <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "overview", label: "What was sent & returned" }, { value: "request", label: "Request JSON" }, { value: "response", label: "Response JSON" }]} />
      {!c.resTs && <p className="faint">This call is still in flight; bodies appear when it returns.</p>}
      {err && <p className="faint">Bodies not available: {err}</p>}
      {c.resTs && !bodies && !err && <Spinner />}
      {tab === "overview" && (
        <div className="inspector-sections">
          <section>
            <h4 className="ih">What came back</h4>
            {c.text ? <div className="quote">{c.text}</div> : <p className="faint">No text.</p>}
            {c.toolUses && c.toolUses.length > 0 && (
              <ul className="tooluses">
                {c.toolUses.map((u) => (
                  <li key={u.id}>
                    <span className="mono">{u.name}</span>
                    <code className="mono faint">{JSON.stringify(u.input).slice(0, 220)}</code>
                  </li>
                ))}
              </ul>
            )}
            {c.blocks && <div className="faint mono small">blocks: {c.blocks.join(", ")}</div>}
          </section>
          <section>
            <h4 className="ih">System prompt the framework sent <span className="faint">{chars(c.systemChars)}</span></h4>
            {req ? <CodeView code={sys || "(none)"} lang="markdown" wrap maxHeight={320} /> : <div className="quote mono small">{c.systemPreview}</div>}
            {sysMsg.length > 0 && (
              <>
                <h4 className="ih">…plus {sysMsg.length} role:"system" message{sysMsg.length > 1 ? "s" : ""} in the conversation</h4>
                <CodeView code={sysMsg.map((m: any) => systemText(m.content)).join("\n\n---\n\n")} lang="markdown" wrap maxHeight={240} />
              </>
            )}
          </section>
          <section>
            <h4 className="ih">Tools offered <span className="faint">{c.tools.length} · {chars(c.toolsChars)} of schema</span></h4>
            <div className="toolchips">
              {(tools.length ? tools : c.tools.map((name) => ({ name }))).map((t: any) => (
                <details key={t.name} className="toolchip">
                  <summary className="mono">{t.name}{t.defer_loading ? <span className="faint"> (deferred)</span> : null}</summary>
                  {t.description && <p>{t.description}</p>}
                  {t.input_schema && <JsonView value={t.input_schema} defaultDepth={3} maxHeight={260} />}
                </details>
              ))}
            </div>
          </section>
          <section>
            <h4 className="ih">Request parameters</h4>
            <div className="kv">
              <div><span>model</span><span className="mono">{req?.model ?? "—"}</span></div>
              <div><span>max_tokens</span><span className="mono">{c.maxTokens ?? req?.max_tokens ?? "—"}</span></div>
              <div><span>messages</span><span className="mono">{c.messages}</span></div>
              <div><span>stream</span><span className="mono">{String(c.stream ?? req?.stream ?? false)}</span></div>
              <div><span>thinking</span><span className="mono">{c.thinking ? JSON.stringify(c.thinking) : "—"}</span></div>
              <div><span>output_config</span><span className="mono">{c.outputConfig ? JSON.stringify(c.outputConfig) : "—"}</span></div>
              <div><span>tool_choice</span><span className="mono">{req?.tool_choice ? JSON.stringify(req.tool_choice) : "—"}</span></div>
              <div><span>cache_control</span><span className="mono">{req && JSON.stringify(req).includes("cache_control") ? "yes" : "no"}</span></div>
              <div><span>user-agent</span><span className="mono">{c.userAgent || "—"}</span></div>
            </div>
          </section>
        </div>
      )}
      {tab === "request" && req && <JsonView value={req} defaultDepth={2} title="request" />}
      {tab === "response" && res && <JsonView value={res} defaultDepth={3} title="response" />}
    </div>
  );
}

function ToolDetail({ a, i, onSelect }: { a: AgentState; i: number; onSelect: (s: Selection) => void }) {
  const t = a.tools[i];
  const result = useMemo(() => tryJson(t?.result), [t?.result]);
  if (!t) return null;
  // the model call that asked for it: the last one that returned before the tool started
  const asker = [...a.llm].reverse().find((c) => (c.resTs ?? Infinity) <= t.startTs + 0.05);
  return (
    <div className="inspector">
      <div className="pager">
        <button className="btn btn-quiet btn-sm" disabled={i === 0} onClick={() => onSelect({ type: "tool", agent: a.id, i: i - 1 })}>← prev</button>
        <span className="mono faint">{i + 1} / {a.tools.length}</span>
        <button className="btn btn-quiet btn-sm" disabled={i >= a.tools.length - 1} onClick={() => onSelect({ type: "tool", agent: a.id, i: i + 1 })}>next →</button>
      </div>
      <div className="istats">
        <Stat k="Server" v={<span className="srv-tag" style={{ ["--srv" as any]: serverColor(t.server) }}><ServerIcon server={t.server} size={13} /> {SERVER_LABEL[t.server] ?? t.server}</span>} />
        <Stat k="Tool" v={<span className="mono">{t.name}</span>} />
        <Stat k="Duration" v={t.ms !== undefined ? ms(t.ms) : "running"} />
        <Stat k="Result" v={t.error ? <Chip tone="red">error</Chip> : t.endTs ? <Chip tone="green">ok</Chip> : <Chip>pending</Chip>} />
      </div>
      {asker && <button className="linkish" onClick={() => onSelect({ type: "llm", agent: a.id, n: asker.n })}>Requested by model call #{asker.n} →</button>}
      <h4 className="ih">Arguments</h4>
      <JsonView value={t.args ?? {}} defaultDepth={4} maxHeight={320} />
      <h4 className="ih">Result {t.result && t.result.includes("more chars]") && <span className="faint">(preview — the server kept the full text)</span>}</h4>
      {typeof result === "string" ? <CodeView code={result || "(empty)"} wrap maxHeight={480} /> : <JsonView value={result} defaultDepth={3} maxHeight={480} />}
    </div>
  );
}

let skillCache: Promise<Record<string, string>> | null = null;
function skillBodies() {
  skillCache ??= api.skills().then((r) => Object.fromEntries(r.skills.map((s) => [s.name, s.body]))).catch(() => ({}));
  return skillCache;
}

function MarkerDetail({ m }: { m: AgentState["markers"][number] }) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    if (m.kind !== "skill") return;
    skillBodies().then((b) => setBody(b[m.label.split("/")[0]] ?? null));
  }, [m]);
  return (
    <div className="inspector">
      {m.kind === "skill" && (
        <>
          <p>The agent loaded the <strong>{m.label}</strong> skill{m.data?.via ? <> via <span className="mono">{m.data.via}</span></> : null}. This is what it read:</p>
          {body ? <Markdown src={body} className="paper" /> : <p className="faint">Skill body not in the repo's skills/ (it may be a generated skill).</p>}
        </>
      )}
      {m.kind !== "skill" && <JsonView value={m.data ?? {}} defaultDepth={4} />}
    </div>
  );
}

function AgentDetail({ a }: { a: AgentState }) {
  const app = useApp();
  const f = app.fw(a.framework);
  const [tab, setTab] = useState<"about" | "prompt" | "logs">("about");
  const oh = overheadChars(a);
  const first = a.llm[0];
  return (
    <div className="inspector">
      <div className="agent-hero">
        <Glyph fw={a.framework} size={44} />
        <div>
          <div className="agent-hero-name">{f?.name ?? a.framework}</div>
          <div className="faint">{f?.vendor} · {f?.language} · {f?.loc ?? a.summary?.loc ?? "?"} lines of adapter code · {a.model}</div>
        </div>
        {a.grade && <Stamp score={a.grade.score} passed={a.grade.passed} />}
      </div>
      <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "about", label: "Overview" }, { value: "prompt", label: "Prompt & answer" }, { value: "logs", label: `Logs (${a.logs.length})` }]} />
      {tab === "about" && (
        <div className="inspector-sections">
          {f?.summary && <p className="lede-sm">{f.summary}</p>}
          <div className="istats">
            <Stat k="Cost" v={usd(a.totals.cost, 4)} />
            <Stat k="Tokens" v={compact(a.totals.input + a.totals.output + a.totals.cacheRead + a.totals.cacheWrite)} sub={`${compact(a.totals.cacheRead)} cached`} />
            <Stat k="Calls" v={`${a.totals.llmCalls} LLM · ${a.totals.toolCalls} tools`} sub={a.totals.toolErrors ? `${a.totals.toolErrors} tool errors` : undefined} />
            <Stat k="Wall time" v={secs(a.summary?.metrics?.wall_s ?? (a.endTs && a.startTs ? a.endTs - a.startTs : null))} />
            <Stat k="Framework overhead" v={oh !== null ? chars(oh) : "—"} sub={first ? `${chars(first.systemChars)} system + ${chars(first.toolsChars)} tools on call #1` : undefined} />
            <Stat k="Skills loaded" v={a.totals.skillLoads} sub={a.skillMode ? `${a.skillMode} mode` : undefined} />
          </div>
          {a.error && <div className="callout callout-red"><I.warn size={14} /><pre className="mono small">{a.error}</pre></div>}
          {a.grade && (
            <section>
              <h4 className="ih">Grade</h4>
              <ul className="checks">
                {a.grade.checks.map((c) => (
                  <li key={c.id} className={c.earned >= c.points ? "ok" : c.earned > 0 ? "part" : "bad"}>
                    <span className="checks-mark">{c.earned >= c.points ? <I.check size={13} /> : <I.x size={13} />}</span>
                    <span className="checks-label">{c.label}{c.detail && <span className="checks-detail">{c.detail}</span>}</span>
                    <span className="mono">{c.earned}/{c.points}</span>
                  </li>
                ))}
              </ul>
              {a.grade.error && <p className="faint">{a.grade.error}</p>}
            </section>
          )}
          {f?.notes && (
            <details className="notes">
              <summary>Adapter notes — what this framework does by itself</summary>
              <p>{f.notes}</p>
            </details>
          )}
          {f?.packages && <div className="kv"><div><span>packages</span><span className="mono">{f.packages}</span></div>{f.homepage && <div><span>homepage</span><a className="mono" href={f.homepage} target="_blank" rel="noreferrer">{f.homepage}</a></div>}</div>}
        </div>
      )}
      {tab === "prompt" && (
        <div className="inspector-sections">
          <section><h4 className="ih">Final answer</h4>{a.final ? <Markdown src={a.final} className="paper" /> : <p className="faint">No final answer yet.</p>}</section>
          <section><h4 className="ih">Task prompt</h4><CodeView code={a.prompt ?? ""} lang="markdown" wrap /></section>
          <section><h4 className="ih">System prompt the lab gave every framework</h4><CodeView code={a.systemPrompt ?? ""} lang="markdown" wrap maxHeight={360} /></section>
        </div>
      )}
      {tab === "logs" && (
        <div className="logs mono" role="log">
          {a.logs.length === 0 && <p className="faint">No output.</p>}
          {a.logs.map((l, i) => <div key={i} className={`log-${l.level}`}>{l.line}</div>)}
        </div>
      )}
    </div>
  );
}
