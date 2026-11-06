"""Event bus: every observation the lab makes, in order, per run. Persisted as JSONL and streamed to the UI."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any


class RunLog:
    def __init__(self, run_id: str, path: Path):
        self.run_id = run_id
        self.path = path
        self.events: list[dict] = []
        self.subscribers: set[asyncio.Queue] = set()
        self.closed = False
        path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = path.open("a")

    def emit(self, agent: str | None, type_: str, data: dict | None = None) -> dict:
        ev = {"seq": len(self.events), "ts": round(time.time(), 3), "run": self.run_id, "agent": agent,
              "type": type_, "data": data or {}}
        self.events.append(ev)
        try:
            self._fh.write(json.dumps(ev, default=str) + "\n")
            self._fh.flush()
        except ValueError:
            pass
        for q in list(self.subscribers):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                pass
        return ev

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=10000)
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subscribers.discard(q)

    def close(self) -> None:
        self.closed = True
        for q in list(self.subscribers):
            q.put_nowait({"type": "stream.end", "run": self.run_id})
        try:
            self._fh.close()
        except Exception:
            pass


def preview(value: Any, n: int = 600) -> str:
    s = value if isinstance(value, str) else json.dumps(value, default=str)
    return s if len(s) <= n else s[:n] + f"… [{len(s) - n} more chars]"
