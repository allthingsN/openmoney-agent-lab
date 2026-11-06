"""Agent Builder: plain-English task → agent design → a runnable project per framework → test run → publish.

The design (system prompt, which tool servers, generated custom tools, generated skills, sample workspace files,
success criteria) comes from Claude. The code for each framework is that framework's lab adapter — the same file
the benchmark measures — driven by the design's agent.json, so every framework builds the identical agent.
"""

from __future__ import annotations

import ast
import io
import json
import re
import shutil
import textwrap
import zipfile
from pathlib import Path

import httpx

from . import config
from .runs import AgentSlot, Run, RunManager, SKILLS_DIR, frameworks
from .safepath import UnsafePath, safe_id, within

ROOT = config.ROOT
BUILDS_DIR = ROOT / "my-agents"

CATALOG = {
    "files": {"title": "Workspace files", "description": "Read files in the agent's workspace folder; write results to outbox/.",
              "tools": ["list_files", "read_file", "write_file"]},
    "toolbox": {"title": "Toolbox", "description": "Fetch web pages and APIs (fetch_url), current_time, and a notes memory.",
                "tools": ["fetch_url", "current_time", "save_note", "read_notes"]},
    "offers": {"title": "OpenMoney offers sandbox", "description": "Search fictional home-internet and mobile plans with full terms and availability by ZIP3.",
               "tools": ["list_categories", "search_offers", "get_offer", "check_availability"]},
}
ALLOWED_IMPORTS = {"json", "math", "re", "datetime", "statistics", "csv", "random", "collections", "itertools", "textwrap",
                   "hashlib", "base64", "decimal", "fractions", "html", "string", "urllib", "urllib.request", "urllib.parse",
                   "time", "zoneinfo", "calendar", "uuid", "difflib", "unicodedata", "io"}
BANNED_CALLS = {"eval", "exec", "compile", "__import__", "open", "input", "breakpoint", "globals", "locals", "vars", "getattr", "setattr"}

DESIGN_SYSTEM = """You design AI agents. A person describes, in plain English, a job they want an agent to do. You return a
complete design for one agent that can do it with tools, as JSON only (no prose), in this shape:

{
  "name": "Short product-like name",
  "slug": "kebab-case-id",
  "summary": "One sentence: what the agent does for the person.",
  "system_prompt": "The agent's instructions: who it works for, how it behaves, what it must never do, how it finishes. 120-300 words.",
  "sample_prompt": "A realistic first request the person would send, referring to the sample files if any.",
  "catalog_tools": ["files", "toolbox"],
  "custom_tools": [
    {"name": "snake_case_name", "description": "What it does and when to use it.",
     "parameters": [{"name": "arg", "type": "string|integer|number|boolean", "description": "…", "required": true}],
     "code": "Python function BODY (no def line). Standard library only. Return a str or a JSON-serialisable dict. WORKSPACE is a pathlib.Path to the workspace folder; use WORKSPACE / 'x' and .read_text()/.write_text() for files (never open())."}
  ],
  "skills": [{"name": "kebab-case", "description": "When to use this skill (one sentence).", "body": "Markdown instructions: the expert procedure, rules, formats."}],
  "workspace_files": [{"path": "inbox/example.csv", "content": "small realistic sample data the agent can work on"}],
  "success_criteria": ["Concrete, checkable statements about a good result for the sample prompt (3-6)."]
}

Catalog tool servers you can include in catalog_tools:
CATALOG

Rules: prefer catalog tools; add custom tools only for deterministic logic or data the job needs (0-4 of them), each
self-contained. Skills hold domain procedure and formats (1-3). Include sample workspace files so the agent can be
tried immediately (no real personal data). Never require API keys or services the person hasn't mentioned. Output the
JSON object and nothing else."""


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48] or "my-agent"


def _extract_json(text: str) -> dict:
    m = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.S)
    raw = m.group(1) if m else text[text.find("{"): text.rfind("}") + 1]
    return json.loads(raw)


async def design(description: str, model: str | None = None) -> dict:
    u = config.load()
    if not u.configured:
        raise ValueError("Add your Anthropic key (or LiteLLM proxy) in Settings first.")
    catalog = "\n".join(f"- {k}: {v['description']} Tools: {', '.join(v['tools'])}" for k, v in CATALOG.items())
    system = DESIGN_SYSTEM.replace("CATALOG", catalog)
    body = {"model": model or u.model, "max_tokens": 16000, "system": system,
            "messages": [{"role": "user", "content": f"The job, in the person's words:\n\n{description}"}]}
    last_err = None
    async with httpx.AsyncClient(timeout=300) as c:
        for attempt in range(2):
            r = await c.post(u.messages_url("/v1/messages"), json=body,
                             headers={**u.auth_headers(), "anthropic-version": "2023-06-01", "content-type": "application/json"})
            if r.status_code != 200:
                raise ValueError(f"Model call failed: HTTP {r.status_code} {r.text[:300]}")
            text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
            try:
                d = _extract_json(text)
                return normalize(d, description)
            except Exception as e:
                last_err = e
                body["messages"] += [{"role": "assistant", "content": text},
                                     {"role": "user", "content": f"That was not valid JSON for the design ({e}). Return only the JSON object."}]
    raise ValueError("The model's reply wasn't a valid design two times in a row. Try again, or rephrase the job.")


