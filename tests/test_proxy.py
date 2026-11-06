import json

from lab import pricing
from lab.proxy import StreamRecorder, apply_shims


def sse(*events):
    return b"".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode() for e in events)


def test_stream_recorder_rebuilds_message_across_chunk_boundaries():
    raw = sse(
        {"type": "message_start", "message": {"id": "m", "model": "claude-opus-5-5", "usage": {"input_tokens": 10, "cache_read_input_tokens": 5}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hel"}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "lo"}},
        {"type": "content_block_stop", "index": 0},
        {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "t1", "name": "f", "input": {}}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"a\":"}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": " 1}"}},
        {"type": "content_block_stop", "index": 1},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 7}},
        {"type": "message_stop"},
    )
    r = StreamRecorder()
    for i in range(0, len(raw), 13):  # arbitrary chunking
        r.feed(raw[i:i + 13])
    m = r.message
    assert m["content"][0]["text"] == "Hello" and m["content"][1]["input"] == {"a": 1}
    assert m["stop_reason"] == "tool_use" and m["usage"]["output_tokens"] == 7 and m["usage"]["input_tokens"] == 10


def test_shims_are_opt_in():
    body = {"temperature": 0.7, "tool_choice": {"type": "any"}}
    assert apply_shims(dict(body), []) == []
    b = dict(body)
    assert apply_shims(b, ["strip_sampling", "tool_choice_auto"]) == ["removed temperature", "tool_choice any -> auto"]
    assert b == {"tool_choice": {"type": "auto"}}


def test_pricing():
    assert pricing.cost("claude-opus-5-5", {"input_tokens": 1_000_000, "output_tokens": 1_000_000}) == 24.0
    assert pricing.cost("claude-sonnet-5-5", {"cache_read_input_tokens": 1_000_000}) == 0.2
    assert pricing.cost("anthropic/claude-haiku-5-5", {"input_tokens": 1_000_000}) == 0.1
    assert pricing.cost("unknown-model", {"input_tokens": 5}) == 0.0
