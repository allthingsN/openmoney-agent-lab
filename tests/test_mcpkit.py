import asyncio
from typing import Annotated, Literal

from lab.mcpkit import CallContext, ToolError, ToolServer


def _srv():
    s = ToolServer("t", "test")

    @s.tool("Add numbers")
    def add(a: int, b: Annotated[int, "second"] = 2) -> dict:
        return {"sum": a + b}

    @s.tool()
    def pick(kind: Literal["x", "y"], tags: list[str] = []) -> str:
        """Pick one."""
        if kind == "y":
            raise ToolError("no y")
        return kind + ",".join(tags)

    return s


def rpc(s, method, params=None, id_=1):
    return asyncio.run(s.handle({"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}}, CallContext("t")))


def test_initialize_negotiates_protocol():
    s = _srv()
    assert rpc(s, "initialize", {"protocolVersion": "2025-06-18"})["result"]["protocolVersion"] == "2025-06-18"
    assert rpc(s, "initialize", {"protocolVersion": "2099-01-01"})["result"]["protocolVersion"] == "2025-11-25"


def test_schema_from_type_hints():
    tools = {t["name"]: t for t in rpc(_srv(), "tools/list")["result"]["tools"]}
    a = tools["add"]["inputSchema"]
    assert a["required"] == ["a"] and a["properties"]["b"] == {"type": "integer", "description": "second", "default": 2}
    assert tools["pick"]["inputSchema"]["properties"]["kind"] == {"type": "string", "enum": ["x", "y"]}
    assert tools["pick"]["description"] == "Pick one."


def test_call_and_errors():
    s = _srv()
    assert '"sum": 5' in rpc(s, "tools/call", {"name": "add", "arguments": {"a": 3}})["result"]["content"][0]["text"]
    r = rpc(s, "tools/call", {"name": "pick", "arguments": {"kind": "y"}})["result"]
    assert r["isError"] and r["content"][0]["text"] == "no y"
    assert rpc(s, "tools/call", {"name": "add", "arguments": {"zzz": 1}})["result"]["isError"]
    assert rpc(s, "server/discover")["error"]["code"] == -32601
    assert asyncio.run(s.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}, CallContext("t"))) is None
