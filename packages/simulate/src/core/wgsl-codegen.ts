// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WGSL Compute Shader Codegen — Phase 1 of the WebGPU simulation backend.
 *
 * AOT-compiles the arena expression tree into specialized WGSL functions.
 * Each equation becomes a dedicated `residual_N()` function with zero branch
 * divergence, allowing the GPU compiler to optimize aggressively.
 */

import { type DAEBuilder, BinOp, EqKind, ExprKind, UnaryOp } from "@modelscript/runtime/wasm_dae.js";
import type { GPUArenaBuffers, GPUBlockPlan } from "./gpu-buffers.js";

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
export function emitExprWGSL(arena: DAEBuilder, exprId: number): string {
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
      if (varIdx >= 0) {
        const offset = arena.getVarOffsets?.()[varIdx] ?? varIdx;
        return `state[${offset}u]`;
      }
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
          if (derIdx >= 0) {
            const offset = arena.getVarOffsets?.()[derIdx] ?? derIdx;
            return `state[${offset}u]`;
          }
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
        const varOffsets = arena.getVarOffsets?.();
        if (idxCount === 1 && baseName) {
          const idxNode = arena.getExprLeft(exprId);
          // 1. Static integer literal subscript
          if (arena.getExprKind(idxNode) === ExprKind.IntLiteral) {
            const idx = arena.getExprData1(idxNode);
            const subIdx = arena.getVarIdxByName(`${baseName}[${idx}]`);
            if (subIdx >= 0) {
              const offset = varOffsets?.[subIdx] ?? subIdx;
              return `state[${offset}u]`;
            }
          }

          const idxExpr = emitExprWGSL(arena, idxNode);

          // 2. Tensor variable with contiguous scalar elements
          const baseVarIdx = arena.getVarIdxByName(baseName);
          if (baseVarIdx >= 0) {
            const elemCount = arena.getVarShapeElementCount?.(baseVarIdx) ?? 1;
            const baseOffset = varOffsets?.[baseVarIdx] ?? baseVarIdx;
            if (elemCount > 1) {
              return `state[${baseOffset}u + clamp(u32(max(0.0, round((${idxExpr}).x) - 1.0)), 0u, ${elemCount - 1}u)]`;
            }
          }

          // 3. Dynamic subscript over scalarized array elements (baseName[1], baseName[2], ...)
          const elementOffsets: { index: number; offset: number }[] = [];
          for (let k = 1; k <= 256; k++) {
            const subVarIdx = arena.getVarIdxByName(`${baseName}[${k}]`);
            if (subVarIdx < 0) {
              if (k > 1) break;
              continue;
            }
            const off = varOffsets?.[subVarIdx] ?? subVarIdx;
            elementOffsets.push({ index: k, offset: off });
          }

          if (elementOffsets.length > 0) {
            let selectChain = `state[${elementOffsets[0]!.offset}u]`;
            for (let k = 1; k < elementOffsets.length; k++) {
              const entry = elementOffsets[k]!;
              selectChain = `select(${selectChain}, state[${entry.offset}u], i32(round((${idxExpr}).x)) == ${entry.index})`;
            }
            return selectChain;
          }

          if (baseVarIdx >= 0) {
            const baseOffset = varOffsets?.[baseVarIdx] ?? baseVarIdx;
            return `state[${baseOffset}u]`;
          }
        } else if (idxCount > 1 && baseName) {
          // Multi-dimensional subscript
          const firstIdxNode = arena.getExprLeft(exprId);
          const indices: number[] = [];
          let allStatic = true;
          for (let d = 0; d < idxCount; d++) {
            const node = d === 0 ? firstIdxNode : arena.getExprLeft(exprId + d);
            if (arena.getExprKind(node) === ExprKind.IntLiteral) {
              indices.push(arena.getExprData1(node));
            } else {
              allStatic = false;
              break;
            }
          }
          if (allStatic) {
            const commaName = `${baseName}[${indices.join(",")}]`;
            const bracketName = `${baseName}${indices.map((i) => `[${i}]`).join("")}`;
            const subIdx =
              arena.getVarIdxByName(commaName) >= 0
                ? arena.getVarIdxByName(commaName)
                : arena.getVarIdxByName(bracketName);
            if (subIdx >= 0) {
              const offset = varOffsets?.[subIdx] ?? subIdx;
              return `state[${offset}u]`;
            }
          }
        }
      }
      return "vec2<f32>(0.0, 0.0)";
    }

    default:
      return "vec2<f32>(0.0, 0.0)";
  }
}

