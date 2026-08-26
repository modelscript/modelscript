// SPDX-License-Identifier: AGPL-3.0-or-later
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Second-Order Derivatives (Hessians) & Symmetric Star-Coloring", () => {
  it("should evaluate exact analytical Lagrangian Hessian and compute symmetric star-coloring", async () => {
    const result = buildParser(modelicaLanguage);
    const tmpDir = path.resolve(__dirname, "../build/tmp-hessian-star-coloring-test");
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

    // 2. Add Variables: x (id 0), y (id 1)
    const varX = exports.dae_addVariable(dae, 100, 0, 0, 0, 1.2);
    const varY = exports.dae_addVariable(dae, 101, 0, 0, 0, 2.5);

    const varValuesPtr = exports.atomicChunkAlloc(16);
    const f64Mem = new Float64Array(memory.buffer, varValuesPtr, 2);
    f64Mem[0] = 1.2; // x = 1.2
    f64Mem[1] = 2.5; // y = 2.5

    // Expressions for x and y
    const exprX = exports.dae_addExpression(dae, 0, varX, 0, 0); // Name (0)
    const exprY = exports.dae_addExpression(dae, 0, varY, 0, 0); // Name (0)

    const c1 = exports.dae_addRealLiteral(dae, 1.0);
    const c100 = exports.dae_addRealLiteral(dae, 100.0);

    // Objective: Rosenbrock f(x, y) = 100*(y - x^2)^2 + (1 - x)^2
    // term1: (1 - x)^2
    const diff1X = exports.dae_addExpression(dae, 5, 1, c1, exprX); // 1 - x
    const term1 = exports.dae_addExpression(dae, 5, 2, diff1X, diff1X); // (1 - x)^2

    // term2: 100 * (y - x*x)^2
    const xSq = exports.dae_addExpression(dae, 5, 2, exprX, exprX); // x^2
    const diffYXSq = exports.dae_addExpression(dae, 5, 1, exprY, xSq); // y - x^2
    const diffYXSqSq = exports.dae_addExpression(dae, 5, 2, diffYXSq, diffYXSq); // (y - x^2)^2
    const term2 = exports.dae_addExpression(dae, 5, 2, c100, diffYXSqSq); // 100 * (y - x^2)^2

    const objExpr = exports.dae_addExpression(dae, 5, 0, term1, term2); // f(x, y)

    // Constraint Equation: x * y = 3.0
    const lhs0 = exports.dae_addExpression(dae, 5, 2, exprX, exprY);
    const rhs0 = exports.dae_addRealLiteral(dae, 3.0);
    const eq0 = exports.dae_addEquation(dae, 0, lhs0, rhs0);

    // 3. Build Hessian Sparsity & Star-Coloring
    const eqIndicesPtr = exports.atomicChunkAlloc(4);
    const eqIndices = new Uint32Array(memory.buffer, eqIndicesPtr, 1);
    eqIndices[0] = eq0;

    const varIndicesPtr = exports.atomicChunkAlloc(8);
    const varIndices = new Uint32Array(memory.buffer, varIndicesPtr, 2);
    varIndices[0] = varX;
    varIndices[1] = varY;

    const hessianCCS = exports.dae_buildHessianSparsity(dae, objExpr, eqIndicesPtr, 1, varIndicesPtr, 2);
    expect(hessianCCS).toBeGreaterThan(0);

    const nnzH = exports.dae_getJacobianNNZ(hessianCCS);
    expect(nnzH).toBe(4); // 2x2 symmetric Hessian entries

    const starColoring = exports.dae_computeStarColoring(hessianCCS);
    expect(starColoring).toBeGreaterThan(0);
    const numColors = exports.dae_getColoringNumColors(starColoring);
    expect(numColors).toBeGreaterThanOrEqual(1);

    // 4. Evaluate Exact Lagrangian Hessian: sigmaF = 1.0, lambda_0 = 5.0
    const lambdaPtr = exports.atomicChunkAlloc(8);
    const lambdaMem = new Float64Array(memory.buffer, lambdaPtr, 1);
    lambdaMem[0] = 5.0; // lambda_0 = 5.0

    exports.dae_evalLagrangianHessian(
      dae,
      hessianCCS,
      objExpr,
      eqIndicesPtr,
      1,
      varIndicesPtr,
      2,
      lambdaPtr,
      1.0,
      varValuesPtr,
    );

    const hValuesPtr = exports.dae_getJacobianValuesPtr(hessianCCS);
    const hValues = new Float64Array(memory.buffer, hValuesPtr, nnzH);

    // At x=1.2, y=2.5:
    // d^2 f / dx^2 = 1200*(1.2)^2 - 400*(2.5) + 2 = 1728 - 1000 + 2 = 730.0
    // d^2 f / dx dy = -400*(1.2) = -480.0
    // d^2 f / dy^2 = 200.0
    // With lambda_0 = 5.0 (d^2(x*y)/dx dy = 1.0):
    // Total H = [[730.0, -475.0], [-475.0, 200.0]]
    expect(hValues[0]).toBeCloseTo(730.0, 4); // H[0, 0]
    expect(hValues[1]).toBeCloseTo(-475.0, 4); // H[1, 0]
    expect(hValues[2]).toBeCloseTo(-475.0, 4); // H[0, 1]
    expect(hValues[3]).toBeCloseTo(200.0, 4); // H[1, 1]
  }, 180000);
});
