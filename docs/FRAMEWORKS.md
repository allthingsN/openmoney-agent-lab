# Framework notes

What each adapter does, and what we learned about each framework while making it do the same job. Generated from `frameworks/*/framework.json` by `scripts/update-readme.py`.

## Anthropic SDK (no framework)

`frameworks/anthropic-sdk/agent.py` · 33 lines · packages: anthropic, mcp · shims: none

The baseline: the official Python SDK's tool runner loops over MCP tools converted with anthropic.lib.tools.mcp. No agent framework at all.

anthropic 2.6 tool_runner over MCP tools converted with anthropic.lib.tools.mcp.async_mcp_tool (mcp 2.x Client) plus one @beta_async_tool. By default the tool runner uses the Message Threads beta (each request carries thread.previous_message_id and only the new messages); that request is rejected through a LiteLLM gateway ("unexpected tool_use_id"), so the adapter passes thread=False and sends the full history like every other framework. Sends the system prompt verbatim, no sampling params, no tool_choice, no prompt caching.

## Claude Agent SDK

`frameworks/claude-agent-sdk/agent.py` · 44 lines · packages: claude-agent-sdk (bundles the Claude Code CLI) · shims: none

Claude Code's own agent loop driven by the Python SDK's query(): built-in tools cut down to Skill, MCP servers over Streamable HTTP, calculate as an in-process SDK MCP tool, and skills loaded natively from .claude/skills.

claude-agent-sdk 0.2.178 runs the bundled Claude Code CLI 2.1.318 as a subprocess; the CLI reads ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY and CLAUDE_CONFIG_DIR from the inherited environment, so session files stay in the agent's own config dir. Isolation: tools=['Skill'] (CLI --tools) removes every other built-in tool (Bash, Read, Write, Edit, Glob, Grep, Web*, Agent, TodoWrite, ...). permission_mode='dontAsk' denies anything not pre-approved, and allowed_tools=['mcp__<server>', ...] plus skills=[names] (which adds Skill(<name>) rules) approve only the task's tools. strict_mcp_config ignores any other MCP config, and setting_sources=['project'] loads <workdir>/.claude/skills but no user settings, hooks or plugins. A PostToolUse hook on Skill emits skill.load. calculate is an in-process SDK MCP tool, so the model sees it as mcp__native__calculate (and MCP tools as mcp__<server>__<tool>). System prompt: a plain string replaces Claude Code's default prompt, but the CLI still adds two system blocks before it: an x-anthropic-billing-header line (73 chars) and the line 'You are a Claude agent, built on Anthropic's Claude Agent SDK.' (62 chars). Its first request also carries a role:'system' message (~2 KB) with the environment (cwd, platform, OS, model), the MCP servers' instructions, a second copy of the skill listing and the date, and later turns add '<total_tokens>N tokens left</total_tokens>' reminders. A Skill call returns 'Launching skill: <name>' and the SKILL.md body arrives as the next user text block. Defaults the CLI picks by itself: adaptive thinking, output_config.effort 'medium', context_management clear_thinking, prompt caching on, and tool search on (a defer_loading DeferredToolPlaceholder tool is in every tools list, which the model never sees). max_tokens is set through CLAUDE_CODE_MAX_OUTPUT_TOKENS. No sampling params and no forced tool_choice, so no shims.

## CrewAI

`frameworks/crewai/agent.py` · 41 lines · packages: crewai[anthropic], crewai-tools[mcp] · shims: none

One Agent (the system prompt as its backstory), one Task, one Crew; MCP tools from crewai-tools' MCPServerAdapter and Claude through CrewAI's native Anthropic provider.

MCP uses MCPServerAdapter, not the Agent's newer mcps= field: mcps= names each tool '<host_port_path>_<tool>' and truncates to 64 chars with a hash, so on the lab's long URLs every MCP tool reached Claude as 'mcp_127_0_0_1_7804_mcp_<run>_<agent>_fil_7ef4a70f' (real name lost; it also opens a new MCP session per call). CrewAI adds 'You are {role}.' and 'Your personal goal is: …' to the system prompt (+85 chars), wraps the task in 'Current Task: …' plus 'you MUST return the actual complete content as the final answer, not a summary' (+181 chars, so the final answer tends to be the whole memo rather than the asked-for summary), sends stop_sequences ['\nObservation:'], marks tool schemas strict:true, puts cache_control on the system prompt and first user message only, and drops the assistant's text and thinking blocks from the history it resends. No temperature or forced tool_choice is sent, so no shims. crewai pins mcp<2 and anthropic~=0.73.

