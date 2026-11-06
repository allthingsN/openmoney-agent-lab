#!/usr/bin/env python3
"""Run this agent on one of its frameworks.

    python3 run.py <framework> ["your request"] [--model claude-opus-5-5]

Reads the model key from the environment or a .env file next to this script:
  ANTHROPIC_API_KEY=sk-ant-...                       (Anthropic directly), or
  ANTHROPIC_BASE_URL=https://your-litellm ANTHROPIC_API_KEY=sk-...   (a LiteLLM proxy in front of Anthropic)
Standard library only.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_env() -> dict:
    env = dict(os.environ)
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if env.get("LITELLM_BASE_URL") and not env.get("ANTHROPIC_BASE_URL"):
        env["ANTHROPIC_BASE_URL"] = env["LITELLM_BASE_URL"]
    if env.get("LITELLM_API_KEY") and not env.get("ANTHROPIC_API_KEY"):
        env["ANTHROPIC_API_KEY"] = env["LITELLM_API_KEY"]
    if env.get("ANTHROPIC_BASE_URL", "").rstrip("/").endswith("/v1"):
        env["ANTHROPIC_BASE_URL"] = env["ANTHROPIC_BASE_URL"].rstrip("/")[:-3]
    return env


def main() -> None:
    args = [a for a in sys.argv[1:]]
    model = None
    if "--model" in args:
        i = args.index("--model")
        model = args[i + 1]
        del args[i:i + 2]
    agent = json.loads((ROOT / "agent.json").read_text())
    if not args or args[0] not in agent["frameworks"]:
        print(__doc__)
        print("frameworks:", ", ".join(agent["frameworks"]))
        sys.exit(2)
    fid = args[0]
    prompt = args[1] if len(args) > 1 else agent["prompt"]
    fw_dir = ROOT / "frameworks" / fid
    fw = json.loads((fw_dir / "framework.json").read_text())
    env = load_env()
    if not env.get("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY (in .env or the environment) first.")

    work = ROOT / ".run" / fid
    work.mkdir(parents=True, exist_ok=True)
    py = sys.executable or "python3"
    ws = ROOT / "workspace"
    servers = []
    native = fw.get("skills") == "native"
    for s in agent["servers"]:
        if s == "skills" and native:
            continue
        a = [str(ROOT / "servers" / f"{s}.py"), "--workspace", str(ws)]
        if (ROOT / "data").exists():
            a += ["--data", str(ROOT / "data")]
        if (ROOT / "skills").exists():
            a += ["--skills", str(ROOT / "skills")]
        servers.append({"name": s, "transport": "stdio", "command": py, "args": a})
    skills_dir = work / ".claude" / "skills"
    if native and (ROOT / "skills").exists():
        shutil.rmtree(skills_dir, ignore_errors=True)
        shutil.copytree(ROOT / "skills", skills_dir)
    system = agent["system_prompt"]
    if agent.get("skills"):
        how = "Load a skill with the Skill tool." if native else "Load a skill with the `load_skill` tool."
        lines = []
        for n in agent["skills"]:
            text = (ROOT / "skills" / n / "SKILL.md").read_text()
            desc = next((l.split(":", 1)[1].strip() for l in text.splitlines() if l.startswith("description:")), "")
            lines.append(f"- **{n}**: {desc}")
        system += f"\n\n## Skills\n{how} Available skills:\n" + "\n".join(lines) + "\n"
    spec = {"agent_id": fid, "framework": fid, "model": model or env.get("ANTHROPIC_MODEL") or agent["model"],
            "max_tokens": agent.get("max_tokens", 16000), "max_turns": agent.get("max_turns", 40),
            "system_prompt": system, "prompt": prompt, "mcp_servers": servers,
            "skills": {"mode": "native" if native else "mcp", "names": agent.get("skills", []), "dir": str(skills_dir)},
            "native_tools": agent.get("native_tools", ["calculate"]), "workdir": str(work)}
    spec_path = work / "agent.json"
    spec_path.write_text(json.dumps(spec, indent=2))

    marker = fw_dir / (".venv" if fw["language"] == "python" else "node_modules")
    if not marker.exists():
        print(f"Installing {fw['name']} (first run only)…", flush=True)
        subprocess.run([c.replace("{dir}", str(fw_dir)) for c in fw["setup"]], cwd=fw_dir, check=True)
    env.setdefault("CLAUDE_CONFIG_DIR", str(work / ".claude-config"))
    for k, v in {"GOOGLE_API_USE_CLIENT_CERTIFICATE": "false", "OPENAI_AGENTS_DISABLE_TRACING": "1",
                 "CREWAI_DISABLE_TELEMETRY": "true", "OTEL_SDK_DISABLED": "true", "DO_NOT_TRACK": "1"}.items():
        env.setdefault(k, v)
    env["LAB_SPEC"] = str(spec_path)
    cmd = [c.replace("{dir}", str(fw_dir)).replace("{spec}", str(spec_path)) for c in fw["run"]]
    print(f"→ {fw['name']} · {spec['model']}\n", flush=True)
    sys.exit(subprocess.run(cmd, cwd=work, env=env).returncode)


if __name__ == "__main__":
    main()
