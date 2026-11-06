// Mastra: an Agent on the Anthropic provider, MCP tools from MCPClient, one native createTool().
import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { MCPClient } from "@mastra/mcp";
import { z } from "zod";

import * as labkit from "./labkit.ts";

const spec = labkit.loadSpec();
// Mastra's "anthropic/<model>" router string would use ANTHROPIC_BASE_URL verbatim, but the lab's value has no
// /v1, so pass an AI SDK provider instance (Mastra accepts these) with the versioned URL.
const anthropic = createAnthropic({ baseURL: `${process.env.ANTHROPIC_BASE_URL}/v1`, apiKey: process.env.ANTHROPIC_API_KEY });

const calculate = createTool({
  id: "calculate",
  description: labkit.CALCULATE_DESCRIPTION,
  inputSchema: z.object({ expression: z.string() }),
  execute: ({ expression }) => labkit.calculate(expression),
});

const mcp = new MCPClient({
  servers: Object.fromEntries(spec.mcp_servers.map((s) => [
    s.name, s.transport === "http" ? { url: new URL(s.url!) } : { command: s.command!, args: s.args ?? [] },
  ])),
});

try {
  const agent = new Agent({
    id: "lab-agent",
    name: "Lab agent",
    instructions: spec.system_prompt,
    model: anthropic(spec.model),
    tools: { ...(spec.native_tools.includes("calculate") ? { calculate } : {}), ...(await mcp.listTools()) },
  });
  const result = await agent.generate(spec.prompt, {
    maxSteps: spec.max_turns,
    modelSettings: { maxOutputTokens: spec.max_tokens },
  });
  await labkit.final(result.steps.at(-1)?.text ?? result.text); // result.text joins the text of every step
} finally {
  await mcp.disconnect();
}
