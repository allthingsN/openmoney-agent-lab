# How to verify this repo's claims

Each step says what it proves. Steps 1–3 need no API key.

| # | Do this | What it proves |
|---|---|---|
| 1 | `uv sync && uv run pytest` | The graders recompute the right answers from the task data, every trap is caught by the rule it targets, a leaked name/ZIP/token fails the run, the MCP kit, proxy stream recorder and builder safety checks work (17 tests). |
| 2 | `uv run python scripts/verify-results.py` | Every published number (model calls, tokens in/out/cached, cost, tool calls, score, leaderboard means) is recomputed from the raw response bodies and event logs committed in `results/`. Prints `OK` per result set. CI runs this. |
| 3 | `./lab.sh`, open http://localhost:7777 → **Results** → Replay | Watch any published run as it happened; click any model call to see the exact request the framework sent and the response it got. |
| 4 | Read `frameworks/*/agent.py` / `agent.ts` (26–48 lines each) | No task-specific code or extra prompting in any adapter; each reads the same `agent.json`. `docs/FRAMEWORKS.md` lists what each framework adds on its own. |
| 5 | With a key: `./lab.sh bench --task bill-doctor --frameworks langgraph claude-agent-sdk --model claude-haiku-5-5` (≈ $0.05) | Reproduce a result yourself; drop `--model` for Opus 5.5 (≈ $1.10 for these two). |
| 6 | `./lab.sh mission --model claude-haiku-5-5` (≈ $0.10) | The multi-framework mission runs end to end and is graded. |
| 7 | UI → **Builder**: describe a job, build for 2 frameworks, test; then `cd my-agents/<slug> && python3 run.py <framework>` | A built agent runs on its own, outside the lab, with only your key. |
| 8 | `docker compose up --build` | The image installs every framework and runs them (≈ 7.5 GB). |

Model access: Settings in the UI, or `.env` (`ANTHROPIC_API_KEY`, or `LITELLM_BASE_URL` + `LITELLM_API_KEY`).
