#!/usr/bin/env python3
"""Fill README.md's framework table and results section from frameworks/*/framework.json and results/index.json."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from lab.runs import frameworks  # noqa: E402


def block(text, name, body):
    return re.sub(rf"(<!-- {name}:start -->).*?(<!-- {name}:end -->)", lambda m: f"{m[1]}\n{body}\n{m[2]}", text, flags=re.S)


def main():
    fws = sorted(frameworks().values(), key=lambda f: (f["id"] != "anthropic-sdk", f["language"], f["name"]))
    rows = [f"| [{f['name']}]({f['homepage']}) | {'TypeScript' if f['language'] == 'typescript' else 'Python'} | "
            f"{f['summary']} [Code](frameworks/{f['id']}/{f['entry']}) ({f['loc']} lines) |" for f in fws]
    idx = json.loads((ROOT / "results/index.json").read_text())["benchmarks"] if (ROOT / "results/index.json").exists() else []
    out = []
    seen = set()
    for b in idx:
        key = (b["kind"], b["task"], b["model"])
        if key in seen:
            continue
        seen.add(key)
        if b["kind"] == "mission":
            team = ", ".join(f"{k} → `{v}`" for k, v in (b.get("roles") or {}).items())
            out.append(f"\n**{b['title']}** (mission) on `{b['model']}`, {b['date']}: score **{b['grade']}/100**, "
                       f"total ${b['cost_total']:.2f}. Team: {team}. [Run log](results/{b['id']}/)\n")
            continue
        out.append(f"\n**{b['title']}** on `{b['model']}`, {b['date']} — {b.get('trials') or 1} trials per framework "
                   f"([full table + logs](results/{b['id']}/))\n")
        out.append("| Framework | Score | Pass | Cost / run | Time | Model calls | Input tokens (cached) |")
        out.append("|---|---:|---:|---:|---:|---:|---:|")
        for r in b["leaderboard"] or []:
            out.append(f"| {r['name']} | {r['score_mean']:.1f} | {r['pass_rate'] * 100:.0f}% | ${r['cost_mean']:.3f} | "
                       f"{r['wall_mean']:.0f}s | {r['llm_calls_mean']:.1f} | {r['input_tokens_mean']:,.0f} ({r['cached_share'] * 100:.0f}%) |")
    readme = (ROOT / "README.md").read_text()
    readme = block(readme, "frameworks", "\n".join(rows))
    readme = block(readme, "results", "\n".join(out) if out else "_No published runs yet._")
    (ROOT / "README.md").write_text(readme)
    notes = ["# Framework notes", "", "What each adapter does, and what we learned about each framework while making it do the same job. "
             "Generated from `frameworks/*/framework.json` by `scripts/update-readme.py`.", ""]
    for f in fws:
        notes += [f"## {f['name']}", "", f"`frameworks/{f['id']}/{f['entry']}` · {f['loc']} lines · packages: {f.get('packages', '')} · "
                  f"shims: {', '.join(f.get('shims') or []) or 'none'}", "", f.get("summary", ""), "", f.get("notes") or "", ""]
    (ROOT / "docs" / "FRAMEWORKS.md").write_text("\n".join(notes))
    print("README updated")


if __name__ == "__main__":
    main()
