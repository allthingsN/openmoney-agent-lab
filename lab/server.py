"""The lab server: UI, API, live event stream, metering proxy and MCP tool servers on one port."""

from __future__ import annotations

import asyncio
import gzip
import json
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from . import config, proxy
from .runs import RunManager, frameworks, tasks

ROOT = config.ROOT
WEB_DIST = ROOT / "web" / "dist"
RESULTS_DIR = ROOT / "results"

app = FastAPI(title="OpenMoney Agent Lab", docs_url="/api/docs", openapi_url="/api/openapi.json")
manager = RunManager(port=int(os.environ.get("LAB_PORT", "7777")), concurrency=int(os.environ.get("LAB_CONCURRENCY", "4")))


# --------------------------------------------------------------------------------------------- settings
@app.get("/api/health")
def health():
    return {"ok": True, "upstream": config.load().masked()}


@app.get("/api/config")
def get_config():
    return {"upstream": config.load().masked(), "models": config.MODELS}


@app.post("/api/config")
async def set_config(req: Request):
    body = await req.json()
    cur = config.load()
    provider = body.get("provider", cur.provider)
    key = body.get("api_key") or ""
    if not key or "…" in key:
        key = cur.api_key
    base = body.get("base_url") or ("https://api.anthropic.com" if provider == "anthropic" else cur.base_url)
    u = config.Upstream(provider=provider, api_key=key.strip(), base_url=base.strip(), model=body.get("model", cur.model))
    config.save(u)
    return {"upstream": config.load().masked()}


@app.post("/api/config/test")
async def test_config():
    u = config.load()
    if not u.configured:
        return {"ok": False, "message": "No key configured."}
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(u.messages_url("/v1/messages"),
                             headers={**u.auth_headers(), "anthropic-version": "2023-06-01", "content-type": "application/json"},
                             json={"model": u.model, "max_tokens": 64, "messages": [{"role": "user", "content": "Reply with: ready"}]})
        if r.status_code == 200:
            j = r.json()
            text = "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text")
            return {"ok": True, "message": f"{j.get('model')} says: {text.strip()[:60]}"}
        return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:300]}"}
    except Exception as e:
        return {"ok": False, "message": f"{type(e).__name__}: {e}"}


# --------------------------------------------------------------------------------------------- catalog
@app.get("/api/frameworks")
def list_frameworks():
    return {"frameworks": list(frameworks().values())}


@app.get("/api/frameworks/{fid}/source")
def framework_source(fid: str):
    fw = frameworks().get(fid)
    if not fw:
        raise HTTPException(404)
    d = Path(fw["dir"])
    files = {}
    for name in [fw.get("entry", "agent.py")] + fw.get("extra_files", []):
        p = d / name
        if p.exists():
            files[name] = p.read_text()
    return {"framework": fid, "files": files}


@app.get("/api/tasks")
def list_tasks():
    return {"tasks": list(tasks().values())}


@app.get("/api/skills")
def list_skills():
    from .servers.skills import index, parse_skill

    out = []
    for s in index(ROOT / "skills"):
        _, body = parse_skill((ROOT / "skills" / s["name"] / "SKILL.md").read_text())
        out.append({**s, "body": body})
    return {"skills": out}


# --------------------------------------------------------------------------------------------- runs
@app.post("/api/runs")
async def create_run(req: Request):
    b = await req.json()
    kind = b.get("kind", "bench")
    if not config.load().configured and not b.get("allow_unconfigured"):
        raise HTTPException(400, "Add your Anthropic key (or LiteLLM proxy) in Settings first.")
    if kind == "bench":
        fws = b.get("frameworks") or []
        if not fws:
            raise HTTPException(400, "Pick at least one framework.")
        run = manager.create_bench(b["task"], fws, int(b.get("trials", 1)), b.get("model"), bool(b.get("interactive")))
    elif kind == "mission":
        from .mission import create_mission

        run = create_mission(manager, b)
    elif kind == "build":
        from .builder import create_build_run

        run = create_build_run(manager, b)
    else:
        raise HTTPException(400, f"unknown kind {kind}")
    if kind == "mission":
        from .mission import start_mission

        start_mission(manager, run)
    else:
        manager.start(run)
    return run.info()


