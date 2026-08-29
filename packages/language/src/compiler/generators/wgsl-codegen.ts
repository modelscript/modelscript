// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WGSL Compute Shader Codegen — Phase 1 of the WebGPU simulation backend.
 *
 * AOT-compiles the arena expression tree into specialized WGSL functions.
 * Each equation becomes a dedicated `residual_N()` function with zero branch
 * divergence, allowing the GPU compiler to optimize aggressively.
 */

import type { GPUArenaBuffers } from "../arena-gpu-buffers.js";
import { type ArenaDAEBuilder, BinOp, EqKind, ExprKind, UnaryOp } from "../dae-arena.js";

// ─────────────────────────────────────────────────────────────────────────────
// Operator Mappings
// ─────────────────────────────────────────────────────────────────────────────

const BINOP_WGSL: Record<number, string> = {
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

// ─────────────────────────────────────────────────────────────────────────────
// Expression Codegen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit a WGSL expression string for an arena expression node.
 * Recursively traverses the expression tree and produces inlined WGSL code.
 */
export function emitExprWGSL(arena: ArenaDAEBuilder, exprId: number): string {
  if (exprId < 0) return "vec2<f32>(0.0, 0.0)";
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral: {
      const v = arena.getExprRealValue(exprId);
      return `ds_from_f32(${formatF32(v)})`;
    }
    case ExprKind.IntLiteral:
      return `ds_from_f32(f32(${arena.getExprData1(exprId)}))`;

    case ExprKind.BoolLiteral:
      return arena.getExprData1(exprId) !== 0 ? "vec2<f32>(1.0, 0.0)" : "vec2<f32>(0.0, 0.0)";

    case ExprKind.EnumLiteral:
      return `ds_from_f32(f32(${arena.getExprData1(exprId)}))`;

    case ExprKind.StringLiteral:
      return "vec2<f32>(0.0, 0.0)"; // No numeric representation

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const varIdx = resolveVarIdx(arena, nameId);
      if (varIdx >= 0) return `state[${varIdx}u]`;
      // Unresolved name — could be loop variable or time
      const name = arena.interner.resolve(nameId);
      if (name === "time") return "sim_params.time";
      // Loop iterator or unknown — emit as named local
      return sanitizeName(name ?? "unknown");
    }

    case ExprKind.Der: {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerName = arena.interner.resolve(arena.getExprData1(argId));
        if (innerName) {
          const derIdx = arena.getVarIdxByName(`der(${innerName})`);
          if (derIdx >= 0) return `state[${derIdx}u]`;
        }
      }
      return "vec2<f32>(0.0, 0.0)";
    }

    case ExprKind.Pre:
      // pre(x) → current value (pre-values updated between steps)
      return emitExprWGSL(arena, arena.getExprData1(exprId));

    case ExprKind.Negate:
      return `ds_sub(vec2<f32>(0.0, 0.0), ${emitExprWGSL(arena, arena.getExprLeft(exprId))})`;

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const operand = emitExprWGSL(arena, arena.getExprLeft(exprId));
      if (op === UnaryOp.Negate) return `ds_sub(vec2<f32>(0.0, 0.0), ${operand})`;
      if (op === UnaryOp.Not) return `select(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0), ${operand}.x != 0.0)`;
      return operand;
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const l = emitExprWGSL(arena, arena.getExprLeft(exprId));
      const r = emitExprWGSL(arena, arena.getExprRight(exprId));

      // Power uses WGSL pow() - fallback to f32 for now
      if (op === BinOp.Pow || op === BinOp.ElemPow) return `ds_from_f32(pow(${l}.x, ${r}.x))`;
      // Logical ops use select()
      if (op === BinOp.And) return `select(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), ${l}.x != 0.0 && ${r}.x != 0.0)`;
      if (op === BinOp.Or) return `select(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), ${l}.x != 0.0 || ${r}.x != 0.0)`;
      // Comparison ops return f32 0/1 (well, vec2<f32>)
      if (op >= BinOp.Eq && op <= BinOp.Gte) {
        return `select(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), ${l}.x ${BINOP_WGSL[op] ?? "=="} ${r}.x)`;
      }
      // Arithmetic
      if (op === BinOp.Add || op === BinOp.ElemAdd) return `ds_add(${l}, ${r})`;
      if (op === BinOp.Sub || op === BinOp.ElemSub) return `ds_sub(${l}, ${r})`;
      if (op === BinOp.Mul || op === BinOp.ElemMul) return `ds_mul(${l}, ${r})`;
      if (op === BinOp.Div || op === BinOp.ElemDiv) return `ds_div(${l}, ${r})`;

      return `ds_add(${l}, ${r})`;
    }

    case ExprKind.IfElse: {
      const cond = emitExprWGSL(arena, arena.getExprData1(exprId));
      const then_ = emitExprWGSL(arena, arena.getExprLeft(exprId));
      const else_ = emitExprWGSL(arena, arena.getExprRight(exprId));
      return `select(${else_}, ${then_}, ${cond}.x != 0.0)`;
    }

    case ExprKind.Call:
      return emitCallWGSL(arena, exprId);

    case ExprKind.Subscript: {
      const baseId = arena.getExprData1(exprId);
      if (arena.getExprKind(baseId) === ExprKind.Name) {
        const baseName = arena.interner.resolve(arena.getExprData1(baseId));
        const idxCount = arena.getExprRight(exprId);
        if (idxCount === 1) {
          const idxExpr = emitExprWGSL(arena, arena.getExprLeft(exprId));
          // Static subscript: try to resolve at codegen time
          const idxNode = arena.getExprLeft(exprId);
          if (arena.getExprKind(idxNode) === ExprKind.IntLiteral) {
            const idx = arena.getExprData1(idxNode);
            const subIdx = arena.getVarIdxByName(`${baseName}[${idx}]`);
            if (subIdx >= 0) return `state[${subIdx}u]`;
          }
          // Dynamic subscript: use name_to_var lookup (fallback)
          return `/* dynamic subscript ${baseName}[${idxExpr}.x] */ vec2<f32>(0.0, 0.0)`;
        }
      }
      return "vec2<f32>(0.0, 0.0)";
    }

    default:
      return "vec2<f32>(0.0, 0.0)";
  }
}

