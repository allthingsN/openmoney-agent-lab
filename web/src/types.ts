// Shapes returned by the lab server (lab/server.py, lab/runs.py, lab/proxy.py, lab/mission.py, lab/builder.py).

export interface Framework {
  id: string;
  name: string;
  vendor: string;
  language: string;
  color: string;
  glyph: string;
  homepage?: string;
  packages?: string;
  summary: string;
  skills?: string;
  entry?: string;
  notes?: string;
  shims?: string[];
  installed: boolean;
  loc: number;
}

export interface Task {
  id: string;
  title: string;
  tagline: string;
  domain: string;
  difficulty?: string;
  servers: string[];
  skills?: string[];
  native_tools?: string[];
  checks?: string[];
  prompt: string;
  system_prompt: string;
  max_turns?: number;
  timeout_s?: number;
}

export interface MissionRole {
  role: string;
  framework: string;
  title: string;
  does: string;
}

export interface Mission {
  id: string;
  title: string;
  tagline: string;
  brief: string;
  deliverables: Array<string | Record<string, string>>;
  roles: MissionRole[];
  skills?: string[];
  servers?: string[];
}

export interface Upstream {
  provider: "anthropic" | "litellm";
  api_key: string;
  base_url: string;
  model: string;
  configured: boolean;
  source: string;
}

export interface Metrics {
  llm_calls: number;
  llm_errors: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  llm_ms: number;
  tool_calls: number;
  tool_errors: number;
  skill_loads: number;
  wall_s: number;
}

export interface Check {
  id: string;
  label: string;
  points: number;
  earned: number;
  detail?: string;
}

export interface Grade {
  score: number;
  passed: boolean;
  checks: Check[];
  failed_must?: string[];
  error?: string;
  judge?: string;
}

export interface AgentSummary {
  agent_id: string;
  framework: string;
  framework_name: string;
  label: string;
  role: string | null;
  status: string;
  exit_code: number | null;
  error: string | null;
  metrics: Metrics;
  tools_by_server: Record<string, number>;
  score: number | null;
  passed: boolean | null;
  grade?: Grade | null;
  final_text?: string;
  loc?: number;
  shims?: string[];
}

export interface RunInfo {
  id: string;
  kind: "bench" | "mission" | "build";
  title: string;
  model: string;
  status: string;
  interactive: boolean;
  meta: Record<string, any>;
  created: number;
  finished: number | null;
  agents: AgentSummary[];
}

export interface LabEvent {
  seq: number;
  ts: number;
  run: string;
  agent: string | null;
  type: string;
  data: any;
}

export interface BoardTask {
  id: string;
  title: string;
  role: string;
  status: "todo" | "running" | "done" | "rework";
  depends_on: string[];
  assignee: string | null;
  result?: string | null;
  instructions?: string;
  comments?: Array<{ by?: string; role: string; text: string; t?: number }>;
  rework_reason?: string | null;
  created_by?: string;
}

export interface CatalogEntry {
  title: string;
  description: string;
  tools: string[];
}

export interface ToolParam {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

export interface CustomTool {
  name: string;
  description: string;
  parameters: ToolParam[];
  code: string;
  problems?: string[];
}

export interface Skill {
  name: string;
  description: string;
  body: string;
}

export interface Design {
  name: string;
  slug: string;
  summary: string;
  description: string;
  system_prompt: string;
  sample_prompt: string;
  catalog_tools: string[];
  custom_tools: CustomTool[];
  skills: Skill[];
  workspace_files: Array<{ path: string; content: string }>;
  success_criteria: string[];
}

export interface BuildSummary {
  slug: string;
  name: string;
  summary: string;
  frameworks: string[];
  modified: number;
}

export interface BuildTree {
  slug: string;
  path: string;
  files: Record<string, string>;
  design?: Design;
}

export interface PublishedIndexRow {
  id: string;
  title?: string;
  task?: string;
  kind?: string;
  model?: string;
  created?: number;
  published?: string | number;
  agents?: AgentSummary[];
  frameworks?: string[];
  [k: string]: any;
}