function emitCallWGSL(arena: DAEBuilder, exprId: number): string {
  const rawFuncName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
  const funcName = rawFuncName.replace(/^(Modelica\.(Math|ComplexMath|SIunits\.Conversions)\.|Math\.)/, "");
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
    // Direct WGSL equivalents
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
    case "ceil":
    case "floor":
      return `ds_from_f32(${funcName}((${args[0] ?? z}).x))`;

    case "sign": {
      const a0 = args[0] ?? z;
      return `select(select(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), (${a0}).x > 0.0), vec2<f32>(-1.0, 0.0), (${a0}).x < 0.0)`;
    }

    case "log10":
      return `ds_from_f32(log((${args[0] ?? z}).x) * 0.4342944819)`;

    case "atan2":
      return `ds_from_f32(atan2((${args[0] ?? z}).x, (${args[1] ?? z}).x))`;

    case "max":
      return args.length >= 2 ? `select(${args[1]}, ${args[0]}, (${args[0]}).x > (${args[1]}).x)` : (args[0] ?? z);
    case "min":
      return args.length >= 2 ? `select(${args[1]}, ${args[0]}, (${args[0]}).x < (${args[1]}).x)` : (args[0] ?? z);

    case "pow":
      return `ds_from_f32(pow((${args[0] ?? z}).x, (${args[1] ?? z}).x))`;

    case "mod": {
      const x = args[0] ?? z;
      const y = args[1] ?? "vec2<f32>(1.0, 0.0)";
      return `ds_sub(${x}, ds_mul(ds_from_f32(floor((${x}).x / (${y}).x)), ${y}))`;
    }
    case "rem": {
      const x = args[0] ?? z;
      const y = args[1] ?? "vec2<f32>(1.0, 0.0)";
      return `ds_sub(${x}, ds_mul(ds_from_f32(trunc((${x}).x / (${y}).x)), ${y}))`;
    }
    case "div":
      return `ds_from_f32(trunc((${args[0] ?? z}).x / (${args[1] ?? "vec2<f32>(1.0, 0.0)"}).x))`;

    case "integer":
      return `ds_from_f32(floor((${args[0] ?? z}).x))`;
    case "round":
      return `ds_from_f32(round((${args[0] ?? z}).x))`;

    // smooth(p, expr) -> second argument is the expression
    case "smooth":
      return (args.length > 1 ? args[1] : args[0]) ?? z;

    // semiLinear(x, k_pos, k_neg) -> x >= 0 ? k_pos * x : k_neg * x
    case "semiLinear": {
      const x = args[0] ?? z;
      const kPos = args[1] ?? z;
      const kNeg = args[2] ?? z;
      return `select(ds_mul(${kNeg}, ${x}), ds_mul(${kPos}, ${x}), (${x}).x >= 0.0)`;
    }

    // homotopy(actual, simplified) -> actual expression
    case "homotopy":
    case "noEvent":
    case "delay":
    case "/*Real*/":
    case "/*Integer*/":
    case "/*Boolean*/":
    case "Real":
    case "Integer":
    case "Boolean":
      return args[0] ?? z;

    // Event & simulation phase operators
    case "initial": {
      const t0 = formatF32(arena.experiment?.startTime ?? 0.0);
      return `select(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), abs(sim_params.time.x - ${t0}) <= 1e-6)`;
    }
    case "terminal": {
      const tEnd = formatF32(arena.experiment?.stopTime ?? 1.0);
      return `select(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), sim_params.time.x >= ${tEnd} - 1e-6)`;
    }
    case "sample": {
      if (args.length >= 2) {
        const start = args[0]!;
        const interval = args[1]!;
        return `select(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), sim_params.time.x >= (${start}).x && abs(fract((sim_params.time.x - (${start}).x) / max((${interval}).x, 1e-9))) <= 1e-5)`;
      }
      return z;
    }
    case "edge":
    case "change":
      return `select(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), (${args[0] ?? z}).x != 0.0 && abs(sim_params.time.x) <= 1e-6)`;

    case "der":
      // der() as function call form
      if (argCount === 1 && arena.getExprKind(firstArgId) === ExprKind.Name) {
        const varName = arena.interner.resolve(arena.getExprData1(firstArgId));
        if (varName) {
          const derIdx = arena.getVarIdxByName(`der(${varName})`);
          if (derIdx >= 0) {
            const offset = arena.getVarOffsets?.()[derIdx] ?? derIdx;
            return `state[${offset}u]`;
          }
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
      return args[0] ?? z;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wavefront Dependency Analysis for Parallel Block Execution
// ─────────────────────────────────────────────────────────────────────────────

function collectExprReadVars(arena: DAEBuilder, exprId: number, out: Set<number>): void {
  if (exprId < 0) return;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const varIdx = resolveVarIdx(arena, arena.getExprData1(exprId));
      if (varIdx >= 0) out.add(varIdx);
      return;
    }
    case ExprKind.Der: {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerName = arena.interner.resolve(arena.getExprData1(argId));
        if (innerName) {
          const derIdx = arena.getVarIdxByName(`der(${innerName})`);
          if (derIdx >= 0) out.add(derIdx);
        }
      }
      return;
    }
    case ExprKind.Pre:
      collectExprReadVars(arena, arena.getExprData1(exprId), out);
      return;
    case ExprKind.Negate:
    case ExprKind.Unary:
      collectExprReadVars(arena, arena.getExprLeft(exprId), out);
      return;
    case ExprKind.Binary:
      collectExprReadVars(arena, arena.getExprLeft(exprId), out);
      collectExprReadVars(arena, arena.getExprRight(exprId), out);
      return;
    case ExprKind.IfElse:
      collectExprReadVars(arena, arena.getExprData1(exprId), out);
      collectExprReadVars(arena, arena.getExprLeft(exprId), out);
      collectExprReadVars(arena, arena.getExprRight(exprId), out);
      return;
    case ExprKind.Call: {
      const argCount = arena.getExprRight(exprId);
      const firstArgId = arena.getExprLeft(exprId);
      for (let i = 0; i < argCount; i++) {
        collectExprReadVars(arena, i === 0 ? firstArgId : arena.getExprLeft(exprId + i), out);
      }
      return;
    }
    case ExprKind.Subscript: {
      const baseId = arena.getExprData1(exprId);
      collectExprReadVars(arena, baseId, out);
      collectExprReadVars(arena, arena.getExprLeft(exprId), out);
      return;
    }
    default:
      return;
  }
}

