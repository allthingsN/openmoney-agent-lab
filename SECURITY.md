# Security

Report a vulnerability privately through GitHub's **Report a vulnerability** (Security tab), or email
support@allthingsn.com. Please don't open a public issue for it.

## How the lab protects you

- **Local only by default.** `./lab.sh` binds to `127.0.0.1`; Docker Compose publishes `127.0.0.1:7777` only.
- **Other websites can't drive it.** Requests whose `Origin` is another site, `null`, or marked `Sec-Fetch-Site:
  cross-site` are refused, and the server only answers to `localhost`-style `Host` names (DNS rebinding). Add your own
  hostnames with `LAB_ALLOWED_HOSTS`.
- **Your key stays in the lab process.** Agents get the lab's local proxy and a per-agent token; the proxy refuses
  any other token. Settings are saved `0600` in `.lab/`.
- **Paths from requests are confined.** Every id is checked (`[A-Za-z0-9._-]`) and every path is resolved and must
  stay inside its folder (`lab/safepath.py`); tested in `tests/test_security.py`.
- **No commands for web requests.** The server never runs `git`, `gh` or a shell for a request. Publishing a built
  agent to GitHub shows the commands for you to run yourself.
- **Generated code is reviewed before it runs.** The Agent Builder statically checks generated tools (stdlib
  allowlist, no `eval`/`exec`/`open`/`os`/`subprocess`) and requires you to confirm you read them; build folders never
  serve or zip `.env` files.
- **Agents are fenced in.** Each framework runs as its own process with only the task's MCP tools; the Claude Agent SDK's
  built-in tools (Bash, file access, web) are switched off.

## Dependencies

Each framework keeps its own lock file; Dependabot watches all of them (`.github/dependabot.yml`).

| Package | Where | Status |
|---|---|---|
| `filelock` ≥ 4.2.1 | google-adk, openai-agents | Forced with a uv override (litellm caps it below 4). Verified with full runs. |
| `opentelemetry-api/sdk` ≥ 1.45.1 | google-adk | Forced with a uv override (google-adk caps it at 1.44). Verified with full runs. |
| `chromadb` 1.5.9 | crewai | **No fixed release exists.** CrewAI imports it unconditionally. All four advisories (GHSA-36p7-vc44-83pf, GHSA-f4j7-r4q5-qw2c, GHSA-2wm9-hf6c-p5cr, GHSA-xph7-9rjv-w5fr) are in Chroma's **HTTP server** (tenant authorization and the collections API). The lab never starts a Chroma server and the CrewAI adapter enables no memory, knowledge or embeddings (`tests/test_security.py` keeps it that way), so the vulnerable code is not used. We'll upgrade as soon as Chroma ships a fix. |
