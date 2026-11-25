// SPDX-License-Identifier: AGPL-3.0-or-later

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createModelScriptMcpServer, type ServerContext } from "@modelscript/mcp";
import type { LLMToolDefinition } from "./llm-client.js";

const BACKEND_MCP_TOOL_ALLOWLIST = new Set([
  "modelica_load",
  "modelica_query",
  "modelica_flatten",
  "modelica_simulate",
  "formal_verify_safety",
  "validate_system_consistency",
]);

export interface BackendMcpSession {
  tools: LLMToolDefinition[];
  toolNames: Set<string>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
}

export async function createBackendMcpSession(userId?: number): Promise<BackendMcpSession> {
  const ctx: ServerContext = {
    current: null,
    ...(userId !== undefined ? { userId } : {}),
  };
  const mcpServer = createModelScriptMcpServer(ctx, { name: "ansatz-backend-mcp", version: "0.1.0" });
  const client = new Client({ name: "ansatz-ai-orchestrator", version: "0.1.0" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  const tools: LLMToolDefinition[] = [];
  const toolNames = new Set<string>();

  for (const t of listed.tools) {
    if (!BACKEND_MCP_TOOL_ALLOWLIST.has(t.name)) continue;
    toolNames.add(t.name);
    tools.push({
      type: "function",
      function: {
        name: t.name,
        description: t.description || `ModelScript MCP tool ${t.name}`,
        parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      },
    });
  }

  return {
    tools,
    toolNames,
    callTool: async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      const parts = Array.isArray(result.content)
        ? result.content
            .map((c) =>
              typeof c === "object" && c !== null && "text" in c
                ? String((c as { text: unknown }).text)
                : JSON.stringify(c),
            )
            .join("\n")
        : JSON.stringify(result);
      return parts || (result.isError ? "MCP tool returned an error." : "OK");
    },
    close: async () => {
      await Promise.allSettled([client.close(), mcpServer.close()]);
    },
  };
}
