// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "path";
import { fileURLToPath } from "url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Phase 3: Massive Parallel Batched Simulation Engine (Vectorized vmap)", () => {
  it("should compile WASM runtime and execute 100 parallel parameter sweep trajectories simultaneously", async () => {
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
    const { facade } = await createWasmParser(modelicaWasm);
    const exports = facade.exports as any;
    const memory = facade.wasmMemory;

    // 1. Create DaeBuilder
    const dae = exports.dae_createBuilder();
    expect(dae).toBeGreaterThan(0);

    // 2. Add Variables for Cooling Model:
    // T (id 0): Continuous state, start=100.0
    // k (id 1): Parameter, default=1.0
    // Tamb (id 2): Parameter, default=20.0
    const varT = exports.dae_addVariable(dae, 100, 0, 0, 0, 100.0); // Continuous
    const varK = exports.dae_addVariable(dae, 101, 0, 1, 0, 1.0); // Parameter
    const varTamb = exports.dae_addVariable(dae, 102, 0, 1, 0, 20.0); // Parameter

    // Equation: der(T) = -k * (T - Tamb)
    const exprT = exports.dae_addExpression(dae, 0, varT, 0, 0); // ExprKind.Name
    const exprK = exports.dae_addExpression(dae, 0, varK, 0, 0); // ExprKind.Name
    const exprTamb = exports.dae_addExpression(dae, 0, varTamb, 0, 0); // ExprKind.Name

    const derT = exports.dae_addExpression(dae, 12, exprT, 0, 0); // ExprKind.Der (12)
    const diffT = exports.dae_addExpression(dae, 5, 1, exprT, exprTamb); // BinOp.Sub (1): T - Tamb
    const mulKDiff = exports.dae_addExpression(dae, 5, 2, exprK, diffT); // BinOp.Mul (2): k * (T - Tamb)
    const rhsDer = exports.dae_addExpression(dae, 14, 0, mulKDiff, 0); // ExprKind.Negate (14): -k * (T - Tamb)

    exports.dae_addEquation(dae, 0, derT, rhsDer); // EqKind.Simple (0)

    // 3. Prepare Parameter Sweep (M = 100 instances, varying k from 0.1 to 5.0)
    const nInstances = 100;
    const nParams = 1; // varying k (varK)

    const paramIndicesPtr = exports.atomicChunkAlloc(4);
    const paramIndices = new Uint32Array(memory.buffer, paramIndicesPtr, 1);
    paramIndices[0] = varK;

    const batchParamsPtr = exports.atomicChunkAlloc(nInstances * 8);
    const batchParams = new Float64Array(memory.buffer, batchParamsPtr, nInstances);
    for (let i = 0; i < nInstances; i++) {
      batchParams[i] = 0.1 + (i * 4.9) / (nInstances - 1); // k in [0.1, 5.0]
    }

    const t0 = 0.0;
    const t1 = 2.0;
    const dt = 0.01;
    const nSteps = Math.ceil((t1 - t0) / dt) + 1;
    const nVars = 3;
    const totalFloats = nInstances * nSteps * nVars;
    const outResultsPtr = exports.atomicChunkAlloc(totalFloats * 8);

    // 4. Execute Batched Vectorized Simulation
    const executedInstances = exports.dae_simulateBatch(
      dae,
      nInstances,
      paramIndicesPtr,
      nParams,
      batchParamsPtr,
      t0,
      t1,
      dt,
      outResultsPtr,
    );
    expect(executedInstances).toBe(nInstances);

    // 5. Verify Trajectory Accuracy Across Instances
    const outResults = new Float64Array(memory.buffer, outResultsPtr, totalFloats);

    for (let inst = 0; inst < nInstances; inst++) {
      const kVal = batchParams[inst];
      const instOffset = inst * nSteps * nVars;

      // Check final state at t = 2.0: T(2.0) = 20.0 + (100.0 - 20.0) * exp(-kVal * 2.0)
      const lastStepOffset = instOffset + (nSteps - 1) * nVars;
      const finalT = outResults[lastStepOffset + 0]; // varT is at offset 0
      const expectedT = 20.0 + 80.0 * Math.exp(-kVal * 2.0);

      expect(Math.abs(finalT - expectedT)).toBeLessThan(0.1); // Discretization error bound for dt=0.01
    }
  });
});
