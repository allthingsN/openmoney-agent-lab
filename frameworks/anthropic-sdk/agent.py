"""Baseline: no framework. The Anthropic Python SDK's tool runner, with MCP tools and one native tool."""

import asyncio
from contextlib import AsyncExitStack

from anthropic import AsyncAnthropic
from anthropic.lib.tools import beta_async_tool
from anthropic.lib.tools.mcp import async_mcp_tool
from mcp import Client, StdioServerParameters

import labkit


@beta_async_tool(description=labkit.CALCULATE_DESCRIPTION)
async def calculate(expression: str) -> str:
    return labkit.calculate(expression)


async def main() -> None:
    spec = labkit.load_spec()
    client = AsyncAnthropic()  # ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL from the environment

    async with AsyncExitStack() as stack:
        tools = [calculate] if "calculate" in spec["native_tools"] else []
        for s in spec["mcp_servers"]:
            target = s["url"] if s["transport"] == "http" else StdioServerParameters(command=s["command"], args=s.get("args", []))
            mcp = await stack.enter_async_context(Client(target))
            tools += [async_mcp_tool(t, mcp) for t in (await mcp.list_tools()).tools]

        runner = client.beta.messages.tool_runner(
            model=spec["model"],
            max_tokens=spec["max_tokens"],
            system=spec["system_prompt"],
            tools=tools,
            messages=[{"role": "user", "content": spec["prompt"]}],
            max_iterations=spec["max_turns"],
            # Send the whole conversation each turn instead of a server-side message thread, so requests work
            # through gateways such as LiteLLM and match what the other frameworks send.
            thread=False,
        )
        message = await runner.until_done()

    labkit.final("".join(b.text for b in message.content if b.type == "text"))


if __name__ == "__main__":
    asyncio.run(main())
