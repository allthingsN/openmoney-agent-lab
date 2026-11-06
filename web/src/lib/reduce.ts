// One reducer for every run: live, finished or a published replay. Everything the UI shows is derived from events.
import type { BoardTask, Grade, LabEvent } from "../types";

export type AgentStatus = "queued" | "running" | "paused" | "done" | "error";

export interface LlmCall {
  n: number; // proxy's per-agent call number (used for the bodies endpoint)
  reqTs: number;
  resTs?: number;
  latencyMs?: number;
  ttftMs?: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  thinkingTokens?: number;
  costUsd: number;
  stopReason?: string;
  blocks?: string[];
  text?: string;
  toolUses?: Array<{ id: string; name: string; input: unknown }>;
  messages: number;
  systemChars: number;
  toolsChars: number;
  tools: string[];
  systemPreview?: string;
  thinking?: unknown;
  outputConfig?: unknown;
  maxTokens?: number;
  stream?: boolean;
  userAgent?: string;
  error?: string;
  status?: number;
}

export interface ToolCall {
  i: number;
  server: string;
  name: string;
  args: unknown;
  result?: string;
  ms?: number;
  error?: boolean;
  startTs: number;
  endTs?: number;
}

export interface Marker {
  ts: number;
  kind: "skill" | "error" | "shim" | "approval" | "control" | "final";
  label: string;
  data?: any;
}

export interface AgentState {
  id: string;
  framework: string;
  label: string;
  role: string | null;
  color?: string;
  phase?: string;
  status: AgentStatus;
  pausedRequested: boolean;
  createdTs?: number;
  startTs?: number;
  endTs?: number;
  model?: string;
  servers: string[];
  skillNames: string[];
  skillMode?: string;
  prompt?: string;
  systemPrompt?: string;
  llm: LlmCall[];
  tools: ToolCall[];
  markers: Marker[];
  logs: Array<{ ts: number; level: string; line: string }>;
  final?: string;
  grade?: Grade;
  error?: string | null;
  summary?: any;
  totals: {
    cost: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    llmCalls: number;
    llmErrors: number;
    toolCalls: number;
    toolErrors: number;
    skillLoads: number;
  };
  lastEventTs: number;
}

export interface Approval {
  id: string;
  agent: string | null;
  action: string;
  detail: any;
  ts: number;
  decision?: { approved: boolean; note: string; ts: number };
}

export interface BoardEvent {
  ts: number;
  seq: number;
  what: string;
  by: string;
  task: BoardTask;
}

export interface RunState {
  runId?: string;
  kind?: string;
  title?: string;
  model?: string;
  t0?: number;
  lastTs?: number;
  lastSeq: number;
  started: boolean;
  ended: boolean; // run.end seen
  streamEnded: boolean; // stream.end seen
  agents: Record<string, AgentState>;
  order: string[];
  approvals: Record<string, Approval>;
  setup: Record<string, { lines: string[]; ok?: boolean; ts: number }>;
  // missions
  brief?: string;
  deliverables?: Array<string | Record<string, string>>;
  roles?: Array<{ role: string; title: string; does: string; framework: string; framework_name: string; color?: string }>;
  tasks: Record<string, BoardTask>;
  taskOrder: string[];
  boardEvents: BoardEvent[];
  phases: Array<{ phase: string; round?: number; ts: number }>;
  gate?: { phase: string; tasks: BoardTask[]; ts: number; decision?: { approved: boolean; note: string; ts: number } };
  missionGrade?: Grade;
  missionError?: string;
  runSummary?: any[];
}

export const emptyRun = (): RunState => ({
  lastSeq: -1,
  started: false,
  ended: false,
  streamEnded: false,
  agents: {},
  order: [],
  approvals: {},
  setup: {},
  tasks: {},
  taskOrder: [],
  boardEvents: [],
  phases: [],
});

const emptyTotals = () => ({
  cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, llmCalls: 0, llmErrors: 0, toolCalls: 0, toolErrors: 0, skillLoads: 0,
});

