"""Claude Agent SDK: Claude Code's agent loop, limited to the task's MCP tools, one in-process tool and native skills."""

import asyncio

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher, ResultMessage, create_sdk_mcp_server, query, tool

import labkit


@tool("calculate", labkit.CALCULATE_DESCRIPTION, {"expression": str})
async def calculate(args: dict) -> dict:
    return {"content": [{"type": "text", "text": labkit.calculate(args["expression"])}]}


async def count_skill_load(hook_input: dict, tool_use_id: str | None, context: dict) -> dict:
    labkit.emit("skill.load", skill=hook_input["tool_input"].get("skill"), via="native")
    return {}


def mcp_config(s: dict) -> dict:
    if s["transport"] == "http":
        return {"type": "http", "url": s["url"]}
    return {"type": "stdio", "command": s["command"], "args": s.get("args", [])}


async def main() -> None:
    spec = labkit.load_spec()
    servers = {s["name"]: mcp_config(s) for s in spec["mcp_servers"]}
    if "calculate" in spec["native_tools"]:
        servers["native"] = create_sdk_mcp_server("native", tools=[calculate])
    native_skills = spec["skills"]["mode"] == "native" and spec["skills"]["names"]

    options = ClaudeAgentOptions(
        model=spec["model"],
        system_prompt=spec["system_prompt"],  # a plain string replaces Claude Code's default system prompt
        cwd=spec["workdir"],
        max_turns=spec["max_turns"],
        mcp_servers=servers,
        strict_mcp_config=True,  # ignore any .mcp.json / user MCP config
        # Built-in tools: only Skill. No Bash/Read/Write/Web/Agent/etc., so the agent can only act through the
        # lab's measured MCP servers. MCP tools are allowed whole-server; anything else is denied, never prompted.
        tools=["Skill"] if native_skills else [],
        allowed_tools=[f"mcp__{name}" for name in servers],
        permission_mode="dontAsk",
        skills=spec["skills"]["names"] if native_skills else [],  # adds Skill(<name>) allow rules
        setting_sources=["project"],  # <workdir>/.claude/skills; no user settings, hooks or plugins
        hooks={"PostToolUse": [HookMatcher(matcher="Skill", hooks=[count_skill_load])]},
        # The CLI reads ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY / CLAUDE_CONFIG_DIR from the inherited environment.
        env={"CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(spec["max_tokens"])},
    )

    result = None
    async for message in query(prompt=spec["prompt"], options=options):
        if isinstance(message, ResultMessage):
            result = message
    if result is None or result.is_error:
        raise RuntimeError(f"agent failed: {result and (result.subtype, result.errors, result.result)}")
    labkit.final(result.result or "")


if __name__ == "__main__":
    asyncio.run(main())
