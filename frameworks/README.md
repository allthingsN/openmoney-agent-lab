# Framework adapters

Every folder here is one agent framework doing the same job. The lab starts the folder's `run` command with one
argument, the path of an `agent.json` spec, and measures everything from outside the framework.

## The contract

An adapter reads the spec and builds an agent **the way that framework's docs say to**:

| Spec field | What the adapter does with it |
|---|---|
| `model` | The Claude model id, e.g. `claude-opus-5-5`. Use the framework's Anthropic provider (or LiteLLM's `anthropic/` provider when the framework only speaks LiteLLM). |
| `system_prompt`, `prompt` | System instructions and the single user turn. |
| `mcp_servers[]` | `{name, transport: "http", url}` (Streamable HTTP) or `{name, transport: "stdio", command, args}`. Load **every** tool from every server through the framework's own MCP support. |
| `native_tools` | `["calculate"]`: define a `calculate(expression: str) -> str` tool in the framework's native tool style, whose body calls `labkit.calculate(expression)`; use `labkit.CALCULATE_DESCRIPTION` as its description. |
| `skills` | `{mode, names, dir}`. In `mcp` mode skills are already tools on the `skills` MCP server. In `native` mode (Claude Agent SDK) skills are in `dir` (a `.claude/skills` folder in the working directory). |
| `max_turns`, `max_tokens` | Turn/iteration limit and per-response `max_tokens`, where the framework has them. |
| `events_url`, `events_token` | Used only through `labkit` (`labkit.calculate`, `labkit.final`). |

When the agent finishes, call `labkit.final(text)` with its final answer and exit 0. Let real failures raise (exit
non-zero): the lab records them as framework errors.

### Rules
- **Model traffic:** never hard-code keys or URLs. The lab sets `ANTHROPIC_BASE_URL` (its metering proxy, no `/v1`
  suffix) and `ANTHROPIC_API_KEY` (a per-agent token). Pass them to the framework if it doesn't read them itself.
  Outside the lab the same variables point at Anthropic or a LiteLLM proxy.
- **Sampling:** don't set `temperature`/`top_p` (current Claude models reject non-default sampling) and don't force
  `tool_choice` to `any`/`tool` (Opus 5.5 and Sonnet 5.5 return 400). If the framework does either by itself, add
  the matching shim to `framework.json` (`"strip_sampling"`, `"tool_choice_auto"`) and explain it in `notes`. The
  proxy logs every shim it applies.
- **Idiomatic and short:** the adapter is the example people read. Prefer the framework's documented high-level
  agent API over hand-written loops, and keep it to one readable file.
- **Same job for everyone:** no extra prompting, no task-specific code, no retries the framework doesn't do itself.

## `framework.json`

```json
{
  "id": "langgraph", "name": "LangGraph", "vendor": "LangChain", "language": "python",
  "color": "#1C3C3C", "glyph": "LG", "homepage": "https://…", "packages": "langgraph, langchain-anthropic, …",
  "summary": "One sentence on how the agent is built.",
  "skills": "mcp",
  "entry": "agent.py",
  "setup": ["uv", "sync", "--project", "{dir}", "--quiet"],
  "run": ["uv", "run", "--project", "{dir}", "--quiet", "python", "{dir}/agent.py", "{spec}"],
  "shims": [],
  "notes": "Quirks found while building the adapter."
}
```

Python adapters keep their own `pyproject.toml` + `uv.lock` (each framework pins different dependencies) and a copy
of `_shared/labkit.py`. TypeScript adapters keep `package.json` + `package-lock.json` and import
`_shared/labkit.ts`'s copy.

## Try one by hand

```sh
uv run agent-lab bench --task bill-doctor --frameworks langgraph --model claude-haiku-5-5
```
