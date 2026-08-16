import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "QueryEngineTestLang",
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

describe("Phase 2: Reactive Salsa 3.0, Incremental Editing & Polyglot Vectors", () => {
  const tmpDir = path.join(__dirname, "scratch_build_query_engine");
  let facade: any;
  let wasmExports: any;
  let polyglotArenaPtr: number;

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
    const wasmModule = await WebAssembly.compile(wasm);

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
      const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + "\nreturn { LspFacade };";
      const { LspFacade } = new Function(wrapperSrc)();
      return new LspFacade(instance.exports.memory, instance.exports);
    };

    facade = await createInstance();

    // Initialize query arena and polyglot arena
    if (wasmExports.initQueryArena) wasmExports.initQueryArena();
    if (wasmExports.createPolyglotArena) {
      polyglotArenaPtr = wasmExports.createPolyglotArena();
    }
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should track query dependencies and cascade invalidation through subscriber edges", () => {
    facade.queryIncrementRevision();
    const currentRev = facade.queryGetGlobalRevision();
    expect(currentRev).toBeGreaterThanOrEqual(1);

    // Create Query 1 (e.g. Type Checking Query) and Query 2 (e.g. Codegen Query)
    const q1 = facade.queryAllocNode(1, 100, 0, 0, 0);
    const q2 = facade.queryAllocNode(2, 200, 0, 0, 0);

    expect(q1).toBeGreaterThan(0);
    expect(q2).toBeGreaterThan(0);

    // Set values and mark valid for current revision
    facade.querySetValue(q1, 42);
    facade.querySetRevision(q1, currentRev);
    facade.querySetValue(q2, 999);
    facade.querySetRevision(q2, currentRev);

    // Link dependency: Q2 depends on Q1
    facade.queryAddDependency(q2, q1);

    expect(facade.queryGetRevision(q1)).toBe(currentRev);
    expect(facade.queryGetRevision(q2)).toBe(currentRev);

    // Invalidate Q1: Q2 must automatically cascade to dirty (revision = 0)
    facade.queryInvalidate(q1);

    expect(facade.queryGetRevision(q1)).toBe(0);
    expect(facade.queryGetRevision(q2)).toBe(0);
  });

  test("should support negative dependency tracking when unresolved symbols are defined", () => {
    facade.clearStubs();
    facade.queryIncrementRevision();
    const rev = facade.queryGetGlobalRevision();

    // Query 3 failed because symbol 'MissingType' does not exist yet
    const q3 = facade.queryAllocNode(3, 300, 0, 0, 0);
    facade.querySetValue(q3, 0); // Unresolved
    facade.querySetRevision(q3, rev);

    // Register negative dependency on 'MissingType'
    facade.salsaRegisterNegativeDependency(q3, "MissingType");

    expect(facade.queryGetRevision(q3)).toBe(rev);

    // User defines 'MissingType' in file 10
    facade.registerStub(10, 1, 0, 1, 0, "MissingType", 0, 100);

    // Q3 should now be automatically invalidated!
    expect(facade.queryGetRevision(q3)).toBe(0);
  });

  test("should perform O(1) Merkle backdating to avoid downstream invalidation", () => {
    facade.queryIncrementRevision();
    const rev1 = facade.queryGetGlobalRevision();

    const q4 = facade.queryAllocNode(4, 400, 0, 0, 0);
    facade.querySetValue(q4, 1234);
    facade.querySetRevision(q4, rev1);

    // Set initial 64-bit Merkle hash for Q4 result
    const merkleLow = 0xaabbccdd >>> 0;
    const merkleHigh = 0x11223344 >>> 0;
    facade.querySetMerkle(q4, merkleLow, merkleHigh);

    expect(facade.queryGetMerkleLow(q4)).toBe(merkleLow);
    expect(facade.queryGetMerkleHigh(q4)).toBe(merkleHigh);

    // Advance global revision
    facade.queryIncrementRevision();
    const rev2 = facade.queryGetGlobalRevision();

    // Re-evaluation produces the exact same Merkle hash -> backdating succeeds
    const backdated = facade.salsaBackdateQuery(q4, merkleLow, merkleHigh);
    expect(backdated).toBe(true);
    expect(facade.queryGetRevision(q4)).toBe(rev2);

    // Different Merkle hash -> backdating returns false (value changed)
    const backdatedChanged = facade.salsaBackdateQuery(q4, 0x99999999 >>> 0, 0x88888888 >>> 0);
    expect(backdatedChanged).toBe(false);
  });

  test("should manage per-language version vectors in polyglot arena", () => {
    expect(polyglotArenaPtr).toBeGreaterThan(0);

    // Language 1 (e.g. Modelica), Language 2 (e.g. SysML2)
    const langModelica = 1;
    const langSysML2 = 2;

    const vMod0 = facade.polyglotGetLangVersion(polyglotArenaPtr, langModelica);
    const vSys0 = facade.polyglotGetLangVersion(polyglotArenaPtr, langSysML2);

    expect(vMod0).toBe(0);
    expect(vSys0).toBe(0);

    // Edit occurs in Modelica
    const vMod1 = facade.polyglotIncrementLangVersion(polyglotArenaPtr, langModelica);
    expect(vMod1).toBe(1);

    // Check changed status
    expect(facade.polyglotHasLangChanged(polyglotArenaPtr, langModelica, 0)).toBe(true);
    expect(facade.polyglotHasLangChanged(polyglotArenaPtr, langModelica, 1)).toBe(false);

    // SysML2 is completely unaffected (zero cross-talk)
    expect(facade.polyglotHasLangChanged(polyglotArenaPtr, langSysML2, 0)).toBe(false);
    expect(facade.polyglotGetLangVersion(polyglotArenaPtr, langSysML2)).toBe(0);
  });

  test("should shift stub byte offsets in-place on interior edits (Zero-Reparse Delta Shifting)", () => {
    facade.clearStubs();

    // Register 3 stubs in file 100
    facade.registerStub(100, 1, 0, 1, 0, "ModelA", 10, 50);
    facade.registerStub(100, 2, 0, 1, 0, "ModelB", 100, 200);
    facade.registerStub(100, 3, 0, 1, 0, "ModelC", 300, 400);

    // User types 25 characters inside ModelA at byte offset 20
    const shiftedCount = facade.shiftStubByteOffsets(100, 20, 25);
    expect(shiftedCount).toBe(3);

    // Retrieve file outline to verify updated byte ranges
    const fileSymbols = facade.getFileSymbols(100);
    expect(fileSymbols.length).toBe(3);

    // ModelA was edited inside: endByte expanded by 25 (50 -> 75)
    expect(fileSymbols[0].startByte).toBe(10);
    expect(fileSymbols[0].endByte).toBe(75);

    // ModelB was after offset 20: entire span shifted by +25 (100..200 -> 125..225)
    expect(fileSymbols[1].startByte).toBe(125);
    expect(fileSymbols[1].endByte).toBe(225);

    // ModelC was after offset 20: entire span shifted by +25 (300..400 -> 325..425)
    expect(fileSymbols[2].startByte).toBe(325);
    expect(fileSymbols[2].endByte).toBe(425);
  });
});
