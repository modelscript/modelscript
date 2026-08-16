import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "FlattenerMathTestLang",
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

describe("Phase 4: Modelica Flattening & MSL Math Engine Migration", () => {
  const tmpDir = path.join(__dirname, "scratch_build_flattener_math");
  let facade: any;
  let wasmExports: any;

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
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should create DaeBuilder and manage variables, expressions, and equations", () => {
    const daePtr = wasmExports.dae_createBuilder();
    expect(daePtr).toBeGreaterThan(0);

    // Register variables: v1 (Real, Continuous, Local), v2 (Real, Continuous, Local)
    const v1 = wasmExports.dae_addVariable(daePtr, 1, 0, 0, 0, 10.5);
    const v2 = wasmExports.dae_addVariable(daePtr, 2, 0, 0, 0, 0.0);

    expect(v1).toBe(0);
    expect(v2).toBe(1);

    // Snapshot state
    wasmExports.dae_snapshot(daePtr);

    // Add speculative variable v3
    const v3 = wasmExports.dae_addVariable(daePtr, 3, 0, 0, 0, 99.0);
    expect(v3).toBe(2);

    // Rollback to snapshot
    wasmExports.dae_rollback(daePtr);

    // Verify rollback restored variable count
    const v3_retry = wasmExports.dae_addVariable(daePtr, 4, 0, 0, 0, 42.0);
    expect(v3_retry).toBe(2);
  });

  test("should handle connector connection graphs and synthesize zero-sum flow equations", () => {
    const daePtr = wasmExports.dae_createBuilder();
    const flattenerPtr = facade.createFlattener(daePtr);
    expect(flattenerPtr).toBeGreaterThan(0);

    // Variables:
    // v0: p1.v (potential)
    // v1: p2.v (potential)
    // v2: p1.i (flow)
    // v3: p2.i (flow)
    wasmExports.dae_addVariable(daePtr, 1, 0, 0, 0, 0.0);
    wasmExports.dae_addVariable(daePtr, 2, 0, 0, 0, 0.0);
    wasmExports.dae_addVariable(daePtr, 3, 0, 0, 0, 0.0);
    wasmExports.dae_addVariable(daePtr, 4, 0, 0, 0, 0.0);

    // Connect potential variables: p1.v = p2.v
    facade.flattenerAddConnection(flattenerPtr, 0, 1, false);

    // Connect flow variables: p1.i + p2.i = 0
    facade.flattenerAddConnection(flattenerPtr, 2, 3, true);

    // Finalize connections -> emits zero-sum flow equations
    const flowEqCount = facade.flattenerFinalizeConnections(flattenerPtr);
    expect(flowEqCount).toBe(1);
  });

  test("should evaluate built-in MSL mathematical functions with high precision", () => {
    expect(facade.mathSin(0.0)).toBeCloseTo(0.0);
    expect(facade.mathSin(Math.PI / 2)).toBeCloseTo(1.0);
    expect(facade.mathCos(0.0)).toBeCloseTo(1.0);
    expect(facade.mathCos(Math.PI)).toBeCloseTo(-1.0);
    expect(facade.mathTan(0.0)).toBeCloseTo(0.0);
    expect(facade.mathSqrt(16.0)).toBeCloseTo(4.0);
    expect(facade.mathExp(1.0)).toBeCloseTo(Math.E);
    expect(facade.mathLog(Math.E)).toBeCloseTo(1.0);
  });

  test("should evaluate CSG Signed Distance Functions (SDF) and Boolean combinations", () => {
    // Sphere at origin with radius 1.0
    // Point at (2, 0, 0) should have distance 1.0
    const dSphere = facade.csgSdfSphere(2.0, 0.0, 0.0, 1.0);
    expect(dSphere).toBeCloseTo(1.0);

    // Box at origin with half-extent (1, 1, 1)
    // Point at (2, 0, 0) should have distance 1.0
    const dBox = facade.csgSdfBox(2.0, 0.0, 0.0, 1.0, 1.0, 1.0);
    expect(dBox).toBeCloseTo(1.0);

    // CSG Boolean Operations
    expect(facade.csgOpUnion(1.0, 2.0)).toBe(1.0); // min
    expect(facade.csgOpIntersect(1.0, 2.0)).toBe(2.0); // max
    expect(facade.csgOpDifference(1.0, -2.0)).toBe(2.0); // max(d1, -d2)
  });
});
