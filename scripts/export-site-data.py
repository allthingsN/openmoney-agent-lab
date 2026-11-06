#!/usr/bin/env python3
"""Write the published results as the compact JSON the openmoney.ai /lab page renders.

    python3 scripts/export-site-data.py > ../openmoney.ai/platform/src/shared/content/agent-lab.json
"""
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
REPO = "https://github.com/allthingsN/openmoney-agent-lab"
KEEP = ("framework", "name", "color", "language", "loc", "trials", "score_mean", "pass_rate", "cost_mean", "wall_mean",
        "llm_calls_mean", "tool_calls_mean", "input_tokens_mean", "cached_share", "overhead_chars")


def main():
    idx = json.loads((ROOT / "results/index.json").read_text())["benchmarks"]
    tasks = {yaml.safe_load(p.read_text())["id"]: yaml.safe_load(p.read_text()) for p in ROOT.glob("tasks/*/task.yaml")}
    benches, missions, seen = [], [], set()
    for b in idx:  # newest first; one entry per task+model
        key = (b["kind"], b["task"], b["model"])
        if key in seen:
            continue
        seen.add(key)
        if b["kind"] == "mission":
            s = json.loads((ROOT / "results" / b["id"] / "summary.json").read_text())
            missions.append({"id": b["id"], "title": b["title"], "model": b["model"], "date": b["date"], "score": b["grade"],
                             "cost_total": b["cost_total"], "agents": len(s["agents"]),
                             "roles": [{"role": k, "framework": v} for k, v in (b.get("roles") or {}).items()]})
        else:
            t = tasks.get(b["task"], {})
            benches.append({"id": b["id"], "title": b["title"], "task": b["task"], "tagline": t.get("tagline", ""),
                            "model": b["model"], "date": b["date"], "trials": b.get("trials") or 1,
                            "leaderboard": [{k: r.get(k) for k in KEEP} for r in b["leaderboard"] or []]})
    benches.sort(key=lambda b: (b["model"] != "claude-opus-5-5", b["task"]))
    json.dump({"repo": REPO, "generated": idx[0]["date"] if idx else "", "benchmarks": benches, "missions": missions},
              sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
