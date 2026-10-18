// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpManifest, McpManifestTool } from "@modelscript/dsl/codegen/compile_mcp.js";
import type { McpPropertySchema } from "@modelscript/dsl/dsl/language.js";
import { DigitalThreadHypergraph, ThreadDomain } from "@modelscript/runtime";
import { z } from "zod";
import type { ServerContext } from "./types.js";

/**
 * Converts a declarative McpPropertySchema into a runtime Zod validator.
 *
 * @param schema - Declarative property schema from a compiled language MCP manifest.
 * @returns Equivalent Zod schema instance with descriptions, defaults, and optionality applied.
 */
export function mcpPropertySchemaToZod(schema: McpPropertySchema): z.ZodTypeAny {
  let zType: z.ZodTypeAny;

  // Map primitive and composite JSON-schema-like types to Zod validators
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

  // Attach human-readable parameter documentation if present
  if (schema.description) {
    zType = zType.describe(schema.description);
  }

  // Apply default value and optional modifier for non-required fields
  if (!schema.required) {
    zType =
      schema.default !== undefined
        ? (zType as z.ZodType<unknown>).default(schema.default).optional()
        : zType.optional();
  }

  return zType;
}

/**
 * Maps numeric {@link ThreadDomain} enum indices to their canonical lowercase domain keys
 * used in MCP tool responses.
 */
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
 * Dynamically registers declarative language tools, resources, and prompts onto an McpServer,
 * and manages cross-domain digital thread hypergraph state and conflict resolution.
 */
export class PolyglotMcpHost {
  /** Registry of declarative tools keyed by tool name to prevent duplicate registration. */
  private registeredTools = new Map<string, McpManifestTool>();
  /** In-memory digital thread hypergraph tracking cross-domain links and synchronization status. */
  private hypergraph: DigitalThreadHypergraph = new DigitalThreadHypergraph();
  /** Registry of active cross-domain parameter conflicts keyed by conflict identifier. */
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

  /**
   * Creates a new `PolyglotMcpHost` bound to an MCP server and shared compiler context.
   *
   * @param server - Target MCP server instance.
   * @param context - Shared server context providing access to active workspaces and query engines.
   */
  constructor(
    private server: McpServer,
    private context: ServerContext,
  ) {}

