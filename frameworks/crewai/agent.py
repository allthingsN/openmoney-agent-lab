"""CrewAI: one Agent, one Task, one Crew. MCP tools through crewai-tools' MCPServerAdapter, Claude through CrewAI's
native Anthropic provider."""

import os
from contextlib import ExitStack

from crewai import LLM, Agent, Crew, Task
from crewai.tools import BaseTool
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

import labkit


class Calculate(BaseTool):
    name: str = "calculate"
    description: str = labkit.CALCULATE_DESCRIPTION

    def _run(self, expression: str) -> str:
        return labkit.calculate(expression)


def main() -> None:
    spec = labkit.load_spec()
    llm = LLM(
        model=f"anthropic/{spec['model']}",
        base_url=os.environ["ANTHROPIC_BASE_URL"],
        api_key=os.environ["ANTHROPIC_API_KEY"],
        max_tokens=spec["max_tokens"],
    )

    with ExitStack() as stack:
        tools = [Calculate()] if "calculate" in spec["native_tools"] else []
        for s in spec["mcp_servers"]:
            params = ({"url": s["url"], "transport": "streamable-http"} if s["transport"] == "http"
                      else StdioServerParameters(command=s["command"], args=s.get("args", [])))
            tools += stack.enter_context(MCPServerAdapter(params))

        agent = Agent(
            role="Assistant",
            goal="Do what the person asks, using your tools.",
            backstory=spec["system_prompt"],
            llm=llm,
            tools=tools,
            max_iter=spec["max_turns"],
        )
        task = Task(description=spec["prompt"], expected_output="The final answer for the person", agent=agent)
        result = Crew(agents=[agent], tasks=[task]).kickoff()

    labkit.final(result.raw)


if __name__ == "__main__":
    main()
