"""labkit: the few things every lab agent shares, kept out of the framework code.

* ``load_spec()``   — the agent's job: model, prompts, MCP servers, skills (from agent.json)
* ``calculate()``   — the one native tool every agent defines in its own framework's style
* ``emit()``        — optional telemetry to the lab (native tool calls, the final answer). No-op outside the lab.
* ``final()``       — report the final answer

Standard library only. The same file is copied next to every Python framework's agent.
"""

from __future__ import annotations

import ast
import json
import math
import operator
import os
import re
import sys
import time
import urllib.request

_SPEC: dict | None = None


def load_spec(path: str | None = None) -> dict:
    global _SPEC
    p = path or (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("LAB_SPEC", "agent.json"))
    with open(p) as f:
        _SPEC = json.load(f)
    return _SPEC


def emit(type_: str, **data) -> None:
    s = _SPEC or {}
    url, token = s.get("events_url"), s.get("events_token")
    if not url:
        return
    body = json.dumps({"type": type_, "data": data}, default=str).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"content-type": "application/json", "authorization": f"Bearer {token}"})
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as e:  # telemetry must never break the agent
        print(f"[labkit] telemetry failed: {e}", file=sys.stderr)


def final(text: str) -> None:
    emit("agent.final", text=text)
    print("\n===== FINAL ANSWER =====\n" + text)


# ---- calculate: safe arithmetic ----------------------------------------------------------------------------
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
        ast.USub: operator.neg, ast.UAdd: operator.pos}
_FUNCS = {"round": round, "min": min, "max": max, "abs": abs, "sum": lambda *a: sum(a[0] if len(a) == 1 else a),
          "sqrt": math.sqrt, "ceil": math.ceil, "floor": math.floor}

CALCULATE_DESCRIPTION = ("Evaluate an arithmetic expression exactly, e.g. '12*(65-5) + 99' or 'round(1452/1024, 2)'. "
                         "Supports + - * / // % **, parentheses, and round, min, max, abs, sum, sqrt, ceil, floor.")


def _eval(node):
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval(node.left), _eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval(node.operand))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS:
        return _FUNCS[node.func.id](*[_eval(a) for a in node.args])
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_eval(e) for e in node.elts]
    raise ValueError("only arithmetic is allowed")


_GROUPED = re.compile(r"(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)")


def _strip_grouping(expression: str) -> str:
    """Drop thousands separators ("2,627.76") but keep argument commas ("round(x, 2)", "max(5,234)").
    A grouped number counts as one when it is outside brackets, or has a decimal part. Same rule as labkit.ts."""
    def fix(m):
        before = expression[: m.start()]
        depth = before.count("(") + before.count("[") - before.count(")") - before.count("]")
        return m[0].replace(",", "") if depth == 0 or "." in m[0] else m[0]

    return _GROUPED.sub(fix, expression)


def calculate(expression: str) -> str:
    """Evaluate an arithmetic expression and report it to the lab as a native tool call."""
    t0 = time.perf_counter()
    try:
        expr = _strip_grouping(expression).replace("$", "")
        value = _eval(ast.parse(expr, mode="eval"))
        if isinstance(value, float):
            value = round(value, 10)
        out, err = str(value), False
    except Exception as e:
        out, err = f"Error: {e}", True
    emit("tool.end", server="native", name="calculate", args={"expression": expression}, result=out,
         ms=round((time.perf_counter() - t0) * 1000, 2), error=err)
    return out