def normalize(d: dict, description: str = "") -> dict:
    d = dict(d)
    d["name"] = d.get("name") or "My agent"
    d["slug"] = _slugify(d.get("slug") or d["name"])
    d["description"] = description or d.get("description", "")
    d["catalog_tools"] = [t for t in d.get("catalog_tools", []) if t in CATALOG] or ["files"]
    if "files" not in d["catalog_tools"]:
        d["catalog_tools"].insert(0, "files")
    tools = []
    for t in d.get("custom_tools", [])[:6]:
        t = dict(t)
        t["name"] = re.sub(r"\W", "_", t.get("name", "tool")).strip("_")[:48] or "tool"
        t["problems"] = check_tool(t)
        tools.append(t)
    d["custom_tools"] = tools
    d["skills"] = [{**s, "name": _slugify(s.get("name", "skill"))} for s in d.get("skills", [])[:5]]
    d["workspace_files"] = [f for f in d.get("workspace_files", [])[:12]
                            if f.get("path") and ".." not in f["path"] and not f["path"].startswith("/")]
    d.setdefault("success_criteria", [])
    d.setdefault("sample_prompt", "")
    d.setdefault("system_prompt", "")
    return d


# ---------------------------------------------------------------------------------------------------------- tools
_PY = {"string": "str", "integer": "int", "number": "float", "boolean": "bool"}


def tool_source(t: dict) -> str:
    params = []
    for p in sorted(t.get("parameters", []), key=lambda p: not p.get("required", True)):
        ann = f'Annotated[{_PY.get(p.get("type"), "str")}, {json.dumps(p.get("description", ""))}]'
        name = re.sub(r"\W", "_", p["name"])
        params.append(f"{name}: {ann}" + ("" if p.get("required", True) else " = None"))
    body = textwrap.indent(textwrap.dedent(t.get("code") or "return 'not implemented'").strip("\n"), "        ")
    return (f"    @srv.tool({json.dumps(t.get('description', ''))})\n"
            f"    def {t['name']}({', '.join(params)}):\n{body}\n")


def check_tool(t: dict) -> list[str]:
    """Static checks on generated tool code. The person still reviews it before anything runs."""
    src = "def _f():\n" + textwrap.indent(textwrap.dedent(t.get("code") or "pass"), "    ")
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return [f"syntax error: {e.msg} (line {e.lineno})"]
    problems = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for n in names:
                if n not in ALLOWED_IMPORTS and n.split(".")[0] not in ALLOWED_IMPORTS:
                    problems.append(f"imports {n} (only standard-library modules from the allowlist)")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in BANNED_CALLS:
            problems.append(f"calls {node.func.id}()")
        if isinstance(node, ast.Attribute) and node.attr in ("open", "system", "popen", "remove", "unlink", "rmtree"):
            problems.append(f"calls .{node.attr}() (use WORKSPACE paths with read_text/write_text)")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            problems.append(f"uses {node.attr}")
    return problems


def custom_server_source(d: dict) -> str:
    funcs = "\n".join(tool_source(t) for t in d["custom_tools"])
    return f'''"""Custom tools for {d['name']}, generated by the Agent Builder. Review before running."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

try:
    from lab.mcpkit import Env, ToolServer, stdio_main
except ImportError:
    from mcpkit import Env, ToolServer, stdio_main


def build(env: Env) -> ToolServer:
    srv = ToolServer("custom", {json.dumps(d['summary'] if 'summary' in d else d['name'])})
    WORKSPACE = Path(env.workspace) if env.workspace else Path("workspace")

{funcs}
    return srv


if __name__ == "__main__":
    stdio_main(build)
'''


# ---------------------------------------------------------------------------------------------------------- project
def project_dir(slug: str) -> Path:
    """The folder of a build, always inside my-agents/."""
    return within(BUILDS_DIR, safe_id(_slugify(slug)))


def servers_for(d: dict) -> list[str]:
    s = list(d["catalog_tools"])
    if d["custom_tools"]:
        s.append("custom")
    if d["skills"]:
        s.append("skills")
    return s


