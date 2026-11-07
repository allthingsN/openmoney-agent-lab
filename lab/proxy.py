"""The metering proxy: every framework talks to Claude through here.

Agents get ``ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/llm/<run>/<agent>`` and a per-agent token as their API
key. The proxy checks the token, waits if a person paused the agent, forwards the request to Anthropic (or a
LiteLLM proxy) with the real key, and records exactly what was sent and what came back: tokens, cost, latency,
time to first token, stop reason, tool calls, and how big the framework's own system prompt and tool list are.
Measuring here, outside the framework, is what makes the numbers comparable.
"""

from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from . import config, pricing
from .cachemark import add_cache_markers
from .events import preview

if TYPE_CHECKING:
    from .runs import AgentSlot

FORWARD_HEADERS = ("anthropic-version", "anthropic-beta", "content-type", "accept")
_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(600, connect=20))
    return _client


def _token(req: Request) -> str:
    k = req.headers.get("x-api-key") or ""
    a = req.headers.get("authorization") or ""
    return k or a.removeprefix("Bearer ").strip()


def _summarize_request(body: dict) -> dict:
    system = body.get("system")
    if isinstance(system, list):
        system_text = "".join(b.get("text", "") for b in system if isinstance(b, dict))
    else:
        system_text = system or ""
    tools = body.get("tools") or []
    msgs = body.get("messages") or []
    last = msgs[-1] if msgs else {}
    last_kinds = []
    if isinstance(last.get("content"), list):
        last_kinds = [b.get("type") for b in last["content"] if isinstance(b, dict)]
    return {
        "model": body.get("model"),
        "stream": bool(body.get("stream")),
        "max_tokens": body.get("max_tokens"),
        "messages": len(msgs),
        "system_chars": len(system_text),
        "system_preview": preview(system_text, 400),
        "tools": [t.get("name") for t in tools],
        "tools_chars": len(json.dumps(tools)),
        "thinking": body.get("thinking"),
        "output_config": body.get("output_config"),
        "tool_choice": body.get("tool_choice"),
        "temperature": body.get("temperature"),
        "last_message": {"role": last.get("role"), "content": last_kinds or "text"},
    }


def _summarize_message(msg: dict) -> dict:
    blocks = []
    text = []
    tool_uses = []
    for b in msg.get("content") or []:
        t = b.get("type")
        blocks.append(t)
        if t == "text":
            text.append(b.get("text", ""))
        elif t == "tool_use":
            tool_uses.append({"id": b.get("id"), "name": b.get("name"), "input": b.get("input")})
    return {"stop_reason": msg.get("stop_reason"), "blocks": blocks, "text": preview("".join(text), 1500),
            "tool_uses": tool_uses, "usage": msg.get("usage") or {}, "model": msg.get("model")}


def apply_shims(body: dict, shims: list[str]) -> list[str]:
    applied = []
    if "strip_sampling" in shims:
        for k in ("temperature", "top_p", "top_k"):
            if k in body:
                body.pop(k)
                applied.append(f"removed {k}")
    if "tool_choice_auto" in shims:
        tc = body.get("tool_choice")
        if isinstance(tc, dict) and tc.get("type") in ("any", "tool"):
            body["tool_choice"] = {"type": "auto"}
            applied.append(f"tool_choice {tc.get('type')} -> auto")
    if "prompt_cache" in shims:
        where = add_cache_markers(body)
        if where:
            applied.append("cache breakpoints: " + " + ".join(where))
    return applied


class StreamRecorder:
    """Rebuilds the final message from Anthropic's SSE stream while passing bytes through untouched."""

    def __init__(self):
        self.buf = b""
        self.message: dict = {"content": [], "usage": {}}
        self.partial_json: dict[int, str] = {}
        self.first_token_at: float | None = None
        self.error: dict | None = None

    def feed(self, chunk: bytes) -> None:
        self.buf += chunk
        while b"\n\n" in self.buf:
            raw, self.buf = self.buf.split(b"\n\n", 1)
            data = b"".join(line[5:].strip() for line in raw.split(b"\n") if line.startswith(b"data:"))
            if not data:
                continue
            try:
                ev = json.loads(data)
            except json.JSONDecodeError:
                continue
            self._event(ev)

    def _event(self, ev: dict) -> None:
        t = ev.get("type")
        m = self.message
        if t == "message_start":
            msg = ev.get("message") or {}
            m.update({k: v for k, v in msg.items() if k != "content"})
            m["usage"] = dict(msg.get("usage") or {})
        elif t == "content_block_start":
            if self.first_token_at is None:
                self.first_token_at = time.perf_counter()
            idx = ev.get("index", len(m["content"]))
            while len(m["content"]) <= idx:
                m["content"].append({})
            m["content"][idx] = dict(ev.get("content_block") or {})
        elif t == "content_block_delta":
            idx = ev.get("index", 0)
            d = ev.get("delta") or {}
            if idx >= len(m["content"]):
                return
            b = m["content"][idx]
            if d.get("type") == "text_delta":
                b["text"] = b.get("text", "") + d.get("text", "")
            elif d.get("type") == "input_json_delta":
                self.partial_json[idx] = self.partial_json.get(idx, "") + d.get("partial_json", "")
            elif d.get("type") == "thinking_delta":
                b["thinking"] = b.get("thinking", "") + d.get("thinking", "")
        elif t == "content_block_stop":
            idx = ev.get("index", 0)
            if idx in self.partial_json and idx < len(m["content"]):
                try:
                    m["content"][idx]["input"] = json.loads(self.partial_json[idx] or "{}")
                except json.JSONDecodeError:
                    m["content"][idx]["input"] = {"_unparsed": self.partial_json[idx]}
        elif t == "message_delta":
            d = ev.get("delta") or {}
            if "stop_reason" in d:
                m["stop_reason"] = d["stop_reason"]
            for k, v in (ev.get("usage") or {}).items():
                if v is not None:
                    m["usage"][k] = v
        elif t == "error":
            self.error = ev.get("error")


