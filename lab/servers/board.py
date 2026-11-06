"""board: the shared task board a team of agents (each on its own framework) coordinates through.

State lives on the run, so every agent sees the same board. The planner creates tasks; the lab starts the right
specialist for each task once its dependencies are done; the reviewer can send work back.
"""

from __future__ import annotations

import time
from typing import Annotated

try:
    from lab.mcpkit import CallContext, Env, ToolError, ToolServer, stdio_main
except ImportError:
    from mcpkit import CallContext, Env, ToolError, ToolServer, stdio_main

STATUSES = ("todo", "running", "done", "rework")


def build(env: Env) -> ToolServer:
    st = env.state.setdefault("board", {"mission": {}, "tasks": {}, "order": [], "next": 1, "messages": []})
    srv = ToolServer("board", "The team's shared task board: the mission, every task, its owner role, status, "
                              "results and comments.")

    def who(ctx: CallContext) -> str:
        return (ctx.extra or {}).get("role") or "agent"

    def task(task_id: str) -> dict:
        t = st["tasks"].get(task_id)
        if not t:
            raise ToolError(f"No task {task_id}. Use list_tasks.")
        return t

    def view(t: dict, full: bool = False) -> dict:
        v = {k: t[k] for k in ("id", "title", "role", "status", "depends_on", "assignee")}
        if t.get("result"):
            v["result"] = t["result"] if full else t["result"][:400]
        if full:
            v["instructions"] = t["instructions"]
            v["comments"] = t["comments"]
            v["rework_reason"] = t.get("rework_reason")
        return v

    def changed(t: dict, what: str, ctx: CallContext | None = None):
        env.emit("board.update", what=what, by=(ctx.agent_id if ctx else "lab"), task=view(t, full=True))

    @srv.tool(read_only=True)
    def get_mission(ctx: CallContext) -> dict:
        """The mission brief, what a finished package must contain, and the roles on the team."""
        return st["mission"]

    @srv.tool(read_only=True)
    def list_tasks(ctx: CallContext, status: Annotated[str, "Optional filter: todo, running, done, rework"] = "") -> dict:
        """All tasks on the board (results shortened)."""
        rows = [view(st["tasks"][i]) for i in st["order"] if not status or st["tasks"][i]["status"] == status]
        return {"tasks": rows}

    @srv.tool(read_only=True)
    def get_task(ctx: CallContext, task_id: str) -> dict:
        """One task with its full instructions, result and comments."""
        return view(task(task_id), full=True)

    @srv.tool()
    def create_task(ctx: CallContext, title: str,
                    role: Annotated[str, "Who should do it: one of the mission's roles"],
                    instructions: Annotated[str, "What to do and what to hand back, specific enough to act on alone"],
                    depends_on: Annotated[list[str], "Task ids that must be done first"] = []) -> dict:
        """Add a task to the board (planner and reviewer only)."""
        if who(ctx) not in ("planner", "reviewer"):
            raise ToolError("Only the planner or reviewer can create tasks.")
        roles = [r["role"] for r in st["mission"].get("roles", [])]
        if role not in roles or role in ("planner",):
            raise ToolError(f"role must be one of: {', '.join(r for r in roles if r != 'planner')}")
        for d in depends_on:
            task(d)
        tid = f"T{st['next']}"
        st["next"] += 1
        t = {"id": tid, "title": title, "role": role, "instructions": instructions, "depends_on": list(depends_on),
             "status": "todo", "assignee": None, "result": None, "comments": [], "created_by": ctx.agent_id,
             "created": time.time()}
        st["tasks"][tid] = t
        st["order"].append(tid)
        changed(t, "created", ctx)
        return {"created": tid}

    @srv.tool()
    def add_comment(ctx: CallContext, task_id: str, text: str) -> dict:
        """Leave a note on a task for whoever works on it next (or for the reviewer)."""
        t = task(task_id)
        t["comments"].append({"by": ctx.agent_id, "role": who(ctx), "text": text, "t": time.time()})
        changed(t, "comment", ctx)
        return {"ok": True}

    @srv.tool()
    def complete_task(ctx: CallContext, task_id: str,
                      result: Annotated[str, "What you found or made: numbers, ids, file paths in outbox/. Concise."]) -> dict:
        """Mark your task done with its result."""
        t = task(task_id)
        if t["assignee"] != ctx.agent_id:
            raise ToolError(f"{task_id} is assigned to {t['assignee']}, not you.")
        t["status"] = "done"
        t["result"] = result
        changed(t, "done", ctx)
        return {"ok": True}

    @srv.tool()
    def request_rework(ctx: CallContext, task_id: str, reason: Annotated[str, "What is wrong and what would fix it"]) -> dict:
        """Send a finished task back for another pass (reviewer only)."""
        if who(ctx) != "reviewer":
            raise ToolError("Only the reviewer can request rework.")
        t = task(task_id)
        if t["status"] != "done":
            raise ToolError("Only finished tasks can be sent back.")
        if t.get("reworks", 0) >= 1:
            raise ToolError("This task already had a rework round; note the issue in your review instead.")
        t["reworks"] = t.get("reworks", 0) + 1
        t["status"] = "rework"
        t["rework_reason"] = reason
        changed(t, "rework", ctx)
        return {"ok": True}

    return srv


if __name__ == "__main__":
    stdio_main(build)
