"""skills: progressive disclosure of Agent Skills (SKILL.md folders) for frameworks without native skills."""

from __future__ import annotations

import re
from typing import Annotated

try:
    from lab.mcpkit import Env, ToolError, ToolServer, stdio_main
except ImportError:
    from mcpkit import Env, ToolError, ToolServer, stdio_main


def parse_skill(text: str) -> tuple[dict, str]:
    meta: dict = {}
    body = text
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        body = m.group(2)
    return meta, body


def index(skills_dir, allowed: list[str] | None = None) -> list[dict]:
    out = []
    if not skills_dir or not skills_dir.exists():
        return out
    for d in sorted(skills_dir.iterdir()):
        f = d / "SKILL.md"
        if f.is_file() and (allowed is None or d.name in allowed):
            meta, _ = parse_skill(f.read_text())
            out.append({"name": meta.get("name", d.name), "description": meta.get("description", "")})
    return out


def build(env: Env) -> ToolServer:
    allowed = env.state.get("skills_allowed")
    srv = ToolServer("skills", "Agent Skills: folders of instructions. Load a skill before doing work it covers.")
    root = env.skills_dir.resolve()

    def skill_dir(name: str):
        d = (root / name).resolve()
        if root not in d.parents or not (d / "SKILL.md").is_file() or (allowed is not None and name not in allowed):
            raise ToolError(f"No such skill: {name}")
        return d

    @srv.tool(read_only=True)
    def list_skills() -> dict:
        """List available skills with one-line descriptions."""
        return {"skills": index(root, allowed)}

    @srv.tool(read_only=True)
    def load_skill(name: Annotated[str, "Skill name, e.g. 'true-cost'"]) -> str:
        """Load a skill's full instructions (its SKILL.md). Files it links to can be read with read_skill_file."""
        d = skill_dir(name)
        _, body = parse_skill((d / "SKILL.md").read_text())
        extra = sorted(str(p.relative_to(d)) for p in d.rglob("*") if p.is_file() and p.name != "SKILL.md")
        if extra:
            body += "\n\n---\nFiles in this skill (read with read_skill_file): " + ", ".join(extra)
        env.emit("skill.load", skill=name, via="mcp")
        return body

    @srv.tool(read_only=True)
    def read_skill_file(name: str, path: Annotated[str, "Path inside the skill folder, e.g. reference/worked-example.md"]) -> str:
        """Read a supporting file that a skill links to."""
        d = skill_dir(name)
        p = (d / path).resolve()
        if d not in p.parents or not p.is_file():
            raise ToolError(f"No such file in skill {name}: {path}")
        env.emit("skill.file", skill=name, path=path, via="mcp")
        return p.read_text()

    return srv


if __name__ == "__main__":
    stdio_main(build)
