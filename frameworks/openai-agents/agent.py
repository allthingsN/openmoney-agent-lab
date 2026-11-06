"""OpenAI Agents SDK: an Agent running Claude through the SDK's LiteLLM model, with MCP servers and one function tool."""

import asyncio
import os
from contextlib import AsyncExitStack

from agents import Agent, ModelSettings, Runner, function_tool, set_tracing_disabled
from agents.extensions.models.litellm_model import LitellmModel
from agents.mcp import MCPServerStdio, MCPServerStreamableHttp

import labkit

set_tracing_disabled(True)  # traces would go to OpenAI; there is no OpenAI key here


@function_tool(description_override=labkit.CALCULATE_DESCRIPTION)
def calculate(expression: str) -> str:
    return labkit.calculate(expression)


def mcp_server(s: dict):
    if s["transport"] == "http":
        return MCPServerStreamableHttp({"url": s["url"]}, name=s["name"], cache_tools_list=True)
    return MCPServerStdio({"command": s["command"], "args": s.get("args", [])}, name=s["name"], cache_tools_list=True)


async def main() -> None:
    spec = labkit.load_spec()
    model = LitellmModel(
        model=f"anthropic/{spec['model']}",
        base_url=os.environ["ANTHROPIC_BASE_URL"],
        api_key=os.environ["ANTHROPIC_API_KEY"],
    )

    async with AsyncExitStack() as stack:
        servers = [await stack.enter_async_context(mcp_server(s)) for s in spec["mcp_servers"]]
        agent = Agent(
            name="lab-agent",
            instructions=spec["system_prompt"],
            model=model,
            model_settings=ModelSettings(max_tokens=spec["max_tokens"]),
            tools=[calculate] if "calculate" in spec["native_tools"] else [],
            mcp_servers=servers,
        )
        result = await Runner.run(agent, spec["prompt"], max_turns=spec["max_turns"])

    labkit.final(str(result.final_output))


if __name__ == "__main__":
    asyncio.run(main())
