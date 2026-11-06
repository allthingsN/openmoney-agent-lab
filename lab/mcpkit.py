"""mcpkit: a small, dependency-free MCP tool server.

It speaks the parts of the Model Context Protocol that agent frameworks use for tools:
``initialize``, ``tools/list``, ``tools/call``, ``ping`` (plus empty ``resources``/``prompts`` lists),
over two transports:

* **stdio**: newline-delimited JSON-RPC, for agents you export and run on their own.
* **Streamable HTTP**: plain JSON responses to POSTs, which the lab mounts at
  ``/mcp/<run>/<agent>/<server>`` so every tool call can be credited to the agent that made it.

Only the standard library is used, so the exported servers run in any framework's environment and
behave the same whichever MCP client version the framework ships.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
import time
import traceback
import typing
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
LATEST = SUPPORTED_PROTOCOLS[0]


class ToolError(Exception):
    """Raise inside a tool to return ``isError: true`` with this message to the model."""


@dataclass
class ToolDef:
    name: str
    description: str
    input_schema: dict
    fn: Callable[..., Any]
    wants_ctx: bool
    annotations: dict = field(default_factory=dict)

    def describe(self) -> dict:
        d = {"name": self.name, "description": self.description, "inputSchema": self.input_schema}
        if self.annotations:
            d["annotations"] = self.annotations
        return d


@dataclass
class CallContext:
    """What a tool sees about the call it is serving."""

    server: str
    run_id: str = "local"
    agent_id: str = "agent"
    state: Any = None  # whatever the server's builder put there (workspace, simulator, ...)
    extra: dict = field(default_factory=dict)


Hook = Callable[[CallContext, str, dict], Awaitable[Any] | Any]


def _schema_for(tp: Any) -> dict:
    origin = typing.get_origin(tp)
    args = typing.get_args(tp)
    if origin is typing.Annotated:
        base, *meta = args
        s = _schema_for(base)
        for m in meta:
            if isinstance(m, str):
                s["description"] = m
            elif isinstance(m, dict):
                s.update(m)
        return s
    if origin in (typing.Union, getattr(__import__("types"), "UnionType", None)):
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return _schema_for(non_none[0])
        return {"anyOf": [_schema_for(a) for a in non_none]}
    if origin is typing.Literal:
        vals = list(args)
        t = "string" if all(isinstance(v, str) for v in vals) else "number"
        return {"type": t, "enum": vals}
    if origin in (list, tuple, set):
        return {"type": "array", "items": _schema_for(args[0]) if args else {}}
    if origin is dict or tp is dict:
        return {"type": "object"}
    return {
        str: {"type": "string"},
        int: {"type": "integer"},
        float: {"type": "number"},
        bool: {"type": "boolean"},
        list: {"type": "array"},
        Any: {},
    }.get(tp, {"type": "string"})


def _input_schema(fn: Callable) -> tuple[dict, bool]:
    sig = inspect.signature(fn)
    hints = typing.get_type_hints(fn, include_extras=True)
    props: dict[str, dict] = {}
    required: list[str] = []
    wants_ctx = False
    for name, p in sig.parameters.items():
        if name == "ctx":
            wants_ctx = True
            continue
        s = _schema_for(hints.get(name, str))
        if p.default is not inspect.Parameter.empty:
            if p.default is not None:
                s["default"] = p.default
        else:
            required.append(name)
        props[name] = s
    schema = {"type": "object", "properties": props, "additionalProperties": False}
    if required:
        schema["required"] = required
    return schema, wants_ctx


class ToolServer:
    def __init__(self, name: str, instructions: str = "", version: str = "1.0.0"):
        self.name = name
        self.instructions = instructions
        self.version = version
        self.tools: dict[str, ToolDef] = {}
        self.before_call: list[Hook] = []
        self.after_call: list[Callable[..., Any]] = []

    # ---- registration -------------------------------------------------------------------------
    def tool(self, description: str | None = None, *, name: str | None = None, read_only: bool | None = None,
             destructive: bool | None = None):
        def deco(fn):
            schema, wants_ctx = _input_schema(fn)
            ann = {}
            if read_only is not None:
                ann["readOnlyHint"] = read_only
            if destructive is not None:
                ann["destructiveHint"] = destructive
            desc = description or inspect.getdoc(fn) or ""
            td = ToolDef(name or fn.__name__, desc.strip(), schema, fn, wants_ctx, ann)
            self.tools[td.name] = td
            return fn

        return deco

    # ---- execution ----------------------------------------------------------------------------
    async def call(self, name: str, args: dict, ctx: CallContext) -> dict:
        td = self.tools.get(name)
        if td is None:
            return {"content": [{"type": "text", "text": f"Unknown tool: {name}"}], "isError": True}
        started = time.perf_counter()
        is_error = False
        for hook in self.before_call:
            r = hook(ctx, name, args)
            if inspect.isawaitable(r):
                r = await r
            if isinstance(r, dict) and r.get("deny"):
                result_text = f"Denied: {r.get('reason') or 'a person declined this action'}"
                out = {"content": [{"type": "text", "text": result_text}], "isError": True}
                await self._after(ctx, name, args, out, started, True)
                return out
        try:
            kwargs = dict(args or {})
            if td.wants_ctx:
                kwargs["ctx"] = ctx
            value = td.fn(**kwargs)
            if inspect.isawaitable(value):
                value = await value
            text = value if isinstance(value, str) else json.dumps(value, indent=1, default=str)
        except ToolError as e:
            is_error, text = True, str(e)
        except TypeError as e:
            is_error, text = True, f"Bad arguments for {name}: {e}"
        except Exception as e:  # pragma: no cover - surfaced to the model
            is_error, text = True, f"{type(e).__name__}: {e}"
            traceback.print_exc(file=sys.stderr)
        out = {"content": [{"type": "text", "text": text}], "isError": is_error}
        await self._after(ctx, name, args, out, started, is_error)
        return out

    async def _after(self, ctx, name, args, out, started, is_error):
        ms = (time.perf_counter() - started) * 1000
        for hook in self.after_call:
            r = hook(ctx, name, args, out, ms, is_error)
            if inspect.isawaitable(r):
                await r

    async def handle(self, msg: dict, ctx: CallContext) -> dict | None:
        """Handle one JSON-RPC message; returns the response, or None for notifications."""
        mid = msg.get("id")
        method = msg.get("method", "")
        params = msg.get("params") or {}
        if mid is None:  # notification
            return None

        def ok(result):
            return {"jsonrpc": "2.0", "id": mid, "result": result}

        if method == "initialize":
            asked = params.get("protocolVersion") or LATEST
            version = asked if asked in SUPPORTED_PROTOCOLS else LATEST
            return ok({
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": self.name, "version": self.version},
                "instructions": self.instructions,
            })
        if method == "ping":
            return ok({})
        if method == "tools/list":
            return ok({"tools": [t.describe() for t in self.tools.values()]})
        if method == "tools/call":
            return ok(await self.call(params.get("name", ""), params.get("arguments") or {}, ctx))
        if method in ("resources/list", "resources/templates/list"):
            return ok({"resources": [] if method == "resources/list" else [], "resourceTemplates": []})
        if method == "prompts/list":
            return ok({"prompts": []})
        if method == "logging/setLevel":
            return ok({})
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"Method not found: {method}"}}

    async def handle_payload(self, payload: Any, ctx: CallContext) -> Any:
        if isinstance(payload, list):
            out = [r for r in [await self.handle(m, ctx) for m in payload] if r is not None]
            return out or None
        return await self.handle(payload, ctx)

    # ---- stdio transport ----------------------------------------------------------------------
    def run_stdio(self, ctx: CallContext | None = None) -> None:
        ctx = ctx or CallContext(server=self.name)

        async def main():
            loop = asyncio.get_running_loop()
            reader = asyncio.StreamReader()
            await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
            while True:
                line = await reader.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
                else:
                    resp = await self.handle_payload(payload, ctx)
                if resp is not None:
                    sys.stdout.write(json.dumps(resp) + "\n")
                    sys.stdout.flush()

        asyncio.run(main())


# ---- environment shared by servers ------------------------------------------------------------

class Env:
    """Where a server's state lives for one agent: its workspace, the task's data, shared state."""

    def __init__(self, workspace=None, data_dir=None, skills_dir=None, state=None, emit=None, approve=None):
        from pathlib import Path

        self.workspace = Path(workspace) if workspace else None
        self.data_dir = Path(data_dir) if data_dir else None
        self.skills_dir = Path(skills_dir) if skills_dir else None
        self.state = state if state is not None else {}
        self._emit = emit
        self._approve = approve

    def emit(self, type_: str, **data) -> None:
        if self._emit:
            self._emit(type_, data)

    async def approve(self, action: str, detail: dict) -> tuple[bool, str]:
        """Ask a person to approve an action. Without an approver (stdio, benchmarks) it is allowed."""
        if self._approve is None:
            return True, ""
        return await self._approve(action, detail)


def stdio_main(build, argv=None):
    """`python server.py --workspace DIR --data DIR --skills DIR` runs a server over stdio."""
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--workspace")
    p.add_argument("--data")
    p.add_argument("--skills")
    a = p.parse_args(argv)
    env = Env(workspace=a.workspace, data_dir=a.data, skills_dir=a.skills)
    server = build(env)
    server.run_stdio(CallContext(server=server.name, state=env))
