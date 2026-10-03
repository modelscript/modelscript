// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm, performBltTransformationArena } from "@modelscript/runtime/wasm_blt.js";
import { DAEBuilder, EqKind, ExprKind, Variability } from "@modelscript/runtime/wasm_dae.js";
import assert from "node:assert";
import { serializeArenaForGPU } from "../src/core/gpu-buffers.js";
import { generateWGSL } from "../src/core/wgsl-codegen.js";

console.log("=== Testing WebGPU Adaptive (Tsit5) & Stiff (TR-BDF2) Compute Shaders ===");

await initBltWasm();

// 1. Construct a simple DAE arena: dy/dt = -k * y
const arena = new DAEBuilder();
const yIdx = arena.addVariable("y", 0, Variability.Continuous);
const derYIdx = arena.addVariable("der(y)", 0, Variability.Continuous);
const kIdx = arena.addVariable("k", 0, Variability.Parameter);

arena.setVarStartValue(yIdx, 1.0);
arena.setVarStartValue(kIdx, 0.5);

// Equation 1: der(y) = -k * y
const negK = arena.addUnaryExpr(ExprKind.Negate, arena.addNameExpr("k"));
const rhs = arena.addBinaryExpr(ExprKind.Binary, 2 /* Mul */, negK, arena.addNameExpr("y"));
arena.addEquation(EqKind.Simple, arena.addNameExpr("der(y)"), rhs);

// 2. Perform BLT and GPU serialization
const stateVars = new Set<number>([yIdx]);
const blt = performBltTransformationArena(arena);
const gpuBuffers = serializeArenaForGPU(arena, blt, stateVars);

assert(gpuBuffers !== undefined, "GPU buffers must be generated successfully");
assert.strictEqual(gpuBuffers.stateVarIndices.length, 1, "Must have 1 state variable");

// 3. Generate WGSL Compute Shader
const wgsl = generateWGSL(arena, gpuBuffers, { workgroupSize: 64, debugComments: true });

// 4. Assert WGSL contains Tsit5, TR-BDF2, and scratch bindings
console.log("Validating generated WGSL compute shader...");

assert(wgsl.includes("stage_scratch: array<vec2<f32>>"), "Must declare stage_scratch buffer binding");
assert(wgsl.includes("solver_type: u32"), "SimParams must declare solver_type");
assert(wgsl.includes("sub_stage: u32"), "SimParams must declare sub_stage");

// Tsit5 Kernel assertions
assert(
  wgsl.includes("fn tsit5_step(@builtin(global_invocation_id) gid: vec3<u32>)"),
  "Must contain tsit5_step compute kernel",
);
assert(wgsl.includes("0.161"), "Must contain Tsit5 stage coefficients");
assert(
  wgsl.includes("stage_scratch[7u * N + idx] = ds_mul(dt, err_sum);"),
  "Must compute Tsit5 embedded error estimate",
);

// TR-BDF2 Kernel assertions
assert(
  wgsl.includes("fn trbdf2_step(@builtin(global_invocation_id) gid: vec3<u32>)"),
  "Must contain trbdf2_step compute kernel",
);
assert(wgsl.includes("0.585786437626905"), "Must contain TR-BDF2 gamma coefficient");
assert(wgsl.includes("1.2071067811865475"), "Must contain TR-BDF2 BDF stage coefficients");

console.log("  ✓ WGSL Stage Scratch Buffer Binding: OK");
console.log("  ✓ WGSL 7-Stage Embedded Tsit5 Compute Pipeline: OK");
console.log("  ✓ WGSL 2-Stage Stiff TR-BDF2 Compute Pipeline: OK");
console.log("WebGPU Adaptive & Stiff Compute Shaders verified successfully!");
