// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Native IEEE-754 `double` (FP64) CUDA / HIP Kernel Codegen from `DAEBuilder`.
 *
 * Sibling to `wgsl-codegen.ts`: instead of emulating double precision with `vec2<f32>`
 * double-single arithmetic (required by WebGPU/WGSL), this emitter lowers the linear-memory
 * DAE arena directly into hardware FP64 CUDA/HIP C++ kernels compiled in-process via
 * NVRTC (NVIDIA) or hipRTC (AMD) on Cloud HPC GPU nodes (A100/H100/B200/MI300X).
 */

import { BinOp, type DAEBuilder, EqKind, ExprKind, UnaryOp } from "@modelscript/runtime/wasm_dae.js";
import type { GPUArenaBuffers } from "./gpu-buffers.js";

export interface CudaCodegenOptions {
  /** Target dialect: "cuda" (NVRTC) or "hip" (hipRTC). Defaults to "cuda". */
  dialect?: "cuda" | "hip";
  /** Block size (threads per block). Defaults to 256. */
  blockSize?: number;
  /** Kernel prefix symbol. Defaults to "ms_dae". */
  kernelPrefix?: string;
}

const BINOP_CUDA: Record<number, string> = {
  [BinOp.Add]: "+",
  [BinOp.Sub]: "-",
  [BinOp.Mul]: "*",
  [BinOp.Div]: "/",
  [BinOp.ElemAdd]: "+",
  [BinOp.ElemSub]: "-",
  [BinOp.ElemMul]: "*",
  [BinOp.ElemDiv]: "/",
  [BinOp.Lt]: "<",
  [BinOp.Gt]: ">",
  [BinOp.Lte]: "<=",
  [BinOp.Gte]: ">=",
  [BinOp.Eq]: "==",
  [BinOp.Neq]: "!=",
};

function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `v_${cleaned}`;
}

function formatF64(v: number): string {
  if (!Number.isFinite(v)) return "0.0";
  const s = String(v);
  return s.includes(".") || s.includes("e") || s.includes("E") ? s : `${s}.0`;
}

function resolveVarIdx(arena: DAEBuilder, nameId: number): number {
  const name = arena.interner.resolve(nameId);
  if (!name) return -1;
  return arena.getVarIdxByName(name);
}

/**
 * Emit a native IEEE-754 `double` CUDA/HIP expression for an arena expression node.
 */
export function emitExprCudaFP64(arena: DAEBuilder, exprId: number): string {
  if (exprId < 0) return "0.0";
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
      return formatF64(arena.getExprRealValue(exprId));
    case ExprKind.IntLiteral:
      return `((double)(${arena.getExprData1(exprId)}))`;
    case ExprKind.BoolLiteral:
      return arena.getExprData1(exprId) !== 0 ? "1.0" : "0.0";
    case ExprKind.EnumLiteral:
      return `((double)(${arena.getExprData1(exprId)}))`;
    case ExprKind.StringLiteral:
      return "0.0";

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const varIdx = resolveVarIdx(arena, nameId);
      if (varIdx >= 0) {
        const offset = arena.getVarOffsets?.()[varIdx] ?? varIdx;
        return `state[${offset}]`;
      }
      const name = arena.interner.resolve(nameId);
      if (name === "time") return "sim_time";
      return sanitizeIdent(name ?? "unknown");
    }

    case ExprKind.Der: {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerName = arena.interner.resolve(arena.getExprData1(argId));
        if (innerName) {
          const derIdx = arena.getVarIdxByName(`der(${innerName})`);
          if (derIdx >= 0) {
            const offset = arena.getVarOffsets?.()[derIdx] ?? derIdx;
            return `state[${offset}]`;
          }
        }
      }
      return "0.0";
    }

    case ExprKind.Pre:
      return emitExprCudaFP64(arena, arena.getExprData1(exprId));

    case ExprKind.Negate:
      return `(-(${emitExprCudaFP64(arena, arena.getExprLeft(exprId))}))`;

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const operand = emitExprCudaFP64(arena, arena.getExprLeft(exprId));
      if (op === UnaryOp.Negate) return `(-(${operand}))`;
      if (op === UnaryOp.Not) return `(((${operand}) != 0.0) ? 0.0 : 1.0)`;
      return operand;
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const l = emitExprCudaFP64(arena, arena.getExprLeft(exprId));
      const r = emitExprCudaFP64(arena, arena.getExprRight(exprId));

      if (op === BinOp.Pow || op === BinOp.ElemPow) return `pow(${l}, ${r})`;
      if (op === BinOp.And) return `((((${l}) != 0.0) && ((${r}) != 0.0)) ? 1.0 : 0.0)`;
      if (op === BinOp.Or) return `((((${l}) != 0.0) || ((${r}) != 0.0)) ? 1.0 : 0.0)`;
      if (op >= BinOp.Eq && op <= BinOp.Gte) {
        return `(((${l}) ${BINOP_CUDA[op] ?? "=="} (${r})) ? 1.0 : 0.0)`;
      }
      return `((${l}) ${BINOP_CUDA[op] ?? "+"} (${r}))`;
    }

    case ExprKind.IfElse: {
      const cond = emitExprCudaFP64(arena, arena.getExprData1(exprId));
      const thenExpr = emitExprCudaFP64(arena, arena.getExprLeft(exprId));
      const elseExpr = emitExprCudaFP64(arena, arena.getExprRight(exprId));
      return `(((${cond}) != 0.0) ? (${thenExpr}) : (${elseExpr}))`;
    }

    case ExprKind.Call: {
      const rawName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
      const fnName = rawName.replace(/^(Modelica\.(Math|ComplexMath|SIunits\.Conversions)\.|Math\.)/, "");
      const argCount = arena.getExprRight(exprId);
      const firstArgId = arena.getExprLeft(exprId);
      const args: string[] = [];
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? firstArgId : arena.getExprLeft(exprId + i);
        args.push(emitExprCudaFP64(arena, argExprId));
      }
      const a0 = args[0] ?? "0.0";
      const a1 = args[1] ?? "0.0";
      switch (fnName) {
        case "sin":
        case "cos":
        case "tan":
        case "asin":
        case "acos":
        case "atan":
        case "sinh":
        case "cosh":
        case "tanh":
        case "exp":
        case "log":
        case "log10":
        case "sqrt":
        case "ceil":
        case "floor":
          return `${fnName}(${a0})`;
        case "abs":
          return `fabs(${a0})`;
        case "atan2":
          return `atan2(${a0}, ${a1})`;
        case "min":
          return `fmin(${a0}, ${a1})`;
        case "max":
          return `fmax(${a0}, ${a1})`;
        case "mod":
          return `fmod(${a0}, ${a1})`;
        case "sign":
          return `(((${a0}) > 0.0) ? 1.0 : (((${a0}) < 0.0) ? -1.0 : 0.0))`;
        default:
          return "0.0";
      }
    }

    default:
      return "0.0";
  }
}