function emitCallWGSL(arena: ArenaDAEBuilder, exprId: number): string {
  const funcName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
  const argCount = arena.getExprRight(exprId);
  const firstArgId = arena.getExprLeft(exprId);

  // Collect argument WGSL strings
  const args: string[] = [];
  for (let i = 0; i < argCount; i++) {
    const argExprId = i === 0 ? firstArgId : arena.getExprLeft(exprId + i);
    args.push(emitExprWGSL(arena, argExprId));
  }

  const z = "vec2<f32>(0.0, 0.0)";

  // Map Modelica built-ins to WGSL
  switch (funcName) {
    // Direct WGSL equivalents (fallback to f32 for transcendentals for now)
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
    case "sqrt":
    case "abs":
    case "sign":
    case "ceil":
    case "floor":
      return `ds_from_f32(${funcName}((${args[0] ?? z}).x))`;

    case "log10":
      return `ds_from_f32(log(${args[0] ?? z}.x) * 0.4342944819)`;

    case "atan2":
      return `ds_from_f32(atan2((${args[0] ?? z}).x, (${args[1] ?? z}).x))`;

    case "max":
      return args.length >= 2 ? `select(${args[1]}, ${args[0]}, (${args[0]}).x > (${args[1]}).x)` : (args[0] ?? z);
    case "min":
      return args.length >= 2 ? `select(${args[1]}, ${args[0]}, (${args[0]}).x < (${args[1]}).x)` : (args[0] ?? z);

    case "pow":
      return `ds_from_f32(pow((${args[0] ?? z}).x, (${args[1] ?? z}).x))`;

    case "mod":
      return `ds_from_f32((${args[0] ?? z}.x) - floor((${args[0] ?? z}.x) / (${args[1] ?? z}.x)) * (${args[1] ?? z}.x))`;
    case "rem":
      return `ds_from_f32((${args[0] ?? z}.x) - trunc((${args[0] ?? z}.x) / (${args[1] ?? z}.x)) * (${args[1] ?? z}.x))`;
    case "div":
      return `ds_from_f32(trunc((${args[0] ?? z}.x) / (${args[1] ?? z}.x)))`;

    case "integer":
      return `ds_from_f32(floor((${args[0] ?? z}.x)))`;
    case "round":
      return `ds_from_f32(round((${args[0] ?? z}.x)))`;

    // Pass-through
    case "noEvent":
    case "smooth":
    case "homotopy":
    case "/*Real*/":
    case "/*Integer*/":
    case "/*Boolean*/":
    case "Real":
    case "Integer":
    case "Boolean":
      return args[0] ?? z;

    // Event operators — return 0 in continuous simulation
    case "edge":
    case "change":
    case "sample":
    case "initial":
    case "terminal":
      return z;

    case "der":
      // der() as function call form
      if (argCount === 1 && arena.getExprKind(firstArgId) === ExprKind.Name) {
        const varName = arena.interner.resolve(arena.getExprData1(firstArgId));
        if (varName) {
          const derIdx = arena.getVarIdxByName(`der(${varName})`);
          if (derIdx >= 0) return `state[${derIdx}u]`;
        }
      }
      return z;

    case "pre":
      return args[0] ?? z;

    case "zeros":
      return z;
    case "ones":
      return "vec2<f32>(1.0, 0.0)";
    case "fill":
      return args[0] ?? z;

    default:
      // Unknown function — emit a comment and zero fallback
      return `/* ${funcName}(${args.join(", ")}) */ vec2<f32>(0.0, 0.0)`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Shader Generation
// ─────────────────────────────────────────────────────────────────────────────

/** Options for WGSL shader generation. */
export interface WGSLCodegenOptions {
  /** Workgroup size for block evaluation kernel (default: 64). */
  workgroupSize?: number;
  /** Whether to emit debug comments in the shader (default: false). */
  debugComments?: boolean;
}

/**
 * Generate a complete WGSL compute shader for evaluating the DAE system.
 *
 * The shader contains:
 * 1. Buffer bindings for state, block metadata, and residuals.
 * 2. One `residual_N()` function per simple equation.
 * 3. A dispatch kernel that evaluates all blocks in BLT order.
 *
 * @param arena - The flattened DAE arena.
 * @param gpuBuffers - Serialized GPU buffers (for block plan metadata).
 * @param options - Codegen options.
 * @returns Complete WGSL shader source code.
 */
export function generateWGSL(
  arena: ArenaDAEBuilder,
  gpuBuffers: GPUArenaBuffers,
  options?: WGSLCodegenOptions,
): string {
  const workgroupSize = options?.workgroupSize ?? 64;
  const debug = options?.debugComments ?? false;
  const plan = gpuBuffers.blockPlan;
  const lines: string[] = [];

  // ── Header ──
  lines.push("// Auto-generated WGSL compute shader for ModelScript DAE simulation");
  lines.push("// Do not edit — regenerated from ArenaDAEBuilder on each model change.");
  lines.push("");

  // ── DS (Double-Single) Arithmetic Library ──
  lines.push("fn ds_add(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {");
  lines.push("    let t1 = a.x + b.x;");
  lines.push("    let e = t1 - a.x;");
  lines.push("    let t2 = ((b.x - e) + (a.x - (t1 - e))) + a.y + b.y;");
  lines.push("    return vec2<f32>(t1 + t2, t2 - ((t1 + t2) - t1));");
  lines.push("}");
  lines.push("");
  lines.push("fn ds_sub(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {");
  lines.push("    return ds_add(a, vec2<f32>(-b.x, -b.y));");
  lines.push("}");
  lines.push("");
  lines.push("fn ds_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {");
  lines.push("    let p1 = a.x * b.x;");
  lines.push("    let p2 = fma(a.x, b.x, -p1);");
  lines.push("    let p3 = a.x * b.y + a.y * b.x;");
  lines.push("    let t = p2 + p3;");
  lines.push("    return vec2<f32>(p1 + t, t - ((p1 + t) - p1));");
  lines.push("}");
  lines.push("");
  lines.push("fn ds_div(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {");
  lines.push("    let q1 = a.x / b.x;");
  lines.push("    let rem = ds_sub(a, ds_mul(b, vec2<f32>(q1, 0.0)));");
  lines.push("    let q2 = rem.x / b.x;");
  lines.push("    return vec2<f32>(q1 + q2, q2 - ((q1 + q2) - q1));");
  lines.push("}");
  lines.push("");
  lines.push("fn ds_from_f32(a: f32) -> vec2<f32> {");
  lines.push("    return vec2<f32>(a, 0.0);");
  lines.push("}");
  lines.push("");

  // ── Buffer bindings ──
  lines.push("@group(0) @binding(0) var<storage, read_write> state: array<vec2<f32>>;");
  lines.push("@group(0) @binding(1) var<storage, read_write> residuals: array<vec2<f32>>;");
  lines.push("@group(0) @binding(2) var<uniform> sim_params: SimParams;");
  lines.push("@group(0) @binding(3) var<storage, read> state_var_indices: array<u32>;");
  lines.push("@group(0) @binding(4) var<storage, read> deriv_var_indices: array<u32>;");
  lines.push("@group(0) @binding(5) var<storage, read_write> y0: array<vec2<f32>>;");
  lines.push("@group(0) @binding(6) var<storage, read_write> y_acc: array<vec2<f32>>;");
  lines.push("");
  lines.push("struct SimParams {");
  lines.push("  time: vec2<f32>,");
  lines.push("  dt: vec2<f32>,");
  lines.push("  block_count: u32,");
  lines.push("  num_states: u32,");
  lines.push("  rk4_stage: u32,");
  lines.push("};");
  lines.push("");

  // ── Per-equation residual functions ──
  const emittedEqs = new Set<number>();

  for (let b = 0; b < plan.blockCount; b++) {
    const eqStart = plan.blockStarts[b] ?? 0;
    const eqEnd = plan.blockStarts[b + 1] ?? 0;
    const isLoop = (plan.blockFlags[b] ?? 0) !== 0;

    for (let e = eqStart; e < eqEnd; e++) {
      const eqIdx = plan.sortedEqs[e] ?? 0;
      if (emittedEqs.has(eqIdx)) continue;
      emittedEqs.add(eqIdx);

      const eqKind = arena.getEqKind(eqIdx);
      if (eqKind !== EqKind.Simple) continue;

      const lhsId = arena.getEqLhs(eqIdx);
      const rhsId = arena.getEqRhs(eqIdx);

      if (debug) {
        lines.push(`// Equation ${eqIdx} (block ${b}, ${isLoop ? "loop" : "scalar"})`);
      }

      const lhsCode = emitExprWGSL(arena, lhsId);
      const rhsCode = emitExprWGSL(arena, rhsId);

      lines.push(`fn residual_${eqIdx}(time: vec2<f32>) -> vec2<f32> {`);
      lines.push(`  return ds_sub(${lhsCode}, (${rhsCode}));`);
      lines.push("}");
      lines.push("");
    }
  }

  // ── Scalar block evaluator ──
  lines.push("fn evaluate_scalar_block(block_id: u32, time: vec2<f32>) {");
  lines.push("  switch block_id {");

  for (let b = 0; b < plan.blockCount; b++) {
    if ((plan.blockFlags[b] ?? 0) !== 0) continue; // Skip loops
    const eqStart = plan.blockStarts[b] ?? 0;
    const eqEnd = plan.blockStarts[b + 1] ?? 0;
    if (eqEnd - eqStart !== 1) continue;

    const eqIdx = plan.sortedEqs[eqStart] ?? 0;
    if (arena.getEqKind(eqIdx) !== EqKind.Simple) continue;

    const varStart = plan.blockVarStarts[b] ?? 0;
    const varIdx = plan.blockVars[varStart] ?? 0;

    const lhsId = arena.getEqLhs(eqIdx);
    const rhsId = arena.getEqRhs(eqIdx);

    let assignExpr: string;
    const lhsKind = arena.getExprKind(lhsId);
    const rhsKind = arena.getExprKind(rhsId);

    if (lhsKind === ExprKind.Name || lhsKind === ExprKind.Der) {
      assignExpr = emitExprWGSL(arena, rhsId);
    } else if (rhsKind === ExprKind.Name || rhsKind === ExprKind.Der) {
      assignExpr = emitExprWGSL(arena, lhsId);
    } else {
      assignExpr = `ds_sub(state[${varIdx}u], residual_${eqIdx}(time))`;
    }

    lines.push(`    case ${b}u { state[${varIdx}u] = ${assignExpr}; }`);
  }

  lines.push("    default { }");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  // ── Block residual evaluator (for algebraic loops) ──
  lines.push("fn evaluate_block_residual(eq_local: u32, block_id: u32, time: vec2<f32>) -> vec2<f32> {");
  lines.push("  switch block_id {");

  for (let b = 0; b < plan.blockCount; b++) {
    if ((plan.blockFlags[b] ?? 0) === 0) continue; // Skip scalar blocks
    const eqStart = plan.blockStarts[b] ?? 0;
    const eqEnd = plan.blockStarts[b + 1] ?? 0;

    lines.push(`    case ${b}u {`);
    lines.push("      switch eq_local {");
    for (let e = eqStart; e < eqEnd; e++) {
      const eqIdx = plan.sortedEqs[e] ?? 0;
      lines.push(`        case ${e - eqStart}u { return residual_${eqIdx}(time); }`);
    }
    lines.push("        default { return vec2<f32>(0.0, 0.0); }");
    lines.push("      }");
    lines.push("    }");
  }

  lines.push("    default { return vec2<f32>(0.0, 0.0); }");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  // ── Newton-Raphson solver for algebraic loops ──
  lines.push("fn evaluate_loop_block(block_id: u32, time: vec2<f32>) {");
  lines.push("  // Fetch loop metadata from uniform/storage if needed, or switch on block_id.");
  lines.push("}");
  lines.push("");

  // ── Main dispatch kernel ──
  lines.push(`@compute @workgroup_size(${workgroupSize})`);
  lines.push("fn evaluate_blocks(@builtin(global_invocation_id) gid: vec3<u32>) {");
  lines.push("  let block_id = gid.x;");
  lines.push("  if (block_id >= sim_params.block_count) { return; }");
  lines.push("  let time = sim_params.time;");
  lines.push("");
  lines.push("  evaluate_scalar_block(block_id, time);");
  lines.push("}");
  lines.push("");

  // ── ODE Integration kernels ──
  lines.push(`@compute @workgroup_size(${workgroupSize})`);
  lines.push("fn rk4_step(@builtin(global_invocation_id) gid: vec3<u32>) {");
  lines.push("  let idx = gid.x;");
  lines.push("  if (idx >= sim_params.num_states) { return; }");
  lines.push("  let state_idx = state_var_indices[idx];");
  lines.push("  let deriv_idx = deriv_var_indices[idx];");
  lines.push("  let k = state[deriv_idx];");
  lines.push("  let dt = sim_params.dt;");
  lines.push("  ");
  lines.push("  let dt_6 = ds_div(dt, ds_from_f32(6.0));");
  lines.push("  let dt_3 = ds_div(dt, ds_from_f32(3.0));");
  lines.push("  let dt_2 = ds_div(dt, ds_from_f32(2.0));");
  lines.push("  ");
  lines.push("  if (sim_params.rk4_stage == 0u) {");
  lines.push("    let y = state[state_idx];");
  lines.push("    y0[idx] = y;");
  lines.push("    y_acc[idx] = ds_add(y, ds_mul(dt_6, k));");
  lines.push("    state[state_idx] = ds_add(y, ds_mul(dt_2, k));");
  lines.push("  } else if (sim_params.rk4_stage == 1u) {");
  lines.push("    y_acc[idx] = ds_add(y_acc[idx], ds_mul(dt_3, k));");
  lines.push("    state[state_idx] = ds_add(y0[idx], ds_mul(dt_2, k));");
  lines.push("  } else if (sim_params.rk4_stage == 2u) {");
  lines.push("    y_acc[idx] = ds_add(y_acc[idx], ds_mul(dt_3, k));");
  lines.push("    state[state_idx] = ds_add(y0[idx], ds_mul(dt, k));");
  lines.push("  } else if (sim_params.rk4_stage == 3u) {");
  lines.push("    state[state_idx] = ds_add(y_acc[idx], ds_mul(dt_6, k));");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format a number as a WGSL f32 literal. */
function formatF32(v: number): string {
  if (v === 0) return "0.0";
  if (!Number.isFinite(v)) return "0.0";
  if (Number.isInteger(v) && Math.abs(v) < 1e7) return v.toFixed(1);
  return v.toString();
}

/** Resolve a StringId to a varIdx via the arena's name index. */
function resolveVarIdx(arena: ArenaDAEBuilder, nameId: number): number {
  const name = arena.interner.resolve(nameId);
  if (!name) return -1;
  return arena.getVarIdxByName(name);
}

/** Sanitize a Modelica name for use as a WGSL identifier. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
