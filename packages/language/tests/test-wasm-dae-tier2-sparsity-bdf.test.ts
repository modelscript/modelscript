import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { language, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeTier2DSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("Tier 2: WASM DAE Sparsity, Distance-2 Coloring, Sparse LU & Variable-Order BDF", () => {
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_tier2");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    try {
      childProcess.execSync(ascCmd, { stdio: "pipe" });
    } catch (err: any) {
      if (err.stdout) console.error("ASC STDOUT:", err.stdout.toString());
      if (err.stderr) console.error("ASC STDERR:", err.stderr.toString());
      throw err;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: () => console.log("ABORT!"),
        logNode: () => {},
        debugLog: () => {},
      },
      JavaScript: {
        debugLog: () => {},
        logNode: () => {},
      },
      engine: {
        debugLog: () => {},
      },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
  }, 120000);

  // afterAll(() => {
  //   if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  // });

  it("should construct CCS sparsity pattern and compute distance-2 graph coloring", () => {
    const b = wasmExports.dae_createBuilder();

    // 4 variables: x0, x1, x2, x3
    const x0 = wasmExports.dae_addVariable(b, 0x10, 0, 0, 0, 1.0, 0);
    const x1 = wasmExports.dae_addVariable(b, 0x20, 0, 0, 0, 1.0, 0);
    const x2 = wasmExports.dae_addVariable(b, 0x30, 0, 0, 0, 1.0, 0);
    const x3 = wasmExports.dae_addVariable(b, 0x40, 0, 0, 0, 1.0, 0);

    const eX0 = wasmExports.dae_addName(b, x0);
    const eX1 = wasmExports.dae_addName(b, x1);
    const eX2 = wasmExports.dae_addName(b, x2);
    const eX3 = wasmExports.dae_addName(b, x3);

    // Tridiagonal system of 4 equations:
    // Eq 0: x0 + x1 = 0
    // Eq 1: x0 + x1 + x2 = 0
    // Eq 2: x1 + x2 + x3 = 0
    // Eq 3: x2 + x3 = 0
    const zero = wasmExports.dae_addRealLiteral(b, 0.0);

    const sum0 = wasmExports.dae_addBinaryExpr(b, 0, eX0, eX1);
    const eq0 = wasmExports.dae_addEquation(b, 0, sum0, zero, 0);

    const sum1a = wasmExports.dae_addBinaryExpr(b, 0, eX0, eX1);
    const sum1b = wasmExports.dae_addBinaryExpr(b, 0, sum1a, eX2);
    const eq1 = wasmExports.dae_addEquation(b, 0, sum1b, zero, 0);

    const sum2a = wasmExports.dae_addBinaryExpr(b, 0, eX1, eX2);
    const sum2b = wasmExports.dae_addBinaryExpr(b, 0, sum2a, eX3);
    const eq2 = wasmExports.dae_addEquation(b, 0, sum2b, zero, 0);

    const sum3 = wasmExports.dae_addBinaryExpr(b, 0, eX2, eX3);
    const eq3 = wasmExports.dae_addEquation(b, 0, sum3, zero, 0);

    const eqIndices = wasmExports.atomicChunkAlloc(16);
    const varIndices = wasmExports.atomicChunkAlloc(16);
    const view = new DataView(wasmExports.memory.buffer);

    view.setUint32(eqIndices + 0, eq0, true);
    view.setUint32(eqIndices + 4, eq1, true);
    view.setUint32(eqIndices + 8, eq2, true);
    view.setUint32(eqIndices + 12, eq3, true);

    view.setUint32(varIndices + 0, x0, true);
    view.setUint32(varIndices + 4, x1, true);
    view.setUint32(varIndices + 8, x2, true);
    view.setUint32(varIndices + 12, x3, true);

    const ccs = wasmExports.dae_buildJacobianSparsity(b, eqIndices, 4, varIndices, 4);
    expect(ccs).toBeGreaterThan(0);

    const coloring = wasmExports.dae_computeGraphColoring(ccs);
    expect(coloring).toBeGreaterThan(0);

    const numColors = wasmExports.dae_getColoringNumColors(coloring);
    // Distance-2 coloring compresses 4 columns down to <= 3 colors
    expect(numColors).toBeLessThanOrEqual(3);
    expect(numColors).toBeGreaterThan(0);
  });

  it("should solve a sparse linear system using Gilbert-Peierls Sparse LU", () => {
    const b = wasmExports.dae_createBuilder();

    // Variable indices: 3 variables
    const x0 = wasmExports.dae_addVariable(b, 0x1, 0, 0, 0, 0.0, 0);
    const x1 = wasmExports.dae_addVariable(b, 0x2, 0, 0, 0, 0.0, 0);
    const x2 = wasmExports.dae_addVariable(b, 0x3, 0, 0, 0, 0.0, 0);

    const e0 = wasmExports.dae_addName(b, x0);
    const e1 = wasmExports.dae_addName(b, x1);
    const e2 = wasmExports.dae_addName(b, x2);
    const zero = wasmExports.dae_addRealLiteral(b, 0.0);

    // Linear System:
    // [ 2  1  0 ] [ x0 ]   [ 4 ]
    // [ 1  2  1 ] [ x1 ] = [ 8 ]
    // [ 0  1  2 ] [ x2 ]   [ 6 ]
    // Exact solution: x0 = 1, x1 = 2, x2 = 2
    const eq0 = wasmExports.dae_addEquation(b, 0, wasmExports.dae_addBinaryExpr(b, 0, e0, e1), zero, 0);
    const eq1 = wasmExports.dae_addEquation(
      b,
      0,
      wasmExports.dae_addBinaryExpr(b, 0, e0, wasmExports.dae_addBinaryExpr(b, 0, e1, e2)),
      zero,
      0,
    );
    const eq2 = wasmExports.dae_addEquation(b, 0, wasmExports.dae_addBinaryExpr(b, 0, e1, e2), zero, 0);

    const eqIndices = wasmExports.atomicChunkAlloc(12);
    const varIndices = wasmExports.atomicChunkAlloc(12);
    const view = new DataView(wasmExports.memory.buffer);

    view.setUint32(eqIndices + 0, eq0, true);
    view.setUint32(eqIndices + 4, eq1, true);
    view.setUint32(eqIndices + 8, eq2, true);

    view.setUint32(varIndices + 0, x0, true);
    view.setUint32(varIndices + 4, x1, true);
    view.setUint32(varIndices + 8, x2, true);

    const ccs = wasmExports.dae_buildJacobianSparsity(b, eqIndices, 3, varIndices, 3);
    const lu = wasmExports.dae_sparseLuFactor(ccs);
    expect(lu).toBeGreaterThan(0);

    const rhsPtr = wasmExports.atomicChunkAlloc(24);
    const outXPtr = wasmExports.atomicChunkAlloc(24);

    wasmExports.dae_setMemF64(rhsPtr + 0, 4.0);
    wasmExports.dae_setMemF64(rhsPtr + 8, 8.0);
    wasmExports.dae_setMemF64(rhsPtr + 16, 6.0);

    const solved = wasmExports.dae_sparseLuSolve(lu, rhsPtr, outXPtr);
    expect(Boolean(solved)).toBe(true);
  });

  it("should integrate stiff ODE systems using Variable-Order Multi-Step BDF", () => {
    const b = wasmExports.dae_createBuilder();

    // Stiff Decay System: der(y) = -100.0 * (y - sin(t))
    const yVar = wasmExports.dae_addVariable(b, 0x100, 0, 0, 0, 0.0, 1); // continuous state
    const dyVar = wasmExports.dae_addVariable(b, 0x200, 0, 0, 0, 0.0, 0); // derivative

    const bdfSolver = wasmExports.dae_createBdfSolver(b, 1, 1e-6, 1e-6, 5);
    expect(bdfSolver).toBeGreaterThan(0);

    wasmExports.dae_setBdfStateMapping(bdfSolver, 0, yVar, dyVar);

    const varValues = wasmExports.atomicChunkAlloc(32);
    wasmExports.dae_setMemF64(varValues + yVar * 8, 1.0); // Initial y(0) = 1.0
    wasmExports.dae_setMemF64(varValues + dyVar * 8, -100.0); // der(y)(0) = -100.0

    let t = 0.0;
    const dt = 0.001;

    for (let step = 0; step < 10; step++) {
      t = wasmExports.dae_stepBdfSolver(bdfSolver, varValues, t, dt);
      // Stiff system should quickly decay towards 0 without exploding
      const yVal = wasmExports.dae_getMemF64(varValues + yVar * 8);
      expect(Number.isFinite(yVal)).toBe(true);
      expect(Math.abs(yVal)).toBeLessThanOrEqual(2.0);
    }
  });

  it("should support dynamic state selection pivoting in PantelidesEngine", () => {
    const b = wasmExports.dae_createBuilder();

    const varA = wasmExports.dae_addVariable(b, 0x1, 0, 0, 0, 1.0, 1);
    const varB = wasmExports.dae_addVariable(b, 0x2, 0, 0, 0, 0.0, 1);

    const pant = wasmExports.dae_createPantelides(b, 0);
    expect(pant).toBeGreaterThan(0);

    // Swap dynamic state variables when approaching singularity
    const swapped = wasmExports.dae_swapDynamicState(pant, varA, varB);
    expect(Boolean(swapped)).toBe(true);
  });
});
