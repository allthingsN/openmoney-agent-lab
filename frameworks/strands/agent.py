"""Strands Agents: an Agent with the Anthropic model provider, MCP servers as MCPClient tool providers and one @tool."""

import os

from mcp import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client
from strands import Agent, tool
from strands.models.anthropic import AnthropicModel
from strands.tools.mcp import MCPClient

import labkit


@tool(description=labkit.CALCULATE_DESCRIPTION)
def calculate(expression: str) -> str:
    return labkit.calculate(expression)


def mcp_client(s: dict) -> MCPClient:
    if s["transport"] == "http":
        return MCPClient(lambda: streamable_http_client(s["url"]))
    return MCPClient(lambda: stdio_client(StdioServerParameters(command=s["command"], args=s.get("args", []))))


def main() -> None:
    spec = labkit.load_spec()
    model = AnthropicModel(
        client_args={"base_url": os.environ["ANTHROPIC_BASE_URL"], "api_key": os.environ["ANTHROPIC_API_KEY"]},
        model_id=spec["model"],
        max_tokens=spec["max_tokens"],
    )
    tools = [calculate] if "calculate" in spec["native_tools"] else []
    tools += [mcp_client(s) for s in spec["mcp_servers"]]  # the agent starts and stops each client

    with Agent(model=model, system_prompt=spec["system_prompt"], tools=tools) as agent:
        result = agent(spec["prompt"], limits={"turns": spec["max_turns"]})

    labkit.final(str(result))


if __name__ == "__main__":
    main()
