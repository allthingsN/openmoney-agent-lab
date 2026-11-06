# How the lab measures

The point is a fair comparison: **the same job, the same model, the same tools, measured the same way, from
outside every framework.** Nothing here depends on a framework reporting its own numbers.

```
            ┌──────────────────────── the lab (one process, one port) ────────────────────────┐
            │                                                                                  │
 framework  │   /llm/<run>/<agent>/v1/messages ──► metering proxy ──► Anthropic  (or LiteLLM)  │
 agent      │        tokens · cache · cost · latency · TTFT · system prompt · tools offered    │
 process ───┤                                                                                  │
 (its own   │   /mcp/<run>/<agent>/<server> ──► MCP tool servers (files, offers, ops, skills,   │
 venv or    │        board, toolbox, custom)    every call: args · result · ms · error         │
 node_modules)                                                                                 │
            │   /api/runs/<run>/agents/<agent>/events ◄── labkit: native tool calls, final answer│
            │                                                                                  │
            │   grader (deterministic, per task) reads: outbox files, tool-call log, sim state  │
            └──────────────────────────────────────────────────────────────────────────────────┘
```

## What every framework gets
- **Model:** one Claude model for the whole run (default `claude-opus-5-5`). Each agent's
  `ANTHROPIC_BASE_URL` points at the proxy with a per-agent token as its API key; the real key never leaves the
  lab process. The proxy forwards the request **unchanged** (unless a documented, opt-in shim is listed for that
  framework, and then every change is logged as a `shim.applied` event).
- **Prompt:** the same system prompt and user prompt from the task file, plus a list of available skills.
- **Tools:** the task's MCP servers over Streamable HTTP, hosted by the lab, plus one native tool, `calculate`,
  that each adapter defines in its framework's own tool style.
- **Skills:** the same SKILL.md folders. Frameworks without native skills load them through the `skills` MCP
  server (`list_skills`, `load_skill`, `read_skill_file` — progressive disclosure). The Claude Agent SDK uses its
  native Skill tool on the same files.
- **Limits:** the same turn limit and per-response `max_tokens`, through each framework's own setting.
- **Isolation:** each framework runs in its own environment (its own `.venv` or `node_modules`) as a separate
  process; its built-in tools (if any) are switched off so it can only act through the measured tools; telemetry
  to third parties is disabled through environment variables.

## What is measured
| Metric | Where | Notes |
|---|---|---|
| Score, pass/fail, per-check detail | task grader | Deterministic: recomputes the right answer from the task data (Bill Doctor) or reads the simulator's action log (Incident Commander). Some checks are *must-pass* (privacy, no leaked secret). |
| LLM calls, input/output tokens, cache read/write tokens | proxy | From the API's own `usage` on every response, streaming or not. |
| Cost | proxy | List prices in `lab/pricing.py` × usage (cache writes at 1.25×/2× input, cache reads at the model's cache price). |
| Latency, time to first token | proxy | Per call; wall time per agent from process start to exit. |
| Prompt overhead | proxy | Characters of system prompt + tool definitions (+ system messages) on the first call: what the framework adds on top of the task's own prompt. |
| Tool calls, tool errors, by server | MCP servers | Every argument and result is kept; graders use them (e.g. privacy leaks are detected in the arguments the offers server actually received). |
| Skill loads | skills server / Skill hook | |
| Adapter LOC | static | Non-blank, non-comment lines of the framework's agent file. |

## What is not measured (yet)
- Frameworks' own retry/backoff under rate limits (runs use a key with enough headroom).
- Multi-model routing, memory stores, or hosted services some frameworks offer.
- Variance beyond the number of trials published (see each result's trial count; graders are deterministic, models aren't).

## Reproduce
```sh
cp .env.example .env              # add your key
uv run agent-lab bench --task all --frameworks all --trials 3 --publish
```
`--publish` writes `results/<date>-<task>-<model>/` (summary, gzipped event log, every request/response body with
local paths scrubbed) and regenerates `results/README.md` and `results/index.json`.
