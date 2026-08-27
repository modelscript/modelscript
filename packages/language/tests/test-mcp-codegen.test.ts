// SPDX-License-Identifier: AGPL-3.0-or-later

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildParser } from "../src/api.js";
import { LspFacade } from "../src/bindings/javascript/bindings.js";
import { field, language, mcpPrompt, mcpResource, mcpTool, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Declarative In-WASM MCP Engine", () => {
  let tmpDir: string;
  let facade: LspFacade;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));

    const testMcpDsl = language({
      name: "mcp_test_lang",
      rules: {
        Program: ($: any) => repeat($.Decl),
        Decl: ($: any) => seq("let", field("name", $.Identifier), ";"),
        Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
      },
      extras: ($: any) => [/\s+/],
      mcp: {
        serverName: "test-mcp-server",
        serverVersion: "1.2.3",
        tools: [
          mcpTool({
            name: "test_classify",
            description: "Classifies an entity and returns consistency status",
            category: "reasoning",
            pure: true,
            inputSchema: {
              iri: { type: "string", description: "IRI to classify", required: true },
            },
          }),
          mcpTool({
            name: "test_simulate",
            description: "Simulates a component and yields metrics",
            category: "simulation",
            pure: true,
            inputSchema: {
              stopTime: { type: "number", description: "Simulation end time", default: 10 },
            },
          }),
        ],
        resources: [
          mcpResource({
            uriTemplate: "mcp://model/{id}/ast",
            name: "Model AST",
            mimeType: "application/json",
            description: "AST node hierarchy for model",
          }),
        ],
        prompts: [
          mcpPrompt({
            name: "diagnose_conflict",
            description: "Diagnose why a model has conflicting constraints",
            arguments: [{ name: "modelName", description: "Target model identifier", required: true }],
            template: (args) => `Diagnose conflict in model: ${args.modelName}`,
          }),
        ],
      },
    });

    const result = buildParser(testMcpDsl as any);

    // Verify manifest extraction
    expect(result.mcpManifest).toBeDefined();
    expect(result.mcpManifest?.serverName).toBe("test-mcp-server");
    expect(result.mcpManifest?.serverVersion).toBe("1.2.3");
    expect(result.mcpManifest?.tools.length).toBe(2);
    expect(result.mcpManifest?.tools[0].name).toBe("test_classify");
    expect(result.mcpManifest?.tools[0].category).toBe("reasoning");
    expect(result.mcpManifest?.tools[0].inputSchema.iri.type).toBe("string");
    expect(result.mcpManifest?.tools[1].name).toBe("test_simulate");
    expect(result.mcpManifest?.resources.length).toBe(1);
    expect(result.mcpManifest?.resources[0].uriTemplate).toBe("mcp://model/{id}/ast");
    expect(result.mcpManifest?.prompts.length).toBe(1);
    expect(result.mcpManifest?.prompts[0].name).toBe("diagnose_conflict");

    // Write AssemblyScript files to tmpDir
    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --enable simd --debug --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const memory = new WebAssembly.Memory({ initial: 512, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory,
        abort: (msg: any, file: any, line: any, col: any) => {
          console.error(`WASM ABORT: line ${line}, col ${col}`);
        },
      },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    if ((instance.exports as any).initCompiler) {
      (instance.exports as any).initCompiler();
    }
    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + "\nreturn { LspFacade };";
    const { LspFacade: GeneratedFacade } = new Function(wrapperSrc)();
    facade = new GeneratedFacade(instance.exports.memory || memory, instance.exports);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("WASM MCP tool discovery and name hashing", () => {
    const count = facade.mcpGetToolCount();
    expect(count).toBe(2);

    const hash0 = facade.mcpGetToolNameHash(0);
    const hash1 = facade.mcpGetToolNameHash(1);
    expect(hash0).toBeGreaterThan(0);
    expect(hash1).toBeGreaterThan(0);
    expect(hash0).not.toBe(hash1);
  });

  test("WASM in-memory tool dispatch", () => {
    const status0 = facade.mcpDispatchTool(0, 10, 20, 30);
    expect(status0).toBe(1);

    const status1 = facade.mcpDispatchTool(1, 40, 50, 60);
    expect(status1).toBe(1);

    const statusInvalid = facade.mcpDispatchTool(99, 0, 0, 0);
    expect(statusInvalid).toBe(0);
  });
});