async def handle(req: Request, slot: "AgentSlot", path: str) -> Response:
    if _token(req) != slot.token:
        return JSONResponse({"type": "error", "error": {"type": "authentication_error",
                                                        "message": "Unknown lab agent token"}}, status_code=401)
    upstream = config.load()
    if not upstream.configured:
        return JSONResponse({"type": "error", "error": {"type": "authentication_error",
                                                        "message": "The lab has no Anthropic key yet. Add one in Settings."}},
                            status_code=401)
    raw = await req.body()
    url = upstream.messages_url(path)
    if req.url.query:
        url += "?" + req.url.query
    headers = {k: v for k, v in req.headers.items() if k.lower() in FORWARD_HEADERS}
    headers.setdefault("anthropic-version", "2023-06-01")
    headers.update(upstream.auth_headers())

    is_messages = path.rstrip("/").endswith("/messages") and req.method == "POST"
    if not is_messages:
        r = await client().request(req.method, url, content=raw, headers=headers)
        slot.log.emit(slot.agent_id, "llm.other", {"path": path, "status": r.status_code})
        return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type"))

    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        body = {}
    applied = apply_shims(body, slot.shims) if body else []
    if applied:
        raw = json.dumps(body).encode()
        # caching is added on every call; say so once, not 40 times
        shown = [c for c in applied if not (c.startswith("cache breakpoints") and slot._cache_noted)]
        if any(c.startswith("cache breakpoints") for c in applied):
            slot._cache_noted = True
        if shown:
            slot.log.emit(slot.agent_id, "shim.applied", {"changes": shown})

    await slot.gate()  # pause / step control from the UI
    if slot.over_budget():
        msg = (f"Spend cap reached: ${slot.metrics['cost_usd']:.2f} of ${slot.max_cost_usd:.2f} for this agent. "
               "The lab stopped it.")
        slot.log.emit(slot.agent_id, "agent.budget", {"cap_usd": slot.max_cost_usd, "spent_usd": slot.metrics["cost_usd"]})
        slot.halt(msg)
        return JSONResponse({"type": "error", "error": {"type": "permission_error", "message": msg}}, status_code=403)
    n = slot.next_llm_seq()
    summary = _summarize_request(body)
    summary["seq"] = n
    summary["user_agent"] = req.headers.get("user-agent", "")[:120]
    slot.log.emit(slot.agent_id, "llm.request", summary)
    slot.save_llm(n, "request", body)
    started = time.perf_counter()

    if body.get("stream"):
        rec = StreamRecorder()
        upstream_req = client().build_request("POST", url, content=raw, headers=headers)
        r = await client().send(upstream_req, stream=True)
        if r.status_code >= 400:
            content = await r.aread()
            await r.aclose()
            _record_error(slot, n, r.status_code, content, started)
            return Response(content, status_code=r.status_code, media_type=r.headers.get("content-type"))

        async def relay():
            try:
                async for chunk in r.aiter_raw():
                    rec.feed(chunk)
                    yield chunk
            finally:
                await r.aclose()
                _record_response(slot, n, rec.message, started, rec.first_token_at, stream=True, error=rec.error)

        return StreamingResponse(relay(), status_code=r.status_code,
                                 media_type=r.headers.get("content-type", "text/event-stream"))

    r = await client().post(url, content=raw, headers=headers)
    if r.status_code >= 400:
        _record_error(slot, n, r.status_code, r.content, started)
        return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type"))
    try:
        msg = r.json()
    except Exception:
        msg = {}
    _record_response(slot, n, msg, started, None, stream=False)
    return Response(r.content, status_code=r.status_code, media_type="application/json")


def _record_error(slot, n, status, content, started):
    try:
        err = json.loads(content)
    except Exception:
        err = {"raw": content[:2000].decode(errors="replace")}
    slot.save_llm(n, "response", {"status": status, "error": err})
    slot.metrics["llm_errors"] += 1
    slot.log.emit(slot.agent_id, "llm.error", {"seq": n, "status": status, "error": preview(err, 800),
                                                "latency_ms": round((time.perf_counter() - started) * 1000)})


def _record_response(slot, n, msg, started, first_token_at, stream, error=None):
    latency = (time.perf_counter() - started) * 1000
    s = _summarize_message(msg)
    usage = s["usage"]
    model = s.get("model") or ""
    usd = pricing.cost(model, usage)
    m = slot.metrics
    m["llm_calls"] += 1
    m["input_tokens"] += usage.get("input_tokens") or 0
    m["output_tokens"] += usage.get("output_tokens") or 0
    m["cache_read_tokens"] += usage.get("cache_read_input_tokens") or 0
    m["cache_write_tokens"] += usage.get("cache_creation_input_tokens") or 0
    m["cost_usd"] = round(m["cost_usd"] + usd, 6)
    m["llm_ms"] += latency
    s.update({"seq": n, "latency_ms": round(latency), "cost_usd": usd, "stream": stream,
              "ttft_ms": round((first_token_at - started) * 1000) if first_token_at else None})
    if error:
        s["stream_error"] = error
    slot.save_llm(n, "response", msg)
    slot.log.emit(slot.agent_id, "llm.response", s)
