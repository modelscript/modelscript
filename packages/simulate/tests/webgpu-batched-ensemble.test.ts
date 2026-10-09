// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import assert from "node:assert";
import {
  createBatchedOdeConfigFromArena,
  generateBatchedOdeCudaKernel,
  generateBatchedOdeEnsemble,
  generateBatchedOdeWgslKernel,
  type BatchedOdeEnsembleConfig,
} from "../src/optimizer/solvers/gpu-codegen.js";

console.log("=== Testing Batched ODE GPU Ensemble Simulation (DiffEqGPU Paradigm) ===");

// 1. Test CUDA Kernel Generation for Lotka-Volterra predator-prey system
{
  const config: BatchedOdeEnsembleConfig = {
    name: "lotka_volterra",
    numStates: 2,
    numParams: 4,
    stateNames: ["x", "y"],
    paramNames: ["alpha", "beta", "gamma", "delta"],
    // dx/dt = alpha * x - beta * x * y
    // dy/dt = delta * x * y - gamma * y
    rhsExpressions: ["(p_0 * y_0) - (p_1 * y_0 * y_1)", "(p_3 * y_0 * y_1) - (p_2 * y_1)"],
    integrator: "rk4",
    workgroupSize: 256,
  };

  const cudaKernel = generateBatchedOdeCudaKernel(config);
  assert.strictEqual(cudaKernel.target, "cuda");
  assert.strictEqual(cudaKernel.name, "lotka_volterra_ensemble");
  assert.strictEqual(cudaKernel.workgroupSize, 256);

  // Check coalesced memory access pattern: state_idx * batch_size + traj
  assert.ok(cudaKernel.source.includes("int traj = blockIdx.x * blockDim.x + threadIdx.x;"));
  assert.ok(cudaKernel.source.includes("if (traj >= batch_size) return;"));
  assert.ok(cudaKernel.source.includes("double y_0 = y0[0 * batch_size + traj];"));
  assert.ok(cudaKernel.source.includes("double y_1 = y0[1 * batch_size + traj];"));
  assert.ok(cudaKernel.source.includes("double p_0 = params[0 * batch_size + traj];"));
  assert.ok(cudaKernel.source.includes("double p_3 = params[3 * batch_size + traj];"));

  // Check in-register RK4 stages
  assert.ok(cudaKernel.source.includes("double k1_0 = (p_0 * y_0) - (p_1 * y_0 * y_1);"));
  assert.ok(cudaKernel.source.includes("double y_tmp_0 = y_0 + 0.5 * h * k1_0;"));
  assert.ok(cudaKernel.source.includes("double k2_0 = (p_0 * y_tmp_0) - (p_1 * y_tmp_0 * y_tmp_1);"));
  assert.ok(cudaKernel.source.includes("double k3_0 = (p_0 * y_tmp_0) - (p_1 * y_tmp_0 * y_tmp_1);"));
  assert.ok(cudaKernel.source.includes("double k4_0 = (p_0 * y_tmp_0) - (p_1 * y_tmp_0 * y_tmp_1);"));
  assert.ok(cudaKernel.source.includes("y_0 += (h / 6.0) * (k1_0 + 2.0 * k2_0 + 2.0 * k3_0 + k4_0);"));

  // Check coalesced output writeback
  assert.ok(cudaKernel.source.includes("y_out[0 * batch_size + traj] = y_0;"));
  assert.ok(cudaKernel.source.includes("y_out[1 * batch_size + traj] = y_1;"));

  // Check launcher signature
  assert.ok(cudaKernel.source.includes('extern "C" void lotka_volterra_ensemble_launch('));
  assert.ok(cudaKernel.source.includes("int blocks = (batch_size + threads - 1) / threads;"));

  console.log("✓ CUDA batched ODE ensemble kernel generation passed");
}

