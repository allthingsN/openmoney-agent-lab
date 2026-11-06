# OpenMoney Agent Lab — every framework pre-installed, UI built.
#   docker compose up --build        then open http://localhost:7777
FROM node:24-bookworm-slim

COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /uvx /usr/local/bin/
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*

ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    LAB_STATE_DIR=/data/state \
    LAB_RUNS_DIR=/data/runs \
    PYTHONUNBUFFERED=1

WORKDIR /lab
COPY . .
RUN uv python install 3.12 && uv sync --frozen --no-dev
RUN cd web && npm ci --silent && npm run build --silent

# Install every framework's own environment now so runs start instantly (set PREINSTALL=none for a slim image).
ARG PREINSTALL=all
RUN if [ "$PREINSTALL" = "all" ]; then uv run --no-dev agent-lab setup; fi

EXPOSE 7777
VOLUME ["/data"]
CMD ["uv", "run", "--no-dev", "agent-lab", "serve", "--host", "0.0.0.0", "--port", "7777"]
