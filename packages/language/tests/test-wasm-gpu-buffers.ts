// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { estimateGPUMemoryBytes, serializeArenaForGPU } from "../src/compiler/simulator/core/gpu-buffers.js";
import type { ArenaBltResult } from "../src/runtime/wasm_blt.js";
import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, VarType, Variability } from "../src/runtime/wasm_dae.js";

async function runTests() {
  console.log("Testing WASM GPU Buffer Serialization...");

  const dae = new DAEBuilder();

  // 1. Create variables:
  // States: x, y
  // Derivatives: der(x), der(y)
  // Parameters: p = 42.5
  // Algebraic: z1, z2 (form a loop)
  const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.25);
  const yIdx = dae.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 2.75);
  const derXIdx = dae.addVariable("der(x)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const derYIdx = dae.addVariable("der(y)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const pIdx = dae.addVariable("p", VarType.Real, Variability.Parameter, Causality.Local, 42.5);
  const z1Idx = dae.addVariable("z1", VarType.Real, Variability.Continuous, Causality.Local, 0.5);
  const z2Idx = dae.addVariable("z2", VarType.Real, Variability.Continuous, Causality.Local, 0.5);

  // 2. Create Equations:
  // Eq 0 (scalar): der(x) = y + p
  // Eq 1 (scalar): der(y) = -x
  // Eq 2 & 3 (loop): z1 = z2 + 1, z2 = z1 * 0.5
  const eq0 = dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("der(x)")),
    dae.addBinaryExpr(
      BinOp.Add,
      dae.addExpression(ExprKind.Name, dae.interner.intern("y")),
      dae.addExpression(ExprKind.Name, dae.interner.intern("p")),
    ),
  );

  const eq1 = dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("der(y)")),
    dae.addUnaryExpr(ExprKind.Negate, dae.addExpression(ExprKind.Name, dae.interner.intern("x"))),
  );

  const eq2 = dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("z1")),
    dae.addBinaryExpr(BinOp.Add, dae.addExpression(ExprKind.Name, dae.interner.intern("z2")), dae.addRealLiteral(1.0)),
  );

  const eq3 = dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("z2")),
    dae.addBinaryExpr(BinOp.Mul, dae.addExpression(ExprKind.Name, dae.interner.intern("z1")), dae.addRealLiteral(0.5)),
  );

  // Mock BLT result: Block 0 (eq0, var der(x)), Block 1 (eq1, var der(y)), Block 2 (eq2, eq3, vars z1, z2)
  const bltResult: ArenaBltResult = {
    sortedEquations: [eq0, eq1, eq2, eq3],
    blocks: [
      { eqIdxs: [eq0], vars: [derXIdx] },
      { eqIdxs: [eq1], vars: [derYIdx] },
      { eqIdxs: [eq2, eq3], vars: [z1Idx, z2Idx] },
    ],
  };

  const stateVars = new Set<number>([xIdx, yIdx]);

  // Run WASM serialization
  const buffers = serializeArenaForGPU(dae, bltResult, stateVars);
  assert.ok(buffers, "serializeArenaForGPU should return a valid buffer pack");

  console.log("Verifying buffer metadata...");
  assert.strictEqual(buffers.varCount, dae.varCount, "varCount should match");
  assert.strictEqual(buffers.eqCount, dae.eqCount, "eqCount should match");
  assert.strictEqual(buffers.exprCount, dae.exprCount, "exprCount should match");

  // Verify state buffer double-single layout
  console.log("Verifying state buffer Double-Single decomposition...");
  assert.strictEqual(buffers.stateBuffer.length, dae.varCount * 2, "stateBuffer should have 2 f32 per var");

  // For x (start = 1.25)
  const xHigh = buffers.stateBuffer[xIdx * 2] ?? 0;
  const xLow = buffers.stateBuffer[xIdx * 2 + 1] ?? 0;
  assert.strictEqual(xHigh + xLow, 1.25, "x start value reconstructed from DS should be 1.25");

  // For y (start = 2.75)
  const yHigh = buffers.stateBuffer[yIdx * 2] ?? 0;
  const yLow = buffers.stateBuffer[yIdx * 2 + 1] ?? 0;
  assert.strictEqual(yHigh + yLow, 2.75, "y start value reconstructed from DS should be 2.75");

  // For p (start = 42.5)
  const pHigh = buffers.stateBuffer[pIdx * 2] ?? 0;
  const pLow = buffers.stateBuffer[pIdx * 2 + 1] ?? 0;
  assert.strictEqual(pHigh + pLow, 42.5, "p start value reconstructed from DS should be 42.5");

  // Verify nameToVarIdx table
  console.log("Verifying nameToVarIdx table...");
  const xNameId = dae.getVarNameId(xIdx);
  const yNameId = dae.getVarNameId(yIdx);
  const pNameId = dae.getVarNameId(pIdx);
  assert.strictEqual(buffers.nameToVarIdx[xNameId], xIdx, "nameToVarIdx for x should match xIdx");
  assert.strictEqual(buffers.nameToVarIdx[yNameId], yIdx, "nameToVarIdx for y should match yIdx");
  assert.strictEqual(buffers.nameToVarIdx[pNameId], pIdx, "nameToVarIdx for p should match pIdx");

  // Verify Block Plan
  console.log("Verifying CSR Block Plan...");
  const plan = buffers.blockPlan;
  assert.strictEqual(plan.blockCount, 3, "blockCount should be 3");
  assert.strictEqual(plan.scalarBlockCount, 2, "scalarBlockCount should be 2");
  assert.strictEqual(plan.loopBlockCount, 1, "loopBlockCount should be 1 (algebraic loop block)");
  assert.strictEqual(plan.maxBlockSize, 2, "maxBlockSize should be 2");

  assert.strictEqual(plan.blockFlags[0], 0, "Block 0 should be scalar (flag = 0)");
  assert.strictEqual(plan.blockFlags[1], 0, "Block 1 should be scalar (flag = 0)");
  assert.strictEqual(plan.blockFlags[2], 1, "Block 2 should be loop (flag = 1)");

  assert.strictEqual(plan.blockStarts[0], 0);
  assert.strictEqual(plan.blockStarts[1], 1);
  assert.strictEqual(plan.blockStarts[2], 2);
  assert.strictEqual(plan.blockStarts[3], 4);

  assert.deepStrictEqual(Array.from(plan.sortedEqs), [eq0, eq1, eq2, eq3]);

  // Verify state and derivative variable matching
  console.log("Verifying state and derivative variable index pairs...");
  assert.strictEqual(buffers.stateVarIndices.length, 2, "2 state variables");
  assert.strictEqual(buffers.derivVarIndices.length, 2, "2 derivative variables");
  assert.strictEqual(buffers.stateVarIndices[0], xIdx);
  assert.strictEqual(buffers.derivVarIndices[0], derXIdx);
  assert.strictEqual(buffers.stateVarIndices[1], yIdx);
  assert.strictEqual(buffers.derivVarIndices[1], derYIdx);

  // Verify Memory Estimation
  const bytes = estimateGPUMemoryBytes(buffers);
  console.log(`Estimated GPU memory: ${bytes} bytes`);
  assert.ok(bytes > 0, "GPU memory estimate should be greater than 0");

  console.log("All WASM GPU Buffer Serialization tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
