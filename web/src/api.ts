import type {
  BuildSummary, BuildTree, CatalogEntry, Design, Framework, Mission, PublishedIndexRow, RunInfo, Skill, Task, Upstream,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* not json */
    }
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

const get = <T,>(u: string) => req<T>("GET", u);
const post = <T,>(u: string, b: unknown = {}) => req<T>("POST", u, b);

export const api = {
  config: () => get<{ upstream: Upstream; models: string[] }>("/api/config"),
  saveConfig: (b: Partial<Upstream>) => post<{ upstream: Upstream }>("/api/config", b),
  testConfig: () => post<{ ok: boolean; message: string }>("/api/config/test"),

  frameworks: () => get<{ frameworks: Framework[] }>("/api/frameworks"),
  frameworkSource: (id: string) => get<{ framework: string; files: Record<string, string> }>(`/api/frameworks/${id}/source`),
  tasks: () => get<{ tasks: Task[] }>("/api/tasks"),
  skills: () => get<{ skills: Array<Skill & { files?: string[] }> }>("/api/skills"),
  missions: () => get<{ missions: Mission[] }>("/api/missions"),

  runs: () => get<{ runs: RunInfo[] }>("/api/runs"),
  run: (id: string) => get<RunInfo>(`/api/runs/${id}`),
  createRun: (b: Record<string, unknown>) => post<RunInfo>("/api/runs", b),
  control: (run: string, agent: string, action: string) =>
    post(`/api/runs/${run}/agents/${encodeURIComponent(agent)}/control`, { action }),
  approve: (run: string, aid: string, approved: boolean, note = "") => post(`/api/runs/${run}/approvals/${aid}`, { approved, note }),
  outbox: (run: string, agent: string) => get<{ files: Record<string, string> }>(`/api/runs/${run}/agents/${encodeURIComponent(agent)}/outbox`),
  runOutbox: (run: string) => get<{ files: Record<string, string> }>(`/api/runs/${run}/outbox`),
  missionAction: (run: string, action: "gate" | "comment" | "rework", b: Record<string, unknown>) =>
    post(`/api/runs/${run}/mission/${action}`, b),

  builds: () => get<{ builds: BuildSummary[]; catalog: Record<string, CatalogEntry> }>("/api/builder"),
  design: (description: string, model?: string) => post<{ design: Design }>("/api/builder/design", { description, model }),
  check: (design: Design) => post<{ design: Design }>("/api/builder/check", { design }),
  build: (design: Design, frameworks: string[]) => post<BuildTree>("/api/builder/build", { design, frameworks }),
  getBuild: (slug: string) => get<BuildTree & { design: Design }>(`/api/builder/${slug}`),
  github: (slug: string, repo: string, isPrivate: boolean) =>
    post<{ ok: boolean; output: string }>(`/api/builder/${slug}/github`, { repo, private: isPrivate }),

  results: () => get<{ benchmarks: PublishedIndexRow[] }>("/api/results"),
  result: (id: string) => get<RunInfo>(`/api/results/${id}`),
  resultOutbox: (id: string, agent: string) => get<{ files: Record<string, string> }>(`/api/results/${id}/outbox/${encodeURIComponent(agent)}`),
};

/** Where a run's events and model-call bodies live: a run on this machine, or a published result. */
export interface RunSource {
  type: "run" | "result";
  id: string;
  speed?: number;
}

export function eventsUrl(src: RunSource, after: number): string {
  if (src.type === "result") return `/api/results/${src.id}/events?speed=${src.speed ?? 0}`;
  return `/api/runs/${src.id}/events?after=${after}`;
}

export function llmUrl(src: RunSource, agent: string, n: number): string {
  if (src.type === "result") return `/api/results/${src.id}/llm/${encodeURIComponent(agent)}/${n}`;
  return `/api/runs/${src.id}/agents/${encodeURIComponent(agent)}/llm/${n}`;
}
