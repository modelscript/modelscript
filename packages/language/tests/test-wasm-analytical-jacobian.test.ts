import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/dsl/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Phase 1: In-WASM Analytical Sparse Jacobian & Adjoint Tape Engine (CasADi-Grade AD)", () => {
  it("should compile WASM runtime and verify analytical sparse Jacobian and reverse-mode AdTape", async () => {
    const result = buildParser(modelicaLanguage);
    const tmpDir = path.resolve(__dirname, "../build/tmp-analytical-jacobian-test");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascBin = path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js");
    childProcess.execSync(
      `node "${ascBin}" parser.ts -O0 --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
      { cwd: tmpDir, stdio: "inherit" },
    );

    const wasmBytes = fs.readFileSync(path.join(tmpDir, "parser.wasm"));
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: (msg: number, file: number, line: number, col: number) => {
          console.error(`WASM abort: ${msg} at ${file}:${line}:${col}`);
        },
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

    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
    const exports = instance.exports as any;

    // 1. Create DaeBuilder
    const dae = exports.dae_createBuilder();
    expect(dae).toBeGreaterThan(0);

    // 2. Add Variables: x0 (id 0), x1 (id 1)
    const x0 = exports.dae_addVariable(dae, 100, 0, 0, 0, 2.0); // Real, Continuous, Local, start=2.0
    const x1 = exports.dae_addVariable(dae, 101, 0, 0, 0, 3.0); // Real, Continuous, Local, start=3.0

    // Set variable values in memory at varValuesPtr:
    const varValuesPtr = exports.atomicChunkAlloc(16); // 2 * f64 = 16 bytes
    const f64Mem = new Float64Array(memory.buffer, varValuesPtr, 2);
    f64Mem[0] = 2.0; // x0 = 2.0
    f64Mem[1] = 3.0; // x1 = 3.0

    // Equation 0: x0 * x0 + x1 = 7.0  (residual: (x0 * x0 + x1) - 7.0)
    // d(res0)/dx0 = 2 * x0 = 4.0
    // d(res0)/dx1 = 1.0
    const x0Expr = exports.dae_addExpression(dae, 0, x0, 0, 0); // ExprKind.Name (0)
    const x1Expr = exports.dae_addExpression(dae, 0, x1, 0, 0); // ExprKind.Name (0)
    const x0Sq = exports.dae_addExpression(dae, 5, 2, x0Expr, x0Expr); // ExprKind.Binary (5), BinOp.Mul (2)
    const lhs0 = exports.dae_addExpression(dae, 5, 0, x0Sq, x1Expr); // ExprKind.Binary (5), BinOp.Add (0)
    const rhs0 = exports.dae_addRealLiteral(dae, 7.0);
    const eq0 = exports.dae_addEquation(dae, 0, lhs0, rhs0); // EqKind.Simple (0)

    // Equation 1: x0 * x1 = 6.0  (residual: (x0 * x1) - 6.0)
    // d(res1)/dx0 = x1 = 3.0
    // d(res1)/dx1 = x0 = 2.0
    const lhs1 = exports.dae_addExpression(dae, 5, 2, x0Expr, x1Expr); // ExprKind.Binary (5), BinOp.Mul (2)
    const rhs1 = exports.dae_addRealLiteral(dae, 6.0);
    const eq1 = exports.dae_addEquation(dae, 0, lhs1, rhs1); // EqKind.Simple (0)

    // 3. Build Jacobian Sparsity & Graph Coloring
    const eqIndicesPtr = exports.atomicChunkAlloc(8);
    const eqIndices = new Uint32Array(memory.buffer, eqIndicesPtr, 2);
    eqIndices[0] = eq0;
    eqIndices[1] = eq1;

    const varIndicesPtr = exports.atomicChunkAlloc(8);
    const varIndices = new Uint32Array(memory.buffer, varIndicesPtr, 2);
    varIndices[0] = x0;
    varIndices[1] = x1;

    const ccs = exports.dae_buildJacobianSparsity(dae, eqIndicesPtr, 2, varIndicesPtr, 2);
    expect(ccs).toBeGreaterThan(0);

    const nnz = exports.dae_getJacobianNNZ(ccs);
    expect(nnz).toBe(4); // 2x2 dense block = 4 entries

    const coloring = exports.dae_computeGraphColoring(ccs);
    expect(coloring).toBeGreaterThan(0);
    const numColors = exports.dae_getColoringNumColors(coloring);
    expect(numColors).toBeGreaterThanOrEqual(1);

    // 4. Evaluate Analytical Sparse Jacobian
    exports.dae_evalAnalyticalJacobian(dae, ccs, eqIndicesPtr, varIndicesPtr, varValuesPtr);

    const jacValuesPtr = exports.dae_getJacobianValuesPtr(ccs);
    expect(jacValuesPtr).toBeGreaterThan(0);
    const jacValues = new Float64Array(memory.buffer, jacValuesPtr, nnz);

    // Column 0 (x0): d(eq0)/dx0 = 2*x0 = 4.0, d(eq1)/dx0 = x1 = 3.0
    // Column 1 (x1): d(eq0)/dx1 = 1.0,        d(eq1)/dx1 = x0 = 2.0
    expect(jacValues[0]).toBeCloseTo(4.0, 6);
    expect(jacValues[1]).toBeCloseTo(3.0, 6);
    expect(jacValues[2]).toBeCloseTo(1.0, 6);
    expect(jacValues[3]).toBeCloseTo(2.0, 6);

    // 5. Test Reverse-Mode AdTape for Adjoint Sensitivity
    const tape = exports.dae_createAdTape(256);
    expect(tape).toBeGreaterThan(0);

    // Objective function: J(x0, x1) = (x0 - 1)^2 + (x1 - 2)^2
    // at x0=2, x1=3: J = (2-1)^2 + (3-2)^2 = 2.0
    // dJ/dx0 = 2*(x0 - 1) = 2.0
    // dJ/dx1 = 2*(x1 - 2) = 2.0
    const c1 = exports.dae_addRealLiteral(dae, 1.0);
    const c2 = exports.dae_addRealLiteral(dae, 2.0);
    const diff0 = exports.dae_addExpression(dae, 5, 1, x0Expr, c1); // x0 - 1
    const diff1 = exports.dae_addExpression(dae, 5, 1, x1Expr, c2); // x1 - 2
    const term0 = exports.dae_addExpression(dae, 5, 2, diff0, diff0); // (x0 - 1)^2
    const term1 = exports.dae_addExpression(dae, 5, 2, diff1, diff1); // (x1 - 2)^2
    const objExpr = exports.dae_addExpression(dae, 5, 0, term0, term1); // J

    const rootTapeNode = exports.dae_tapeRecordExpr(tape, dae, objExpr, varValuesPtr);
    expect(exports.dae_tapeGetValue(tape, rootTapeNode)).toBeCloseTo(2.0, 6);

    // Backward AD sweep
    exports.dae_tapeBackward(tape, rootTapeNode);

    const gradX0 = exports.dae_tapeGetVarGrad(tape, x0);
    const gradX1 = exports.dae_tapeGetVarGrad(tape, x1);

    expect(gradX0).toBeCloseTo(2.0, 6);
    expect(gradX1).toBeCloseTo(2.0, 6);
  }, 180000);
});
