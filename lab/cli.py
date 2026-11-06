"""agent-lab command line.

  agent-lab serve                      start the UI + API on http://127.0.0.1:7777
  agent-lab bench --task bill-doctor --frameworks all --trials 3 [--publish]
  agent-lab setup [framework ...]      install framework environments ahead of time
  agent-lab list                       frameworks and tasks
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

import uvicorn


def _serve_config(port: int, host: str = "127.0.0.1"):
    return uvicorn.Config("lab.server:app", host=host, port=port, log_level="warning", lifespan="on")


def cmd_serve(a):
    os.environ["LAB_PORT"] = str(a.port)
    from . import config

    u = config.load()
    print(f"\n  OpenMoney Agent Lab  →  http://{'localhost' if a.host in ('127.0.0.1', '0.0.0.0') else a.host}:{a.port}\n")
    print(f"  model traffic: {u.provider} ({u.masked()['source']})" if u.configured
          else "  No key yet: open the UI and add your Anthropic key in Settings.")
    uvicorn.run("lab.server:app", host=a.host, port=a.port, log_level="warning")


async def _bench(a):
    os.environ["LAB_PORT"] = str(a.port)
    from . import server
    from .runs import frameworks, tasks

    fws = list(frameworks()) if a.frameworks == ["all"] else a.frameworks
    task_ids = list(tasks()) if a.task == "all" else [a.task]
    srv = uvicorn.Server(_serve_config(a.port))
    serve_task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.05)
    runs = []
    for tid in task_ids:
        run = server.manager.create_bench(tid, fws, a.trials, a.model)
        print(f"run {run.id}: {tid} × {len(fws)} frameworks × {a.trials} trial(s) on {run.model}")
        runs.append(run)
        last = 0

        async def progress(run=run):
            nonlocal last
            while run.status != "done":
                await asyncio.sleep(5)
                done = sum(1 for s in run.agents.values() if s.status in ("done", "error"))
                if done != last:
                    last = done
                    print(f"  {done}/{len(run.agents)} agents finished")

        p = asyncio.create_task(progress())
        await server.manager._run_all(run)
        p.cancel()
        _print_table(run)
        if a.publish:
            from .publish import publish

            print("published →", publish(run))
    srv.should_exit = True
    await serve_task


def _print_table(run):
    rows = [s.summary() for s in run.agents.values()]
    print(f"\n{'agent':<22}{'score':>7}{'pass':>6}{'calls':>7}{'tools':>7}{'in tok':>9}{'out tok':>9}{'$':>8}{'secs':>7}  status")
    for r in sorted(rows, key=lambda r: -(r["score"] or 0)):
        m = r["metrics"]
        print(f"{r['agent_id']:<22}{(r['score'] or 0):>7.1f}{'yes' if r['passed'] else 'no':>6}{m['llm_calls']:>7}{m['tool_calls']:>7}"
              f"{m['input_tokens'] + m['cache_read_tokens'] + m['cache_write_tokens']:>9}{m['output_tokens']:>9}{m['cost_usd']:>8.3f}{m['wall_s']:>7.0f}  "
              f"{r['status']}{(' — ' + r['error'][:80].replace(chr(10), ' ')) if r['error'] else ''}")
    print()


async def _mission(a):
    os.environ["LAB_PORT"] = str(a.port)
    from . import server
    from .mission import create_mission, start_mission

    srv = uvicorn.Server(_serve_config(a.port))
    serve_task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.05)
    roles = dict(r.split("=", 1) for r in (a.roles or []))
    if a.all:
        roles = {r: a.all for r in ("planner", "researcher", "analyst", "privacy", "writer", "scheduler", "reviewer")} | roles
    run = create_mission(server.manager, {"mission": a.mission, "roles": roles, "model": a.model})
    print(f"mission run {run.id} on {run.model}: " + ", ".join(f"{k}={v}" for k, v in run.assign.items()))
    start_mission(server.manager, run)
    seen = 0
    while run.status != "done":
        await asyncio.sleep(3)
        for ev in run.log.events[seen:]:
            t, d = ev["type"], ev["data"]
            if t == "mission.phase":
                print(f"— phase {d['phase']}" + (f" (round {d.get('round')})" if d.get("round") else ""))
            elif t == "board.update" and d.get("what") in ("created", "done", "rework", "started"):
                tk = d["task"]
                print(f"  [{d['what']:>7}] {tk['id']} {tk['role']:<10} {tk['title'][:70]}" + (f" → {str(tk.get('result'))[:90]}" if d['what'] == 'done' else ""))
            elif t in ("agent.error", "mission.error"):
                print("  ERROR", ev.get("agent"), str(d)[:300])
        seen = len(run.log.events)
    g = run.meta.get("grade", {})
    print(f"\nmission score {g.get('score')} passed={g.get('passed')}")
    for c in g.get("checks", []):
        print(f"  {c['id']:<10}{c['earned']:>5}/{c['points']:<4} {c['detail'][:120]}")
    tot = sum(s.metrics["cost_usd"] for s in run.agents.values())
    print(f"agents run: {len(run.agents)}  cost ${tot:.3f}")
    if a.publish:
        from .publish import publish

        print("published →", publish(run))
    srv.should_exit = True
    await serve_task


def cmd_mission(a):
    asyncio.run(_mission(a))


def cmd_bench(a):
    asyncio.run(_bench(a))


def cmd_setup(a):
    from .events import RunLog
    from .runs import RunManager, frameworks

    fws = frameworks()
    ids = a.frameworks or list(fws)

    async def go():
        m = RunManager()
        for fid in ids:
            print(f"setting up {fid} …", flush=True)
            await m.ensure_framework(fws[fid])
        print("done")

    asyncio.run(go())


def cmd_list(a):
    from .runs import frameworks, tasks

    print("frameworks:")
    for f in frameworks().values():
        print(f"  {f['id']:<18}{f['name']:<32}{f['language']:<12}{'installed' if f['installed'] else ''}")
    print("tasks:")
    for t in tasks().values():
        print(f"  {t['id']:<22}{t['title']}")


def main(argv=None):
    p = argparse.ArgumentParser(prog="agent-lab")
    sub = p.add_subparsers(dest="cmd")
    s = sub.add_parser("serve")
    s.add_argument("--port", type=int, default=int(os.environ.get("LAB_PORT", 7777)))
    s.add_argument("--host", default=os.environ.get("LAB_HOST", "127.0.0.1"))
    s.set_defaults(fn=cmd_serve)
    b = sub.add_parser("bench")
    b.add_argument("--task", default="all")
    b.add_argument("--frameworks", nargs="+", default=["all"])
    b.add_argument("--trials", type=int, default=1)
    b.add_argument("--model", default=None)
    b.add_argument("--port", type=int, default=7788)
    b.add_argument("--publish", action="store_true")
    b.set_defaults(fn=cmd_bench)
    mi = sub.add_parser("mission")
    mi.add_argument("--mission", default="moving-day")
    mi.add_argument("--roles", nargs="*", help="role=framework overrides")
    mi.add_argument("--all", help="use this framework for every role")
    mi.add_argument("--model", default=None)
    mi.add_argument("--port", type=int, default=7790)
    mi.add_argument("--publish", action="store_true")
    mi.set_defaults(fn=cmd_mission)
    st = sub.add_parser("setup")
    st.add_argument("frameworks", nargs="*")
    st.set_defaults(fn=cmd_setup)
    ls = sub.add_parser("list")
    ls.set_defaults(fn=cmd_list)
    a = p.parse_args(argv)
    if not getattr(a, "fn", None):
        a = p.parse_args(["serve"] + (argv or sys.argv[1:]))
    a.fn(a)


if __name__ == "__main__":
    main()
