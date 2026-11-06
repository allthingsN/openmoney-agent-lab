"""Helpers shared by graders."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Artifacts:
    """Everything a grader may look at after a run, all recorded outside the framework."""

    workspace: Path                      # the agent's copy of the workspace (outbox/ included)
    data_dir: Path                       # the task's data folder
    tool_calls: list[dict]               # [{server, name, args, result, error, t}] from the MCP servers + native tools
    final_text: str = ""                 # the agent's final answer
    state: dict = field(default_factory=dict)  # server state at the end (e.g. ops actions)


@dataclass
class Check:
    id: str
    label: str
    points: float
    earned: float
    detail: str = ""

    def as_dict(self):
        return self.__dict__.copy()


def last_json_block(text: str) -> dict | None:
    blocks = re.findall(r"```(?:json)?\s*\n(.*?)```", text or "", re.S)
    for b in reversed(blocks):
        try:
            v = json.loads(b)
            if isinstance(v, dict):
                return v
        except json.JSONDecodeError:
            continue
    # a bare object at the end
    m = re.search(r"(\{[\s\S]*\})\s*$", (text or "").strip())
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            return None
    return None


def num(v: Any) -> float | None:
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace("$", "").replace(",", "").strip())
        except ValueError:
            return None
    return None


def close(a: Any, b: float, tol: float = 1.0) -> bool:
    x = num(a)
    return x is not None and abs(x - b) <= tol


def summarize(checks: list[Check], pass_score: float = 80, must: list[str] | None = None) -> dict:
    total = sum(c.points for c in checks)
    earned = sum(c.earned for c in checks)
    score = round(100 * earned / total, 1) if total else 0.0
    failed_must = [c.id for c in checks if must and c.id in must and c.earned < c.points]
    return {
        "score": score,
        "passed": score >= pass_score and not failed_must,
        "failed_must": failed_must,
        "checks": [c.as_dict() for c in checks],
    }
