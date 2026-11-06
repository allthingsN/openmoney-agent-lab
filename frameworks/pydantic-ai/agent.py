"""PydanticAI: a pydantic_ai.Agent on its Anthropic provider, with one MCPToolset per MCP server."""

import asyncio

from fastmcp.client.transports import StdioTransport
from pydantic_ai import Agent, UsageLimits
from pydantic_ai.mcp import MCPToolset

import labkit


def toolset(server: dict) -> MCPToolset:
    if server["transport"] == "http":  # Streamable HTTP
        return MCPToolset(server["url"], id=server["name"])
    return MCPToolset(StdioTransport(command=server["command"], args=server.get("args", [])), id=server["name"])


async def main() -> None:
    spec = labkit.load_spec()
    agent = Agent(
        f"anthropic:{spec['model']}",  # AnthropicProvider: ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL from the environment
        instructions=spec["system_prompt"],
        toolsets=[toolset(s) for s in spec["mcp_servers"]],
        model_settings={"max_tokens": spec["max_tokens"]},
    )

    if "calculate" in spec["native_tools"]:
        @agent.tool_plain(description=labkit.CALCULATE_DESCRIPTION)
        def calculate(expression: str) -> str:
            return labkit.calculate(expression)

    result = await agent.run(spec["prompt"], usage_limits=UsageLimits(request_limit=spec["max_turns"]))
    labkit.final(result.output)


if __name__ == "__main__":
    asyncio.run(main())
