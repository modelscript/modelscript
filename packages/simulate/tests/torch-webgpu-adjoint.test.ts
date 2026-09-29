// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import assert from "node:assert";
import { TorchAutogradBridge } from "../src/core/torch-autograd-bridge.js";
import { WebGPUAdjointRunner } from "../src/core/webgpu-adjoint-runner.js";

async function runTests() {
  console.log("=== Testing PyTorch Autograd Bridge & WebGPU Batched Adjoint Runner ===");
  await initBltWasm();

  // Simple harmonic oscillator:
  // der(x) = v
  // der(v) = -k * x
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(xIdx, 1.0);
  const vIdx = arena.addVariable("v", VarType.Real, Variability.Continuous, 0, 0.0);
  arena.setVarStartValue(vIdx, 0.0);
  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 4.0);
  arena.setVarExpression(kIdx, arena.addRealLiteral(4.0));

  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const vExpr = arena.addNameExpr("v");
  arena.addEquation(EqKind.Simple, derX, vExpr);

  const derV = arena.addDerExpr(vExpr);
  const kExpr = arena.addNameExpr("k");
  const kx = arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr);
  const negKx = arena.addUnaryExpr(UnaryOp.Negate, kx);
  arena.addEquation(EqKind.Simple, derV, negKx);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: TorchAutogradBridge Forward & Backward Cycle
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 1: TorchAutogradBridge forward & backward simulation cycle...");
  const bridge = new TorchAutogradBridge({
    arena,
    parameterNames: ["k"],
    stateNames: ["x", "v"],
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.02,
  });

  // Forward pass
  const fwdRes = bridge.forward({
    parameters: [4.0],
  });

  assert.ok(fwdRes.tapeId.startsWith("tape_"));
  assert.ok(fwdRes.time.length > 40);
  assert.strictEqual(fwdRes.trajectory[0]?.length, 2);
  console.log(`  Forward pass generated ${fwdRes.time.length} trajectory steps with tapeId: ${fwdRes.tapeId}`);

  // Backward pass with cotangent vector [dL/dx(T)=1.0, dL/dv(T)=0.0]
  const bwdRes = bridge.backward({
    tapeId: fwdRes.tapeId,
    parameters: [4.0],
    gradOutputs: [1.0, 0.0],
  });

  assert.strictEqual(bwdRes.gradParameters.length, 1);
  const gradK = bwdRes.gradParameters[0]!;
  console.log(`  Adjoint grad dL/dk: ${gradK.toFixed(6)}`);
  assert.ok(!isNaN(gradK));
  assert.ok(bwdRes.gradInitialStates.length === 2);

  // Verify Python module generator produces expected autograd code
  const pyCode = bridge.generatePythonModule("http://localhost:8080");
  assert.ok(pyCode.includes("class ModelScriptDaeFunction(torch.autograd.Function):"));
  assert.ok(pyCode.includes("class ModelScriptDaeModule(nn.Module):"));
  console.log("  ✔ PyTorch Autograd Bridge and Python code generator verified!");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: WebGPU Batched Adjoint Runner
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 2: WebGPU Batched Adjoint Runner...");
  const gpuRunner = new WebGPUAdjointRunner(arena);
  await gpuRunner.initialize();

  // Batch of 5 different parameter configurations: k in [1.0, 2.0, 4.0, 8.0, 16.0]
  const paramBatch = [
    new Float64Array([1.0]),
    new Float64Array([2.0]),
    new Float64Array([4.0]),
    new Float64Array([8.0]),
    new Float64Array([16.0]),
  ];

  const batchRes = await gpuRunner.runBatchedAdjoint({
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.02,
    parametersToDifferentiate: ["k"],
    parameterBatch: paramBatch,
    targets: [
      new Float64Array([0.5, 0.0]),
      new Float64Array([0.0, -1.0]),
      new Float64Array([-1.0, 0.0]),
      new Float64Array([0.0, 1.0]),
      new Float64Array([1.0, 0.0]),
    ],
  });

  assert.strictEqual(batchRes.losses.length, 5);
  assert.strictEqual(batchRes.gradients.length, 5);
  console.log(`  Executed batch of 5 trajectories on ${batchRes.device} in ${batchRes.elapsedMs}ms:`);
  for (let b = 0; b < 5; b++) {
    const pVal = paramBatch[b]![0]!;
    const loss = batchRes.losses[b]!;
    const grad = batchRes.gradients[b]![0]!;
    console.log(`    Batch item ${b} (k=${pVal.toFixed(1)}): loss=${loss.toFixed(4)}, dL/dk=${grad.toFixed(4)}`);
    assert.ok(!isNaN(loss));
    assert.ok(!isNaN(grad));
  }

  console.log("  ✔ WebGPU Batched Adjoint Runner verified successfully!");
  console.log("\nAll PyTorch Bridge and WebGPU Adjoint tests PASSED successfully!");
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