// 2. Test WGSL Kernel Generation for WebGPU execution
{
  const config: BatchedOdeEnsembleConfig = {
    name: "harmonic_oscillator",
    numStates: 2,
    numParams: 2,
    stateNames: ["x", "v"],
    paramNames: ["k", "m"],
    // dx/dt = v
    // dv/dt = -(k / m) * x
    rhsExpressions: ["y_1", "-(p_0 / p_1) * y_0"],
    integrator: "rk4",
    workgroupSize: 128,
  };

  const wgslKernel = generateBatchedOdeWgslKernel(config);
  assert.strictEqual(wgslKernel.target, "webgpu");
  assert.strictEqual(wgslKernel.name, "harmonic_oscillator_ensemble");
  assert.strictEqual(wgslKernel.workgroupSize, 128);

  // Check bindings and struct layout
  assert.ok(wgslKernel.source.includes("struct SimUniforms {"));
  assert.ok(wgslKernel.source.includes("@group(0) @binding(0) var<storage, read> y0: array<f32>;"));
  assert.ok(wgslKernel.source.includes("@group(0) @binding(1) var<storage, read> params: array<f32>;"));
  assert.ok(wgslKernel.source.includes("@group(0) @binding(2) var<storage, read_write> y_out: array<f32>;"));
  assert.ok(wgslKernel.source.includes("@group(0) @binding(3) var<uniform> uniforms: SimUniforms;"));
  assert.ok(wgslKernel.source.includes("@compute @workgroup_size(128)"));

  // Check coalesced reading and writeback in WGSL
  assert.ok(wgslKernel.source.includes("let traj = gid.x;"));
  assert.ok(wgslKernel.source.includes("if (traj >= uniforms.batch_size) { return; }"));
  assert.ok(wgslKernel.source.includes("var y_0: f32 = y0[0u * bsz + traj];"));
  assert.ok(wgslKernel.source.includes("var y_1: f32 = y0[1u * bsz + traj];"));
  assert.ok(wgslKernel.source.includes("let p_0: f32 = params[0u * bsz + traj];"));
  assert.ok(wgslKernel.source.includes("y_out[0u * bsz + traj] = y_0;"));
  assert.ok(wgslKernel.source.includes("y_out[1u * bsz + traj] = y_1;"));

  console.log("✓ WGSL batched ODE ensemble shader generation passed");
}

// 3. Test Full Ensemble Generation and Memory Layout Parity
{
  const config: BatchedOdeEnsembleConfig = {
    numStates: 1,
    numParams: 1,
    rhsExpressions: ["-p_0 * y_0"],
    integrator: "euler",
  };

  const ensemble = generateBatchedOdeEnsemble(config);
  assert.strictEqual(ensemble.cuda.target, "cuda");
  assert.strictEqual(ensemble.wgsl.target, "webgpu");
  assert.strictEqual(ensemble.memoryLayout.coalesced, true);
  assert.strictEqual(ensemble.memoryLayout.indexingFormula, "state_idx * batch_size + trajectory_idx");

  // Verify Euler stepper in both targets
  assert.ok(ensemble.cuda.source.includes("y_0 += h * dy_0;"));
  assert.ok(ensemble.wgsl.source.includes("y_0 = y_0 + h * dy_0;"));

  console.log("✓ Full ensemble multi-target generation with Euler integrator passed");
}

// 4. Test Extraction of Ensemble Config from DAEBuilder Arena
{
  const arena = new DAEBuilder();
  // Continuous state x
  arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  // Continuous state v
  arena.addVariable("v", VarType.Real, Variability.Continuous, 0, 0.0);
  // Parameter k = 10.0
  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 10.0);
  arena.setVarExpression(kIdx, arena.addRealLiteral(10.0));

  // Equation 1: der(x) = v
  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const vExpr = arena.addNameExpr("v");
  arena.addEquation(EqKind.Simple, derX, vExpr);

  // Equation 2: der(v) = -k * x
  const derV = arena.addDerExpr(vExpr);
  const kExpr = arena.addNameExpr("k");
  const kTimesX = arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr);
  const negKTimesX = arena.addUnaryExpr(UnaryOp.Negate, kTimesX);
  arena.addEquation(EqKind.Simple, derV, negKTimesX);

  const extractedConfig = createBatchedOdeConfigFromArena(arena, {
    name: "harmonic_spring",
    integrator: "rk4",
    workgroupSize: 256,
  });

  assert.strictEqual(extractedConfig.name, "harmonic_spring");
  assert.strictEqual(extractedConfig.numStates, 2);
  assert.strictEqual(extractedConfig.numParams, 1);
  assert.ok(extractedConfig.stateNames?.includes("x") && extractedConfig.stateNames?.includes("v"));
  assert.ok(extractedConfig.paramNames?.includes("k"));
  assert.strictEqual(extractedConfig.rhsExpressions.length, 2);

  // Check generated ensemble code from extracted config
  const kernels = generateBatchedOdeEnsemble(extractedConfig);
  assert.ok(kernels.cuda.source.includes("harmonic_spring_ensemble"));
  assert.ok(kernels.wgsl.source.includes("harmonic_spring_ensemble"));

  console.log("✓ Linear memory DAEBuilder arena extraction to GPU ensemble passed");
}

console.log("=== All Batched ODE GPU Ensemble Tests Passed Cleanly ===");
