<p align="center">
  <img src="web/public/mark.svg" alt="" width="64">
</p>

<h1 align="center">OpenMoney Agent Lab</h1>

<p align="center"><b>The same hard agent task on ten agent frameworks — measured from the outside, published in full, and replayable without a key.</b><br>
Then a team of agents on six frameworks working one job together, and a builder that turns a plain-English job into a working agent on every framework you pick.</p>

<p align="center">
  <a href="#run-it-in-two-minutes">Run it</a> ·
  <a href="#results">Results</a> ·
  <a href="#1-arena-one-task-every-framework">Arena</a> ·
  <a href="#2-mission-control-a-team-across-frameworks">Mission Control</a> ·
  <a href="#3-agent-builder-plain-english--an-agent-on-every-framework">Agent Builder</a> ·
  <a href="docs/METHODOLOGY.md">Methodology</a> ·
  <a href="docs/VERIFY.md">Verify it</a> ·
  <a href="https://openmoney.ai/lab">openmoney.ai/lab</a>
</p>

<p align="center"><img src="docs/img/home.png" alt="The lab's home page: published leaderboard and how it's measured" width="900"></p>

---

Every framework in this repo gets **the same model, the same prompt, the same MCP tools, the same skills and the
same limits**. The lab runs each one as its own process and watches it from outside: a metering proxy sees every
model call (tokens, cache, cost, latency, the system prompt and tools the framework actually sent), the lab's MCP
servers see every tool call, and a deterministic grader scores the result. No framework reports its own numbers.

<!-- frameworks:start -->