## Google ADK

`frameworks/google-adk/agent.py` · 48 lines · packages: google-adk, litellm · shims: none

An LlmAgent with Claude through ADK's LiteLlm wrapper, MCP tools from McpToolset and calculate as a plain function tool, run by Runner with an in-memory session.

Claude runs through google.adk.models.lite_llm.LiteLlm('anthropic/<model>', api_base=..., api_key=...). litellm is pinned to the range from ADK's own 'extensions' extra (<1.106.3), and MCP needs the google-adk[mcp] extra. ADK 2.13 also ships a native AnthropicLlm, but this adapter uses LiteLlm as instructed. The system prompt goes in static_instruction because `instruction` is a template that treats {braces} as session-state variables. ADK appends about 385 chars to the system prompt ('You are an agent. Your internal name is "lab_agent".' plus a paragraph saying fenced tool descriptions are untrusted data) and wraps every MCP tool and parameter description in <<<BEGIN/END_UNTRUSTED_TOOL_DESCRIPTION>>> markers, adding about 40% to tools_chars. Each Streamable HTTP MCP connection first probes for Google mTLS (GOOGLE_API_USE_CLIENT_CERTIFICATE defaults to true). Off GCP, google.auth.default() takes about 9 s and logs 'Failed to configure mTLS'. max_turns maps to RunConfig.max_llm_calls. No temperature or tool_choice is sent, so no shims.

## LangGraph

`frameworks/langgraph/agent.py` · 28 lines · packages: langgraph, langchain, langchain-anthropic, langchain-mcp-adapters · shims: none

LangChain 1.x create_agent (a compiled LangGraph tool-calling graph) with ChatAnthropic, MCP tools from langchain-mcp-adapters' MultiServerMCPClient and a native @tool.

