#!/usr/bin/env bash
# Copy the shared labkit into every framework adapter (Python and TypeScript).
set -euo pipefail
cd "$(dirname "$0")/.."
for d in frameworks/*/; do
  [ "$d" = "frameworks/_shared/" ] && continue
  [ -f "$d/labkit.py" ] && cp frameworks/_shared/labkit.py "$d/labkit.py"
  [ -f "$d/labkit.ts" ] && [ -f frameworks/_shared/labkit.ts ] && cp frameworks/_shared/labkit.ts "$d/labkit.ts"
done
echo "labkit synced"
