// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpManifest, McpManifestTool, McpPropertySchema } from "@modelscript/language";
import { z } from "zod";
import type { ServerContext } from "./types.js";

/**
 * Converts a declarative McpPropertySchema into a runtime Zod validator.
 */
export function mcpPropertySchemaToZod(schema: McpPropertySchema): z.ZodTypeAny {
  let zType: z.ZodTypeAny;

  switch (schema.type) {
    case "string":
      if (schema.enum && schema.enum.length > 0) {
        zType = z.enum(schema.enum as [string, ...string[]]);
      } else {
        zType = z.string();
      }
      break;
    case "number":
      zType = z.number();
      break;
    case "boolean":
      zType = z.boolean();
      break;
    case "array":
      zType = schema.items ? z.array(mcpPropertySchemaToZod(schema.items)) : z.array(z.any());
      break;
    case "object":
      if (schema.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [k, v] of Object.entries(schema.properties)) {
          shape[k] = mcpPropertySchemaToZod(v);
        }
        zType = z.object(shape);
      } else {
        zType = z.record(z.any());
      }
      break;
    default:
      zType = z.any();
  }

  if (schema.description) {
    zType = zType.describe(schema.description);
  }

  if (!schema.required) {
    zType =
      schema.default !== undefined
        ? (zType as z.ZodType<unknown>).default(schema.default).optional()
        : zType.optional();
  }

  return zType;
}

/**
 * Polyglot Model Context Protocol (MCP) Host.
 * Dynamically registers declarative language tools, resources, and prompts onto an McpServer.
 */
export class PolyglotMcpHost {
  private registeredTools = new Map<string, McpManifestTool>();

  constructor(
    private server: McpServer,
    private context: ServerContext,
  ) {}

  /**
   * Registers all declarative tools, resources, and prompts from an MCP manifest.
   */
  public registerManifest(
    manifest: McpManifest,
    wasmFacadeProvider?: (
      tool: McpManifestTool,
    ) => { mcpDispatchTool?: (idx: number) => number; mcpGetOutputText?: () => string } | null,
  ): void {
    for (const tool of manifest.tools) {
      if (this.registeredTools.has(tool.name)) continue;
      this.registeredTools.set(tool.name, tool);

      // Build Zod shape for tool input arguments
      const zodShape: Record<string, z.ZodTypeAny> = {};
      for (const [propName, propSchema] of Object.entries(tool.inputSchema)) {
        zodShape[propName] = mcpPropertySchemaToZod(propSchema);
      }

      this.server.tool(tool.name, tool.description, zodShape, async (args: Record<string, unknown>) => {
        // 1. Try zero-copy in-WASM fast-path if pure and facade available
        const facade = wasmFacadeProvider ? wasmFacadeProvider(tool) : null;
        if (facade && tool.pure && typeof facade.mcpDispatchTool === "function") {
          const toolIndex = manifest.tools.findIndex((t) => t.name === tool.name);
          if (toolIndex >= 0) {
            const status = facade.mcpDispatchTool(toolIndex);
            if (status === 1) {
              const output = facade.mcpGetOutputText ? facade.mcpGetOutputText() : "";
              return {
                content: [{ type: "text" as const, text: output || "Execution succeeded (in-WASM)." }],
              };
            }
          }
        }

        // 2. Return success status with serialized arguments
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ status: "success", tool: tool.name, args }, null, 2),
            },
          ],
        };
      });
    }

    // Register declarative resources
    for (const resource of manifest.resources) {
      this.server.resource(
        resource.name,
        resource.uriTemplate,
        {
          description: resource.description,
          mimeType: resource.mimeType || "application/json",
        },
        async (uri) => {
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify({ uri: uri.href, resource: resource.name, status: "available" }),
                mimeType: resource.mimeType || "application/json",
              },
            ],
          };
        },
      );
    }

    // Register declarative prompt templates
    for (const prompt of manifest.prompts) {
      const promptShape: Record<string, z.ZodTypeAny> = {};
      for (const arg of prompt.arguments || []) {
        let zArg: z.ZodTypeAny = z.string();
        if (arg.description) zArg = zArg.describe(arg.description);
        if (!arg.required) zArg = zArg.optional();
        promptShape[arg.name] = zArg;
      }

      this.server.prompt(prompt.name, prompt.description, promptShape, async (args: Record<string, string>) => {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Prompt template '${prompt.name}' with arguments: ${JSON.stringify(args)}`,
              },
            },
          ],
        };
      });
    }
  }

  /**
   * Returns all registered tool names.
   */
  public getRegisteredToolNames(): string[] {
    return Array.from(this.registeredTools.keys());
  }
}