def write_project(d: dict, framework_ids: list[str]) -> Path:
    d = normalize(d, d.get("description", ""))
    bad = {t["name"]: t["problems"] for t in d["custom_tools"] if t["problems"]}
    if bad:
        raise ValueError("Fix the custom tool code first: " + json.dumps(bad))
    fws = frameworks()
    p = project_dir(d["slug"])
    if p.exists():
        for child in ("frameworks", "servers", "skills"):
            shutil.rmtree(p / child, ignore_errors=True)
    (p / "servers").mkdir(parents=True, exist_ok=True)
    lab_dir = Path(__file__).parent
    shutil.copy(lab_dir / "mcpkit.py", p / "servers" / "mcpkit.py")
    server_files = {name: f"{name}.py" for name in (*CATALOG, "skills")}  # file names the lab defines, not input
    for s in d["catalog_tools"] + (["skills"] if d["skills"] else []):
        fname = server_files[s]
        shutil.copy(lab_dir / "servers" / fname, p / "servers" / fname)
    if "offers" in d["catalog_tools"]:
        (p / "data").mkdir(exist_ok=True)
        shutil.copy(ROOT / "tasks/bill-doctor/data/offers.json", p / "data/offers.json")
    if d["custom_tools"]:
        (p / "servers" / "custom.py").write_text(custom_server_source(d))
    for sk in d["skills"]:
        sd = within(p, "skills", safe_id(sk["name"]))
        sd.mkdir(parents=True, exist_ok=True)
        (sd / "SKILL.md").write_text(f"---\nname: {sk['name']}\ndescription: {sk.get('description', '')}\n---\n\n{sk.get('body', '')}\n")
    ws = p / "workspace"
    (ws / "outbox").mkdir(parents=True, exist_ok=True)
    for f in d["workspace_files"]:
        try:
            fp = within(ws, f["path"])
        except UnsafePath:
            continue  # a model-written path that would land outside the workspace
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(f.get("content", ""))
    for fid in framework_ids:
        if fid not in fws:
            raise ValueError(f"Unknown framework: {fid}")
        fw = fws[fid]
        src = Path(fw["dir"])
        dst = p / "frameworks" / src.name  # the registry's own folder name, not the request's
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".venv", "node_modules", "__pycache__", "*.pyc"))
    spec = {
        "name": d["name"], "model": config.load().model or config.DEFAULT_MODEL, "max_tokens": 16000, "max_turns": 40,
        "system_prompt": d["system_prompt"], "prompt": d["sample_prompt"],
        "servers": servers_for(d), "skills": [s["name"] for s in d["skills"]], "native_tools": ["calculate"],
        "frameworks": framework_ids,
    }
    (p / "agent.json").write_text(json.dumps(spec, indent=2))
    (p / "design.json").write_text(json.dumps(d, indent=2))
    (p / "run.py").write_text((lab_dir / "export_run.py").read_text())
    (p / ".env.example").write_text("# Anthropic directly\nANTHROPIC_API_KEY=sk-ant-...\n\n# …or a LiteLLM proxy in front of Anthropic\n"
                                    "# ANTHROPIC_BASE_URL=https://your-litellm.example.com\n# ANTHROPIC_API_KEY=sk-your-litellm-key\n")
    (p / ".gitignore").write_text(".env\n.run/\n.venv/\nnode_modules/\n__pycache__/\nworkspace/outbox/*\n!workspace/outbox/.keep\n")
    (ws / "outbox" / ".keep").touch()
    (p / "README.md").write_text(readme(d, framework_ids, fws))
    return p


def readme(d: dict, framework_ids: list[str], fws: dict) -> str:
    rows = "\n".join(f"| `{fid}` | {fws[fid]['name']} | {fws[fid]['language']} | `frameworks/{fid}/{fws[fid].get('entry', 'agent.py')}` |"
                     for fid in framework_ids)
    tools = "\n".join(f"- **{CATALOG[s]['title']}** (`servers/{s}.py`): {CATALOG[s]['description']}" for s in d["catalog_tools"])
    custom = "\n".join(f"- `{t['name']}`: {t.get('description', '')}" for t in d["custom_tools"]) or "- (none)"
    skills = "\n".join(f"- `{s['name']}`: {s.get('description', '')}" for s in d["skills"]) or "- (none)"
    first = framework_ids[0] if framework_ids else "anthropic-sdk"
    return f"""# {d['name']}

{d.get('summary', '')}

Built with the OpenMoney Agent Lab from this request:

> {d.get('description', '').strip()}

The same agent is built on {len(framework_ids)} framework(s). Each `frameworks/<id>/` folder is a complete agent in that
framework's own style; all of them read `agent.json` (instructions, tools, skills) and use the same tool servers in
`servers/` over MCP (stdio), so they do the same job.

| id | Framework | Language | Code |
|---|---|---|---|
{rows}

## Run it

Needs Python 3.11+ and [uv](https://docs.astral.sh/uv/) (and Node 20+ for TypeScript frameworks).

```sh
cp .env.example .env        # put your Anthropic API key in it (or a LiteLLM proxy URL + key)
python3 run.py {first}      # runs the sample request
python3 run.py {first} "your own request"
```

Results the agent writes land in `workspace/outbox/`.

## What it can use

Tool servers:
{tools}

Custom tools (`servers/custom.py`, generated — read it before you run it):
{custom}

Skills (`skills/`):
{skills}

## Instructions

```
{d['system_prompt']}
```

## A good result

""" + "\n".join(f"- {c}" for c in d.get("success_criteria", [])) + "\n"


