// Vercel AI SDK: a ToolLoopAgent over the Anthropic provider, MCP tools from @ai-sdk/mcp, one native tool().
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { ToolLoopAgent, isStepCount, tool, type ToolSet } from "ai";
import { z } from "zod";

import * as labkit from "./labkit.ts";

const spec = labkit.loadSpec();
// The provider reads ANTHROPIC_API_KEY itself; its base URL setting includes the /v1 the lab's variable leaves out.
const anthropic = createAnthropic({ baseURL: `${process.env.ANTHROPIC_BASE_URL}/v1`, apiKey: process.env.ANTHROPIC_API_KEY });

const clients: MCPClient[] = [];
try {
  const tools: ToolSet = {};
  if (spec.native_tools.includes("calculate")) {
    tools.calculate = tool({
      description: labkit.CALCULATE_DESCRIPTION,
      inputSchema: z.object({ expression: z.string() }),
      execute: ({ expression }) => labkit.calculate(expression),
    });
  }
  for (const s of spec.mcp_servers) {
    const client = await createMCPClient({
      transport: s.transport === "http" ? { type: "http", url: s.url! } : new StdioMCPTransport({ command: s.command!, args: s.args }),
    });
    clients.push(client);
    Object.assign(tools, await client.tools());
  }

  const agent = new ToolLoopAgent({
    model: anthropic(spec.model),
    instructions: spec.system_prompt,
    tools,
    maxOutputTokens: spec.max_tokens,
    stopWhen: isStepCount(spec.max_turns),
  });
  const result = await agent.generate({ prompt: spec.prompt });
  await labkit.final(result.text);
} finally {
  await Promise.all(clients.map((c) => c.close()));
}