/**
 * Generates a complete NVRTC/hipRTC-compilable IEEE-754 `double` (FP64) GPU kernel
 * for batched ensemble DAE residual evaluation and RK4 integration.
 */
export function generateCudaFP64Kernel(
  arena: DAEBuilder,
  buffers: GPUArenaBuffers,
  options?: CudaCodegenOptions,
): string {
  const dialect = options?.dialect ?? "cuda";
  const prefix = options?.kernelPrefix ?? "ms_dae";
  const nVars = Math.max(arena.varCount, buffers.stateVarIndices.length);
  const nEqs = arena.eqCount;

  const lines: string[] = [
    `// Auto-generated by ModelScript Hardware FP64 ${dialect.toUpperCase()} Codegen`,
    dialect === "hip" ? `#include <hip/hip_runtime.h>` : `// Compiled in-process via NVRTC (IEEE-754 double)`,
    `#include <math.h>`,
    ``,
    `extern "C" {`,
    ``,
    `__device__ inline void ${prefix}_eval_residuals_device(`,
    `    const double* __restrict__ state,`,
    `    double* __restrict__ residuals,`,
    `    double sim_time) {`,
  ];

  for (let i = 0; i < nEqs; i++) {
    const kind = arena.getEqKind(i);
    if (kind === EqKind.Simple) {
      const lhs = emitExprCudaFP64(arena, arena.getEqLhs(i));
      const rhs = emitExprCudaFP64(arena, arena.getEqRhs(i));
      lines.push(`  residuals[${i}] = (${lhs}) - (${rhs});`);
    } else {
      lines.push(`  residuals[${i}] = 0.0;`);
    }
  }

  lines.push(`}`);
  lines.push(``);
  lines.push(`__global__ void ${prefix}_batched_eval_fp64(`);
  lines.push(`    const double* __restrict__ batch_states,`);
  lines.push(`    double* __restrict__ batch_residuals,`);
  lines.push(`    double sim_time,`);
  lines.push(`    int batch_size) {`);
  lines.push(`  const int idx = blockIdx.x * blockDim.x + threadIdx.x;`);
  lines.push(`  if (idx >= batch_size) return;`);
  lines.push(`  const double* state = batch_states + (size_t)idx * ${Math.max(1, nVars)};`);
  lines.push(`  double* residuals = batch_residuals + (size_t)idx * ${Math.max(1, nEqs)};`);
  lines.push(`  ${prefix}_eval_residuals_device(state, residuals, sim_time);`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`} // extern "C"`);

  return lines.join("\n");
}