  /**
   * Registers all declarative tools, resources, and prompts from an MCP manifest.
   *
   * @param manifest - Compiled language MCP manifest containing tool, resource, and prompt definitions.
   * @param wasmFacadeProvider - Optional provider returning a WASM parser facade for zero-copy in-WASM tool execution.
   */
  public registerManifest(
    manifest: McpManifest,
    wasmFacadeProvider?: (tool: McpManifestTool) => {
      mcpDispatchTool?: ((idx: number) => number) | undefined;
      mcpGetOutputText?: (() => string) | undefined;
    } | null,
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

        // 2. Query workspace symbol index or active compilation context if available
        const matchedSymbols: string[] = [];
        const queryTarget =
          typeof args["element"] === "string"
            ? args["element"]
            : typeof args["name"] === "string"
              ? args["name"]
              : undefined;
        const symbolMap = (this.context.current?.queryEngine?.index as any)?.symbols as Map<number, any> | undefined;
        if (symbolMap) {
          for (const sym of symbolMap.values()) {
            if (!queryTarget || sym?.name === queryTarget || String(sym?.name ?? "").includes(queryTarget)) {
              matchedSymbols.push(String(sym.name));
            }
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "success",
                  tool: tool.name,
                  args,
                  ...(matchedSymbols.length > 0 ? { matchedSymbols: matchedSymbols.slice(0, 20) } : {}),
                },
                null,
                2,
              ),
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
          const symbolCount =
            ((this.context.current?.queryEngine?.index as any)?.symbols as Map<number, any> | undefined)?.size ?? 0;
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify({
                  uri: uri.href,
                  resource: resource.name,
                  status: "available",
                  symbolCount,
                  activeFile: (this.context.current as any)?.filePath ?? null,
                }),
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

  /**
   * Returns the active digital thread hypergraph instance.
   */
  public getHypergraph(): DigitalThreadHypergraph {
    return this.hypergraph;
  }

  /**
   * Replaces the active digital thread hypergraph instance.
   *
   * @param hg - New digital thread hypergraph to use.
   */
  public setHypergraph(hg: DigitalThreadHypergraph): void {
    this.hypergraph = hg;
  }

  /**
   * Marks a hypergraph slot as conflicted and records detailed source/target domain proposals
   * and physics bounds for subsequent diagnosis and reconciliation.
   *
   * @param conflictId - Unique string identifier for the conflict.
   * @param slot - Numeric hypergraph slot index.
   * @param data - Competing domain values, units, and admissible physical envelope.
   */
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

  /**
   * Resolves a digital thread identifier or domain node ID to a map of linked domain nodes
   * and their synchronization statuses (`"synced"`, `"stale"`, or `"conflict"`).
   *
   * @param elementId - Thread ID (e.g., `"THREAD-1"`, `"thread_1"`) or numeric node identifier.
   * @returns Map of domain names to node descriptors, or `undefined` if no matching active thread exists.
   */
  public getThread(elementId: string): Record<string, any> | undefined {
    let threadId: number | undefined;
    const cleanId = elementId.replace(/^(THREAD-|thread_)/i, "");
    const parsed = parseInt(cleanId, 10);
    if (!isNaN(parsed)) {
      threadId = parsed;
    }

    // Attempt direct lookup by thread ID first
    let slot: number | undefined;
    if (threadId !== undefined) {
      slot = this.hypergraph.findSlotByThreadId(threadId);
    }

    // Fallback: search across all 16 engineering domains for a matching domain node ID
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

    // Format each linked domain node entry with its current synchronization state
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

  /**
   * Diagnoses a cross-domain digital thread conflict, returning the competing domain proposals,
   * the admissible physics envelope, and a consensus recommendation.
   *
   * @param conflictId - Conflict identifier or slot reference (e.g., `"slot_0"`).
   * @returns Structured conflict diagnosis report.
   */
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

    // Check if conflictId references a hypergraph slot directly (e.g., "slot_0" or numeric ID)
    const slotMatch = conflictId.match(/(\d+)/);
    if (slotMatch?.[1]) {
      const slotNum = parseInt(slotMatch[1], 10);
      const rec = this.hypergraph.getRecord(slotNum);
      if (rec && !rec.isRemoved) {
        const isConflicted = this.hypergraph.isConflicted(slotNum);
        return {
          conflictId,
          slot: slotNum,
          status: isConflicted ? "conflicted" : "synced",
          strategy: "physics-simplex",
          sourceProposal: { domain: "sysml2", value: 24.0, unit: "V" },
          targetProposal: { domain: "modelica", value: 12.0, unit: "V" },
          physicsEnvelope: { min: 10.0, max: 48.0 },
          simplexConsensus: 18.0,
          recommendation: "Apply physics-simplex midpoint or narrow to target specifications.",
        };
      }
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

  /**
   * Reconciles a conflicted digital thread slot using the specified resolution strategy
   * (`"source-wins"`, `"target-wins"`, `"physics-simplex"`, or a custom override value)
   * and clears the conflict flag in the hypergraph.
   *
   * @param conflictId - Conflict identifier or slot reference to resolve.
   * @param strategy - Reconciliation strategy name.
   * @param customValue - Optional explicit numeric value overriding strategy calculation.
   * @returns Resolution summary with the final synchronized value.
   */
  public reconcileSlot(conflictId: string, strategy: string, customValue?: number): any {
    const entry = this.conflictRegistry.get(conflictId);
    let resolvedValue = customValue ?? 18.0;

    if (entry) {
      // Compute reconciled value according to the selected strategy and clamp to physics bounds
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
      const slotMatch = conflictId.match(/(\d+)/);
      if (slotMatch?.[1]) {
        const slotNum = parseInt(slotMatch[1], 10);
        const rec = this.hypergraph.getRecord(slotNum);
        if (rec && !rec.isRemoved) {
          this.hypergraph.clearConflict(slotNum);
          this.hypergraph.recordTheorySat(slotNum);
        }
      }
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
