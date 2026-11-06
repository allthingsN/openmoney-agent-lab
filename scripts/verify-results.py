#!/usr/bin/env python3
"""Check every published result against its raw logs — no API key needed.

For each results/<id>/: recompute each agent's model calls, tokens and cost from the committed response bodies
(llm/<agent>/NNN.json.gz, the API's own `usage`), recount tool calls and read the grade from the event log
(events.jsonl.gz), and compare all of it with summary.json. Then rebuild each leaderboard from the agents.

    uv run python scripts/verify-results.py
"""
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from lab import pricing  # noqa: E402
from lab.publish import aggregate  # noqa: E402


def main() -> int:
    bad = 0
    for d in sorted((ROOT / "results").glob("*/summary.json")):
        s = json.loads(d.read_text())
        rdir = d.parent
        events = [json.loads(l) for l in gzip.open(rdir / "events.jsonl.gz", "rt")]
        problems = []
        for a in s["agents"]:
            aid, m = a["agent_id"], a["metrics"]
            calls = tin = tout = cr = cw = 0
            cost = 0.0
            for f in sorted((rdir / "llm" / aid).glob("*.json.gz")):
                resp = json.load(gzip.open(f, "rt")).get("response") or {}
                u = resp.get("usage")
                if not u:
                    continue  # an error response
                calls += 1
                tin += u.get("input_tokens") or 0
                tout += u.get("output_tokens") or 0
                cr += u.get("cache_read_input_tokens") or 0
                cw += u.get("cache_creation_input_tokens") or 0
                cost += pricing.cost(resp.get("model", ""), u)
            tools = sum(1 for e in events if e["agent"] == aid and e["type"] == "tool.end")
            graded = [e["data"] for e in events if e["agent"] == aid and e["type"] == "agent.graded"]
            checks = {
                "llm_calls": (calls, m["llm_calls"]), "input_tokens": (tin, m["input_tokens"]),
                "output_tokens": (tout, m["output_tokens"]), "cache_read_tokens": (cr, m["cache_read_tokens"]),
                "cache_write_tokens": (cw, m["cache_write_tokens"]), "tool_calls": (tools, m["tool_calls"]),
            }
            for k, (got, want) in checks.items():
                if got != want:
                    problems.append(f"{aid}: {k} recomputed {got} vs published {want}")
            if abs(cost - m["cost_usd"]) > 0.001:
                problems.append(f"{aid}: cost recomputed {cost:.4f} vs published {m['cost_usd']:.4f}")
            if s["kind"] != "mission" and graded and graded[-1]["score"] != a["score"]:
                problems.append(f"{aid}: score in event log {graded[-1]['score']} vs summary {a['score']}")
        if s.get("leaderboard"):
            rebuilt = {r["framework"]: r for r in aggregate(s["agents"])}
            for r in s["leaderboard"]:
                x = rebuilt[r["framework"]]
                for k in ("score_mean", "pass_rate", "cost_mean", "llm_calls_mean", "tool_calls_mean"):
                    if x[k] != r[k]:
                        problems.append(f"leaderboard {r['framework']}: {k} {x[k]} vs {r[k]}")
        n_calls = sum(1 for _ in (rdir / "llm").rglob("*.json.gz"))
        status = "OK " if not problems else "BAD"
        print(f"{status} {s['id']:<42} {len(s['agents']):>3} agents  {n_calls:>4} model calls re-read  "
              f"${sum(a['metrics']['cost_usd'] for a in s['agents']):.2f}")
        for p in problems:
            print("     ", p)
        bad += len(problems)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
