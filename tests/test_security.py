import pytest
from fastapi.testclient import TestClient

from lab import server
from lab.safepath import UnsafePath, safe_id, within


def test_within_confines_paths(tmp_path):
    (tmp_path / "a").mkdir()
    assert within(tmp_path, "a", "b.json") == (tmp_path / "a" / "b.json").resolve()
    for bad in ("../x", "a/../../x", "/etc/passwd"):
        with pytest.raises(UnsafePath):
            within(tmp_path, bad)
    (tmp_path / "link").symlink_to("/etc")
    with pytest.raises(UnsafePath):
        within(tmp_path, "link", "passwd")


def test_safe_id():
    assert safe_id("b20261106-053119-83ce") == "b20261106-053119-83ce"
    for bad in ("..", "../x", "a/b", "", ".hidden", "a\\b", "x" * 200):
        with pytest.raises(UnsafePath):
            safe_id(bad)


client = TestClient(server.app, base_url="http://127.0.0.1:7777")


def test_traversal_in_url_params_is_refused():
    for url in ("/api/runs/..%2F..%2Fetc/agents/x/llm/1", "/api/results/..%2Fpyproject.toml",
                "/api/results/x/outbox/..%2F..%2Fpyproject", "/api/builder/..%2F..%2Fetc",
                "/api/runs/../summary.json", "/api/results/..", "/api/results/.git/events",
                "/api/runs/x/agents/..%5C..%5Cx/outbox", "/..%2Fpyproject.toml", "/%2e%2e/pyproject.toml"):
        r = client.get(url)
        assert r.status_code in (404, 422) or (r.status_code == 200 and r.text.lstrip().startswith("<!doctype html>")), url
        assert "[project]" not in r.text and "[core]" not in r.text, url


def test_cross_origin_and_rebinding_are_refused():
    assert client.post("/api/runs", json={}, headers={"origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/config", json={}, headers={"origin": "null"}).status_code == 403
    assert client.get("/api/health", headers={"host": "evil.example:7777"}).status_code == 403
    assert client.get("/api/health", headers={"origin": "http://localhost:5173"}).status_code == 200
    assert client.get("/api/health").status_code == 200


def test_github_publishing_is_not_run_by_the_server():
    assert client.post("/api/builder/x/github", json={"repo": "x"}).status_code in (404, 405)


def test_crewai_never_reaches_chroma():
    """chromadb (no patched release) is only exposed through Chroma's HTTP server; CrewAI uses it in-process for
    memory/knowledge. The adapter must enable neither, and nothing in the lab may start a Chroma server."""
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    src = (root / "frameworks/crewai/agent.py").read_text()
    for forbidden in ("memory=True", "knowledge", "embedder", "chromadb"):
        assert forbidden not in src, forbidden
    for p in list((root / "lab").rglob("*.py")) + list((root / "frameworks").glob("*/agent.*")):
        text = p.read_text()
        assert "chroma run" not in text and "chromadb.app" not in text and "chromadb.server" not in text, p
