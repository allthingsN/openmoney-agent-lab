"""Missions: a team of agents, each on a different framework, working one goal through a shared task board.

Plan → (a person approves, if interactive) → the lab runs every task whose dependencies are done, each with the
framework assigned to its role, in parallel → the reviewer checks and may send work back → the planner assembles
the deliverable → the lab grades it.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path

import yaml

from . import config
from .runs import AgentSlot, Run, RunManager, frameworks

MISSIONS_DIR = config.ROOT / "missions"
_log = logging.getLogger("agent-lab")


class MissionStopped(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason
MAX_TASK_RUNS = 24


def missions() -> dict[str, dict]:
    out = {}
    for f in sorted(MISSIONS_DIR.glob("*/mission.yaml")):
        m = yaml.safe_load(f.read_text())
        m["dir"] = str(f.parent)
        out[m["id"]] = m
    return out


def create_mission(manager: RunManager, body: dict) -> Run:
    m = missions()[body.get("mission", "moving-day")]
    fws = frameworks()
    assign = {r["role"]: (body.get("roles") or {}).get(r["role"], r["framework"]) for r in m["roles"]}
    for role, fid in assign.items():
        if fid not in fws:
            raise ValueError(f"Unknown framework {fid} for {role}")
    run = Run(manager, "mission", m["title"], body.get("model") or config.load().model, bool(body.get("interactive")),
              {"mission": m["id"], "roles": assign})
    ws = run.dir / "workspace"
    shutil.copytree(Path(m["dir"]) / "workspace", ws)
    run.shared["board"] = {
        "mission": {"title": m["title"], "brief": m["brief"], "deliverables": m["deliverables"],
                    "roles": [{"role": r["role"], "title": r["title"], "does": r["does"],
                               "framework": fws[assign[r["role"]]]["name"]} for r in m["roles"]]},
        "tasks": {}, "order": [], "next": 1, "messages": [],
    }
    run.mission = m
    run.assign = assign
    run.gate_future = None
    manager.runs[run.id] = run
    return run


def start_mission(manager: RunManager, run: Run) -> None:
    run.task = asyncio.create_task(_orchestrate(manager, run))


def _system(run: Run, role: str) -> str:
    m = run.mission
    r = next(x for x in m["roles"] if x["role"] == role)
    fw = frameworks()[run.assign[role]]
    team = "\n".join(f"- {x['title']} ({x['role']}, built on {frameworks()[run.assign[x['role']]]['name']}): {x['does']}"
                     for x in m["roles"])
    return (f"You are the {r['title']} on a team of AI agents. Each teammate runs on a different agent framework; "
            f"you run on {fw['name']}. The team coordinates through a shared task board (the board tools) and a shared "
            f"workspace (the files tools; only outbox/ is writable). Today is 2026-11-05.\n\n"
            f"Your job: {r['does']}\n\nThe team:\n{team}\n\n"
            "Work only through your tools. Never invent prices, terms or availability. Keep results concise and "
            "specific (offer ids, exact numbers, file paths). Load every skill that applies before doing the work it covers.")


def _slot(manager: RunManager, run: Run, role: str, suffix: str, prompt: str) -> AgentSlot:
    m = run.mission
    fw = frameworks()[run.assign[role]]
    aid = f"{role}-{suffix}"
    n = 2
    while aid in run.agents:
        aid = f"{role}-{suffix}-{n}"
        n += 1
    title = next(x["title"] for x in m["roles"] if x["role"] == role)
    slot = AgentSlot(run=run, agent_id=aid, framework=fw, label=f"{title} · {fw['name']}", prompt=prompt,
                     system_prompt=_system(run, role), workspace_src=None, data_dir=Path(m["dir"]) / "data",
                     servers=m["servers"], skills=m.get("skills", []), max_turns=m.get("max_turns", 40),
                     timeout_s=m.get("timeout_s", 600), role=role, workspace_dir=run.dir / "workspace")
    run.add(slot)
    run.log.emit(slot.agent_id, "agent.created", {"role": role, "framework": fw["id"], "label": slot.label,
                                                  "color": fw.get("color"), "phase": suffix})
    return slot


def _board(run: Run) -> dict:
    return run.shared["board"]


def _task_prompt(run: Run, t: dict) -> str:
    b = _board(run)
    deps = "\n".join(f"- {d} {b['tasks'][d]['title']}: {b['tasks'][d]['result']}" for d in t["depends_on"]) or "- (none)"
    comments = "\n".join(f"- {c['role']}: {c['text']}" for c in t["comments"]) or "- (none)"
    rework = f"\n\nThis task was sent back by the reviewer: {t['rework_reason']}\nYour previous result: {t['result']}" \
        if t.get("rework_reason") and t["status"] == "rework" else ""
    return (f"Your task is {t['id']}: {t['title']}\n\nInstructions:\n{t['instructions']}\n\n"
            f"Results of the tasks this depends on:\n{deps}\n\nComments on this task:\n{comments}{rework}\n\n"
            f"When you are done, call complete_task with task_id \"{t['id']}\" and a concise result. "
            "Then reply with one sentence saying what you did.")


async def _gate(run: Run, phase: str, detail: dict) -> bool:
    if not run.interactive:
        return True
    run.gate_future = asyncio.get_running_loop().create_future()
    run.log.emit(None, "mission.gate", {"phase": phase, **detail})
    try:
        ok, note = await asyncio.wait_for(run.gate_future, timeout=1800)
    except asyncio.TimeoutError:
        ok, note = True, "no answer in 30 minutes; continuing"
    run.log.emit(None, "mission.gate_decision", {"phase": phase, "approved": ok, "note": note})
    if note and ok:
        for t in _board(run)["tasks"].values():
            if t["status"] in ("todo", "rework"):
                t["comments"].append({"by": "person", "role": "person", "text": note, "t": 0})
    return ok


async def _execute(manager: RunManager, run: Run, budget: list[int]) -> None:
    b = _board(run)
    running: dict[asyncio.Task, str] = {}
    while True:
        for tid in b["order"]:
            t = b["tasks"][tid]
            if t["status"] not in ("todo", "rework") or tid in running.values() or budget[0] <= 0:
                continue
            if any(b["tasks"][d]["status"] != "done" for d in t["depends_on"]):
                continue
            prompt = _task_prompt(run, t)
            slot = _slot(manager, run, t["role"], tid, prompt)
            t["assignee"] = slot.agent_id
            t["status"] = "running"
            budget[0] -= 1
            run.log.emit(slot.agent_id, "board.update", {"what": "started", "by": "lab", "task": dict(t)})
            running[asyncio.create_task(manager.run_agent(slot))] = tid
        if not running:
            return
        done, _ = await asyncio.wait(list(running), return_when=asyncio.FIRST_COMPLETED)
        for d in done:
            tid = running.pop(d)
            t = b["tasks"][tid]
            if t["status"] == "running":  # the agent ended without complete_task
                slot = run.agents[t["assignee"]]
                t["status"] = "done"
                t["result"] = (slot.final_text or slot.error or "no result")[:2000]
                t["comments"].append({"by": "lab", "role": "lab", "text": "Closed by the lab from the agent's final answer "
                                      "(it did not call complete_task).", "t": 0})
                run.log.emit(slot.agent_id, "board.update", {"what": "done", "by": "lab", "task": dict(t)})


async def _orchestrate(manager: RunManager, run: Run) -> None:
    run.status = "running"
    m = run.mission
    fws = frameworks()
    run.log.emit(None, "run.start", {"kind": "mission", "title": run.title, "model": run.model, "mission": m["id"],
                                     "brief": m["brief"], "deliverables": m["deliverables"],
                                     "roles": [{"role": r["role"], "title": r["title"], "does": r["does"],
                                                "framework": run.assign[r["role"]], "framework_name": fws[run.assign[r["role"]]]["name"],
                                                "color": fws[run.assign[r["role"]]].get("color")} for r in m["roles"]],
                                     "agents": []})
    try:
        others = ", ".join(r["role"] for r in m["roles"] if r["role"] not in ("planner", "reviewer"))
        run.log.emit(None, "mission.phase", {"phase": "plan"})
        planner = _slot(manager, run, "planner", "plan",
                        "Read the mission with get_mission, look at the household's files as needed, then put the work on "
                        f"the board with create_task: 4–8 tasks, each owned by one of these roles: {others}. Give every task "
                        "instructions specific enough to act on alone and use depends_on so the work flows (e.g. research → "
                        "analysis → writing). Don't do the work yourself; you'll assemble the final one-page plan after the "
                        "team is done, and the reviewer checks the work. Reply with a short summary of the plan.")
        await manager.run_agent(planner)
        if not _board(run)["tasks"]:
            raise MissionStopped("The planner created no tasks.")
        if not await _gate(run, "plan", {"tasks": [dict(t) for t in _board(run)["tasks"].values()]}):
            raise MissionStopped("A person rejected the plan.")
        budget = [MAX_TASK_RUNS]
        for round_ in (1, 2):
            run.log.emit(None, "mission.phase", {"phase": "execute", "round": round_})
            await _execute(manager, run, budget)
            run.log.emit(None, "mission.phase", {"phase": "review", "round": round_})
            reviewer = _slot(manager, run, "reviewer", f"review{round_}",
                             "Check the team's finished work against the mission's deliverables: read get_mission, list_tasks, "
                             "get_task for each, and the files in outbox/. For each real problem call request_rework(task_id, "
                             "reason) — at most 3 — or create_task for missing work. If everything needed is there and correct, "
                             "say APPROVED. Reply with a short review.")
            await manager.run_agent(reviewer)
            if not any(t["status"] in ("todo", "rework") for t in _board(run)["tasks"].values()):
                break
        await _execute(manager, run, budget)
        run.log.emit(None, "mission.phase", {"phase": "assemble"})
        final = _slot(manager, run, "planner", "assemble",
                      "The team's tasks are finished. Read the board (list_tasks, get_task) and the files in outbox/, then "
                      "write outbox/move-plan.md exactly as the mission's first deliverable describes, using the analyst's "
                      "numbers. Reply with a two-sentence summary for Priya.")
        await manager.run_agent(final)
        run.final_text = final.final_text
    except MissionStopped as e:
        run.log.emit(None, "mission.error", {"error": e.reason})
    except Exception:
        _log.exception("mission %s failed", run.id)
        run.log.emit(None, "mission.error", {"error": "The mission stopped on an internal error; see the lab's log."})
    from .tasks.moving_day import grade
    from .tasks.common import Artifacts

    calls = [c for s in run.agents.values() for c in s.tool_calls]
    try:
        g = grade(Artifacts(run.dir / "workspace", Path(m["dir"]) / "data", calls, getattr(run, "final_text", "")))
    except Exception:
        _log.exception("mission grader failed")
        g = {"score": 0, "passed": False, "checks": [], "error": "grader failed; see the lab's log"}
    run.meta["grade"] = g
    run.meta["board"] = _board(run)["tasks"]
    run.log.emit(None, "mission.graded", g)
    manager.finish(run)


def decide_gate(run: Run, approved: bool, note: str) -> bool:
    f = getattr(run, "gate_future", None)
    if f and not f.done():
        f.set_result((approved, note))
        return True
    return False


def person_comment(run: Run, task_id: str, text: str) -> None:
    t = _board(run)["tasks"][task_id]
    t["comments"].append({"by": "person", "role": "person", "text": text, "t": 0})
    run.log.emit(None, "board.update", {"what": "comment", "by": "person", "task": dict(t)})


def person_rework(run: Run, task_id: str, reason: str) -> None:
    t = _board(run)["tasks"][task_id]
    if t["status"] == "done":
        t["status"] = "rework"
        t["rework_reason"] = f"(from the person) {reason}"
        run.log.emit(None, "board.update", {"what": "rework", "by": "person", "task": dict(t)})
