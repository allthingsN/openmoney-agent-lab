"""Publish a finished run into results/: summary, full event log and every model call, so anyone can audit or
replay it in the UI without an API key. Local paths are scrubbed."""

from __future__ import annotations

import gzip
import json
import os
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .runs import Run, frameworks

RESULTS = config.ROOT / "results"


def _scrub(text: str) -> str:
    text = text.replace(str(config.ROOT), "<lab>")
    home = os.path.expanduser("~")
    text = text.replace(home, "~")
    text = re.sub(r"lab-[A-Za-z0-9_-]{20,}", "lab-<agent-token>", text)
    text = re.sub(r"sk-[A-Za-z0-9_-]{16,}", "sk-<redacted>", text)
    return text


def _short_model(m: str) -> str:
    return m.replace("claude-", "")


def aggregate(agents: list[dict]) -> list[dict]:
    by: dict[str, list[dict]] = {}
    for a in agents:
        by.setdefault(a["framework"], []).append(a)
    fws = frameworks()
    rows = []
    for fid, xs in by.items():
        def vals(f):
            return [f(x) for x in xs]

        def mean(f):
            v = [y for y in vals(f) if y is not None]
            return round(statistics.mean(v), 4) if v else None

        m = lambda k: (lambda x: x["metrics"].get(k))  # noqa: E731
        first = xs[0]
        rows.append({
            "framework": fid, "name": first["framework_name"], "color": fws.get(fid, {}).get("color"),
            "language": fws.get(fid, {}).get("language"), "loc": fws.get(fid, {}).get("loc"),
            "trials": len(xs),
            "score_mean": mean(lambda x: x.get("score") or 0),
            "score_min": min(vals(lambda x: x.get("score") or 0)),
            "pass_rate": round(sum(1 for x in xs if x.get("passed")) / len(xs), 3),
            "errors": sum(1 for x in xs if x["status"] == "error"),
            "cost_mean": mean(m("cost_usd")),
            "wall_mean": mean(m("wall_s")),
            "llm_calls_mean": mean(m("llm_calls")),
            "tool_calls_mean": mean(m("tool_calls")),
            "tool_errors_mean": mean(m("tool_errors")),
            "input_tokens_mean": mean(lambda x: x["metrics"]["input_tokens"] + x["metrics"]["cache_read_tokens"] + x["metrics"]["cache_write_tokens"]),
            "cached_share": round(sum(x["metrics"]["cache_read_tokens"] for x in xs) /
                                  max(1, sum(x["metrics"]["input_tokens"] + x["metrics"]["cache_read_tokens"] + x["metrics"]["cache_write_tokens"] for x in xs)), 3),
            "output_tokens_mean": mean(m("output_tokens")),
            "skill_loads_mean": mean(m("skill_loads")),
            "overhead_chars": first.get("overhead_chars"),
            "agents": [x["agent_id"] for x in xs],
        })
    return sorted(rows, key=lambda r: (-(r["score_mean"] or 0), r["cost_mean"] or 9e9))


def _overhead(run_dir: Path, agent_id: str) -> int | None:
    p = run_dir / "agents" / agent_id / "llm" / "001-request.json"
    if not p.exists():
        return None
    b = json.loads(p.read_text())
    sys_ = b.get("system")
    s = sys_ if isinstance(sys_, str) else "".join(x.get("text", "") for x in (sys_ or []) if isinstance(x, dict))
    msgs = b.get("messages") or []
    sys_msgs = sum(len(json.dumps(m.get("content"))) for m in msgs if m.get("role") == "system")
    return len(s) + len(json.dumps(b.get("tools") or [])) + sys_msgs


def publish(run: Run | str, bench_id: str | None = None) -> Path:
    if isinstance(run, Run):
        info = run.info()
        run_dir = run.dir
    else:
        run_dir = config.RUNS_DIR / run
        info = json.loads((run_dir / "summary.json").read_text())
    date = datetime.fromtimestamp(info["created"], timezone.utc).strftime("%Y-%m-%d")
    subject = info["meta"].get("task") or info["meta"].get("mission") or info["meta"].get("slug") or info["kind"]
    bench_id = bench_id or f"{date}-{subject}-{_short_model(info['model'])}"
    out = RESULTS / bench_id
    (out / "llm").mkdir(parents=True, exist_ok=True)
    for a in info["agents"]:
        a["overhead_chars"] = _overhead(run_dir, a["agent_id"])
        a["final_text"] = _scrub(a.get("final_text") or "")
        if a.get("error"):
            a["error"] = _scrub(a["error"])
        d = run_dir / "agents" / a["agent_id"]
        bodies = sorted((d / "llm").glob("*-request.json")) if (d / "llm").exists() else []
        (out / "llm" / a["agent_id"]).mkdir(parents=True, exist_ok=True)
        for req in bodies:
            n = int(req.name.split("-")[0])
            resp = d / "llm" / f"{n:03d}-response.json"
            doc = {"request": json.loads(_scrub(req.read_text())),
                   "response": json.loads(_scrub(resp.read_text())) if resp.exists() else None}
            with gzip.open(out / "llm" / a["agent_id"] / f"{n:03d}.json.gz", "wt") as f:
                json.dump(doc, f)
        ob = d / "workspace" / "outbox"
        if ob.exists():
            files = {str(p.relative_to(ob)): _scrub(p.read_text(errors="replace")) for p in ob.rglob("*") if p.is_file() and p.name != ".keep"}
            if files:
                (out / "outbox").mkdir(exist_ok=True)
                (out / "outbox" / f"{a['agent_id']}.json").write_text(json.dumps(files, indent=1))
    if info["kind"] == "mission":
        ob = run_dir / "workspace" / "outbox"
        files = {str(p.relative_to(ob)): _scrub(p.read_text(errors="replace")) for p in ob.rglob("*") if p.is_file() and p.name != ".keep"}
        (out / "outbox").mkdir(exist_ok=True)
        (out / "outbox" / "mission.json").write_text(json.dumps(files, indent=1))
    with open(run_dir / "events.jsonl") as src, gzip.open(out / "events.jsonl.gz", "wt") as dst:
        for line in src:
            dst.write(_scrub(line))
    summary = {"id": bench_id, "run_id": info["id"], "kind": info["kind"], "title": info["title"], "model": info["model"],
               "date": date, "meta": json.loads(_scrub(json.dumps(info["meta"], default=str))), "agents": info["agents"],
               "leaderboard": aggregate(info["agents"]) if info["kind"] != "mission" else None}
    (out / "summary.json").write_text(json.dumps(summary, indent=1, default=str))
    rebuild_index()
    return out


