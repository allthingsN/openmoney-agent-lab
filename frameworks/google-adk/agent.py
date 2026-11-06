"""Google ADK: an LlmAgent running Claude through ADK's LiteLlm wrapper, with MCP toolsets and one function tool."""

import asyncio
import os

from google.adk.agents import LlmAgent, RunConfig
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools.mcp_tool import McpToolset, StdioConnectionParams, StreamableHTTPConnectionParams
from google.genai import types
from mcp import StdioServerParameters

import labkit


def calculate(expression: str) -> str:
    return labkit.calculate(expression)


calculate.__doc__ = labkit.CALCULATE_DESCRIPTION  # ADK takes a function tool's description from its docstring


def mcp_toolset(s: dict) -> McpToolset:
    if s["transport"] == "http":
        return McpToolset(connection_params=StreamableHTTPConnectionParams(url=s["url"]))
    server = StdioServerParameters(command=s["command"], args=s.get("args", []))
    return McpToolset(connection_params=StdioConnectionParams(server_params=server))


async def main() -> None:
    spec = labkit.load_spec()
    agent = LlmAgent(
        name="lab_agent",
        model=LiteLlm(
            model=f"anthropic/{spec['model']}",
            api_base=os.environ["ANTHROPIC_BASE_URL"],
            api_key=os.environ["ANTHROPIC_API_KEY"],
        ),
        static_instruction=spec["system_prompt"],  # sent as-is; `instruction` would treat {braces} as state variables
        generate_content_config=types.GenerateContentConfig(max_output_tokens=spec["max_tokens"]),
        tools=([calculate] if "calculate" in spec["native_tools"] else []) + [mcp_toolset(s) for s in spec["mcp_servers"]],
    )

    runner = Runner(agent=agent, app_name="lab", session_service=InMemorySessionService(), auto_create_session=True)
    answer = ""
    try:
        async for event in runner.run_async(
            user_id="lab",
            session_id="lab",
            new_message=types.Content(role="user", parts=[types.Part(text=spec["prompt"])]),
            run_config=RunConfig(max_llm_calls=spec["max_turns"]),
        ):
            if event.is_final_response() and event.content and event.content.parts:
                answer = "".join(p.text or "" for p in event.content.parts if not p.thought)
    finally:
        await runner.close()  # closes the MCP sessions

    labkit.final(answer)


if __name__ == "__main__":
    asyncio.run(main())
