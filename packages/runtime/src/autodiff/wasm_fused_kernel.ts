// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * XLA-Style Fused Operator & Equation Kernel Compiler for DAE Arenas.
 *
 * Compiles BLT single-equation blocks into a monolithic, fused evaluation kernel
 * with register-allocated intermediate variables and local Common Subexpression
 * Elimination (CSE), completely eliminating linear memory round-trips.
 */

import { BinOp, DAEBuilder, ExprKind, UnaryOp } from "../dae/wasm_dae.js";
import { type PackedMemoryLayout } from "../gpu/wasm_memory_planner.js";

export interface FusedKernelOptions {
  /** Target buffer indexing layout. */
  layout?: PackedMemoryLayout;
  /** Enable Common Subexpression Elimination (CSE). Default: true. */
  cse?: boolean;
}

export interface FusedKernelResult {
  /** Executable evaluation function operating on the environment buffer. */
  evaluate: (env: Float64Array) => void;
  /** Compiled JavaScript source code of the fused kernel. */
  source: string;
  /** Total number of intermediate memory writes eliminated. */
  eliminatedWrites: number;
  /** Total number of common subexpressions eliminated. */
  eliminatedSubexpressions: number;
}

export interface ExecutionBlockDescriptor {
  type: "single" | "system";
  varIdx: number;
  exprId: number;
}

/**
 * Compiles a sequence of single execution blocks into a fused, register-resident kernel.
 */
export function compileFusedArenaKernel(
  arena: DAEBuilder,
  executionBlocks: ExecutionBlockDescriptor[],
  options?: FusedKernelOptions,
): FusedKernelResult {
  const layout = options?.layout;
  const enableCse = options?.cse !== false;

  const lines: string[] = [];
  let eliminatedWrites = 0;
  let eliminatedSubexprs = 0;

  // Liveness lookup: if layout provided, only persistent vars MUST be written back to env
  const isPersistentVar = (v: number): boolean => {
    if (!layout) return true;
    return layout.varIdxToOffset[v]! < layout.persistentCount;
  };

  const getOffset = (v: number): number => {
    if (layout) {
      return layout.varIdxToOffset[v]!;
    }
    return arena.getVarNameId(v);
  };

  // Map to track variables currently resident in local JS registers: varIdx -> registerName
  const regMap = new Map<number, string>();

  // CSE cache: expression structural string -> local temporary name
  const cseCache = new Map<string, string>();
  let tempCounter = 0;

  function exprToCode(exprId: number): string {
    if (exprId < 0) return "0";
    const kind = arena.getExprKind(exprId);

    switch (kind) {
      case ExprKind.RealLiteral:
        return arena.getExprRealValue(exprId).toString();
      case ExprKind.IntLiteral:
      case ExprKind.BoolLiteral:
      case ExprKind.EnumLiteral:
        return arena.getExprData1(exprId).toString();

      case ExprKind.Name: {
        const nameId = arena.getExprData1(exprId);
        const nameStr = arena.interner.resolve(nameId);
        const varIdx = nameStr ? arena.getVarIdxByName(nameStr) : -1;

        // If variable is already resident in a local register, read from register!
        if (varIdx !== -1 && regMap.has(varIdx)) {
          return regMap.get(varIdx)!;
        }

        const offset = layout ? (layout.nameIdToOffset.get(nameId) ?? nameId) : nameId;
        return `env[${offset}]`;
      }

      case ExprKind.Negate: {
        const inner = exprToCode(arena.getExprLeft(exprId));
        return `(-(${inner}))`;
      }

      case ExprKind.Unary: {
        const op = arena.getExprData1(exprId);
        const inner = exprToCode(arena.getExprLeft(exprId));
        if (op === UnaryOp.Negate) return `(-(${inner}))`;
        if (op === UnaryOp.Not) return `((${inner}) === 0 ? 1 : 0)`;
        return "0";
      }

      case ExprKind.Binary: {
        const op = arena.getExprData1(exprId);
        const leftCode = exprToCode(arena.getExprLeft(exprId));
        const rightCode = exprToCode(arena.getExprRight(exprId));

        let opStr = "+";
        switch (op) {
          case BinOp.Add:
          case BinOp.ElemAdd:
            opStr = "+";
            break;
          case BinOp.Sub:
          case BinOp.ElemSub:
            opStr = "-";
            break;
          case BinOp.Mul:
          case BinOp.ElemMul:
            opStr = "*";
            break;
          case BinOp.Div:
          case BinOp.ElemDiv:
            opStr = "/";
            break;
          case BinOp.Lt:
            return `((${leftCode}) < (${rightCode}) ? 1 : 0)`;
          case BinOp.Lte:
            return `((${leftCode}) <= (${rightCode}) ? 1 : 0)`;
          case BinOp.Gt:
            return `((${leftCode}) > (${rightCode}) ? 1 : 0)`;
          case BinOp.Gte:
            return `((${leftCode}) >= (${rightCode}) ? 1 : 0)`;
          case BinOp.Eq:
            return `((${leftCode}) === (${rightCode}) ? 1 : 0)`;
          case BinOp.Neq:
            return `((${leftCode}) !== (${rightCode}) ? 1 : 0)`;
          default:
            return "0";
        }

        const rawExpr = `((${leftCode}) ${opStr} (${rightCode}))`;
        if (enableCse) {
          const existing = cseCache.get(rawExpr);
          if (existing) {
            eliminatedSubexprs++;
            return existing;
          }
          const tName = `_t${tempCounter++}`;
          lines.push(`  const ${tName} = ${rawExpr};`);
          cseCache.set(rawExpr, tName);
          return tName;
        }
        return rawExpr;
      }

      case ExprKind.IfElse: {
        const cond = exprToCode(arena.getExprData1(exprId));
        const thenVal = exprToCode(arena.getExprLeft(exprId));
        const elseVal = exprToCode(arena.getExprRight(exprId));
        return `((${cond}) !== 0 ? (${thenVal}) : (${elseVal}))`;
      }

      case ExprKind.Call: {
        const fnName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
        const arg = exprToCode(arena.getExprLeft(exprId));
        if (fnName === "sin") return `Math.sin(${arg})`;
        if (fnName === "cos") return `Math.cos(${arg})`;
        if (fnName === "exp") return `Math.exp(${arg})`;
        if (fnName === "sqrt") return `Math.sqrt(${arg})`;
        if (fnName === "abs") return `Math.abs(${arg})`;
        return "0";
      }

      default:
        return "0";
    }
  }

  // Iterate blocks and generate fused statements
  for (let b = 0; b < executionBlocks.length; b++) {
    const block = executionBlocks[b]!;
    if (block.type !== "single") continue;

    const v = block.varIdx;
    const vName = `_v${v}`;
    const code = exprToCode(block.exprId);

    // Bind result to local register
    lines.push(`  const ${vName} = ${code};`);
    regMap.set(v, vName);

    const persistent = isPersistentVar(v);
    const offset = getOffset(v);

    if (persistent) {
      // Must write to output buffer
      lines.push(`  env[${offset}] = ${vName};`);
    } else {
      // Memory write eliminated! Kept purely in register
      eliminatedWrites++;
    }
  }

  const fullSource = ["function evaluateFused(env) {", ...lines, "}"].join("\n");

  const evaluate = new Function("env", lines.join("\n")) as (env: Float64Array) => void;

  return {
    evaluate,
    source: fullSource,
    eliminatedWrites,
    eliminatedSubexpressions: eliminatedSubexprs,
  };
}