| Framework | Language | How the agent is built |
|---|---|---|
| [Anthropic SDK (no framework)](https://github.com/anthropics/anthropic-sdk-python) | Python | The baseline: the official Python SDK's tool runner loops over MCP tools converted with anthropic.lib.tools.mcp. No agent framework at all. [Code](frameworks/anthropic-sdk/agent.py) (33 lines) |
| [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python) | Python | Claude Code's own agent loop driven by the Python SDK's query(): built-in tools cut down to Skill, MCP servers over Streamable HTTP, calculate as an in-process SDK MCP tool, and skills loaded natively from .claude/skills. [Code](frameworks/claude-agent-sdk/agent.py) (44 lines) |
| [CrewAI](https://github.com/crewAIInc/crewAI) | Python | One Agent (the system prompt as its backstory), one Task, one Crew; MCP tools from crewai-tools' MCPServerAdapter and Claude through CrewAI's native Anthropic provider. [Code](frameworks/crewai/agent.py) (41 lines) |
| [Google ADK](https://github.com/google/adk-python) | Python | An LlmAgent with Claude through ADK's LiteLlm wrapper, MCP tools from McpToolset and calculate as a plain function tool, run by Runner with an in-memory session. [Code](frameworks/google-adk/agent.py) (48 lines) |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Python | LangChain 1.x create_agent (a compiled LangGraph tool-calling graph) with ChatAnthropic, MCP tools from langchain-mcp-adapters' MultiServerMCPClient and a native @tool. [Code](frameworks/langgraph/agent.py) (28 lines) |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | Python | An Agent run by Runner.run, with Claude through the SDK's LitellmModel, MCP tools from MCPServerStreamableHttp and calculate as a @function_tool. [Code](frameworks/openai-agents/agent.py) (37 lines) |
| [PydanticAI](https://github.com/pydantic/pydantic-ai) | Python | A pydantic_ai.Agent with plain-text output on the Anthropic provider, one MCPToolset (FastMCP client) per MCP server and a native @agent.tool_plain. [Code](frameworks/pydantic-ai/agent.py) (26 lines) |
| [Strands Agents](https://github.com/strands-agents/sdk-python) | Python | A Strands Agent on the Anthropic model provider; each MCP server is an MCPClient tool provider the agent starts and stops itself, plus one @tool. [Code](frameworks/strands/agent.py) (29 lines) |
| [Mastra](https://mastra.ai) | TypeScript | A Mastra Agent on an @ai-sdk/anthropic model, with every MCP server's tools from @mastra/mcp's MCPClient.listTools() and calculate defined with createTool(). [Code](frameworks/mastra/agent.ts) (35 lines) |
| [Vercel AI SDK](https://ai-sdk.dev) | TypeScript | A ToolLoopAgent on the @ai-sdk/anthropic provider, with MCP tools from @ai-sdk/mcp's Streamable HTTP client and calculate defined with tool() and a zod schema. [Code](frameworks/vercel-ai-sdk/agent.ts) (37 lines) |

<!-- frameworks:end -->

## Run it in two minutes

You need [uv](https://docs.astral.sh/uv/) and Node.js 20+ — or just Docker.

```sh
git clone https://github.com/allthingsN/openmoney-agent-lab && cd openmoney-agent-lab
./lab.sh                          # builds the UI, starts http://localhost:7777
```

Open **http://localhost:7777**, click **Settings**, and either paste an Anthropic API key or point the lab at a
LiteLLM proxy in front of Anthropic. (Or put it in `.env` — see `.env.example`.) Each framework installs its own
environment the first time you run it (`./lab.sh setup` installs all of them up front).

With Docker:

```sh
cp .env.example .env              # optional: add your key here instead of in the UI
docker compose up --build         # every framework pre-installed
```

No key? The **Results** tab replays every published run — every model call and tool call, as it happened.

## What's inside

### 1. Arena: one task, every framework
Pick a task, tick frameworks, press Run. Each agent gets a lane on a shared time axis: model calls pulse along it
(width = latency), tool calls fly out to the server they hit, skill loads and errors are marked, and counters tick
up (cost, tokens in · cached · out, calls). Click anything for the raw request/response, the tool arguments and
result, or the system prompt and tool list the framework really sent. Pause any agent before its next model call,
step it one call at a time, or stop it. In interactive mode, destructive actions (rolling back a deploy, changing a
flag, posting to the status page) wait for you to approve them.

<p align="center"><img src="docs/img/arena-replay.png" alt="Bill Doctor replayed: 10 frameworks × 3 trials on one time axis, model calls and tool calls per lane, score stamps" width="900"></p>
<p align="center"><img src="docs/img/live-2.png" alt="A live interactive run: pause, step, resume, stop; tool calls colored by server" width="440"> <img src="docs/img/inspector-llm-1440.png" alt="Inspector: the exact request a framework sent and what came back" width="440"></p>

The two tasks are built to separate careful agents from fast ones:

- **Bill Doctor** — a household's bills, usage history and wishes are in its files. The agent shops a fictional
  offers catalog (the OpenMoney offers layer, sandboxed), applies a *true-cost* skill (promos that expire, autopay,
  equipment, fees, taxes, roaming day passes, data caps, "up to" speeds, contracts, availability) and writes a
  memo in a required format. Traps: a sponsored loyalty deal that is cheapest for 12 months and not for 24; the
  cheapest fiber plan isn't sold in their area; "up to 1 Gbps" whose typical speed is 415; a hotspot allowance
  1.4 GB short. A *privacy* skill forbids sending names, numbers, the street or the full ZIP to the offers tool —
  the grader reads the arguments the tool actually received.
- **Incident Commander** — checkout is failing. Alerts, metrics, logs and the change history come from a stateful
  simulator. A deploy 20 minutes earlier and an unrelated search deploy are red herrings; the cause is a feature
  flag ramp. The runbook skill says how to size it (SEV1), mitigate (flag, not rollback), verify (metrics after the
  fix), page the right teams, and write status updates. A live API token sits in a debug log line: page security,
  never copy it.

### 2. Mission Control: a team across frameworks
**Moving Day**: the same household moves from San Jose to Austin. A planner (Claude Agent SDK) puts tasks on a shared
task board; the lab starts each task on the framework assigned to its role once its dependencies are done —
researcher (LangGraph), analyst (PydanticAI), privacy officer (OpenAI Agents SDK), writer (CrewAI), scheduler
(Vercel AI SDK) — then a reviewer (Google ADK) checks the work and can send tasks back, and the planner assembles a
one-page plan. Deliverables: the plan with the right Austin internet and phone plans and exact 24-month costs, a
cancellation letter, and an `.ics` calendar for the move week — all graded. Watch the board and the team graph
live, approve the plan before work starts, comment on tasks or send them back yourself, and reassign any role to
any framework.

<p align="center"><img src="docs/img/mission-board.png" alt="Mission Control: the shared task board" width="440"> <img src="docs/img/mission-activity.png" alt="Mission Control: every agent run on its own lane, colored by framework" width="440"></p>

### 3. Agent Builder: plain English → an agent on every framework
Describe the job ("I run a bakery; every Friday I export sales as CSV…"). Claude designs the agent: instructions,
which tool servers it needs, small custom tools (generated Python, statically checked, shown to you before anything
runs), skills, sample files and success criteria. Edit anything, pick frameworks, and the lab writes a runnable
project with one folder per framework — each the same idiomatic adapter the Arena measures, driven by the
design's `agent.json`. Test them side by side (model-judged against the success criteria), then download the zip,
keep the folder, or publish it to a new GitHub repo. A built project runs on its own:

```sh
cd my-agents/bakery-weekly-sales-bake-planner
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
python3 run.py langgraph                     # or any framework you built it for
python3 run.py crewai "a request of your own"
```

**Cost controls.** Builder test runs, and built projects, add prompt caching to every model call: most frameworks
send the whole conversation uncached on every turn, so a 35-call research run costs several times more than it
needs to. The Arena does not do this; its benchmarks measure each framework as it ships. Each test-run agent also
has a spend cap ($5 by default; the lab stops the agent when it reaches the cap). `fetch_url` returns at most 12,000
characters and strips image links and long lists from JSON. The judge checks the core result first: an agent that
honestly reports it couldn't do the job fails the run, whatever the other criteria say. A built project's `run.py`
adds caching through a small local relay (`cache_relay.py`); set `NO_CACHE_RELAY=1` to call the API directly.

## Results

All published runs, with their full event logs and every request/response body, are in [`results/`](results/).

**What we found (2026-11-06, 3 trials per framework per model):**
- **Every framework can do the job.** On `claude-opus-5-5`, all ten passed every trial of both tasks; only two of 60
  runs dropped points (a missed security page, a status-update detail). The frameworks differ in what the same work
  costs and how long it takes, not in whether it gets done.
- **Prompt caching is the biggest cost lever, and only one framework turns it on by default.** The Claude Agent SDK
  served 82–85% of its input tokens from cache and cost **$0.30 per Bill Doctor run against $0.67–0.85** for everyone
  else (and $0.18 vs $0.35–0.51 on Incident Commander). CrewAI caches its system prompt (16–29% cached); the others send
  the full history uncached unless you configure it.
- **Overhead is small, with two exceptions.** Most frameworks send the task's prompt and tools almost verbatim
  (~4.9–5.6k characters on the first call). Google ADK wraps every tool description in untrusted-content markers (+40%
  tool schema); the Claude Agent SDK adds an environment/system block. CrewAI and ADK were the slowest on Bill Doctor
  (~160 s vs ~80–125 s).
- **On `claude-haiku-5-5` the model is the limit, not the framework:** every framework still aced Bill Doctor (for
  $0.015–0.034 a run), and every framework scored ~90 on Incident Commander because Haiku skipped paging the security
  team about the leaked token.
- **Adapters are 26–48 lines** in every framework; the differences that matter are in defaults (caching, history
  handling, tool naming), documented per framework in [`docs/FRAMEWORKS.md`](docs/FRAMEWORKS.md).

<!-- results:start -->

**Moving Day** (mission) on `claude-opus-5-5`, 2026-11-06: score **100.0/100**, total $4.33. Team: planner → `claude-agent-sdk`, researcher → `langgraph`, analyst → `pydantic-ai`, privacy → `openai-agents`, writer → `crewai`, scheduler → `vercel-ai-sdk`, reviewer → `google-adk`. [Run log](results/2026-11-06-moving-day-opus-5-5/)


**Incident Commander** on `claude-opus-5-5`, 2026-11-06 — 3 trials per framework ([full table + logs](results/2026-11-06-incident-commander-opus-5-5/))

| Framework | Score | Pass | Cost / run | Time | Model calls | Input tokens (cached) |
|---|---:|---:|---:|---:|---:|---:|
| Claude Agent SDK | 100.0 | 100% | $0.177 | 59s | 8.7 | 87,733 (84%) |
| Strands Agents | 100.0 | 100% | $0.351 | 44s | 7.3 | 67,353 (0%) |
| Vercel AI SDK | 100.0 | 100% | $0.354 | 39s | 7.3 | 67,837 (0%) |
| Anthropic SDK (no framework) | 100.0 | 100% | $0.372 | 59s | 7.7 | 72,585 (0%) |
| PydanticAI | 100.0 | 100% | $0.437 | 46s | 9.0 | 87,079 (0%) |
| LangGraph | 100.0 | 100% | $0.441 | 46s | 8.7 | 87,895 (0%) |
| OpenAI Agents SDK | 100.0 | 100% | $0.464 | 49s | 9.7 | 93,619 (0%) |
| Google ADK | 100.0 | 100% | $0.510 | 51s | 8.3 | 105,311 (0%) |
| Mastra | 99.7 | 100% | $0.377 | 38s | 7.0 | 74,790 (0%) |
| CrewAI | 96.7 | 100% | $0.376 | 82s | 8.7 | 85,345 (29%) |

**Incident Commander** on `claude-haiku-5-5`, 2026-11-06 — 3 trials per framework ([full table + logs](results/2026-11-06-incident-commander-haiku-5-5/))

| Framework | Score | Pass | Cost / run | Time | Model calls | Input tokens (cached) |
|---|---:|---:|---:|---:|---:|---:|
| Claude Agent SDK | 90.0 | 100% | $0.007 | 38s | 9.7 | 119,553 (85%) |
| Anthropic SDK (no framework) | 90.0 | 100% | $0.014 | 36s | 9.3 | 108,316 (0%) |
| Strands Agents | 90.0 | 100% | $0.016 | 38s | 9.7 | 123,360 (0%) |
| Vercel AI SDK | 90.0 | 100% | $0.016 | 35s | 10.3 | 127,130 (0%) |
| Google ADK | 90.0 | 100% | $0.019 | 38s | 10.0 | 156,531 (0%) |
| PydanticAI | 89.7 | 100% | $0.012 | 32s | 8.7 | 85,256 (0%) |
| CrewAI | 89.7 | 100% | $0.013 | 48s | 9.3 | 109,712 (27%) |
| LangGraph | 89.7 | 100% | $0.017 | 38s | 10.0 | 128,149 (0%) |
| OpenAI Agents SDK | 89.3 | 100% | $0.016 | 37s | 11.3 | 129,445 (0%) |
| Mastra | 89.3 | 100% | $0.019 | 38s | 10.0 | 148,492 (0%) |

**Bill Doctor** on `claude-opus-5-5`, 2026-11-06 — 3 trials per framework ([full table + logs](results/2026-11-06-bill-doctor-opus-5-5/))

| Framework | Score | Pass | Cost / run | Time | Model calls | Input tokens (cached) |
|---|---:|---:|---:|---:|---:|---:|
| Claude Agent SDK | 100.0 | 100% | $0.303 | 96s | 9.0 | 124,594 (82%) |
| PydanticAI | 100.0 | 100% | $0.672 | 92s | 10.3 | 123,099 (0%) |
| CrewAI | 100.0 | 100% | $0.677 | 161s | 10.3 | 137,605 (17%) |
| Vercel AI SDK | 100.0 | 100% | $0.725 | 83s | 10.3 | 134,433 (0%) |
| OpenAI Agents SDK | 100.0 | 100% | $0.733 | 86s | 11.3 | 142,254 (0%) |
| LangGraph | 100.0 | 100% | $0.741 | 126s | 10.7 | 139,750 (0%) |
| Mastra | 100.0 | 100% | $0.752 | 80s | 9.7 | 145,576 (0%) |
| Strands Agents | 100.0 | 100% | $0.757 | 80s | 11.0 | 145,745 (0%) |
| Anthropic SDK (no framework) | 100.0 | 100% | $0.766 | 95s | 11.0 | 145,815 (0%) |
| Google ADK | 100.0 | 100% | $0.851 | 156s | 10.0 | 167,165 (0%) |

**Bill Doctor** on `claude-haiku-5-5`, 2026-11-06 — 3 trials per framework ([full table + logs](results/2026-11-06-bill-doctor-haiku-5-5/))

| Framework | Score | Pass | Cost / run | Time | Model calls | Input tokens (cached) |
|---|---:|---:|---:|---:|---:|---:|
| Claude Agent SDK | 100.0 | 100% | $0.015 | 96s | 9.0 | 131,473 (83%) |
| Strands Agents | 100.0 | 100% | $0.026 | 106s | 9.7 | 134,098 (0%) |
| PydanticAI | 100.0 | 100% | $0.026 | 111s | 10.3 | 132,089 (0%) |
| LangGraph | 100.0 | 100% | $0.028 | 116s | 10.3 | 144,026 (0%) |
| CrewAI | 100.0 | 100% | $0.028 | 187s | 10.3 | 149,127 (16%) |
| OpenAI Agents SDK | 100.0 | 100% | $0.032 | 121s | 12.7 | 179,340 (0%) |
| Anthropic SDK (no framework) | 100.0 | 100% | $0.033 | 139s | 11.0 | 166,452 (0%) |
| Google ADK | 100.0 | 100% | $0.033 | 118s | 10.7 | 196,558 (0%) |
| Mastra | 100.0 | 100% | $0.034 | 127s | 11.0 | 188,915 (0%) |
| Vercel AI SDK | 100.0 | 100% | $0.034 | 140s | 11.3 | 173,752 (0%) |
<!-- results:end -->

## Command line

```sh
./lab.sh bench --task bill-doctor --frameworks langgraph crewai --trials 3     # headless benchmark
./lab.sh bench --task all --frameworks all --trials 3 --publish                # what produced results/
./lab.sh mission --roles writer=strands reviewer=claude-agent-sdk              # Moving Day, any team
./lab.sh setup                                                                  # install every framework
./lab.sh list
```

## Model access: Anthropic or LiteLLM

The lab sends model traffic either straight to Anthropic (`ANTHROPIC_API_KEY`) or to a LiteLLM proxy's
Anthropic-compatible `/v1/messages` endpoint (`LITELLM_BASE_URL` + `LITELLM_API_KEY`), whichever you configure in
Settings or `.env`. Agents never see your key: each gets the lab's local proxy and a per-agent token. Exported
agents read `ANTHROPIC_API_KEY` (and `ANTHROPIC_BASE_URL` for LiteLLM) from their `.env`.

## Repository map

| Path | What |
|---|---|
| `lab/` | The lab: server + UI API (`server.py`), metering proxy (`proxy.py`), runs (`runs.py`), missions, builder, publishing |
| `lab/mcpkit.py`, `lab/servers/` | A dependency-free MCP server kit and the tool servers (files, offers, ops simulator, skills, board, toolbox) |
| `frameworks/<id>/` | One adapter per framework, each with its own lock file; contract in [`frameworks/README.md`](frameworks/README.md) |
| `tasks/<id>/` | Task definition, workspace files and data; graders in `lab/tasks/` |
| `missions/moving-day/` | The multi-framework mission |
| `skills/` | Agent Skills (SKILL.md folders) used by the tasks |
| `results/` | Published benchmark runs |
| `web/` | The UI (React + Vite) |

## Add a framework or a task

- **Framework:** copy `frameworks/anthropic-sdk/`, follow [`frameworks/README.md`](frameworks/README.md), run
  `./lab.sh bench --task all --frameworks <yours> --model claude-haiku-5-5`.
- **Task:** add `tasks/<id>/` (task.yaml, workspace/, data/) and a grader in `lab/tasks/`; register it in
  `lab/runs.py:grader_for`. Graders must be deterministic and recompute the right answer from the data.

`uv run pytest` runs the lab's tests and `uv run python scripts/verify-results.py` re-checks every published number
against the raw logs (neither needs a key). See [`docs/VERIFY.md`](docs/VERIFY.md).

## License

Apache-2.0. Providers, plans, people and companies in the tasks are fictional.
