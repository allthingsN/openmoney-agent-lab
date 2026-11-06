# Published results

Every run here was executed by `agent-lab bench … --publish` (or `agent-lab mission … --publish`) and is committed with its full event log and every model request/response, so you can audit it or replay it in the lab UI (Results tab) without an API key. All numbers are measured outside the frameworks: tokens and cost at the metering proxy, tool calls at the MCP servers, scores by deterministic graders. Same model, same tools, same skills, same prompt for every framework.

## Moving Day · `claude-opus-5-5` · 2026-11-06

Mission score **100.0** · total cost $4.334 · team: planner: `claude-agent-sdk`, researcher: `langgraph`, analyst: `pydantic-ai`, privacy: `openai-agents`, writer: `crewai`, scheduler: `vercel-ai-sdk`, reviewer: `google-adk` · [details](2026-11-06-moving-day-opus-5-5/summary.json)

## Incident Commander · `claude-opus-5-5` · 2026-11-06

3 trial(s) per framework · [summary](2026-11-06-incident-commander-opus-5-5/summary.json) · [events](2026-11-06-incident-commander-opus-5-5/events.jsonl.gz)

| Framework | Score (mean) | Pass | Cost / run | Time / run | LLM calls | Tool calls | Input tok (cached) | Output tok | Prompt overhead | Adapter LOC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Claude Agent SDK | 100.0 | 100% | $0.177 | 59s | 9 | 18 | 87,733 (84%) | 4,536 | 9,951 chars | 44 |
| Strands Agents | 100.0 | 100% | $0.351 | 44s | 7 | 21 | 67,353 (0%) | 4,069 | 7,198 chars | 29 |
| Vercel AI SDK | 100.0 | 100% | $0.354 | 39s | 7 | 20 | 67,837 (0%) | 4,151 | 6,771 chars | 37 |
| Anthropic SDK (no framework) | 100.0 | 100% | $0.372 | 59s | 8 | 21 | 72,585 (0%) | 4,063 | 6,740 chars | 33 |
| PydanticAI | 100.0 | 100% | $0.437 | 46s | 9 | 22 | 87,079 (0%) | 4,425 | 6,716 chars | 26 |
| LangGraph | 100.0 | 100% | $0.441 | 46s | 9 | 23 | 87,895 (0%) | 4,481 | 6,686 chars | 28 |
| OpenAI Agents SDK | 100.0 | 100% | $0.464 | 49s | 10 | 23 | 93,619 (0%) | 4,481 | 7,046 chars | 37 |
| Google ADK | 100.0 | 100% | $0.510 | 51s | 8 | 21 | 105,311 (0%) | 4,434 | 10,052 chars | 48 |
| Mastra | 99.7 | 100% | $0.377 | 38s | 7 | 20 | 74,790 (0%) | 3,911 | 7,746 chars | 35 |
| CrewAI | 96.7 | 100% | $0.376 | 82s | 9 | 22 | 85,345 (29%) | 6,316 | 7,330 chars | 41 |

## Incident Commander · `claude-haiku-5-5` · 2026-11-06

3 trial(s) per framework · [summary](2026-11-06-incident-commander-haiku-5-5/summary.json) · [events](2026-11-06-incident-commander-haiku-5-5/events.jsonl.gz)

| Framework | Score (mean) | Pass | Cost / run | Time / run | LLM calls | Tool calls | Input tok (cached) | Output tok | Prompt overhead | Adapter LOC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Claude Agent SDK | 90.0 | 100% | $0.007 | 38s | 10 | 23 | 119,553 (85%) | 7,910 | 10,006 chars | 44 |
| Anthropic SDK (no framework) | 90.0 | 100% | $0.014 | 36s | 9 | 26 | 108,316 (0%) | 6,716 | 6,740 chars | 33 |
| Strands Agents | 90.0 | 100% | $0.016 | 38s | 10 | 28 | 123,360 (0%) | 7,561 | 7,198 chars | 29 |
| Vercel AI SDK | 90.0 | 100% | $0.016 | 35s | 10 | 25 | 127,130 (0%) | 7,396 | 6,771 chars | 37 |
| Google ADK | 90.0 | 100% | $0.019 | 38s | 10 | 25 | 156,531 (0%) | 6,658 | 10,052 chars | 48 |
| PydanticAI | 89.7 | 100% | $0.012 | 32s | 9 | 24 | 85,256 (0%) | 6,196 | 6,716 chars | 26 |
| CrewAI | 89.7 | 100% | $0.013 | 48s | 9 | 25 | 109,712 (27%) | 8,565 | 7,330 chars | 41 |
| LangGraph | 89.7 | 100% | $0.017 | 38s | 10 | 26 | 128,149 (0%) | 7,358 | 6,686 chars | 28 |
| OpenAI Agents SDK | 89.3 | 100% | $0.016 | 37s | 11 | 24 | 129,445 (0%) | 6,651 | 7,046 chars | 37 |
| Mastra | 89.3 | 100% | $0.019 | 38s | 10 | 26 | 148,492 (0%) | 7,459 | 7,746 chars | 35 |

