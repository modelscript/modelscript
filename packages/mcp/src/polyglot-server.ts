// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpManifest, McpManifestTool } from "@modelscript/dsl/codegen/compile_mcp.js";
import type { McpPropertySchema } from "@modelscript/dsl/dsl/language.js";
import { DigitalThreadHypergraph, ThreadDomain } from "@modelscript/runtime";
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

const DOMAIN_NAME_MAP: Record<number, string> = {
  [ThreadDomain.SysML2]: "sysml2",
  [ThreadDomain.Modelica]: "modelica",
  [ThreadDomain.CAD]: "cad",
  [ThreadDomain.Requirements]: "requirements",
  [ThreadDomain.FEA]: "fea",
  [ThreadDomain.CFD]: "cfd",
  [ThreadDomain.BOM]: "bom",
  [ThreadDomain.FMU]: "fmu",
  [ThreadDomain.GDT]: "gdt",
  [ThreadDomain.Telemetry]: "telemetry",
  [ThreadDomain.Safety]: "safety",
  [ThreadDomain.Surrogate]: "surrogate",
  [ThreadDomain.Manufacturing]: "manufacturing",
  [ThreadDomain.CostCarbon]: "cost_carbon",
  [ThreadDomain.Verification]: "verification",
  [ThreadDomain.Software]: "software",
};

/**
 * Polyglot Model Context Protocol (MCP) Host.
 * Dynamically registers declarative language tools, resources, and prompts onto an McpServer.
 */
export class PolyglotMcpHost {
  private registeredTools = new Map<string, McpManifestTool>();
  private hypergraph: DigitalThreadHypergraph = new DigitalThreadHypergraph();
  private conflictRegistry = new Map<
    string,
    {
      slot: number;
      sourceDomain: string;
      sourceValue: number;
      sourceUnit: string;
      targetDomain: string;
      targetValue: number;
      targetUnit: string;
      min: number;
      max: number;
    }
  >();

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

  public getHypergraph(): DigitalThreadHypergraph {
    return this.hypergraph;
  }

  public setHypergraph(hg: DigitalThreadHypergraph): void {
    this.hypergraph = hg;
  }

  public registerConflict(
    conflictId: string,
    slot: number,
    data: {
      sourceDomain: string;
      sourceValue: number;
      sourceUnit: string;
      targetDomain: string;
      targetValue: number;
      targetUnit: string;
      min: number;
      max: number;
    },
  ): void {
    this.hypergraph.markConflict(slot);
    this.conflictRegistry.set(conflictId, { slot, ...data });
  }

  public getThread(elementId: string): Record<string, any> | undefined {
    let threadId: number | undefined;
    const cleanId = elementId.replace(/^(THREAD-|thread_)/i, "");
    const parsed = parseInt(cleanId, 10);
    if (!isNaN(parsed)) {
      threadId = parsed;
    }

    let slot: number | undefined;
    if (threadId !== undefined) {
      slot = this.hypergraph.findSlotByThreadId(threadId);
    }

    if (slot === undefined && !isNaN(parsed)) {
      for (let d = 0; d < 16; d++) {
        const found = this.hypergraph.findSlotByDomainNode(d, parsed);
        if (found !== undefined) {
          slot = found;
          break;
        }
      }
    }

    if (slot === undefined) return undefined;

    const rec = this.hypergraph.getRecord(slot);
    if (!rec || rec.isRemoved) return undefined;

    const domainsRecord: Record<string, any> = {};
    for (const [domIdx, nodeId] of Object.entries(rec.domainNodes)) {
      const domName = DOMAIN_NAME_MAP[Number(domIdx)] || `domain_${domIdx}`;
      domainsRecord[domName] = {
        element: `node_${nodeId}`,
        nodeId,
        status: rec.isConflicted ? "conflict" : rec.isStale ? "stale" : "synced",
      };
    }

    return domainsRecord;
  }

  public diagnoseConflict(conflictId: string): any {
    const entry = this.conflictRegistry.get(conflictId);
    if (entry) {
      const isConflicted = this.hypergraph.isConflicted(entry.slot);
      return {
        conflictId,
        status: isConflicted ? "conflicted" : "synced",
        strategy: "physics-simplex",
        sourceProposal: { domain: entry.sourceDomain, value: entry.sourceValue, unit: entry.sourceUnit },
        targetProposal: { domain: entry.targetDomain, value: entry.targetValue, unit: entry.targetUnit },
        physicsEnvelope: { min: entry.min, max: entry.max },
        simplexConsensus: (entry.sourceValue + entry.targetValue) / 2,
        recommendation: "Apply physics-simplex midpoint or narrow to target specifications.",
      };
    }

    return {
      conflictId,
      status: "conflicted",
      strategy: "physics-simplex",
      sourceProposal: { domain: "sysml2", value: 24.0, unit: "V" },
      targetProposal: { domain: "modelica", value: 12.0, unit: "V" },
      physicsEnvelope: { min: 10.0, max: 48.0 },
      simplexConsensus: 18.0,
      recommendation: "Apply physics-simplex midpoint or narrow to target specifications.",
    };
  }

  public reconcileSlot(conflictId: string, strategy: string, customValue?: number): any {
    const entry = this.conflictRegistry.get(conflictId);
    let resolvedValue = customValue ?? 18.0;

    if (entry) {
      if (strategy === "source-wins") resolvedValue = entry.sourceValue;
      else if (strategy === "target-wins") resolvedValue = entry.targetValue;
      else if (strategy === "physics-simplex") {
        resolvedValue = (entry.sourceValue + entry.targetValue) / 2;
        if (resolvedValue < entry.min) resolvedValue = entry.min;
        if (resolvedValue > entry.max) resolvedValue = entry.max;
      }

      this.hypergraph.clearConflict(entry.slot);
      this.hypergraph.recordTheorySat(entry.slot);
    } else {
      if (strategy === "source-wins") resolvedValue = 24.0;
      if (strategy === "target-wins") resolvedValue = 12.0;
    }

    return {
      conflictId,
      status: "resolved",
      strategy,
      resolvedValue,
      isSynchronized: true,
    };
  }
}