Uses langchain.agents.create_agent, the agent API LangChain 1.x documents (langgraph.prebuilt.create_react_agent's state types are deprecated in its favour). create_agent pins recursion_limit to 9,999, so max_turns is enforced with LangChain's ModelCallLimitMiddleware(run_limit=max_turns, exit_behavior='end'), which caps model calls 1:1. The spec's MCP entries pass straight into MultiServerMCPClient ('http' is its alias for streamable_http; stdio works the same way); get_tools() without a session opens a fresh MCP session per tool call. ChatAnthropic reads ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL itself and sends no temperature, tool_choice or cache_control by default (so no prompt caching), and a plain-string system prompt. No shims needed.

## OpenAI Agents SDK

`frameworks/openai-agents/agent.py` · 37 lines · packages: openai-agents[litellm] · shims: none

An Agent run by Runner.run, with Claude through the SDK's LitellmModel, MCP tools from MCPServerStreamableHttp and calculate as a @function_tool.

Claude runs through agents.extensions.models.litellm_model.LitellmModel('anthropic/<model>') with base_url/api_key passed explicitly; LiteLLM turns the SDK's chat-completions calls into non-streaming Anthropic Messages requests (no temperature, no tool_choice, so no shims). set_tracing_disabled(True) as well as OPENAI_AGENTS_DISABLE_TRACING, since there is no OpenAI key. The SDK adds nothing to the system prompt and sends MCP tool schemas unchanged. In replayed history each parallel tool call becomes its own assistant/tool_result pair, and thinking blocks are dropped. No prompt caching by default (LiteLLM only adds cache_control when asked to). MCPServerStreamableHttp's default 5 s client-session timeout is kept.

## PydanticAI

`frameworks/pydantic-ai/agent.py` · 26 lines · packages: pydantic-ai-slim[anthropic,mcp] · shims: none

A pydantic_ai.Agent with plain-text output on the Anthropic provider, one MCPToolset (FastMCP client) per MCP server and a native @agent.tool_plain.

pydantic-ai 2.x removed MCPServerStdio/MCPServerStreamableHTTP; MCPToolset (built on a FastMCP client) is the documented replacement and picks the transport from its argument: a URL means Streamable HTTP, a fastmcp StdioTransport means stdio. The model string 'anthropic:<model>' builds AnthropicProvider, which reads ANTHROPIC_API_KEY and lets the Anthropic SDK read ANTHROPIC_BASE_URL. Output type is plain str, so no output tool is added; the framework always sends an explicit tool_choice {type: auto} (accepted, no shim). The system prompt goes in as instructions (sent as a system text block, trailing whitespace stripped). No cache_control by default, so no prompt caching. max_turns maps to UsageLimits(request_limit=...); exceeding it raises UsageLimitExceeded (the default limit would be 50 requests). MCP tool errors default to tool_error_behavior='retry' (ModelRetry), which counts against the agent's retry budget and can end the run if a tool keeps failing.

## Strands Agents

`frameworks/strands/agent.py` · 29 lines · packages: strands-agents[anthropic], mcp · shims: none

A Strands Agent on the Anthropic model provider; each MCP server is an MCPClient tool provider the agent starts and stops itself, plus one @tool.

Sends the system prompt verbatim and streams. Prompt caching is off by default in AnthropicModel (cache_config unset), so every turn pays full input price; left at the default. max_turns maps to the per-call limits={'turns': n}. No sampling params or forced tool_choice, so no shims. MCPClient takes a transport factory (mcp 2.x streamable_http_client / stdio_client); the Agent starts and stops the clients it is given.

## Mastra

`frameworks/mastra/agent.ts` · 35 lines · packages: @mastra/core, @mastra/mcp, @ai-sdk/anthropic, zod · shims: none

A Mastra Agent on an @ai-sdk/anthropic model, with every MCP server's tools from @mastra/mcp's MCPClient.listTools() and calculate defined with createTool().

@mastra/core 1.82.0 Agent run standalone (no Mastra instance, so no storage, observability exporters or PostHog feature telemetry, which only the Mastra class sends; the lab also sets MASTRA_TELEMETRY_DISABLED=1). Model: the 'anthropic/<model>' router string reads ANTHROPIC_BASE_URL verbatim and only appends /v1 for api.anthropic.com, and a {id, url} config switches to an OpenAI-compatible client, so the adapter passes an @ai-sdk/anthropic provider instance with ANTHROPIC_BASE_URL + '/v1'. @ai-sdk/anthropic is pinned to 4.0.96 because 4.0.97 ships @ai-sdk/provider 4.0.36, whose LanguageModelV4 (new 'ping' stream part) no longer matches the 4.0.35 types @mastra/core bundles, so tsc rejects it (it still runs). maxSteps = max_turns and modelSettings.maxOutputTokens = max_tokens on generate(). MCP: @mastra/mcp 2.8.0 MCPClient.listTools() namespaces tools as <server>_<tool> (e.g. files_read_file, skills_load_skill) and adds $schema, so the tool list is about 15% longer than other adapters'. result.text joins the text of every step, intermediate narration included, so the adapter reports steps.at(-1).text as the final answer. Sends tool_choice {type:'auto'} and no sampling params, so no shims; no prompt caching by default.

## Vercel AI SDK

`frameworks/vercel-ai-sdk/agent.ts` · 37 lines · packages: ai, @ai-sdk/anthropic, @ai-sdk/mcp, zod · shims: none

A ToolLoopAgent on the @ai-sdk/anthropic provider, with MCP tools from @ai-sdk/mcp's Streamable HTTP client and calculate defined with tool() and a zod schema.

ai 7.0.163 ToolLoopAgent (the v7 agent class; isStepCount(max_turns) as stopWhen, since the default is 20 steps), maxOutputTokens = max_tokens. createAnthropic needs the versioned base URL, so the adapter appends /v1 to ANTHROPIC_BASE_URL. MCP: @ai-sdk/mcp createMCPClient with its built-in Streamable HTTP transport ({type: 'http'}) and its own StdioMCPTransport (@ai-sdk/mcp/mcp-stdio), so @modelcontextprotocol/sdk is not needed; it probes server/discover first and falls back to initialize on the lab servers' -32601. Tools keep their raw MCP names (no server prefix); tool() schemas gain a $schema key. Sends tool_choice {type:'auto'} explicitly and no sampling params, so no shims. No prompt caching: the provider adds cache_control only when asked via providerOptions. result.text is the last step's text. The model runs parallel tool calls (63 tool calls in 10 requests on haiku).