def rebuild_index() -> None:
    items = []
    for p in sorted(RESULTS.glob("*/summary.json")):
        s = json.loads(p.read_text())
        items.append({"id": s["id"], "kind": s["kind"], "title": s["title"], "model": s["model"], "date": s["date"],
                      "task": s["meta"].get("task") or s["meta"].get("mission"), "trials": s["meta"].get("trials"),
                      "leaderboard": s.get("leaderboard"),
                      "grade": (s["meta"].get("grade") or {}).get("score") if s["kind"] == "mission" else None,
                      "roles": s["meta"].get("roles"),
                      "cost_total": round(sum(a["metrics"]["cost_usd"] for a in s["agents"]), 4)})
    items.sort(key=lambda i: (i["date"], i["id"]), reverse=True)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "index.json").write_text(json.dumps({"benchmarks": items}, indent=1))
    (RESULTS / "README.md").write_text(render_markdown(items))


def _fmt(v, kind):
    if v is None:
        return "—"
    return {"usd": f"${v:.3f}", "s": f"{v:.0f}s", "n": f"{v:,.0f}", "pct": f"{v * 100:.0f}%", "score": f"{v:.1f}"}[kind]


def render_markdown(items: list[dict]) -> str:
    out = ["# Published results", "",
           "Every run here was executed by `agent-lab bench … --publish` (or `agent-lab mission … --publish`) and is "
           "committed with its full event log and every model request/response, so you can audit it or replay it in the "
           "lab UI (Results tab) without an API key. All numbers are measured outside the frameworks: tokens and cost at "
           "the metering proxy, tool calls at the MCP servers, scores by deterministic graders. Same model, same tools, "
           "same skills, same prompt for every framework.", ""]
    for it in items:
        out.append(f"## {it['title']} · `{it['model']}` · {it['date']}")
        out.append("")
        if it["kind"] == "mission":
            roles = ", ".join(f"{k}: `{v}`" for k, v in (it.get("roles") or {}).items())
            out.append(f"Mission score **{it['grade']}** · total cost ${it['cost_total']:.3f} · team: {roles} · "
                       f"[details]({it['id']}/summary.json)")
            out.append("")
            continue
        out.append(f"{it.get('trials') or 1} trial(s) per framework · [summary]({it['id']}/summary.json) · "
                   f"[events]({it['id']}/events.jsonl.gz)")
        out.append("")
        out.append("| Framework | Score (mean) | Pass | Cost / run | Time / run | LLM calls | Tool calls | Input tok (cached) | Output tok | Prompt overhead | Adapter LOC |")
        out.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
        for r in it["leaderboard"] or []:
            out.append(f"| {r['name']} | {_fmt(r['score_mean'], 'score')} | {_fmt(r['pass_rate'], 'pct')} | {_fmt(r['cost_mean'], 'usd')} | "
                       f"{_fmt(r['wall_mean'], 's')} | {_fmt(r['llm_calls_mean'], 'n')} | {_fmt(r['tool_calls_mean'], 'n')} | "
                       f"{_fmt(r['input_tokens_mean'], 'n')} ({_fmt(r['cached_share'], 'pct')}) | {_fmt(r['output_tokens_mean'], 'n')} | "
                       f"{_fmt(r['overhead_chars'], 'n')} chars | {r['loc'] or '—'} |")
        out.append("")
    out += ["**Prompt overhead** = characters of system prompt + tool definitions (+ any system messages) the framework sent "
            "on its first model call, for the same task. **Adapter LOC** = non-blank, non-comment lines in the framework's agent file.", "",
            "_Note: the Incident Commander's fictional leaked token was renamed from a Stripe-like `sk_live_…` string to "
            "`fhg_tok_live_…` after the 2026-11-06 runs (GitHub push protection reads the former as a real key); the published "
            "logs carry the same substitution. Nothing else in them was changed._", ""]
    return "\n".join(out)