def _disk_runs() -> list[dict]:
    out = []
    if config.RUNS_DIR.exists():
        for p in sorted(config.RUNS_DIR.glob("*/summary.json"), reverse=True)[:200]:
            try:
                out.append(json.loads(p.read_text()))
            except Exception:
                pass
    return out


@app.get("/api/runs")
def list_runs():
    live = {r.id: r.info() for r in manager.runs.values()}
    disk = [r for r in _disk_runs() if r["id"] not in live]
    rows = sorted(list(live.values()) + disk, key=lambda r: r.get("created", 0), reverse=True)
    for r in rows:
        for a in r.get("agents", []):
            a.pop("grade", None)
            a.pop("final_text", None)
    return {"runs": rows}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    if run_id in manager.runs:
        return manager.runs[run_id].info()
    p = config.RUNS_DIR / run_id / "summary.json"
    if p.exists():
        return json.loads(p.read_text())
    raise HTTPException(404)


def _read_events(path: Path) -> list[dict]:
    if not path.exists():
        return []
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt") as f:
        return [json.loads(line) for line in f if line.strip()]


async def _sse(events_iter):
    async for ev in events_iter:
        yield f"data: {json.dumps(ev, default=str)}\n\n"


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, request: Request, after: int = -1):
    run = manager.runs.get(run_id)

    async def gen():
        if run is None:
            for ev in _read_events(config.RUNS_DIR / run_id / "events.jsonl"):
                if ev["seq"] > after:
                    yield ev
            yield {"type": "stream.end", "run": run_id}
            return
        q = run.log.subscribe()
        try:
            for ev in list(run.log.events):
                if ev["seq"] > after:
                    yield ev
            if run.log.closed:
                yield {"type": "stream.end", "run": run_id}
                return
            while True:
                if await request.is_disconnected():
                    return
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield {"type": "ping"}
                    continue
                if ev.get("seq", -1) > after or ev.get("type") == "stream.end":
                    yield ev
                if ev.get("type") == "stream.end":
                    return
        finally:
            run.log.unsubscribe(q)

    return StreamingResponse(_sse(gen()), media_type="text/event-stream",
                             headers={"cache-control": "no-cache", "x-accel-buffering": "no"})


@app.post("/api/runs/{run_id}/agents/{agent_id}/events")
async def agent_event(run_id: str, agent_id: str, req: Request):
    try:
        slot = manager.slot(run_id, agent_id)
    except KeyError:
        raise HTTPException(404)
    if req.headers.get("authorization", "").removeprefix("Bearer ").strip() != slot.token:
        raise HTTPException(401)
    body = await req.json()
    for ev in body if isinstance(body, list) else [body]:
        slot.framework_event(ev)
    return {"ok": True}


@app.post("/api/runs/{run_id}/agents/{agent_id}/control")
async def agent_control(run_id: str, agent_id: str, req: Request):
    b = await req.json()
    run = manager.runs.get(run_id)
    if not run:
        raise HTTPException(404)
    targets = list(run.agents.values()) if agent_id == "*" else [run.agents[agent_id]]
    for s in targets:
        s.control(b.get("action", ""))
    return {"ok": True}


@app.post("/api/runs/{run_id}/approvals/{aid}")
async def decide(run_id: str, aid: str, req: Request):
    b = await req.json()
    run = manager.runs.get(run_id)
    fut = run and run.approvals.get(aid)
    if not fut or fut.done():
        raise HTTPException(404, "No pending approval with that id")
    fut.set_result((bool(b.get("approved")), b.get("note", "")))
    return {"ok": True}


@app.get("/api/runs/{run_id}/agents/{agent_id}/llm/{n}")
def llm_bodies(run_id: str, agent_id: str, n: int):
    d = config.RUNS_DIR / run_id / "agents" / agent_id / "llm"
    out = {}
    for kind in ("request", "response"):
        p = d / f"{n:03d}-{kind}.json"
        if p.exists():
            out[kind] = json.loads(p.read_text())
    if not out:
        raise HTTPException(404)
    return out


