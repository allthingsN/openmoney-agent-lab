import asyncio
import json

from lab import builder as B
from lab.mcpkit import CallContext, Env
from lab.servers import board


def call(srv, ctx, name, **a):
    out = asyncio.run(srv.call(name, a, ctx))
    return out["isError"], out["content"][0]["text"]


def test_board_roles_and_flow():
    env = Env(state={"board": {"mission": {"roles": [{"role": "planner"}, {"role": "writer"}, {"role": "reviewer"}]},
                               "tasks": {}, "order": [], "next": 1, "messages": []}})
    srv = board.build(env)
    planner = CallContext("board", agent_id="planner-plan", extra={"role": "planner"})
    writer = CallContext("board", agent_id="writer-T1", extra={"role": "writer"})
    reviewer = CallContext("board", agent_id="reviewer-1", extra={"role": "reviewer"})
    assert call(srv, writer, "create_task", title="x", role="writer", instructions="y")[0]  # only planners create
    err, text = call(srv, planner, "create_task", title="Draft", role="writer", instructions="Write it")
    assert not err and json.loads(text)["created"] == "T1"
    assert call(srv, writer, "complete_task", task_id="T1", result="done")[0]  # not assigned yet
    env.state["board"]["tasks"]["T1"]["assignee"] = "writer-T1"
    assert not call(srv, writer, "complete_task", task_id="T1", result="outbox/x.md")[0]
    assert not call(srv, reviewer, "request_rework", task_id="T1", reason="too long")[0]
    assert env.state["board"]["tasks"]["T1"]["status"] == "rework"


def test_builder_checks_and_generates_runnable_tools(tmp_path):
    bad = {"name": "t", "code": "import os\nreturn os.system('ls')"}
    assert any("imports os" in p for p in B.check_tool(bad))
    d = B.normalize({"name": "Tip Calc", "catalog_tools": ["files"], "system_prompt": "s", "sample_prompt": "p",
                     "custom_tools": [{"name": "tip", "description": "Tip amount",
                                       "parameters": [{"name": "bill", "type": "number", "required": True},
                                                      {"name": "pct", "type": "number", "required": False}],
                                       "code": "return {'tip': round(bill * (pct or 18) / 100, 2)}"}]})
    assert d["custom_tools"][0]["problems"] == []
    src = B.custom_server_source(d)
    f = tmp_path / "custom.py"
    f.write_text(src)
    import importlib.util
    spec = importlib.util.spec_from_file_location("custom_test", f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    srv = mod.build(Env(workspace=tmp_path))
    err, text = call(srv, CallContext("custom"), "tip", bill=50)
    assert not err and json.loads(text) == {"tip": 9.0}


def test_builder_never_serves_env_files(tmp_path, monkeypatch):
    monkeypatch.setattr(B, "BUILDS_DIR", tmp_path)
    p = tmp_path / "demo"
    (p / "servers").mkdir(parents=True)
    (p / ".env").write_text("ANTHROPIC_API_KEY=sk-ant-secret")
    (p / ".env.local").write_text("X=1")
    (p / ".env.example").write_text("ANTHROPIC_API_KEY=sk-ant-...")
    (p / "agent.json").write_text("{}")
    import io
    import zipfile
    names = zipfile.ZipFile(io.BytesIO(B.zip_project("demo"))).namelist()
    assert "demo/.env.example" in names and not any(n.endswith((".env", ".env.local")) for n in names)
    assert set(B.tree("demo")["files"]) == {".env.example", "agent.json"}
