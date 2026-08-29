import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "StubSimdTestLang",
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

describe("Phase 1: Next-Gen Storage Engine, SIMD Stubs & Merkle Hashes", () => {
  let facade1: any;
  let facade2: any;
  let wasmExports: any;
  let wasmModule: any;
  let tmpDir: string;
  let getFacadeFn: any;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_stub_simd");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    // Compile with SIMD and Threads enabled
    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --enable simd --debug --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + `\nreturn { LspFacade };`;
    getFacadeFn = new Function(wrapperSrc);

    const createInstance = async () => {
      const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
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

    facade1 = await createInstance();
    facade2 = await createInstance();
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should register stubs with Merkle hashes and retrieve via SIMD search", () => {
    facade1.clearStubs();

    // Register 120 symbols to test multiple 4-lane SIMD chunks and tail
    for (let f = 1; f <= 120; f++) {
      facade1.registerStub(f, 1, 0, 1, 0, `Model_${f}`, 0, 100, 0x12345678, 0x9abcdef0);
      facade1.registerStub(f, 2, 1, 2, 0, `voltage_${f}`, 10, 30, 0x11112222, 0x33334444);
    }

    expect(facade1.getStubCount()).toBe(240);

    // Test scalar findStubsByName
    const scalarMatches = facade1.findStubsByName("Model_42");
    expect(scalarMatches.length).toBe(1);
    expect(scalarMatches[0].fileId).toBe(42);
    expect(scalarMatches[0].merkleLow).toBe(0x12345678);
    expect(scalarMatches[0].merkleHigh).toBe(0x9abcdef0);

    // Test WASM SIMD 128-bit vector search
    const simdMatches = facade1.findStubsByNameSIMD("Model_42");
    expect(simdMatches.length).toBe(1);
    expect(simdMatches[0].fileId).toBe(42);
    expect(simdMatches[0].symbolId).toBe(1);
    expect(simdMatches[0].merkleLow).toBe(0x12345678);
    expect(simdMatches[0].merkleHigh).toBe(0x9abcdef0);
  });

  test("should support dead stub unlinking and free-list recycling on file edits", () => {
    facade1.clearStubs();

    // Register file 1 (3 symbols) and file 2 (2 symbols)
    facade1.registerStub(1, 101, 0, 1, 0, "PackageA", 0, 100);
    facade1.registerStub(1, 102, 101, 2, 0, "ComponentA1", 10, 40);
    facade1.registerStub(1, 103, 101, 2, 0, "ComponentA2", 50, 80);

    facade1.registerStub(2, 201, 0, 1, 0, "PackageB", 0, 100);
    facade1.registerStub(2, 202, 201, 2, 0, "ComponentB1", 10, 40);

    expect(facade1.getStubCount()).toBe(5);

    // Verify symbols are discoverable
    expect(facade1.findStubsByName("ComponentA1").length).toBe(1);

    // Clear file 1 (simulating file modification before re-indexing)
    facade1.clearFileStubs(1);

    // Cleared symbols should no longer be returned in name searches
    expect(facade1.findStubsByName("ComponentA1").length).toBe(0);
    expect(facade1.findStubsByName("ComponentA2").length).toBe(0);

    // File 2 symbols must remain fully intact and discoverable
    expect(facade1.findStubsByName("ComponentB1").length).toBe(1);

    // Re-register file 1 with new edits — slots should be recycled from free-list without expanding t_stubCount
    facade1.registerStub(1, 101, 0, 1, 0, "PackageA_Edited", 0, 120);
    facade1.registerStub(1, 104, 101, 2, 0, "ComponentA_New", 10, 50);

    expect(facade1.findStubsByName("PackageA_Edited").length).toBe(1);
    expect(facade1.findStubsByName("ComponentA_New").length).toBe(1);
  });

  test("should support cross-file package FQN stitching", () => {
    facade1.clearStubs();

    // 1. Register parent package in file 1
    const pkgStubId = facade1.registerStub(1, 1, 0, 1, 0, "Analog", 0, 200);
    facade1.bindFqnStub("Modelica.Electrical.Analog", pkgStubId);

    // 2. Register child file 2 with enclosing parent FQN
    facade1.registerFileParentFQN(2, "Modelica.Electrical.Analog");

    // Register top-level Resistor model in file 2 (with parentSymbolId = 0)
    const resistorStubId = facade1.registerStub(2, 10, 0, 1, 0, "Resistor", 0, 50);

    // Verify parentSymbolId was stitched automatically to pkgStubId
    const resistorStubs = facade1.findStubsByName("Resistor");
    expect(resistorStubs.length).toBe(1);
    expect(resistorStubs[0].parentSymbolId).toBe(pkgStubId);

    // Verify children query on Analog returns Resistor
    const analogChildren = facade1.getStubChildren(pkgStubId);
    expect(analogChildren.length).toBe(1);
    expect(analogChildren[0].fileId).toBe(2);
    expect(analogChildren[0].symbolId).toBe(10);
  });

  test("should return all symbols in a file via getFileSymbols in O(K) time", () => {
    facade1.clearStubs();

    // Register 10 symbols across file 5 and file 6
    facade1.registerStub(5, 1, 0, 1, 0, "ClassA", 0, 100);
    facade1.registerStub(5, 2, 1, 2, 0, "attr1", 10, 20);
    facade1.registerStub(5, 3, 1, 2, 0, "attr2", 30, 40);
    facade1.registerStub(5, 4, 1, 2, 0, "attr3", 50, 60);

    facade1.registerStub(6, 10, 0, 1, 0, "ClassB", 0, 100);
    facade1.registerStub(6, 11, 10, 2, 0, "attrB1", 10, 20);

    const file5Symbols = facade1.getFileSymbols(5);
    expect(file5Symbols.length).toBe(4);
    expect(file5Symbols.map((s: any) => s.symbolId)).toEqual([1, 2, 3, 4]);

    const file6Symbols = facade1.getFileSymbols(6);
    expect(file6Symbols.length).toBe(2);
    expect(file6Symbols.map((s: any) => s.symbolId)).toEqual([10, 11]);
  });

  test("should compute 64-bit Merkle hashes bottom-up for AST nodes", () => {
    // Allocate AST leaf nodes and parent node
    const leaf1 = wasmExports.allocAstNode(1, 0, 5, 0);
    const leaf2 = wasmExports.allocAstNode(2, 0, 8, 0);

    const parentNode = wasmExports.allocAstNode(10, 0, 20, 0);
    wasmExports.setFirstChild(parentNode, leaf1);
    wasmExports.setNextSibling(leaf1, leaf2);

    // Compute Merkle hash bottom-up
    const leaf1Hash = wasmExports.computeNodeMerkleHash(leaf1);
    const leaf2Hash = wasmExports.computeNodeMerkleHash(leaf2);
    const parentHash = wasmExports.computeNodeMerkleHash(parentNode);

    expect(leaf1Hash).not.toBe(0n);
    expect(leaf2Hash).not.toBe(0n);
    expect(parentHash).not.toBe(0n);
    expect(parentHash).not.toBe(leaf1Hash);
    expect(parentHash).not.toBe(leaf2Hash);
  });

  test("should export v2 binary snapshot with Merkle hashes and hydrate in clean instance", () => {
    facade1.clearStubs();

    for (let f = 1; f <= 50; f++) {
      facade1.registerStub(f, 1, 0, 1, 0, `Plant_${f}`, 0, 80, 0x1234, 0x5678);
    }

    const snapshot = facade1.exportStubBinary();
    expect(snapshot.byteLength).toBeGreaterThan(32);

    // Restore into clean facade2 instance
    const ok = facade2.importStubBinary(snapshot);
    expect(ok).toBe(true);
    expect(facade2.getStubCount()).toBe(50);

    const plant25 = facade2.findStubsByName("Plant_25");
    expect(plant25.length).toBe(1);
    expect(plant25[0].fileId).toBe(25);
    expect(plant25[0].merkleLow).toBe(0x1234);
    expect(plant25[0].merkleHigh).toBe(0x5678);
  });
});