function newAgent(id: string, d: any, ts: number): AgentState {
  return {
    id,
    framework: d.framework ?? id,
    label: d.label ?? id,
    role: d.role ?? null,
    color: d.color,
    phase: d.phase,
    status: "queued",
    pausedRequested: false,
    createdTs: ts,
    servers: [],
    skillNames: [],
    llm: [],
    tools: [],
    markers: [],
    logs: [],
    totals: emptyTotals(),
    lastEventTs: ts,
  };
}

const LOG_CAP = 400;

function argsKey(server: string, name: string): string {
  return `${server}\u0000${name}`;
}

/** Apply one event. Returns a new state object (structural sharing; only touched agents/arrays are copied). */
export function reduceRun(s: RunState, ev: LabEvent): RunState {
  if (ev.type === "ping") return s;
  if (ev.type === "stream.end") return s.streamEnded ? s : { ...s, streamEnded: true };
  if (typeof ev.seq === "number") {
    if (ev.seq <= s.lastSeq) return s; // de-dupe after reconnects
  }
  const d = ev.data ?? {};
  const ts = ev.ts;
  let next: RunState = {
    ...s,
    lastSeq: typeof ev.seq === "number" ? ev.seq : s.lastSeq,
    lastTs: Math.max(s.lastTs ?? ts, ts),
    t0: s.t0 ?? ts,
    runId: s.runId ?? ev.run,
  };

  const touch = (id: string, init?: any): AgentState => {
    let a = next.agents[id];
    if (!a) {
      a = newAgent(id, init ?? {}, ts);
      next.order = [...next.order, id];
    } else {
      a = { ...a };
    }
    a.lastEventTs = ts;
    next.agents = { ...next.agents, [id]: a };
    return a;
  };

  switch (ev.type) {
    case "run.start": {
      next.started = true;
      next.kind = d.kind;
      next.title = d.title;
      next.model = d.model;
      next.t0 = Math.min(next.t0 ?? ts, ts);
      if (d.brief) next.brief = d.brief;
      if (d.deliverables) next.deliverables = d.deliverables;
      if (d.roles) next.roles = d.roles;
      for (const ag of d.agents ?? []) {
        if (!next.agents[ag.id]) {
          const a = touch(ag.id, ag);
          a.label = ag.label ?? a.label;
          a.color = ag.color;
          a.role = ag.role ?? null;
        }
      }
      break;
    }
    case "agent.created": {
      if (!ev.agent) break;
      const a = touch(ev.agent, d);
      a.role = d.role ?? a.role;
      a.framework = d.framework ?? a.framework;
      a.label = d.label ?? a.label;
      a.color = d.color ?? a.color;
      a.phase = d.phase ?? a.phase;
      break;
    }
    case "agent.start": {
      if (!ev.agent) break;
      const a = touch(ev.agent, d);
      a.status = a.pausedRequested ? "paused" : "running";
      a.startTs = ts;
      a.framework = d.framework ?? a.framework;
      a.label = d.label ?? a.label;
      a.role = d.role ?? a.role;
      a.model = d.model;
      a.servers = d.servers ?? [];
      a.skillNames = d.skills?.names ?? [];
      a.skillMode = d.skills?.mode;
      a.prompt = d.prompt;
      a.systemPrompt = d.system_prompt;
      break;
    }
    case "llm.request": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      if (a.status === "queued" || a.status === "paused") a.status = "running";
      const call: LlmCall = {
        n: d.seq,
        reqTs: ts,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd: 0,
        messages: d.messages ?? 0,
        systemChars: d.system_chars ?? 0,
        toolsChars: d.tools_chars ?? 0,
        tools: d.tools ?? [],
        systemPreview: d.system_preview,
        thinking: d.thinking,
        outputConfig: d.output_config,
        maxTokens: d.max_tokens,
        stream: d.stream,
        userAgent: d.user_agent,
      };
      a.llm = [...a.llm, call];
      break;
    }
    case "llm.response":
    case "llm.error": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      const idx = findLastIndex(a.llm, (c) => c.n === d.seq);
      const base: LlmCall = idx >= 0 ? a.llm[idx] : {
        n: d.seq, reqTs: ts - (d.latency_ms ?? 0) / 1000, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
        costUsd: 0, messages: 0, systemChars: 0, toolsChars: 0, tools: [],
      };
      let c: LlmCall;
      if (ev.type === "llm.response") {
        const u = d.usage ?? {};
        c = {
          ...base,
          resTs: ts,
          latencyMs: d.latency_ms,
          ttftMs: d.ttft_ms,
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          thinkingTokens: u.output_tokens_details?.thinking_tokens,
          costUsd: d.cost_usd ?? 0,
          stopReason: d.stop_reason,
          blocks: d.blocks,
          text: d.text,
          toolUses: d.tool_uses,
          error: d.stream_error ? JSON.stringify(d.stream_error) : undefined,
        };
        const t = { ...a.totals };
        t.cost += c.costUsd;
        t.input += c.inputTokens;
        t.output += c.outputTokens;
        t.cacheRead += c.cacheRead;
        t.cacheWrite += c.cacheWrite;
        t.llmCalls += 1;
        a.totals = t;
      } else {
        c = { ...base, resTs: ts, latencyMs: d.latency_ms, error: typeof d.error === "string" ? d.error : JSON.stringify(d.error), status: d.status };
        a.totals = { ...a.totals, llmErrors: a.totals.llmErrors + 1 };
        a.markers = [...a.markers, { ts, kind: "error", label: `HTTP ${d.status}`, data: d }];
      }
      const llm = a.llm.slice();
      if (idx >= 0) llm[idx] = c;
      else llm.push(c);
      a.llm = llm;
      break;
    }
    case "shim.applied": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      a.markers = [...a.markers, { ts, kind: "shim", label: (d.changes ?? []).join(", "), data: d }];
      break;
    }
    case "tool.start": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      a.tools = [...a.tools, { i: a.tools.length, server: d.server ?? "native", name: d.name ?? "?", args: d.args, startTs: ts }];
      break;
    }
    case "tool.end": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      const server = d.server ?? "native";
      const key = argsKey(server, d.name);
      // match the oldest open call to the same tool (MCP servers emit start+end; native tools only end)
      const idx = a.tools.findIndex((c) => c.endTs === undefined && argsKey(c.server, c.name) === key);
      const tools = a.tools.slice();
      const done: ToolCall = {
        ...(idx >= 0 ? tools[idx] : { i: tools.length, server, name: d.name ?? "?", args: d.args, startTs: ts - (d.ms ?? 0) / 1000 }),
        args: d.args ?? (idx >= 0 ? tools[idx].args : undefined),
        result: d.result,
        ms: d.ms,
        error: !!d.error,
        endTs: ts,
      };
      if (idx >= 0) tools[idx] = done;
      else tools.push(done);
      a.tools = tools;
      a.totals = { ...a.totals, toolCalls: a.totals.toolCalls + 1, toolErrors: a.totals.toolErrors + (d.error ? 1 : 0) };
      break;
    }
    case "skill.load": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      a.markers = [...a.markers, { ts, kind: "skill", label: d.skill ?? d.name ?? "skill", data: d }];
      a.totals = { ...a.totals, skillLoads: a.totals.skillLoads + 1 };
      break;
    }
    case "skill.file": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      a.markers = [...a.markers, { ts, kind: "skill", label: `${d.skill ?? ""}/${d.file ?? d.path ?? ""}`, data: d }];
      break;
    }
    case "agent.log": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      const logs = a.logs.length >= LOG_CAP ? a.logs.slice(-LOG_CAP + 1) : a.logs.slice();
      logs.push({ ts, level: d.level, line: d.line });
      a.logs = logs;
      break;
    }
    case "agent.final": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      a.final = d.text;
      break;
    }
    case "agent.control": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      if (d.action === "pause" || d.action === "step") a.pausedRequested = true;
      if (d.action === "resume") {
        a.pausedRequested = false;
        if (a.status === "paused") a.status = "running";
      }
      a.markers = [...a.markers, { ts, kind: "control", label: d.action, data: d }];
      break;
    }
    case "approval.request": {
      next.approvals = { ...next.approvals, [d.id]: { id: d.id, agent: ev.agent, action: d.action, detail: d.detail, ts } };
      if (ev.agent) {
        const a = touch(ev.agent);
        a.markers = [...a.markers, { ts, kind: "approval", label: d.action, data: d }];
      }
      break;
    }
    case "approval.decision": {
      const prev = next.approvals[d.id];
      if (prev) next.approvals = { ...next.approvals, [d.id]: { ...prev, decision: { approved: d.approved, note: d.note, ts } } };
      break;
    }
    case "agent.graded": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      a.grade = { score: d.score, passed: d.passed, checks: d.checks ?? [], error: d.error };
      break;
    }
    case "agent.error": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      a.status = "error";
      a.error = d.error;
      a.endTs = a.endTs ?? ts;
      a.markers = [...a.markers, { ts, kind: "error", label: "error", data: d }];
      break;
    }
    case "agent.end": {
      if (!ev.agent) break;
      const a = touch(ev.agent);
      a.status = d.status === "done" ? "done" : "error";
      a.endTs = ts;
      a.error = d.error ?? a.error;
      a.summary = d;
      if (d.grade && !a.grade) a.grade = d.grade;
      if (d.final_text && !a.final) a.final = d.final_text;
      break;
    }
    case "setup.start":
    case "setup.log":
    case "setup.end": {
      const fw = d.framework ?? "?";
      const cur = next.setup[fw] ?? { lines: [], ts };
      const lines = ev.type === "setup.log" ? [...cur.lines.slice(-60), d.line] : ev.type === "setup.start" ? [`$ ${d.cmd}`] : cur.lines;
      next.setup = { ...next.setup, [fw]: { ...cur, lines, ok: ev.type === "setup.end" ? d.ok : cur.ok } };
      break;
    }
    case "board.update": {
      const t: BoardTask = d.task;
      if (!t?.id) break;
      const prev = next.tasks[t.id];
      next.tasks = { ...next.tasks, [t.id]: { ...prev, ...t } };
      if (!prev) next.taskOrder = [...next.taskOrder, t.id];
      next.boardEvents = [...next.boardEvents, { ts, seq: ev.seq, what: d.what, by: d.by, task: t }];
      break;
    }
    case "mission.phase": {
      next.phases = [...next.phases, { phase: d.phase, round: d.round, ts }];
      break;
    }
    case "mission.gate": {
      next.gate = { phase: d.phase, tasks: d.tasks ?? [], ts };
      break;
    }
    case "mission.gate_decision": {
      if (next.gate) next.gate = { ...next.gate, decision: { approved: d.approved, note: d.note, ts } };
      break;
    }
    case "mission.graded": {
      next.missionGrade = { score: d.score, passed: d.passed, checks: d.checks ?? [], error: d.error };
      next.phases = [...next.phases, { phase: "graded", ts }];
      break;
    }
    case "mission.error": {
      next.missionError = d.error;
      break;
    }
    case "run.end": {
      next.ended = true;
      next.runSummary = d.agents;
      // any agent still "running" when the run ended is finished
      for (const id of next.order) {
        const a = next.agents[id];
        if (a.status === "running" || a.status === "paused" || a.status === "queued") {
          const sum = (d.agents ?? []).find((x: any) => x.agent_id === id);
          next.agents = { ...next.agents, [id]: { ...a, status: sum?.status === "done" ? "done" : a.startTs ? "error" : "queued", endTs: a.endTs ?? ts } };
        }
      }
      break;
    }
    default:
      break;
  }
  return next;
}

function findLastIndex<T>(arr: T[], fn: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i;
  return -1;
}

export function reduceAll(s: RunState, evs: LabEvent[]): RunState {
  let out = s;
  for (const e of evs) out = reduceRun(out, e);
  return out;
}

/** The framework's own overhead on the first model call: system prompt chars + tool schema chars. */
export function overheadChars(a: AgentState): number | null {
  const c = a.llm[0];
  if (!c) return null;
  return c.systemChars + c.toolsChars;
}

export function totalTokens(a: AgentState): number {
  return a.totals.input + a.totals.output + a.totals.cacheRead + a.totals.cacheWrite;
}

export function agentElapsed(a: AgentState, now: number): number {
  if (!a.startTs) return 0;
  return Math.max(0, (a.endTs ?? now) - a.startTs);
}

export function inflightLlm(a: AgentState): LlmCall | undefined {
  const c = a.llm[a.llm.length - 1];
  return c && c.resTs === undefined ? c : undefined;
}

export function isActive(a: AgentState): boolean {
  return a.status === "running" || a.status === "paused";
}
