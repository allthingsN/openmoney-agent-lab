#!/usr/bin/env bash
# OpenMoney Agent Lab — one command to run it locally.
#   ./lab.sh                 start the UI on http://localhost:7777
#   ./lab.sh bench …         run a benchmark headless (see README)
set -euo pipefail
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ $1 is required. $2"; exit 1; }; }
need uv   "Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
need node "Install Node.js 20+ (https://nodejs.org) — the UI and the TypeScript frameworks need it."

uv sync --quiet
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src -newer web/dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "Building the UI…"
  (cd web && { [ -d node_modules ] || npm ci --silent; } && npm run build --silent)
fi
if [ $# -eq 0 ]; then
  exec uv run --quiet agent-lab serve
fi
exec uv run --quiet agent-lab "$@"