def _private(rel: Path) -> bool:
    """Never serve or zip a project's secrets (.env, .env.local, …) — only .env.example."""
    return any(part.startswith(".env") and part != ".env.example" for part in rel.parts)


def zip_project(slug: str) -> bytes:
    p = project_dir(slug)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(p.rglob("*")):
            rel = f.relative_to(p)
            if f.is_file() and not _private(rel) and not any(part in (".venv", "node_modules", ".run", "__pycache__", ".git") for part in rel.parts):
                z.write(f, f"{p.name}/{rel}")
    return buf.getvalue()


def tree(slug: str) -> dict:
    p = project_dir(slug)
    files = {}
    for f in sorted(p.rglob("*")):
        rel = f.relative_to(p)
        if f.is_file() and not _private(rel) and not any(part in (".venv", "node_modules", ".run", "__pycache__", ".git") for part in rel.parts):
            if f.suffix in (".lock",) or f.name == "package-lock.json":
                files[str(rel)] = f"({f.stat().st_size:,} bytes — dependency lock file)"
            else:
                files[str(rel)] = f.read_text(errors="replace")[:60000]
    return {"slug": p.name, "path": str(p), "files": files}



# ---------------------------------------------------------------------------------------------------------- test run
def create_build_run(manager: RunManager, body: dict) -> Run:
    p = project_dir(body["slug"])
    slug = p.name
    d = json.loads((p / "design.json").read_text())
    spec = json.loads((p / "agent.json").read_text())
    fws = frameworks()
    ids = body.get("frameworks") or spec["frameworks"]
    run = Run(manager, "build", d["name"], body.get("model") or config.load().model, bool(body.get("interactive")),
              {"slug": slug, "frameworks": ids, "success_criteria": d.get("success_criteria", [])})
    prompt = body.get("prompt") or spec["prompt"]
    servers = spec["servers"]
    custom = {"custom": str(p / "servers" / "custom.py")} if "custom" in servers else {}
    for fid in ids:
        run.add(AgentSlot(run=run, agent_id=fid, framework=fws[fid], label=fws[fid]["name"], prompt=prompt,
                          system_prompt=spec["system_prompt"], workspace_src=p / "workspace",
                          data_dir=(p / "data") if (p / "data").exists() else None, servers=servers,
                          skills=spec.get("skills", []), skills_dir=p / "skills" if (p / "skills").exists() else SKILLS_DIR,
                          custom_servers=custom, max_turns=spec.get("max_turns", 40), timeout_s=600,
                          grader=_judge_for(d, prompt)))
    manager.runs[run.id] = run
    return run


def _judge_for(d: dict, prompt: str):
    criteria = d.get("success_criteria") or []
    if not criteria:
        return None

    def judge(a) -> dict:
        from .tasks.common import Check, summarize

        outbox = a.workspace / "outbox"
        files = {str(f.relative_to(outbox)): f.read_text(errors="replace")[:8000] for f in outbox.rglob("*")
                 if f.is_file() and f.name != ".keep"}
        u = config.load()
        ask = ("Grade an AI agent's work. For each criterion answer pass or fail with a short reason. Reply with JSON only: "
               '{"results": [{"criterion": "...", "pass": true, "reason": "..."}]}\n\n'
               f"Request: {prompt}\n\nCriteria:\n" + "\n".join(f"- {c}" for c in criteria) +
               f"\n\nAgent's final answer:\n{a.final_text[:8000]}\n\nFiles it wrote:\n" +
               "\n".join(f"--- {k}\n{v}" for k, v in files.items())[:30000] +
               "\n\nTools it called: " + ", ".join(sorted({c['name'] for c in a.tool_calls})))
        r = httpx.post(u.messages_url("/v1/messages"), timeout=180,
                       headers={**u.auth_headers(), "anthropic-version": "2023-06-01", "content-type": "application/json"},
                       json={"model": u.model, "max_tokens": 4000, "messages": [{"role": "user", "content": ask}]})
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        res = _extract_json(text).get("results", [])
        checks = [Check(f"c{i + 1}", x.get("criterion", criteria[i] if i < len(criteria) else "?"), 1,
                        1 if x.get("pass") else 0, x.get("reason", "")) for i, x in enumerate(res)]
        out = summarize(checks, pass_score=70)
        out["judge"] = "model-graded against the design's success criteria"
        return out

    return judge
