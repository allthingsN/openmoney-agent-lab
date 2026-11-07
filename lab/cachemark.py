"""Prompt caching for agents whose framework doesn't turn it on.

Most agent frameworks send every model call without `cache_control`, so a long tool loop pays full input price for
the whole conversation on every turn (cost grows with the square of the turn count). `add_cache_markers()` puts two
breakpoints on a Messages API request: the end of the system prompt (tools + system, which never change) and the last
block of the newest turn (the growing conversation). The next call then reads everything before its new turn from
the cache at a tenth of the price.

Used by the lab's metering proxy for Agent Builder runs, and by exported projects (`run.py` starts `relay()` so the
same caching applies outside the lab). Requests that already carry `cache_control` (the framework does its own
caching) are left alone. Standard library only, so it can ship inside an exported project.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

EPHEMERAL = {"type": "ephemeral"}
_CACHEABLE = {"text", "image", "document", "tool_use", "tool_result", "search_result"}


def _blocks(body: dict):
    sys_ = body.get("system")
    if isinstance(sys_, list):
        yield from (b for b in sys_ if isinstance(b, dict))
    yield from (t for t in body.get("tools") or [] if isinstance(t, dict))
    for m in body.get("messages") or []:
        c = m.get("content") if isinstance(m, dict) else None
        if isinstance(c, list):
            yield from (b for b in c if isinstance(b, dict))


def has_markers(body: dict) -> bool:
    return "cache_control" in body or any("cache_control" in b for b in _blocks(body))


def add_cache_markers(body: dict) -> list[str]:
    """Add cache breakpoints in place. Returns what it changed (empty if nothing)."""
    if not isinstance(body, dict) or has_markers(body):
        return []
    changed = []
    sys_ = body.get("system")
    if isinstance(sys_, str) and sys_:
        body["system"] = [{"type": "text", "text": sys_, "cache_control": dict(EPHEMERAL)}]
        changed.append("system")
    elif isinstance(sys_, list) and sys_ and isinstance(sys_[-1], dict) and sys_[-1].get("type") == "text":
        sys_[-1]["cache_control"] = dict(EPHEMERAL)
        changed.append("system")
    elif not sys_ and body.get("tools") and isinstance(body["tools"][-1], dict):
        body["tools"][-1]["cache_control"] = dict(EPHEMERAL)
        changed.append("tools")
    for m in reversed(body.get("messages") or []):
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            continue
        c = m.get("content")
        if isinstance(c, str):
            if c:
                m["content"] = [{"type": "text", "text": c, "cache_control": dict(EPHEMERAL)}]
                changed.append("conversation")
            break
        if isinstance(c, list):
            target = next((b for b in reversed(c) if isinstance(b, dict) and b.get("type") in _CACHEABLE
                           and not (b.get("type") == "text" and not b.get("text"))), None)
            if target is not None:
                target["cache_control"] = dict(EPHEMERAL)
                changed.append("conversation")
                break
    return changed


# -------------------------------------------------------------------------------------------- relay (exports)
_HOP = {"host", "content-length", "connection", "accept-encoding", "transfer-encoding", "keep-alive"}


def relay(upstream: str) -> str:
    """Start a local relay that adds cache markers and forwards to `upstream`. Returns its base URL."""
    upstream = upstream.rstrip("/")

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"  # the response ends when the connection closes: simplest way to stream SSE

        def log_message(self, *a):  # quiet
            pass

        def _forward(self):
            n = int(self.headers.get("content-length") or 0)
            data = self.rfile.read(n) if n else None
            if data and self.command == "POST" and self.path.split("?")[0].rstrip("/").endswith("/messages"):
                try:
                    body = json.loads(data)
                    if add_cache_markers(body):
                        data = json.dumps(body).encode()
                except (ValueError, TypeError):
                    pass
            headers = {k: v for k, v in self.headers.items() if k.lower() not in _HOP}
            req = urllib.request.Request(upstream + self.path, data=data, headers=headers, method=self.command)
            try:
                r = urllib.request.urlopen(req, timeout=600)
            except urllib.error.HTTPError as e:
                r = e
            except Exception as e:  # upstream unreachable
                msg = json.dumps({"type": "error", "error": {"type": "api_error", "message": f"relay: {e}"}}).encode()
                self.send_response(502)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(msg)
                return
            self.send_response(r.status if hasattr(r, "status") else r.code)
            for k, v in r.headers.items():
                if k.lower() not in _HOP:
                    self.send_header(k, v)
            self.end_headers()
            while True:
                chunk = r.read1(65536) if hasattr(r, "read1") else r.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()

        do_POST = do_GET = _forward

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}"