## Bill Doctor · `claude-opus-5-5` · 2026-11-06

3 trial(s) per framework · [summary](2026-11-06-bill-doctor-opus-5-5/summary.json) · [events](2026-11-06-bill-doctor-opus-5-5/events.jsonl.gz)

| Framework | Score (mean) | Pass | Cost / run | Time / run | LLM calls | Tool calls | Input tok (cached) | Output tok | Prompt overhead | Adapter LOC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Claude Agent SDK | 100.0 | 100% | $0.303 | 96s | 9 | 43 | 124,594 (82%) | 8,649 | 8,376 chars | 44 |
| PydanticAI | 100.0 | 100% | $0.672 | 92s | 10 | 47 | 123,099 (0%) | 8,978 | 4,933 chars | 26 |
| CrewAI | 100.0 | 100% | $0.677 | 161s | 10 | 41 | 137,605 (17%) | 10,683 | 5,347 chars | 41 |
| Vercel AI SDK | 100.0 | 100% | $0.725 | 83s | 10 | 45 | 134,433 (0%) | 9,379 | 4,988 chars | 37 |
| OpenAI Agents SDK | 100.0 | 100% | $0.733 | 86s | 11 | 41 | 142,254 (0%) | 8,196 | 5,155 chars | 37 |
| LangGraph | 100.0 | 100% | $0.741 | 126s | 11 | 43 | 139,750 (0%) | 9,120 | 4,903 chars | 28 |
| Mastra | 100.0 | 100% | $0.752 | 80s | 10 | 43 | 145,576 (0%) | 8,490 | 5,627 chars | 35 |
| Strands Agents | 100.0 | 100% | $0.757 | 80s | 11 | 47 | 145,745 (0%) | 8,702 | 5,130 chars | 29 |
| Anthropic SDK (no framework) | 100.0 | 100% | $0.766 | 95s | 11 | 42 | 145,815 (0%) | 9,151 | 4,957 chars | 33 |
| Google ADK | 100.0 | 100% | $0.851 | 156s | 10 | 45 | 167,165 (0%) | 9,134 | 7,147 chars | 48 |

## Bill Doctor · `claude-haiku-5-5` · 2026-11-06

3 trial(s) per framework · [summary](2026-11-06-bill-doctor-haiku-5-5/summary.json) · [events](2026-11-06-bill-doctor-haiku-5-5/events.jsonl.gz)

| Framework | Score (mean) | Pass | Cost / run | Time / run | LLM calls | Tool calls | Input tok (cached) | Output tok | Prompt overhead | Adapter LOC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Claude Agent SDK | 100.0 | 100% | $0.015 | 96s | 9 | 43 | 131,473 (83%) | 22,587 | 8,431 chars | 44 |
| Strands Agents | 100.0 | 100% | $0.026 | 106s | 10 | 55 | 134,098 (0%) | 24,991 | 5,130 chars | 29 |
| PydanticAI | 100.0 | 100% | $0.026 | 111s | 10 | 47 | 132,089 (0%) | 25,698 | 4,933 chars | 26 |
| LangGraph | 100.0 | 100% | $0.028 | 116s | 10 | 54 | 144,026 (0%) | 27,132 | 4,903 chars | 28 |
| CrewAI | 100.0 | 100% | $0.028 | 187s | 10 | 54 | 149,127 (16%) | 30,542 | 5,347 chars | 41 |
| OpenAI Agents SDK | 100.0 | 100% | $0.032 | 121s | 13 | 64 | 179,340 (0%) | 28,195 | 5,155 chars | 37 |
| Anthropic SDK (no framework) | 100.0 | 100% | $0.033 | 139s | 11 | 68 | 166,452 (0%) | 33,153 | 4,957 chars | 33 |
| Google ADK | 100.0 | 100% | $0.033 | 118s | 11 | 52 | 196,558 (0%) | 27,337 | 7,147 chars | 48 |
| Mastra | 100.0 | 100% | $0.034 | 127s | 11 | 56 | 188,915 (0%) | 30,418 | 5,627 chars | 35 |
| Vercel AI SDK | 100.0 | 100% | $0.034 | 140s | 11 | 57 | 173,752 (0%) | 33,773 | 4,988 chars | 37 |

**Prompt overhead** = characters of system prompt + tool definitions (+ any system messages) the framework sent on its first model call, for the same task. **Adapter LOC** = non-blank, non-comment lines in the framework's agent file.

_Note: the Incident Commander's fictional leaked token was renamed from a Stripe-like `sk_live_…` string to `fhg_tok_live_…` after the 2026-11-06 runs (GitHub push protection reads the former as a real key); the published logs carry the same substitution. Nothing else in them was changed._