function computeBlockWavefrontLevels(arena: DAEBuilder, plan: GPUBlockPlan): number[][] {
  const blockCount = plan.blockCount;
  if (blockCount === 0) return [];

  const writerBlockByVar = new Map<number, number>();
  const blockLevels = new Int32Array(blockCount);

  for (let b = 0; b < blockCount; b++) {
    const varStart = plan.blockVarStarts[b] ?? 0;
    const varEnd = plan.blockVarStarts[b + 1] ?? 0;
    const writtenVars = new Set<number>();
    for (let v = varStart; v < varEnd; v++) {
      writtenVars.add(plan.blockVars[v] ?? 0);
    }

    const eqStart = plan.blockStarts[b] ?? 0;
    const eqEnd = plan.blockStarts[b + 1] ?? 0;
    const readVars = new Set<number>();
    for (let e = eqStart; e < eqEnd; e++) {
      const eqIdx = plan.sortedEqs[e] ?? 0;
      if (arena.getEqKind(eqIdx) === EqKind.Simple) {
        collectExprReadVars(arena, arena.getEqLhs(eqIdx), readVars);
        collectExprReadVars(arena, arena.getEqRhs(eqIdx), readVars);
      }
    }

    let level = 0;
    for (const rv of readVars) {
      if (writtenVars.has(rv)) continue;
      const depBlock = writerBlockByVar.get(rv);
      if (depBlock !== undefined && depBlock < b) {
        const candidate = (blockLevels[depBlock] ?? 0) + 1;
        if (candidate > level) level = candidate;
      }
    }

    blockLevels[b] = level;
    for (const wv of writtenVars) {
      writerBlockByVar.set(wv, b);
    }
  }

  const levels: number[][] = [];
  for (let b = 0; b < blockCount; b++) {
    const lvl = blockLevels[b] ?? 0;
    while (levels.length <= lvl) levels.push([]);
    levels[lvl]!.push(b);
  }
  return levels;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Shader Generation
// ─────────────────────────────────────────────────────────────────────────────

/** Options for WGSL shader generation. */
export interface WGSLCodegenOptions {
  /** Workgroup size for block evaluation kernel (default: 64). */
  workgroupSize?: number | undefined;
  /** Whether to emit debug comments in the shader (default: false). */
  debugComments?: boolean | undefined;
}

/**
 * Generate a complete WGSL compute shader for evaluating the DAE system.
 *
 * The shader contains:
 * 1. Buffer bindings for state, block metadata, and residuals.
 * 2. One `residual_N()` function per simple equation.
 * 3. A dispatch kernel that evaluates blocks in parallel wavefront levels.
 *
 * @param arena - The flattened DAE arena.
 * @param gpuBuffers - Serialized GPU buffers (for block plan metadata).
 * @param options - Codegen options.
 * @returns Complete WGSL shader source code.
 */
export function generateWGSL(arena: DAEBuilder, gpuBuffers: GPUArenaBuffers, options?: WGSLCodegenOptions): string {
  const workgroupSize = options?.workgroupSize ?? 64;
  const debug = options?.debugComments ?? false;
  const plan = gpuBuffers.blockPlan;
  const lines: string[] = [];

  // ── Header ──
  lines.push("// Auto-generated WGSL compute shader for ModelScript DAE simulation");
  lines.push("// Do not edit — regenerated from DAEBuilder on each model change.");
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
  lines.push("@group(0) @binding(7) var<storage, read_write> stage_scratch: array<vec2<f32>>;");
  lines.push("");
  lines.push("struct SimParams {");
  lines.push("  time: vec2<f32>,");
  lines.push("  dt: vec2<f32>,");
  lines.push("  block_count: u32,");
  lines.push("  num_states: u32,");
  lines.push("  rk4_stage: u32,");
  lines.push("  solver_type: u32,");
  lines.push("  sub_stage: u32,");
  lines.push("  pad: u32,");
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
    const varOffsets = arena.getVarOffsets?.() ?? new Int32Array(arena.varCount);
    const offset = varOffsets[varIdx] ?? varIdx;
    const elemCount = arena.getVarShapeElementCount?.(varIdx) ?? 1;

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
      assignExpr = `ds_sub(state[${offset}u], residual_${eqIdx}(time))`;
    }

    if (elemCount <= 1) {
      lines.push(`    case ${b}u { state[${offset}u] = ${assignExpr}; }`);
    } else {
      lines.push(`    case ${b}u {`);
      lines.push(`      for (var k = 0u; k < ${elemCount}u; k = k + 1u) {`);
      lines.push(`        state[${offset}u + k] = ${assignExpr};`);
      lines.push(`      }`);
      lines.push(`    }`);
    }
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

  // ── Newton-Raphson solver for algebraic loops (coupled dense Jacobian + Gaussian elimination) ──
  lines.push("fn evaluate_loop_block(block_id: u32, time: vec2<f32>) {");
  lines.push("  switch block_id {");

  for (let b = 0; b < plan.blockCount; b++) {
    if ((plan.blockFlags[b] ?? 0) === 0) continue; // Skip scalar blocks
    const eqStart = plan.blockStarts[b] ?? 0;
    const eqEnd = plan.blockStarts[b + 1] ?? 0;
    const m = eqEnd - eqStart;
    if (m <= 0) continue;
    const varStart = plan.blockVarStarts[b] ?? 0;
    const varOffsets = arena.getVarOffsets?.() ?? new Int32Array(arena.varCount);

    lines.push(`    case ${b}u {`);
    if (m >= 2 && m <= 8) {
      // Coupled m x m Newton-Raphson with dense finite-difference Jacobian and partial-pivoting Gaussian elimination
      const offsetLiterals: string[] = [];
      for (let k = 0; k < m; k++) {
        const varIdx = plan.blockVars[varStart + k] ?? 0;
        const offset = varOffsets[varIdx] ?? varIdx;
        offsetLiterals.push(`${offset}u`);
      }
      lines.push(`      let var_offsets = array<u32, ${m}>(${offsetLiterals.join(", ")});`);
      lines.push("      for (var iter = 0u; iter < 16u; iter = iter + 1u) {");
      lines.push(`        var r0: array<f32, ${m}>;`);
      lines.push(`        var rhs: array<f32, ${m}>;`);
      lines.push("        var max_r: f32 = 0.0;");
      lines.push(`        for (var i = 0u; i < ${m}u; i = i + 1u) {`);
      lines.push(`          let res_i = evaluate_block_residual(i, ${b}u, time);`);
      lines.push("          let rv = res_i.x + res_i.y;");
      lines.push("          r0[i] = rv;");
      lines.push("          rhs[i] = -rv;");
      lines.push("          let ar = abs(rv);");
      lines.push("          if (ar > max_r) { max_r = ar; }");
      lines.push("        }");
      lines.push("        if (max_r < 1e-6) { break; }");
      lines.push(`        var J: array<f32, ${m * m}>;`);
      lines.push(`        for (var j = 0u; j < ${m}u; j = j + 1u) {`);
      lines.push("          let v_off = var_offsets[j];");
      lines.push("          let x0 = state[v_off];");
      lines.push("          let step_h = max(1e-5, abs(x0.x) * 1e-5);");
      lines.push("          state[v_off] = ds_add(x0, ds_from_f32(step_h));");
      lines.push(`          for (var i = 0u; i < ${m}u; i = i + 1u) {`);
      lines.push(`            let r_pert = evaluate_block_residual(i, ${b}u, time);`);
      lines.push("            let rv_pert = r_pert.x + r_pert.y;");
      lines.push(`            J[i * ${m}u + j] = (rv_pert - r0[i]) / step_h;`);
      lines.push("          }");
      lines.push("          state[v_off] = x0;");
      lines.push("        }");
      // Gaussian elimination with partial pivoting
      lines.push(`        for (var k = 0u; k < ${m}u; k = k + 1u) {`);
      lines.push("          var piv = k;");
      lines.push(`          var max_piv = abs(J[k * ${m}u + k]);`);
      lines.push(`          for (var i = k + 1u; i < ${m}u; i = i + 1u) {`);
      lines.push(`            let a = abs(J[i * ${m}u + k]);`);
      lines.push("            if (a > max_piv) { max_piv = a; piv = i; }");
      lines.push("          }");
      lines.push("          if (piv != k) {");
      lines.push(`            for (var j = k; j < ${m}u; j = j + 1u) {`);
      lines.push(`              let tmp = J[k * ${m}u + j];`);
      lines.push(`              J[k * ${m}u + j] = J[piv * ${m}u + j];`);
      lines.push(`              J[piv * ${m}u + j] = tmp;`);
      lines.push("            }");
      lines.push("            let tmp_r = rhs[k];");
      lines.push("            rhs[k] = rhs[piv];");
      lines.push("            rhs[piv] = tmp_r;");
      lines.push("          }");
      lines.push(`          let diag = J[k * ${m}u + k];`);
      lines.push("          if (abs(diag) > 1e-12) {");
      lines.push(`            for (var i = k + 1u; i < ${m}u; i = i + 1u) {`);
      lines.push(`              let factor = J[i * ${m}u + k] / diag;`);
      lines.push(`              J[i * ${m}u + k] = 0.0;`);
      lines.push(`              for (var j = k + 1u; j < ${m}u; j = j + 1u) {`);
      lines.push(`                J[i * ${m}u + j] = J[i * ${m}u + j] - factor * J[k * ${m}u + j];`);
      lines.push("              }");
      lines.push("              rhs[i] = rhs[i] - factor * rhs[k];");
      lines.push("            }");
      lines.push("          }");
      lines.push("        }");
      // Back-substitution
      lines.push(`        var dx: array<f32, ${m}>;`);
      lines.push(`        for (var ii = 0u; ii < ${m}u; ii = ii + 1u) {`);
      lines.push(`          let i = ${m - 1}u - ii;`);
      lines.push("          var sum = rhs[i];");
      lines.push(`          for (var j = i + 1u; j < ${m}u; j = j + 1u) {`);
      lines.push(`            sum = sum - J[i * ${m}u + j] * dx[j];`);
      lines.push("          }");
      lines.push(`          let diag = J[i * ${m}u + i];`);
      lines.push("          if (abs(diag) > 1e-12) { dx[i] = sum / diag; } else { dx[i] = 0.0; }");
      lines.push("        }");
      lines.push(`        for (var j = 0u; j < ${m}u; j = j + 1u) {`);
      lines.push("          let v_off = var_offsets[j];");
      lines.push("          state[v_off] = ds_add(state[v_off], ds_from_f32(dx[j]));");
      lines.push("        }");
      lines.push("      }");
    } else {
      lines.push("      let eps = vec2<f32>(1e-5, 0.0);");
      lines.push("      for (var iter = 0u; iter < 16u; iter = iter + 1u) {");
      lines.push("        var max_r: f32 = 0.0;");
      for (let k = 0; k < m; k++) {
        const varIdx = plan.blockVars[varStart + k] ?? 0;
        const offset = varOffsets[varIdx] ?? varIdx;
        lines.push(`        {`);
        lines.push(`          let r0 = evaluate_block_residual(${k}u, ${b}u, time);`);
        lines.push(`          let ar = abs(r0.x);`);
        lines.push(`          if (ar > max_r) { max_r = ar; }`);
        lines.push(`          let x0 = state[${offset}u];`);
        lines.push(`          state[${offset}u] = ds_add(x0, eps);`);
        lines.push(`          let r1 = evaluate_block_residual(${k}u, ${b}u, time);`);
        lines.push(`          let df = ds_div(ds_sub(r1, r0), eps);`);
        lines.push(`          if (abs(df.x) > 1e-12) {`);
        lines.push(`            state[${offset}u] = ds_sub(x0, ds_div(r0, df));`);
        lines.push(`          } else {`);
        lines.push(`            state[${offset}u] = x0;`);
        lines.push(`          }`);
        lines.push(`        }`);
      }
      lines.push("        if (max_r < 1e-6) { break; }");
      lines.push("      }");
    }
    lines.push("    }");
  }

  lines.push("    default { }");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  // ── Main dispatch kernel (executes independent BLT blocks in parallel across threads per wavefront level) ──
  const wavefrontLevels = computeBlockWavefrontLevels(arena, plan);
  lines.push(`@compute @workgroup_size(${workgroupSize})`);
  lines.push(
    "fn evaluate_blocks(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {",
  );
  lines.push("  if (wid.x != 0u) { return; }");
  lines.push("  let tid = lid.x;");
  lines.push("  let time = sim_params.time;");
  lines.push("");
  if (wavefrontLevels.length === 0) {
    lines.push("  if (tid == 0u) {");
    lines.push("    for (var block_id = 0u; block_id < sim_params.block_count; block_id = block_id + 1u) {");
    lines.push("      evaluate_scalar_block(block_id, time);");
    lines.push("      evaluate_loop_block(block_id, time);");
    lines.push("    }");
    lines.push("  }");
  } else {
    for (let lvl = 0; lvl < wavefrontLevels.length; lvl++) {
      const blocksInLevel = wavefrontLevels[lvl]!;
      if (blocksInLevel.length === 1) {
        const b = blocksInLevel[0]!;
        lines.push(`  if (tid == 0u && ${b}u < sim_params.block_count) {`);
        lines.push(`    evaluate_scalar_block(${b}u, time);`);
        lines.push(`    evaluate_loop_block(${b}u, time);`);
        lines.push("  }");
      } else {
        const kL = blocksInLevel.length;
        const arrLit = blocksInLevel.map((b) => `${b}u`).join(", ");
        lines.push(`  {`);
        lines.push(`    let lvl_blocks = array<u32, ${kL}>(${arrLit});`);
        lines.push(`    for (var idx = tid; idx < ${kL}u; idx = idx + ${workgroupSize}u) {`);
        lines.push("      let b = lvl_blocks[idx];");
        lines.push("      if (b < sim_params.block_count) {");
        lines.push("        evaluate_scalar_block(b, time);");
        lines.push("        evaluate_loop_block(b, time);");
        lines.push("      }");
        lines.push("    }");
        lines.push("  }");
      }
      if (lvl < wavefrontLevels.length - 1) {
        lines.push("  storageBarrier();");
      }
    }
  }
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

  // ── Tsit5 7-stage adaptive ODE integration kernel ──
  lines.push(`@compute @workgroup_size(${workgroupSize})`);
  lines.push("fn tsit5_step(@builtin(global_invocation_id) gid: vec3<u32>) {");
  lines.push("  let idx = gid.x;");
  lines.push("  if (idx >= sim_params.num_states) { return; }");
  lines.push("  let state_idx = state_var_indices[idx];");
  lines.push("  let deriv_idx = deriv_var_indices[idx];");
  lines.push("  let k = state[deriv_idx];");
  lines.push("  let dt = sim_params.dt;");
  lines.push("  let N = sim_params.num_states;");
  lines.push("  let stage = sim_params.sub_stage;");
  lines.push("");
  lines.push("  // Store current stage derivative");
  lines.push("  stage_scratch[stage * N + idx] = k;");
  lines.push("");
  lines.push("  if (stage == 0u) {");
  lines.push("    let y = state[state_idx];");
  lines.push("    y0[idx] = y;");
  lines.push("    let a21 = ds_from_f32(0.161);");
  lines.push("    state[state_idx] = ds_add(y, ds_mul(dt, ds_mul(a21, k)));");
  lines.push("  } else if (stage == 1u) {");
  lines.push("    let k0 = stage_scratch[0u * N + idx];");
  lines.push("    let a31 = ds_from_f32(-0.008480655492356989);");
  lines.push("    let a32 = ds_from_f32(0.335480655492357);");
  lines.push("    let sum = ds_add(ds_mul(a31, k0), ds_mul(a32, k));");
  lines.push("    state[state_idx] = ds_add(y0[idx], ds_mul(dt, sum));");
  lines.push("  } else if (stage == 2u) {");
  lines.push("    let k0 = stage_scratch[0u * N + idx];");
  lines.push("    let k1 = stage_scratch[1u * N + idx];");
  lines.push("    let a41 = ds_from_f32(2.897153052710749);");
  lines.push("    let a42 = ds_from_f32(-6.888838239993134);");
  lines.push("    let a43 = ds_from_f32(4.891685187282385);");
  lines.push("    let sum = ds_add(ds_mul(a41, k0), ds_add(ds_mul(a42, k1), ds_mul(a43, k)));");
  lines.push("    state[state_idx] = ds_add(y0[idx], ds_mul(dt, sum));");
  lines.push("  } else if (stage == 3u) {");
  lines.push("    let k0 = stage_scratch[0u * N + idx];");
  lines.push("    let k1 = stage_scratch[1u * N + idx];");
  lines.push("    let k2 = stage_scratch[2u * N + idx];");
  lines.push("    let a51 = ds_from_f32(1.023998522497125);");
  lines.push("    let a52 = ds_from_f32(-2.223202490331607);");
  lines.push("    let a53 = ds_from_f32(1.6499129963539006);");
  lines.push("    let a54 = ds_from_f32(0.5292910714805814);");
  lines.push(
    "    let sum = ds_add(ds_add(ds_mul(a51, k0), ds_mul(a52, k1)), ds_add(ds_mul(a53, k2), ds_mul(a54, k)));",
  );
  lines.push("    state[state_idx] = ds_add(y0[idx], ds_mul(dt, sum));");
  lines.push("  } else if (stage == 4u) {");
  lines.push("    let k0 = stage_scratch[0u * N + idx];");
  lines.push("    let k1 = stage_scratch[1u * N + idx];");
  lines.push("    let k2 = stage_scratch[2u * N + idx];");
  lines.push("    let k3 = stage_scratch[3u * N + idx];");
  lines.push("    let a61 = ds_from_f32(0.3412240537877472);");
  lines.push("    let a62 = ds_from_f32(-0.6204905971302865);");
  lines.push("    let a63 = ds_from_f32(0.4398418855424759);");
  lines.push("    let a64 = ds_from_f32(0.6762436790995681);");
  lines.push("    let a65 = ds_from_f32(0.1631810787004953);");
  lines.push(
    "    let sum = ds_add(ds_add(ds_mul(a61, k0), ds_mul(a62, k1)), ds_add(ds_mul(a63, k2), ds_add(ds_mul(a64, k3), ds_mul(a65, k))));",
  );
  lines.push("    state[state_idx] = ds_add(y0[idx], ds_mul(dt, sum));");
  lines.push("  } else if (stage == 5u) {");
  lines.push("    let k0 = stage_scratch[0u * N + idx];");
  lines.push("    let k1 = stage_scratch[1u * N + idx];");
  lines.push("    let k2 = stage_scratch[2u * N + idx];");
  lines.push("    let k3 = stage_scratch[3u * N + idx];");
  lines.push("    let k4 = stage_scratch[4u * N + idx];");
  lines.push("    let b0 = ds_from_f32(0.0964607668120738);");
  lines.push("    let b1 = ds_from_f32(0.01);");
  lines.push("    let b2 = ds_from_f32(0.4798896504144996);");
  lines.push("    let b3 = ds_from_f32(1.379008574103742);");
  lines.push("    let b4 = ds_from_f32(-3.290069515436081);");
  lines.push("    let b5 = ds_from_f32(2.3247105241057654);");
  lines.push(
    "    let sum = ds_add(ds_add(ds_mul(b0, k0), ds_mul(b1, k1)), ds_add(ds_mul(b2, k2), ds_add(ds_mul(b3, k3)), ds_add(ds_mul(b4, k4), ds_mul(b5, k)))));",
  );
  lines.push("    state[state_idx] = ds_add(y0[idx], ds_mul(dt, sum));");
  lines.push("  } else if (stage == 6u) {");
  lines.push("    let k0 = stage_scratch[0u * N + idx];");
  lines.push("    let k1 = stage_scratch[1u * N + idx];");
  lines.push("    let k2 = stage_scratch[2u * N + idx];");
  lines.push("    let k3 = stage_scratch[3u * N + idx];");
  lines.push("    let k4 = stage_scratch[4u * N + idx];");
  lines.push("    let k5 = stage_scratch[5u * N + idx];");
  lines.push("    let d0 = ds_from_f32(0.0946807557598478);");
  lines.push("    let d1 = ds_from_f32(0.009185641321671);");
  lines.push("    let d2 = ds_from_f32(-0.5064721843617644);");
  lines.push("    let d3 = ds_from_f32(1.643191441986318);");
  lines.push("    let d4 = ds_from_f32(-3.6976777292287);");
  lines.push("    let d5 = ds_from_f32(2.5118683373499944);");
  lines.push("    let d6 = ds_from_f32(-0.054776262827407);");
  lines.push(
    "    let err_sum = ds_add(ds_add(ds_mul(d0, k0), ds_mul(d1, k1)), ds_add(ds_mul(d2, k2), ds_add(ds_mul(d3, k3)), ds_add(ds_mul(d4, k4), ds_add(ds_mul(d5, k5), ds_mul(d6, k))))));",
  );
  lines.push("    stage_scratch[7u * N + idx] = ds_mul(dt, err_sum);");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  // ── TR-BDF2 stiff ODE/DAE integration kernel with implicit Newton-secant / fixed-point correctors ──
  lines.push(`@compute @workgroup_size(${workgroupSize})`);
  lines.push("fn trbdf2_step(@builtin(global_invocation_id) gid: vec3<u32>) {");
  lines.push("  let idx = gid.x;");
  lines.push("  if (idx >= sim_params.num_states) { return; }");
  lines.push("  let state_idx = state_var_indices[idx];");
  lines.push("  let deriv_idx = deriv_var_indices[idx];");
  lines.push("  let k = state[deriv_idx];");
  lines.push("  let dt = sim_params.dt;");
  lines.push("  let N = sim_params.num_states;");
  lines.push("  let stage = sim_params.sub_stage;");
  lines.push("  let corr_iter = sim_params.rk4_stage;");
  lines.push("  let gamma = ds_from_f32(0.585786437626905);");
  lines.push("");
  lines.push("  if (stage == 0u) {");
  lines.push("    let y = state[state_idx];");
  lines.push("    y0[idx] = y;");
  lines.push("    stage_scratch[0u * N + idx] = k;");
  lines.push("    let half_gamma_dt = ds_mul(ds_from_f32(0.5), ds_mul(gamma, dt));");
  lines.push("    let w1 = ds_add(y, ds_mul(half_gamma_dt, k));");
  lines.push("    y_acc[idx] = w1;");
  lines.push("    let y_pred = ds_add(y, ds_mul(ds_mul(gamma, dt), k));");
  lines.push("    state[state_idx] = y_pred;");
  lines.push("    stage_scratch[1u * N + idx] = y_pred;");
  lines.push("    stage_scratch[2u * N + idx] = y_pred;");
  lines.push("    stage_scratch[3u * N + idx] = vec2<f32>(0.0, 0.0);");
  lines.push("  } else if (stage == 1u) {");
  lines.push("    // Implicit Trapezoidal stage corrector: R1(y) = y - w1 - (gamma * dt / 2) * f(t + gamma*dt, y) = 0");
  lines.push("    let y_curr = state[state_idx];");
  lines.push("    let w1 = y_acc[idx];");
  lines.push("    let half_gamma_dt = ds_mul(ds_from_f32(0.5), ds_mul(gamma, dt));");
  lines.push("    let target = ds_add(w1, ds_mul(half_gamma_dt, k));");
  lines.push("    let res = ds_sub(y_curr, target);");
  lines.push("    var y_next = target;");
  lines.push("    if (corr_iter > 0u) {");
  lines.push("      let y_prev = stage_scratch[2u * N + idx];");
  lines.push("      let res_prev = stage_scratch[3u * N + idx];");
  lines.push("      let dy = ds_sub(y_curr, y_prev);");
  lines.push("      let dres = ds_sub(res, res_prev);");
  lines.push("      if (abs(dres.x) > 1e-12 && abs(dy.x) > 1e-14) {");
  lines.push("        let step_sec = ds_div(ds_mul(res, dy), dres);");
  lines.push("        y_next = ds_sub(y_curr, step_sec);");
  lines.push("      }");
  lines.push("    }");
  lines.push("    stage_scratch[2u * N + idx] = y_curr;");
  lines.push("    stage_scratch[3u * N + idx] = res;");
  lines.push("    state[state_idx] = y_next;");
  lines.push("    stage_scratch[1u * N + idx] = y_next;");
  lines.push("  } else if (stage == 2u) {");
  lines.push("    let y_gamma = stage_scratch[1u * N + idx];");
  lines.push("    let y_n = y0[idx];");
  lines.push("    let c_gamma = ds_from_f32(1.2071067811865475);");
  lines.push("    let c_n = ds_from_f32(0.2071067811865475);");
  lines.push("    let w2 = ds_sub(ds_mul(c_gamma, y_gamma), ds_mul(c_n, y_n));");
  lines.push("    y_acc[idx] = w2;");
  lines.push("    let y_pred = ds_add(y_gamma, ds_mul(ds_mul(ds_from_f32(0.41421356237), dt), k));");
  lines.push("    state[state_idx] = y_pred;");
  lines.push("    stage_scratch[2u * N + idx] = y_pred;");
  lines.push("    stage_scratch[3u * N + idx] = vec2<f32>(0.0, 0.0);");
  lines.push("  } else if (stage == 3u) {");
  lines.push("    // Implicit BDF2 stage corrector: R2(y) = y - w2 - d_coeff * dt * f(t + dt, y) = 0");
  lines.push("    let y_curr = state[state_idx];");
  lines.push("    let w2 = y_acc[idx];");
  lines.push("    let d_coeff = ds_from_f32(0.2928932188134524);");
  lines.push("    let target = ds_add(w2, ds_mul(ds_mul(d_coeff, dt), k));");
  lines.push("    let res = ds_sub(y_curr, target);");
  lines.push("    var y_next = target;");
  lines.push("    if (corr_iter > 0u) {");
  lines.push("      let y_prev = stage_scratch[2u * N + idx];");
  lines.push("      let res_prev = stage_scratch[3u * N + idx];");
  lines.push("      let dy = ds_sub(y_curr, y_prev);");
  lines.push("      let dres = ds_sub(res, res_prev);");
  lines.push("      if (abs(dres.x) > 1e-12 && abs(dy.x) > 1e-14) {");
  lines.push("        let step_sec = ds_div(ds_mul(res, dy), dres);");
  lines.push("        y_next = ds_sub(y_curr, step_sec);");
  lines.push("      }");
  lines.push("    }");
  lines.push("    stage_scratch[2u * N + idx] = y_curr;");
  lines.push("    stage_scratch[3u * N + idx] = res;");
  lines.push("    state[state_idx] = y_next;");
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
function resolveVarIdx(arena: DAEBuilder, nameId: number): number {
  const name = arena.interner.resolve(nameId);
  if (!name) return -1;
  return arena.getVarIdxByName(name);
}

/** Sanitize a Modelica name for use as a WGSL identifier. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