@app.get("/api/runs/{run_id}/agents/{agent_id}/outbox")
def outbox(run_id: str, agent_id: str):
    d = config.RUNS_DIR / run_id / "agents" / agent_id / "workspace" / "outbox"
    files = {}
    if d.exists():
        for p in sorted(d.rglob("*")):
            if p.is_file() and p.name != ".keep":
                files[str(p.relative_to(d))] = p.read_text(errors="replace")[:200000]
    return {"files": files}


@app.get("/api/runs/{run_id}/outbox")
def run_outbox(run_id: str):
    """The run's shared workspace outbox (missions: every role writes to one workspace)."""
    d = config.RUNS_DIR / run_id / "workspace" / "outbox"
    files = {}
    if d.exists():
        for p in sorted(d.rglob("*")):
            if p.is_file() and p.name != ".keep":
                files[str(p.relative_to(d))] = p.read_text(errors="replace")[:200000]
    return {"files": files}


# --------------------------------------------------------------------------------------------- builder
@app.get("/api/builder")
def builder_list():
    from . import builder as B

    out = []
    if B.BUILDS_DIR.exists():
        for d in sorted(B.BUILDS_DIR.glob("*/design.json")):
            try:
                j = json.loads(d.read_text())
                spec = json.loads((d.parent / "agent.json").read_text())
                out.append({"slug": d.parent.name, "name": j.get("name"), "summary": j.get("summary"), "frameworks": spec.get("frameworks", []),
                            "modified": d.stat().st_mtime})
            except Exception:
                pass
    return {"builds": sorted(out, key=lambda b: -b["modified"]), "catalog": B.CATALOG}


@app.post("/api/builder/design")
async def builder_design(req: Request):
    from . import builder as B

    b = await req.json()
    if not (b.get("description") or "").strip():
        raise HTTPException(400, "Describe the job first.")
    try:
        return {"design": await B.design(b["description"], b.get("model"))}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/builder/check")
async def builder_check(req: Request):
    from . import builder as B

    return {"design": B.normalize((await req.json())["design"])}


@app.post("/api/builder/build")
async def builder_build(req: Request):
    from . import builder as B

    b = await req.json()
    if not b.get("frameworks"):
        raise HTTPException(400, "Pick at least one framework.")
    try:
        p = B.write_project(b["design"], b["frameworks"])
    except ValueError as e:
        raise HTTPException(400, str(e))
    return B.tree(p.name)


@app.get("/api/builder/{slug}")
def builder_get(slug: str):
    from . import builder as B

    if not B.project_dir(slug).exists():
        raise HTTPException(404)
    t = B.tree(slug)
    t["design"] = json.loads((B.project_dir(slug) / "design.json").read_text())
    return t


@app.get("/api/builder/{slug}/zip")
def builder_zip(slug: str):
    from . import builder as B

    if not B.project_dir(slug).exists():
        raise HTTPException(404)
    return Response(B.zip_project(slug), media_type="application/zip",
                    headers={"content-disposition": f'attachment; filename="{B.project_dir(slug).name}.zip"'})


@app.post("/api/builder/{slug}/github")
async def builder_github(slug: str, req: Request):
    from . import builder as B

    b = await req.json()
    try:
        return B.publish_github(slug, b["repo"], bool(b.get("private", True)))
    except ValueError as e:
        raise HTTPException(400, str(e))


# --------------------------------------------------------------------------------------------- missions
@app.get("/api/missions")
def list_missions():
    from .mission import missions

    return {"missions": list(missions().values())}


@app.post("/api/runs/{run_id}/mission/{action}")
async def mission_action(run_id: str, action: str, req: Request):
    from . import mission as M

    run = manager.runs.get(run_id)
    if not run or run.kind != "mission":
        raise HTTPException(404)
    b = await req.json()
    if action == "gate":
        if not M.decide_gate(run, bool(b.get("approved", True)), b.get("note", "")):
            raise HTTPException(409, "Nothing is waiting for approval")
    elif action == "comment":
        M.person_comment(run, b["task_id"], b["text"])
    elif action == "rework":
        M.person_rework(run, b["task_id"], b.get("reason", ""))
    else:
        raise HTTPException(400)
    return {"ok": True}


