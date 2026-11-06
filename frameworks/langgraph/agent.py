"""LangGraph: LangChain's create_agent (a LangGraph ReAct graph) over MCP tools from langchain-mcp-adapters."""

import asyncio

from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain.tools import tool
from langchain_anthropic import ChatAnthropic
from langchain_mcp_adapters.client import MultiServerMCPClient

import labkit


@tool(description=labkit.CALCULATE_DESCRIPTION)
def calculate(expression: str) -> str:
    return labkit.calculate(expression)


async def main() -> None:
    spec = labkit.load_spec()
    # ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL come from the environment.
    model = ChatAnthropic(model=spec["model"], max_tokens=spec["max_tokens"])

    # The spec's server entries are already MultiServerMCPClient connections ("http" = Streamable HTTP, or "stdio").
    client = MultiServerMCPClient({s["name"]: {k: v for k, v in s.items() if k != "name"} for s in spec["mcp_servers"]})
    tools = await client.get_tools()
    if "calculate" in spec["native_tools"]:
        tools.append(calculate)

    agent = create_agent(
        model,
        tools,
        system_prompt=spec["system_prompt"],
        middleware=[ModelCallLimitMiddleware(run_limit=spec["max_turns"], exit_behavior="end")],
    )
    result = await agent.ainvoke({"messages": [{"role": "user", "content": spec["prompt"]}]})
    labkit.final(result["messages"][-1].text)


if __name__ == "__main__":
    asyncio.run(main())
