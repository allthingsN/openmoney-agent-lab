"""Safe paths from untrusted input (URL parameters, request bodies, model-written designs).

Every path the server builds from outside input goes through `within()`: the result is resolved (symlinks and `..`
included) and must stay inside its base directory, or `UnsafePath` is raised. `safe_id()` additionally limits ids
(run, agent, result, build slug) to a conservative character set.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")


class UnsafePath(ValueError):
    pass


def safe_id(value: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value) or ".." in value:
        raise UnsafePath("invalid id")
    return value


def within(base: str | os.PathLike, *parts: str) -> Path:
    """`base/parts…`, resolved, guaranteed to be `base` itself or inside it."""
    root = os.path.realpath(base)
    candidate = os.path.realpath(os.path.join(root, *[str(p) for p in parts]))
    if candidate != root and not candidate.startswith(root + os.sep):
        raise UnsafePath("path escapes its folder")
    return Path(candidate)