# --------------------------------------------------------------------------------------------- published results
@app.get("/api/results")
def results_index():
    p = RESULTS_DIR / "index.json"
    return json.loads(p.read_text()) if p.exists() else {"benchmarks": []}


@app.get("/api/results/{bench_id}")
def result(bench_id: str):
    p = RESULTS_DIR / bench_id / "summary.json"
    if not p.exists():
        raise HTTPException(404)
    return json.loads(p.read_text())


@app.get("/api/results/{bench_id}/events")
async def result_events(bench_id: str, speed: float = 0):
    p = RESULTS_DIR / bench_id / "events.jsonl.gz"
    evs = _read_events(p)

    async def gen():
        prev = None
        for ev in evs:
            if speed and prev is not None:
                await asyncio.sleep(min(2.0, max(0.0, (ev["ts"] - prev) / speed)))
            prev = ev["ts"]
            yield ev
        yield {"type": "stream.end", "run": bench_id}

    return StreamingResponse(_sse(gen()), media_type="text/event-stream", headers={"cache-control": "no-cache"})


@app.get("/api/results/{bench_id}/outbox/{agent_id}")
def result_outbox(bench_id: str, agent_id: str):
    """A published agent's outbox files (results/<id>/outbox/<agent>.json), so replays show what it wrote."""
    p = RESULTS_DIR / bench_id / "outbox" / f"{agent_id}.json"
    if ".." in bench_id or ".." in agent_id or not p.exists():
        return {"files": {}}
    return {"files": json.loads(p.read_text())}


@app.get("/api/results/{bench_id}/llm/{agent_id}/{n}")
def result_llm(bench_id: str, agent_id: str, n: int):
    p = RESULTS_DIR / bench_id / "llm" / agent_id / f"{n:03d}.json.gz"
    if not p.exists():
        raise HTTPException(404)
    with gzip.open(p, "rt") as f:
        return json.load(f)


# --------------------------------------------------------------------------------------------- proxy + MCP
@app.api_route("/llm/{run_id}/{agent_id}/{path:path}", methods=["GET", "POST"])
async def llm(run_id: str, agent_id: str, path: str, req: Request):
    try:
        slot = manager.slot(run_id, agent_id)
    except KeyError:
        return JSONResponse({"type": "error", "error": {"type": "not_found_error", "message": "unknown lab agent"}}, 404)
    return await proxy.handle(req, slot, "/" + path)


@app.api_route("/mcp/{run_id}/{agent_id}/{server}", methods=["GET", "POST", "DELETE"])
@app.api_route("/mcp/{run_id}/{agent_id}/{server}/", methods=["GET", "POST", "DELETE"], include_in_schema=False)
async def mcp(run_id: str, agent_id: str, server: str, req: Request):
    if req.method == "GET":
        return Response(status_code=405, headers={"allow": "POST"})
    if req.method == "DELETE":
        return Response(status_code=200)
    try:
        slot = manager.slot(run_id, agent_id)
        srv = slot.server(server)
    except KeyError:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": "unknown server"}}, 404)
    try:
        payload = await req.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, 400)
    resp = await srv.handle_payload(payload, slot.ctx(server))
    if resp is None:
        return Response(status_code=202)
    accept = req.headers.get("accept", "")
    if "application/json" not in accept and "text/event-stream" in accept:
        return Response(f"event: message\ndata: {json.dumps(resp)}\n\n", media_type="text/event-stream")
    return JSONResponse(resp)


# --------------------------------------------------------------------------------------------- UI
@app.get("/{path:path}", include_in_schema=False)
def ui(path: str):
    f = WEB_DIST / path
    if path and f.is_file():
        return FileResponse(f)
    idx = WEB_DIST / "index.html"
    if idx.exists():
        return FileResponse(idx)
    return Response("<h1>OpenMoney Agent Lab</h1><p>The UI isn't built yet. Run <code>./lab.sh</code> "
                    "(or <code>cd web && npm install && npm run build</code>).</p>", media_type="text/html")
