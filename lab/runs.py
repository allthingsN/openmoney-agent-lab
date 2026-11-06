"""Runs: start framework agents as subprocesses, give each its own tools and proxy, watch, grade, summarize."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import secrets
import shutil
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import yaml

from . import config
from .events import RunLog, preview
from .mcpkit import CallContext, Env, ToolServer

_log = logging.getLogger("agent-lab")
ROOT = config.ROOT
FRAMEWORKS_DIR = ROOT / "frameworks"
TASKS_DIR = ROOT / "tasks"
SKILLS_DIR = ROOT / "skills"

SERVER_MODULES = {
    "files": "lab.servers.files",
    "offers": "lab.servers.offers",
    "ops": "lab.servers.ops",
    "skills": "lab.servers.skills",
    "board": "lab.servers.board",
    "toolbox": "lab.servers.toolbox",
}

QUIET_ENV = {
    "DO_NOT_TRACK": "1",
    "CREWAI_DISABLE_TELEMETRY": "true",
    "CREWAI_TRACING_ENABLED": "false",
    "OTEL_SDK_DISABLED": "true",
    "ANONYMIZED_TELEMETRY": "false",
    "OPENAI_AGENTS_DISABLE_TRACING": "1",
    "LANGCHAIN_TRACING_V2": "false",
    "LANGSMITH_TRACING": "false",
    "LITELLM_LOG": "ERROR",
    "MASTRA_TELEMETRY_DISABLED": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_AUTOUPDATER": "1",
    "PYTHONUNBUFFERED": "1",
    "NO_COLOR": "1",
    "GOOGLE_API_USE_CLIENT_CERTIFICATE": "false",  # skips google-adk's ~9 s mTLS probe on machines without GCP creds
}


# ---------------------------------------------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------------------------------------------

def frameworks() -> dict[str, dict]:
    out = {}
    for f in sorted(FRAMEWORKS_DIR.glob("*/framework.json")):
        meta = json.loads(f.read_text())
        meta["dir"] = str(f.parent)
        meta["installed"] = _installed(meta)
        entry = f.parent / meta.get("entry", "agent.py")
        meta["loc"] = sum(1 for line in entry.read_text().splitlines() if line.strip() and not line.strip().startswith(("#", "//"))) if entry.exists() else 0
        out[meta["id"]] = meta
    return out


def _installed(meta: dict) -> bool:
    d = Path(meta["dir"])
    return (d / ".venv").exists() if meta.get("language") == "python" else (d / "node_modules").exists()


def tasks() -> dict[str, dict]:
    out = {}
    for f in sorted(TASKS_DIR.glob("*/task.yaml")):
        t = yaml.safe_load(f.read_text())
        t["dir"] = str(f.parent)
        out[t["id"]] = t
    return out


def grader_for(task_id: str) -> Callable | None:
    mod = {"bill-doctor": "lab.tasks.bill_doctor", "incident-commander": "lab.tasks.incident_commander"}.get(task_id)
    return importlib.import_module(mod).grade if mod else None


def skills_section(names: list[str], mode: str, skills_dir: Path | None = None) -> str:
    from .servers.skills import index

    idx = [s for s in index(skills_dir or SKILLS_DIR) if s["name"] in names]
    if not idx:
        return ""
    how = ("Load a skill with the Skill tool." if mode == "native"
           else "Load a skill with the `load_skill` tool (and `read_skill_file` for files it links to).")
    lines = "\n".join(f"- **{s['name']}**: {s['description']}" for s in idx)
    return f"\n\n## Skills\n{how} Available skills:\n{lines}\n"


# ---------------------------------------------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------------------------------------------

def _metrics() -> dict:
    return {"llm_calls": 0, "llm_errors": 0, "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
            "cache_write_tokens": 0, "cost_usd": 0.0, "llm_ms": 0.0, "tool_calls": 0, "tool_errors": 0,
            "skill_loads": 0, "wall_s": 0.0}


@dataclass
class AgentSlot:
    run: "Run"
    agent_id: str
    framework: dict
    label: str
    prompt: str
    system_prompt: str
    workspace_src: Path | None
    data_dir: Path | None
    servers: list[str]
    skills: list[str]
    native_tools: list[str] = field(default_factory=lambda: ["calculate"])
    max_turns: int = 40
    timeout_s: int = 900
    grader: Callable | None = None
    role: str | None = None
    extra_spec: dict = field(default_factory=dict)
    workspace_dir: Path | None = None  # shared workspace (missions); default: the agent's own copy
    skills_dir: Path | None = None     # default: the repo's skills/
    custom_servers: dict = field(default_factory=dict)  # name -> path of a generated mcpkit server file
    token: str = field(default_factory=lambda: "lab-" + secrets.token_urlsafe(18))
    status: str = "queued"
    metrics: dict = field(default_factory=_metrics)
    tool_calls: list = field(default_factory=list)
    state: dict = field(default_factory=dict)
    final_text: str = ""
    grade: dict | None = None
    exit_code: int | None = None
    error: str | None = None
    _servers: dict = field(default_factory=dict)
    _llm_seq: int = 0
    _paused: bool = False
    _step: int = 0
    _resume: asyncio.Event = field(default_factory=asyncio.Event)
    proc: Any = None
    started_at: float | None = None

    @property
    def log(self) -> RunLog:
        return self.run.log

    @property
    def dir(self) -> Path:
        return self.run.dir / "agents" / self.agent_id

    @property
    def workspace(self) -> Path:
        return self.workspace_dir or (self.dir / "workspace")

    @property
    def shims(self) -> list[str]:
        return list(self.framework.get("shims", []))

    def next_llm_seq(self) -> int:
        self._llm_seq += 1
        return self._llm_seq

    def save_llm(self, n: int, kind: str, body: Any) -> None:
        p = self.dir / "llm" / f"{n:03d}-{kind}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(body, indent=1, default=str))

    # -- pause / step --------------------------------------------------------------------------------------------
    async def gate(self) -> None:
        while self._paused and self._step <= 0:
            if self.status not in ("running", "paused"):
                return
            if self.status != "paused":
                self.log.emit(self.agent_id, "agent.paused", {"held": "next model call"})
            self.status = "paused"
            self._resume.clear()
            await self._resume.wait()
        if self._paused and self._step > 0:
            self._step -= 1
        if self.status == "paused":
            self.status = "running"
            self.log.emit(self.agent_id, "agent.resumed", {})

    def control(self, action: str) -> None:
        if action == "pause":
            self._paused = True
        elif action == "resume":
            self._paused = False
            self._resume.set()
        elif action == "step":
            self._paused = True
            self._step += 1
            self._resume.set()
        elif action == "stop" and self.proc and self.proc.returncode is None:
            self.error = "stopped by a person"
            self.proc.kill()
            self._paused = False
            self._resume.set()
        self.log.emit(self.agent_id, "agent.control", {"action": action})

    # -- tools ---------------------------------------------------------------------------------------------------
    def server(self, name: str) -> ToolServer:
        if name in self._servers:
            return self._servers[name]
        if name not in self.servers:
            raise KeyError(name)
        if name in self.custom_servers:
            spec_ = importlib.util.spec_from_file_location(f"lab_custom_{self.run.id}_{name}".replace("-", "_"), self.custom_servers[name])
            mod = importlib.util.module_from_spec(spec_)
            spec_.loader.exec_module(mod)
        else:
            mod = importlib.import_module(SERVER_MODULES[name])
        state = self.run.shared if name == "board" else self.state
        if name == "skills":
            state.setdefault("skills_allowed", self.skills)
        env = Env(workspace=self.workspace, data_dir=self.data_dir, skills_dir=self.skills_dir or SKILLS_DIR, state=state,
                  emit=lambda t, d: self._server_event(t, d), approve=self._approve)
        if name == "board":
            env.state.setdefault("_agent", {})
        srv = mod.build(env)
        srv.before_call.append(self._before_tool)
        srv.after_call.append(self._after_tool)
        self._servers[name] = srv
        return srv

    def ctx(self, server: str) -> CallContext:
        return CallContext(server=server, run_id=self.run.id, agent_id=self.agent_id, extra={"role": self.role})

    def _server_event(self, type_: str, data: dict) -> None:
        if type_ == "skill.load":
            self.metrics["skill_loads"] += 1
        self.log.emit(self.agent_id, type_, data)

    def _before_tool(self, ctx: CallContext, name: str, args: dict):
        self.log.emit(self.agent_id, "tool.start", {"server": ctx.server, "name": name, "args": args})

    def _after_tool(self, ctx, name, args, out, ms, is_error):
        text = "".join(c.get("text", "") for c in out.get("content", []))
        self._record_tool(ctx.server, name, args, text, ms, is_error)

    def _record_tool(self, server, name, args, text, ms, is_error):
        self.metrics["tool_calls"] += 1
        if is_error:
            self.metrics["tool_errors"] += 1
        self.tool_calls.append({"server": server, "name": name, "args": args, "result": text[:20000],
                                "error": is_error, "ms": round(ms, 1), "t": time.time()})
        self.log.emit(self.agent_id, "tool.end", {"server": server, "name": name, "args": args,
                                                  "result": preview(text, 1200), "ms": round(ms, 1), "error": is_error})

    async def _approve(self, action: str, detail: dict) -> tuple[bool, str]:
        if not self.run.interactive:
            return True, ""
        aid = "apr_" + secrets.token_hex(4)
        fut = asyncio.get_running_loop().create_future()
        self.run.approvals[aid] = fut
        self.log.emit(self.agent_id, "approval.request", {"id": aid, "action": action, "detail": detail})
        try:
            ok, note = await asyncio.wait_for(fut, timeout=600)
        except asyncio.TimeoutError:
            ok, note = False, "no answer within 10 minutes"
        self.log.emit(self.agent_id, "approval.decision", {"id": aid, "approved": ok, "note": note})
        return ok, note

    # -- native tools and framework events ---------------------------------------------------------------------
    def framework_event(self, ev: dict) -> None:
        t = ev.get("type", "agent.note")
        d = ev.get("data") or {}
        if t == "tool.end":
            self._record_tool(d.get("server", "native"), d.get("name", "?"), d.get("args", {}), str(d.get("result", "")),
                              d.get("ms", 0), bool(d.get("error")))
            return
        if t == "agent.final":
            self.final_text = d.get("text", "")
        if t == "skill.load":
            self.metrics["skill_loads"] += 1
        self.log.emit(self.agent_id, t, d)

    # -- spec ----------------------------------------------------------------------------------------------------
    def spec(self) -> dict:
        port = self.run.manager.port
        base = f"http://127.0.0.1:{port}"
        mode = "native" if self.framework.get("skills") == "native" else "mcp"
        servers = [s for s in self.servers if not (s == "skills" and mode == "native")]
        sp = self.system_prompt + (skills_section(self.skills, mode, self.skills_dir) if self.skills else "")
        spec = {
            "agent_id": self.agent_id,
            "run_id": self.run.id,
            "framework": self.framework["id"],
            "model": self.run.model,
            "max_tokens": 16000,
            "max_turns": self.max_turns,
            "system_prompt": sp,
            "prompt": self.prompt,
            "mcp_servers": [{"name": s, "transport": "http", "url": f"{base}/mcp/{self.run.id}/{self.agent_id}/{s}"}
                            for s in servers],
            "skills": {"mode": mode, "names": self.skills, "dir": str(self.dir / ".claude" / "skills")},
            "native_tools": self.native_tools,
            "events_url": f"{base}/api/runs/{self.run.id}/agents/{self.agent_id}/events",
            "events_token": self.token,
            "workdir": str(self.dir),
        }
        spec.update(self.extra_spec)
        return spec

    def prepare(self) -> dict:
        self.dir.mkdir(parents=True, exist_ok=True)
        if self.workspace_dir:
            pass
        elif self.workspace_src and not self.workspace.exists():
            shutil.copytree(self.workspace_src, self.workspace)
        else:
            self.workspace.mkdir(parents=True, exist_ok=True)
        (self.workspace / "outbox").mkdir(exist_ok=True)
        spec = self.spec()
        if spec["skills"]["mode"] == "native":
            dst = Path(spec["skills"]["dir"])
            dst.mkdir(parents=True, exist_ok=True)
            for n in self.skills:
                if not (dst / n).exists():
                    shutil.copytree((self.skills_dir or SKILLS_DIR) / n, dst / n)
        (self.dir / "agent.json").write_text(json.dumps(spec, indent=2))
        return spec

    def child_env(self) -> dict:
        port = self.run.manager.port
        env = {k: v for k, v in os.environ.items() if not k.startswith(("ANTHROPIC_", "LITELLM_", "OPENAI_", "CLAUDE_"))}
        env.update(QUIET_ENV)
        env.update({
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{port}/llm/{self.run.id}/{self.agent_id}",
            "ANTHROPIC_API_KEY": self.token,
            "LAB_SPEC": str(self.dir / "agent.json"),
            "LAB_MODEL": self.run.model,
            "CLAUDE_CONFIG_DIR": str(self.dir / ".claude-config"),
            "HOME": os.environ.get("HOME", str(self.dir)),
        })
        return env

    def summary(self) -> dict:
        m = dict(self.metrics)
        m["llm_ms"] = round(m["llm_ms"])
        by_server: dict[str, int] = {}
        for c in self.tool_calls:
            by_server[c["server"]] = by_server.get(c["server"], 0) + 1
        return {
            "agent_id": self.agent_id, "framework": self.framework["id"], "framework_name": self.framework["name"],
            "label": self.label, "role": self.role, "status": self.status, "exit_code": self.exit_code,
            "error": self.error, "metrics": m, "tools_by_server": by_server,
            "score": self.grade.get("score") if self.grade else None,
            "passed": self.grade.get("passed") if self.grade else None,
            "grade": self.grade, "final_text": self.final_text[-4000:],
            "loc": self.framework.get("loc"), "shims": self.shims,
        }


# ---------------------------------------------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------------------------------------------

class Run:
    def __init__(self, manager: "RunManager", kind: str, title: str, model: str, interactive: bool, meta: dict | None = None):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        self.id = f"{kind[:1]}{stamp}-{secrets.token_hex(2)}"
        self.manager = manager
        self.kind = kind
        self.title = title
        self.model = model
        self.interactive = interactive
        self.meta = meta or {}
        self.dir = config.RUNS_DIR / self.id
        self.log = RunLog(self.id, self.dir / "events.jsonl")
        self.agents: dict[str, AgentSlot] = {}
        self.shared: dict = {}
        self.approvals: dict[str, asyncio.Future] = {}
        self.status = "created"
        self.created = time.time()
        self.finished: float | None = None
        self.task: asyncio.Task | None = None

    def add(self, slot: AgentSlot) -> AgentSlot:
        self.agents[slot.agent_id] = slot
        return slot

    def info(self) -> dict:
        return {"id": self.id, "kind": self.kind, "title": self.title, "model": self.model, "status": self.status,
                "interactive": self.interactive, "meta": self.meta, "created": self.created, "finished": self.finished,
                "agents": [a.summary() for a in self.agents.values()]}

    def save(self) -> None:
        (self.dir / "summary.json").write_text(json.dumps(self.info(), indent=1, default=str))


class RunManager:
    def __init__(self, port: int = 7777, concurrency: int = 4):
        self.port = port
        self.runs: dict[str, Run] = {}
        self.sem = asyncio.Semaphore(concurrency)
        self._setup_locks: dict[str, asyncio.Lock] = {}

    def get(self, run_id: str) -> Run:
        return self.runs[run_id]

    def slot(self, run_id: str, agent_id: str) -> AgentSlot:
        return self.runs[run_id].agents[agent_id]

    # -- framework environments --------------------------------------------------------------------------------
    async def ensure_framework(self, fw: dict, log: RunLog | None = None) -> bool:
        if _installed(fw):
            return True
        lock = self._setup_locks.setdefault(fw["id"], asyncio.Lock())
        async with lock:
            if _installed(fw):
                return True
            cmd = [c.replace("{dir}", fw["dir"]) for c in fw["setup"]]
            if log:
                log.emit(None, "setup.start", {"framework": fw["id"], "cmd": " ".join(cmd)})
            proc = await asyncio.create_subprocess_exec(*cmd, cwd=fw["dir"], stdout=asyncio.subprocess.PIPE,
                                                        stderr=asyncio.subprocess.STDOUT)
            tail = []
            async for line in proc.stdout:
                s = line.decode(errors="replace").rstrip()
                tail = (tail + [s])[-40:]
                if log:
                    log.emit(None, "setup.log", {"framework": fw["id"], "line": s[:300]})
            rc = await proc.wait()
            if log:
                log.emit(None, "setup.end", {"framework": fw["id"], "ok": rc == 0})
            if rc != 0:
                raise RuntimeError(f"setup of {fw['id']} failed:\n" + "\n".join(tail))
            return True

    # -- runs ---------------------------------------------------------------------------------------------------
    def create_bench(self, task_id: str, framework_ids: list[str], trials: int = 1, model: str | None = None,
                     interactive: bool = False) -> Run:
        t = tasks()[task_id]
        fws = frameworks()
        run = Run(self, "bench", t["title"], model or config.load().model, interactive,
                  {"task": task_id, "frameworks": framework_ids, "trials": trials})
        for fid in framework_ids:
            for i in range(1, trials + 1):
                aid = f"{fid}-{i}" if trials > 1 else fid
                run.add(AgentSlot(
                    run=run, agent_id=aid, framework=fws[fid], label=fws[fid]["name"] + (f" #{i}" if trials > 1 else ""),
                    prompt=t["prompt"], system_prompt=t["system_prompt"],
                    workspace_src=Path(t["dir"]) / "workspace", data_dir=Path(t["dir"]) / "data",
                    servers=t["servers"], skills=t.get("skills", []), native_tools=t.get("native_tools", ["calculate"]),
                    max_turns=t.get("max_turns", 40), timeout_s=t.get("timeout_s", 900), grader=grader_for(task_id),
                ))
        self.runs[run.id] = run
        return run

    def start(self, run: Run) -> None:
        run.task = asyncio.create_task(self._run_all(run))

    async def _run_all(self, run: Run) -> None:
        run.status = "running"
        run.log.emit(None, "run.start", {"kind": run.kind, "title": run.title, "model": run.model,
                                         "agents": [{"id": a.agent_id, "framework": a.framework["id"], "label": a.label,
                                                     "role": a.role, "color": a.framework.get("color")}
                                                    for a in run.agents.values()]})
        await asyncio.gather(*(self.run_agent(a) for a in run.agents.values()))
        self.finish(run)

    def finish(self, run: Run) -> None:
        run.status = "done"
        run.finished = time.time()
        run.save()
        run.log.emit(None, "run.end", {"agents": [a.summary() for a in run.agents.values()]})
        run.log.close()

    async def run_agent(self, slot: AgentSlot) -> None:
        async with self.sem:
            await self._run_agent(slot)

    async def _run_agent(self, slot: AgentSlot) -> None:
        log = slot.log
        fw = slot.framework
        try:
            await self.ensure_framework(fw, log)
        except Exception:
            _log.exception("framework setup failed: %s", fw["id"])
            slot.status, slot.error = "error", f"Installing {fw['name']} failed; see the setup log above."
            log.emit(slot.agent_id, "agent.error", {"error": slot.error})
            return
        spec = slot.prepare()
        cmd = [c.replace("{dir}", fw["dir"]).replace("{spec}", str(slot.dir / "agent.json")) for c in fw["run"]]
        slot.status = "running"
        slot.started_at = time.time()
        log.emit(slot.agent_id, "agent.start", {"framework": fw["id"], "label": slot.label, "role": slot.role,
                                                "model": spec["model"], "servers": [s["name"] for s in spec["mcp_servers"]],
                                                "skills": spec["skills"], "prompt": slot.prompt[:4000],
                                                "system_prompt": spec["system_prompt"][:6000]})
        try:
            slot.proc = await asyncio.create_subprocess_exec(*cmd, cwd=str(slot.dir), env=slot.child_env(),
                                                             stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)

            async def pump(stream, level):
                async for line in stream:
                    s = line.decode(errors="replace").rstrip()
                    if s:
                        log.emit(slot.agent_id, "agent.log", {"level": level, "line": s[:2000]})

            pumps = asyncio.gather(pump(slot.proc.stdout, "out"), pump(slot.proc.stderr, "err"))
            try:
                await asyncio.wait_for(slot.proc.wait(), timeout=slot.timeout_s)
            except asyncio.TimeoutError:
                slot.error = f"timed out after {slot.timeout_s}s"
                slot.proc.kill()
                await slot.proc.wait()
            await pumps
            slot.exit_code = slot.proc.returncode
            slot.status = "done" if slot.exit_code == 0 and not slot.error else "error"
            if slot.exit_code and not slot.error:
                errs = [e["data"]["line"] for e in log.events if e["agent"] == slot.agent_id and e["type"] == "agent.log"
                        and e["data"]["level"] == "err"][-12:]
                slot.error = f"exit code {slot.exit_code}: " + "\n".join(errs)[-1500:]
        except Exception:  # pragma: no cover
            _log.exception("agent %s failed to run", slot.agent_id)
            slot.status, slot.error = "error", "The agent process could not be started; see the lab's log."
        slot.metrics["wall_s"] = round(time.time() - slot.started_at, 1)
        if slot.grader:
            try:
                from .tasks.common import Artifacts

                serializable_state = json.loads(json.dumps(slot.state, default=str))
                slot.grade = slot.grader(Artifacts(slot.workspace, slot.data_dir, slot.tool_calls, slot.final_text, serializable_state))
                log.emit(slot.agent_id, "agent.graded", {"score": slot.grade["score"], "passed": slot.grade["passed"],
                                                         "checks": slot.grade["checks"]})
            except Exception:
                _log.exception("grader failed for %s", slot.agent_id)
                slot.grade = {"score": 0, "passed": False, "checks": [], "error": "grader failed; see the lab's log"}
                log.emit(slot.agent_id, "agent.graded", {"score": 0, "passed": False, "error": "grader failed"})
        (slot.dir / "tool_calls.json").write_text(json.dumps(slot.tool_calls, indent=1, default=str))
        (slot.dir / "state.json").write_text(json.dumps(slot.state, indent=1, default=str))
        log.emit(slot.agent_id, "agent.end", slot.summary())
