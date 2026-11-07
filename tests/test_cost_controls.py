"""Prompt caching for builder runs, the fetch_url cap, spend caps, and the builder judge's outcome gate."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import urllib.request

from lab import builder
from lab.cachemark import add_cache_markers, relay
from lab.proxy import apply_shims
from lab.servers import toolbox


def _body():
    return {"model": "claude-opus-5-5", "system": "You help.", "tools": [{"name": "t", "input_schema": {"type": "object"}}],
            "messages": [{"role": "user", "content": "hi"},
                         {"role": "assistant", "content": [{"type": "text", "text": "ok"},
                                                           {"type": "tool_use", "id": "1", "name": "t", "input": {}}]},
                         {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "1", "content": "x" * 50}]}]}


def test_markers_on_system_and_newest_turn():
    b = _body()
    assert add_cache_markers(b) == ["system", "conversation"]
    assert b["system"] == [{"type": "text", "text": "You help.", "cache_control": {"type": "ephemeral"}}]
    assert b["messages"][-1]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in b["messages"][1]["content"][-1]
    assert json.dumps(b).count("cache_control") == 2


def test_framework_caching_is_left_alone():
    b = _body()
    b["system"] = [{"type": "text", "text": "You help.", "cache_control": {"type": "ephemeral"}}]
    before = json.dumps(b)
    assert add_cache_markers(b) == []
    assert json.dumps(b) == before


def test_marker_skips_blocks_that_cannot_be_cached():
    b = {"system": [{"type": "text", "text": "s"}],
         "messages": [{"role": "user", "content": "q"},
                      {"role": "assistant", "content": [{"type": "text", "text": "a"}, {"type": "thinking", "thinking": "…"}]}]}
    add_cache_markers(b)
    assert "cache_control" not in b["messages"][-1]["content"][1]
    assert b["messages"][-1]["content"][0]["cache_control"]


def test_proxy_shim_only_when_asked():
    b = _body()
    assert apply_shims(b, []) == [] and "cache_control" not in json.dumps(b)
    assert apply_shims(b, ["prompt_cache"]) == ["cache breakpoints: system + conversation"]


def test_compact_json_drops_media_and_long_lists():
    raw = json.dumps({"results": [{"trackName": "A", "artworkUrl512": "https://x/" + "a" * 200,
                                   "screenshotUrls": ["https://x"] * 10, "supportedDevices": [f"d{i}" for i in range(40)],
                                   "description": "d" * 2000, "averageUserRating": 4.5}]})
    out = json.loads(toolbox._compact_json(raw))["results"][0]
    assert "artworkUrl512" not in out and "screenshotUrls" not in out
    assert out["averageUserRating"] == 4.5 and out["trackName"] == "A"
    assert len(out["supportedDevices"]) == 9 and out["supportedDevices"][-1] == "… 32 more"
    assert len(out["description"]) <= 301


def test_fetch_url_cap_cannot_be_raised(monkeypatch, tmp_path):
    class R:
        headers = SimpleNamespace(get=lambda k, d="": "text/plain", get_content_charset=lambda: "utf-8")

        def read(self, n):
            return b"z" * 50_000

        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

    monkeypatch.setattr(toolbox.urllib.request, "urlopen", lambda req, timeout: R())
    from lab.mcpkit import Env

    srv = toolbox.build(Env(workspace=tmp_path, data_dir=None, skills_dir=None, state={}))
    fn = srv.tools["fetch_url"].fn
    out = fn(url="https://example.com", max_chars=60000)
    assert len(out["text"]) == toolbox.FETCH_MAX_CHARS and out["truncated"]


def test_spend_cap():
    from lab.runs import AgentSlot

    s = AgentSlot.__new__(AgentSlot)
    s.max_cost_usd, s.metrics = 5.0, {"cost_usd": 4.99}
    assert not s.over_budget()
    s.metrics["cost_usd"] = 5.0
    assert s.over_budget()
    s.max_cost_usd = None
    assert not s.over_budget()


def _judge(monkeypatch, verdicts):
    reply = {"content": [{"type": "text", "text": json.dumps({"results": [{"pass": v, "reason": "r"} for v in verdicts]})}]}
    monkeypatch.setattr(builder.httpx, "post", lambda *a, **k: SimpleNamespace(json=lambda: reply))
    d = {"success_criteria": ["Returns a price or says it couldn't", "Two decimals"], "outcome": "Reports the closing prices"}
    j = builder._judge_for(d, "find prices")
    return j(SimpleNamespace(workspace=__import__("pathlib").Path("/nonexistent"), final_text="none", tool_calls=[]))


def test_judge_fails_a_run_that_did_not_deliver(monkeypatch):
    g = _judge(monkeypatch, [False, True, True])  # honest failure: every other criterion vacuously met
    assert g["passed"] is False and g["score"] <= 40 and g["failed_must"] == ["outcome"]
    assert g["checks"][0]["id"] == "outcome" and "closing prices" in g["checks"][0]["label"]
    g = _judge(monkeypatch, [True, True, True])
    assert g["passed"] is True and g["score"] == 100


def test_relay_adds_markers_and_streams(monkeypatch):
    seen = {}

    class Up(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            seen["body"] = json.loads(self.rfile.read(int(self.headers["content-length"])))
            seen["key"] = self.headers.get("x-api-key")
            out = b"event: message_start\ndata: {}\n\n"
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.send_header("content-length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    up = ThreadingHTTPServer(("127.0.0.1", 0), Up)
    threading.Thread(target=up.serve_forever, daemon=True).start()
    base = relay(f"http://127.0.0.1:{up.server_address[1]}")
    req = urllib.request.Request(base + "/v1/messages", data=json.dumps(_body()).encode(),
                                 headers={"x-api-key": "k", "content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        assert r.read().startswith(b"event: message_start")
    assert seen["key"] == "k"
    assert json.dumps(seen["body"]).count("cache_control") == 2
    up.shutdown()
