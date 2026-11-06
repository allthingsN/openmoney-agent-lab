"""files: read the agent's workspace; write only under outbox/."""

from __future__ import annotations

import os
from typing import Annotated

try:
    from lab.mcpkit import Env, ToolError, ToolServer, stdio_main
except ImportError:  # exported, stand-alone
    from mcpkit import Env, ToolError, ToolServer, stdio_main

MAX_READ = 60_000
WRITABLE = ("outbox/",)


def build(env: Env) -> ToolServer:
    srv = ToolServer("files", "Read the files in this workspace. Writing is allowed under outbox/ only.")
    root = env.workspace.resolve()

    def resolve(path: str):
        p = (root / path.lstrip("/")).resolve()
        if p != root and root not in p.parents:
            raise ToolError("Path is outside the workspace")
        return p

    @srv.tool(read_only=True)
    def list_files(directory: Annotated[str, "Folder relative to the workspace root, e.g. '' or 'inbox'"] = "") -> dict:
        """List files (recursively) under a workspace folder, with sizes in bytes."""
        base = resolve(directory)
        if not base.exists():
            raise ToolError(f"No such folder: {directory}")
        files = []
        for dirpath, _, names in os.walk(base):
            for n in sorted(names):
                full = os.path.join(dirpath, n)
                files.append({"path": os.path.relpath(full, root), "bytes": os.path.getsize(full)})
        return {"files": sorted(files, key=lambda f: f["path"])}

    @srv.tool(read_only=True)
    def read_file(path: Annotated[str, "File path relative to the workspace root"]) -> str:
        """Read a text file from the workspace."""
        p = resolve(path)
        if not p.is_file():
            raise ToolError(f"No such file: {path}")
        text = p.read_text(errors="replace")
        return text if len(text) <= MAX_READ else text[:MAX_READ] + "\n…[truncated]"

    @srv.tool(destructive=False)
    def write_file(path: Annotated[str, "Path under outbox/, e.g. outbox/memo.md"],
                   content: Annotated[str, "Full file content"]) -> dict:
        """Create or overwrite a file under outbox/ (the only writable folder)."""
        rel = path.lstrip("/")
        if not rel.startswith(WRITABLE):
            raise ToolError("You can only write under outbox/")
        p = resolve(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return {"written": rel, "bytes": len(content.encode())}

    return srv


if __name__ == "__main__":
    stdio_main(build)
