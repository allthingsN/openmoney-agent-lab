"""toolbox: general-purpose tools for agents made in the Agent Builder."""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Annotated

try:
    from lab.mcpkit import Env, ToolError, ToolServer, stdio_main
except ImportError:
    from mcpkit import Env, ToolError, ToolServer, stdio_main


class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip and data.strip():
            self.out.append(data.strip())


def build(env: Env) -> ToolServer:
    srv = ToolServer("toolbox", "General tools: read web pages, the current time, and a small notes memory.")
    notes = env.state.setdefault("notes", {})

    @srv.tool(read_only=True)
    def fetch_url(url: Annotated[str, "An http(s) URL"], max_chars: int = 12000) -> dict:
        """Fetch a web page or API and return its readable text (HTML is converted to text)."""
        if not re.match(r"^https?://", url):
            raise ToolError("Only http(s) URLs")
        req = urllib.request.Request(url, headers={"user-agent": "agent-lab-toolbox/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                ctype = r.headers.get("content-type", "")
                raw = r.read(2_000_000).decode(r.headers.get_content_charset() or "utf-8", errors="replace")
        except Exception as e:
            raise ToolError(f"Fetch failed: {e}")
        if "html" in ctype:
            p = _Text()
            p.feed(raw)
            raw = "\n".join(p.out)
        return {"url": url, "content_type": ctype, "text": raw[:max_chars], "truncated": len(raw) > max_chars}

    @srv.tool(read_only=True)
    def current_time() -> dict:
        """The current date and time (UTC)."""
        now = datetime.now(timezone.utc)
        return {"utc": now.isoformat(timespec="seconds"), "weekday": now.strftime("%A")}

    @srv.tool()
    def save_note(key: str, value: str) -> dict:
        """Remember something for later in this run."""
        notes[key] = value
        return {"saved": key, "count": len(notes)}

    @srv.tool(read_only=True)
    def read_notes() -> dict:
        """Everything saved with save_note."""
        return {"notes": notes}

    return srv


if __name__ == "__main__":
    stdio_main(build)
