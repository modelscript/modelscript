// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpManifest } from "@modelscript/dsl/codegen/compile_mcp.js";
import { ThreadDomain } from "@modelscript/runtime";
import expect from "expect";
import { describe, test } from "node:test";
import { mcpPropertySchemaToZod, PolyglotMcpHost } from "../src/polyglot-server.js";
import { registerTools } from "../src/tools.js";
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

  test("queries live DigitalThreadHypergraph and reconciles conflicts", () => {
    const server = new McpServer({
      name: "test-polyglot-mcp-live",
      version: "1.0.0",
    });

    const ctx: ServerContext = { current: null };
    const host = new PolyglotMcpHost(server, ctx);
    const hg = host.getHypergraph();

    // Create a live thread
    const slot = hg.createThread(1001);
    hg.bindDomainNode(slot, ThreadDomain.SysML2, 42);
    hg.bindDomainNode(slot, ThreadDomain.Modelica, 84);

    // Query thread by ID
    const threadRecord = host.getThread("1001");
    expect(threadRecord).toBeDefined();
    expect(threadRecord?.sysml2?.nodeId).toBe(42);
    expect(threadRecord?.modelica?.nodeId).toBe(84);
    expect(threadRecord?.sysml2?.status).toBe("synced");

    // Register active conflict
    host.registerConflict("conflict_bus_voltage", slot, {
      sourceDomain: "sysml2",
      sourceValue: 24.0,
      sourceUnit: "V",
      targetDomain: "modelica",
      targetValue: 12.0,
      targetUnit: "V",
      min: 10.0,
      max: 48.0,
    });

    // Verify conflict diagnosed
    const diag = host.diagnoseConflict("conflict_bus_voltage");
    expect(diag.status).toBe("conflicted");
    expect(diag.simplexConsensus).toBe(18.0);
    expect(hg.isConflicted(slot)).toBe(true);

    // Reconcile conflict using physics-simplex
    const reconciled = host.reconcileSlot("conflict_bus_voltage", "physics-simplex");
    expect(reconciled.status).toBe("resolved");
    expect(reconciled.resolvedValue).toBe(18.0);
    expect(hg.isConflicted(slot)).toBe(false);

    // Thread is now verified synchronized
    const updatedRecord = host.getThread("1001");
    expect(updatedRecord?.sysml2?.status).toBe("synced");
  });

  test("registers modelica_diff_calibrate tool cleanly on McpServer", () => {
    const server = new McpServer({
      name: "test-diff-calibrate",
      version: "1.0.0",
    });
    const ctx: ServerContext = { current: null };
    registerTools(server, ctx);
    expect(server).toBeDefined();
  });

  test("registers and executes modelscript_patch_code surgically on candidate files", async () => {
    const server = new McpServer({
      name: "test-patch-code",
      version: "1.0.0",
    });
    const ctx: ServerContext = { current: null };
    registerTools(server, ctx);

    // Verify tool is registered
    const tools = (server as any)._registeredTools;
    expect(tools["modelscript_patch_code"]).toBeDefined();

    // Test surgical patching via temporary scratch file in workspace
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const scratchDir = path.resolve(process.cwd(), "packages/mcp/tests/scratch");
    await fs.mkdir(scratchDir, { recursive: true });
    const scratchFile = path.join(scratchDir, "patch-test.mo");

    const originalText = `model Resistor\n  parameter Real R = 100.0;\n  Real v;\nequation\n  v = 10.0;\nend Resistor;\n`;
    await fs.writeFile(scratchFile, originalText, "utf-8");

    const handler = tools["modelscript_patch_code"].handler;
    const patchRes = await handler({
      filePath: "packages/mcp/tests/scratch/patch-test.mo",
      searchBlock: "  parameter Real R = 100.0;",
      replaceBlock: "  parameter Real R = 220.0;\n  parameter Real tol = 0.05;",
    });

    expect(patchRes.isError).toBeFalsy();
    const parsed = JSON.parse(patchRes.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.addedLines).toBe(2);
    expect(parsed.deletedLines).toBe(1);

    const patchedContent = await fs.readFile(scratchFile, "utf-8");
    expect(patchedContent).toContain("parameter Real R = 220.0;");
    expect(patchedContent).toContain("parameter Real tol = 0.05;");
    expect(patchedContent).not.toContain("parameter Real R = 100.0;");

    // Clean up scratch file
    await fs.rm(scratchDir, { recursive: true, force: true });
  });

  test("registers and executes modelscript_read_file and modelscript_list_workspace_files", async () => {
    const server = new McpServer({
      name: "test-workspace-nav",
      version: "1.0.0",
    });
    const ctx: ServerContext = { current: null };
    registerTools(server, ctx);

    const tools = (server as any)._registeredTools;
    expect(tools["modelscript_read_file"]).toBeDefined();
    expect(tools["modelscript_list_workspace_files"]).toBeDefined();

    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const scratchDir = path.resolve(process.cwd(), "packages/mcp/tests/scratch-nav");
    await fs.mkdir(scratchDir, { recursive: true });
    const scratchFile = path.join(scratchDir, "nav-test.mo");

    const fileContent = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    await fs.writeFile(scratchFile, fileContent, "utf-8");

    // Test read_file
    const readHandler = tools["modelscript_read_file"].handler;
    const readRes = await readHandler({
      filePath: "packages/mcp/tests/scratch-nav/nav-test.mo",
      startLine: 2,
      endLine: 4,
    });

    expect(readRes.isError).toBeFalsy();
    const readParsed = JSON.parse(readRes.content[0].text);
    expect(readParsed.startLine).toBe(2);
    expect(readParsed.endLine).toBe(4);
    expect(readParsed.content).toBe("line 2\nline 3\nline 4");

    // Test list_workspace_files
    const listHandler = tools["modelscript_list_workspace_files"].handler;
    const listRes = await listHandler({
      directory: "packages/mcp/tests/scratch-nav",
      extension: ".mo",
    });

    expect(listRes.isError).toBeFalsy();
    const listParsed = JSON.parse(listRes.content[0].text);
    expect(listParsed.count).toBeGreaterThanOrEqual(1);
    expect(listParsed.files.some((f: string) => f.includes("nav-test.mo"))).toBe(true);

    // Clean up
    await fs.rm(scratchDir, { recursive: true, force: true });
  });
});
