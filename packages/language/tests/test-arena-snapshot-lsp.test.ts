import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";
import { IndexedDbSnapshotStore } from "../src/runtime/indexeddb_snapshot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "SnapshotLspTestLang",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat($.Decl),
        semanticToken("keyword", "end"),
        ";",
      ),
    Decl: ($: any) => seq("Real", field("name", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  symbols: {
    ModelDef: { name: "name", kind: "model", scope: true },
    Decl: { name: "name", kind: "Variable", scope: false },
  },
  extras: ($: any) => [/\s+/],
});

describe("Phase 6: Snapshotting, Memory Forking & Production LSP Integration", () => {
  const tmpDir = path.join(__dirname, "scratch_build_snapshot_lsp");
  let facade: any;
  let wasmExports: any;
  let wasmMemory: any;
  let wasmModule: any;
  let getFacadeFn: any;

  beforeAll(async () => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = buildParser(dsl as any);
    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --enable simd --debug --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + "\nreturn { LspFacade };";
    getFacadeFn = new Function(wrapperSrc);

    const createInstance = async () => {
      const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
      wasmMemory = memory;
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
      wasmExports = instance.exports;
      if (instance.exports.initCompiler) {
        instance.exports.initCompiler();
      }
      const { LspFacade } = getFacadeFn();
      return new LspFacade(instance.exports.memory, instance.exports);
    };

    facade = await createInstance();
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should create and restore Branch-on-Write arena memory snapshots for speculative autocompletions", () => {
    // 1. Take arena snapshot before speculative completion
    const snapPtr = facade.createArenaSnapshot();
    expect(snapPtr).toBeGreaterThan(0);

    // 2. Perform speculative node allocations in arena
    const node1 = wasmExports.arena_allocNode(1);
    const node2 = wasmExports.arena_allocNode(2);
    expect(node1).toBeGreaterThan(0);
    expect(node2).toBeGreaterThan(node1);

    // 3. Rollback arena state
    facade.restoreArenaSnapshot(snapPtr);

    // 4. Subsequent allocation should reuse the restored scratch space
    const node3 = wasmExports.arena_allocNode(1);
    expect(node3).toBe(node1);
  });

  test("should save and restore cold-start binary index snapshots via IndexedDbSnapshotStore", async () => {
    facade.clearStubs();

    // Register symbols in main instance
    facade.registerStub(1, 1, 0, 1, 0, "HydraulicPump", 0, 100, 0x11223344, 0x55667788);
    facade.registerStub(1, 2, 1, 2, 0, "pressureSensor", 100, 200, 0xaabbccdd, 0xeeff0011);

    // Export v2 binary snapshot
    const binary = facade.exportStubBinary();
    expect(binary.length).toBeGreaterThan(0);

    // Persist to IndexedDbSnapshotStore
    const store = new IndexedDbSnapshotStore();
    await store.saveSnapshot("workspace_v2", binary);

    // Load from store
    const loaded = await store.loadSnapshot("workspace_v2");
    expect(loaded).toBeDefined();
    if (!loaded) throw new Error("Expected loaded snapshot to be defined");
    expect(loaded.version).toBe(2);
    expect(loaded.data.length).toBe(binary.length);

    // Create a clean second instance and hydrate
    const memory2 = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports2 = {
      env: { memory: memory2, abort: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };
    const instance2 = await WebAssembly.instantiate(wasmModule, imports2);
    if (instance2.exports.initCompiler) instance2.exports.initCompiler();

    const { LspFacade } = getFacadeFn();
    const facade2 = new LspFacade(instance2.exports.memory, instance2.exports);

    // Hydrate in clean instance
    const restoredCount = facade2.restoreStubBinary(loaded.data);
    expect(restoredCount).toBe(2);

    // Verify symbols and Merkle hashes are instantly restored
    const results = facade2.findStubsByName("HydraulicPump");
    expect(results.length).toBe(1);
    expect(results[0].merkleLow).toBe(0x11223344);
    expect(results[0].merkleHigh).toBe(0x55667788);

    const outline = facade2.getFileSymbols(1);
    expect(outline.length).toBe(2);
  });
});
