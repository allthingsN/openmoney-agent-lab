"""Where the lab sends model traffic. Either Anthropic directly, or a LiteLLM proxy in front of Anthropic.

Sources, first match wins: the settings saved from the UI (.lab/config.json), then environment variables:
  ANTHROPIC_API_KEY                         -> Anthropic directly
  LITELLM_BASE_URL + LITELLM_API_KEY        -> a LiteLLM proxy's Anthropic-compatible /v1/messages
The key stays inside the lab process: agents talk to the lab's local proxy with a per-agent token instead.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()
STATE_DIR = Path(os.environ.get("LAB_STATE_DIR", ROOT / ".lab"))
CONFIG_FILE = STATE_DIR / "config.json"
RUNS_DIR = Path(os.environ.get("LAB_RUNS_DIR", ROOT / "runs"))
DEFAULT_MODEL = os.environ.get("LAB_MODEL", "claude-opus-5-5")
MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]


@dataclass
class Upstream:
    provider: str = "anthropic"          # "anthropic" | "litellm"
    api_key: str = ""
    base_url: str = "https://api.anthropic.com"
    model: str = DEFAULT_MODEL

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def masked(self) -> dict:
        d = asdict(self)
        k = self.api_key
        d["api_key"] = (k[:7] + "…" + k[-4:]) if len(k) > 12 else ("set" if k else "")
        d["configured"] = self.configured
        d["source"] = getattr(self, "_source", "")
        return d

    def messages_url(self, path: str) -> str:
        base = self.base_url.rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3]
        return f"{base}/{path.lstrip('/')}"

    def auth_headers(self) -> dict:
        if self.provider == "litellm":
            return {"authorization": f"Bearer {self.api_key}", "x-api-key": self.api_key}
        return {"x-api-key": self.api_key}


def load() -> Upstream:
    if CONFIG_FILE.exists():
        try:
            d = json.loads(CONFIG_FILE.read_text())
            u = Upstream(**{k: v for k, v in d.items() if k in Upstream.__dataclass_fields__})
            if u.api_key:
                u._source = "saved settings"
                return u
        except Exception:
            pass
    if os.environ.get("LITELLM_BASE_URL") and os.environ.get("LITELLM_API_KEY"):
        u = Upstream("litellm", os.environ["LITELLM_API_KEY"], os.environ["LITELLM_BASE_URL"], DEFAULT_MODEL)
        u._source = "environment (LITELLM_*)"
        return u
    if os.environ.get("ANTHROPIC_API_KEY"):
        u = Upstream("anthropic", os.environ["ANTHROPIC_API_KEY"],
                     os.environ.get("ANTHROPIC_UPSTREAM_URL", "https://api.anthropic.com"), DEFAULT_MODEL)
        u._source = "environment (ANTHROPIC_API_KEY)"
        return u
    u = Upstream()
    u._source = "not configured"
    return u


def save(u: Upstream) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(asdict(u), indent=2))
    os.chmod(CONFIG_FILE, 0o600)
