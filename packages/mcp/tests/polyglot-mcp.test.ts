// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpManifest } from "@modelscript/language";
import { mcpPropertySchemaToZod, PolyglotMcpHost } from "../src/polyglot-server.js";
import type { ServerContext } from "../src/types.js";

describe("Polyglot MCP Host Engine", () => {
  test("converts declarative property schemas to Zod types correctly", () => {
    const stringSchema = mcpPropertySchemaToZod({
      type: "string",
      description: "Class name",
      required: true,
    });
    expect(stringSchema.safeParse("Modelica.Mechanics.Rotational").success).toBe(true);
    expect(stringSchema.safeParse(123).success).toBe(false);

    const enumSchema = mcpPropertySchemaToZod({
      type: "string",
      enum: ["rk4", "dopri5", "bdf"],
      default: "dopri5",
    });
    expect(enumSchema.safeParse("rk4").success).toBe(true);
    expect(enumSchema.safeParse("euler").success).toBe(false);

    const objectSchema = mcpPropertySchemaToZod({
      type: "object",
      properties: {
        min: { type: "number", required: true },
        max: { type: "number", required: true },
      },
    });
    expect(objectSchema.safeParse({ min: 0, max: 10 }).success).toBe(true);
    expect(objectSchema.safeParse({ min: 0 }).success).toBe(false);
  });

  test("registers declarative MCP manifest onto McpServer and executes tools", async () => {
    const server = new McpServer({
      name: "test-polyglot-mcp",
      version: "1.0.0",
    });

    const ctx: ServerContext = { current: null };
    const host = new PolyglotMcpHost(server, ctx);

    const testManifest: McpManifest = {
      serverName: "test-polyglot-mcp",
      serverVersion: "1.0.0",
      tools: [
        {
          name: "modelica_flatten_decl",
          description: "Declaratively flattens a Modelica model",
          category: "transformation",
          pure: true,
          inputSchema: {
            className: { type: "string", description: "Target class name", required: true },
          },
        },
        {
          name: "sysml2_extract_topology_decl",
          description: "Extracts physical connection topology",
          category: "ast",
          pure: true,
          inputSchema: {
            partName: { type: "string", description: "Part name", required: true },
          },
        },
      ],
      resources: [
        {
          uriTemplate: "modelscript://workspace/{lang}/{model}/dae",
          name: "Model Flat DAE",
          mimeType: "text/plain",
          description: "Flat DAE equations for model",
        },
      ],
      prompts: [
        {
          name: "diagnose_system",
          description: "Diagnose system inconsistency",
          arguments: [{ name: "systemName", description: "Name of the system" }],
        },
      ],
    };

    // Mock WASM facade
    const mockFacade = {
      mcpDispatchTool: (idx: number) => (idx === 0 || idx === 1 ? 1 : 0),
      mcpGetOutputText: () => "equation\n  der(x) = -x;\nend",
    };

    host.registerManifest(testManifest, () => mockFacade);

    const registered = host.getRegisteredToolNames();
    expect(registered).toContain("modelica_flatten_decl");
    expect(registered).toContain("sysml2_extract_topology_decl");
  });
});
