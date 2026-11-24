// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { initBltWasm, performBltTransformationArena } from "@modelscript/runtime/wasm_blt.js";
import { BinOp, DAEBuilder, EqKind, ExprKind, Variability } from "@modelscript/runtime/wasm_dae.js";
import { generateCudaFP64Kernel } from "../src/core/cuda-codegen.js";
import { serializeArenaForGPU } from "../src/core/gpu-buffers.js";

describe("Hardware FP64 CUDA/HIP Codegen (cuda-codegen.ts)", () => {
  it("emits native IEEE-754 double (f64) residual and batched kernels from DAEBuilder", async () => {
    await initBltWasm();

    const arena = new DAEBuilder();
    const yIdx = arena.addVariable("y", 0, Variability.Continuous);
    arena.addVariable("der(y)", 0, Variability.Continuous);
    const kIdx = arena.addVariable("k", 0, Variability.Parameter);

    arena.setVarStartValue(yIdx, 1.0);
    arena.setVarStartValue(kIdx, 0.5);

    const negK = arena.addUnaryExpr(ExprKind.Negate, arena.addNameExpr("k"));
    const rhs = arena.addBinaryExpr(ExprKind.Binary, BinOp.Mul, negK, arena.addNameExpr("y"));
    arena.addEquation(EqKind.Simple, arena.addNameExpr("der(y)"), rhs);

    const blt = performBltTransformationArena(arena);
    const gpuBuffers = serializeArenaForGPU(arena, blt, new Set<number>([yIdx]));

    const cudaSrc = generateCudaFP64Kernel(arena, gpuBuffers, { dialect: "cuda" });
    assert.ok(cudaSrc.includes("const double* __restrict__ state"), "should use native double* state");
    assert.ok(cudaSrc.includes("double* __restrict__ residuals"), "should use native double* residuals");
    assert.ok(cudaSrc.includes("__global__ void ms_dae_batched_eval_fp64"), "should emit batched fp64 kernel");
    assert.ok(cudaSrc.includes("state[1]"), "should reference der(y) in state");
    assert.ok(!cudaSrc.includes("vec2<f32>"), "must not emit emulated vec2<f32> double-single");
    assert.ok(!cudaSrc.includes("ds_add"), "must not emit emulated ds_add");

    const hipSrc = generateCudaFP64Kernel(arena, gpuBuffers, { dialect: "hip", kernelPrefix: "hip_dae" });
    assert.ok(hipSrc.includes("#include <hip/hip_runtime.h>"));
    assert.ok(hipSrc.includes("__global__ void hip_dae_batched_eval_fp64"));
  });
});
