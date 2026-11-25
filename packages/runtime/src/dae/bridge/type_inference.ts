// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static expression type inference and Modelica assignability helpers for the DAE arena.
 */

import type { WasmDaeEquations } from "./equations.js";
import { type AssignableTypeOptions, BinOp, Causality, ExprKind, UnaryOp, VarType } from "./types.js";

/** Minimal arena contract required for expression type inference. */
export type TypeInferenceArena = WasmDaeEquations & {
  getFunction(nameOrId: string | number): WasmDaeEquations | undefined;
};

/**
 * Infers the Modelica primitive or enumeration {@link VarType} of an expression node (`exprId`)
 * in `dae`, returning `null` if the type cannot be statically determined from the arena.
 *
 * @param dae - Target `WasmDaeBridge` (`DAEBuilder`) arena.
 * @param exprId - Expression arena ID to inspect.
 * @returns Inferred {@link VarType}, or `null` if unknown.
 */
export function inferArenaExprVarType(dae: TypeInferenceArena, exprId: number): VarType | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.RealLiteral:
      return VarType.Real;
    case ExprKind.IntLiteral:
      return VarType.Integer;
    case ExprKind.BoolLiteral:
      return VarType.Boolean;
    case ExprKind.StringLiteral:
      return VarType.String;
    case ExprKind.EnumLiteral:
      return VarType.Enumeration;
    case ExprKind.Name: {
      const nameId = dae.getExprData1(exprId);
      const vIdx = dae.lookupVariable(nameId);
      if (vIdx >= 0) return dae.getVarType(vIdx);
      const nameStr = dae.interner.resolve(nameId);
      if (nameStr) {
        const vIdx2 = dae.getVarIdxByName(nameStr);
        if (vIdx2 >= 0) return dae.getVarType(vIdx2);
        if (nameStr.includes("[")) {
          const baseName = nameStr.split("[")[0]!;
          const baseIdx = dae.getVarIdxByName(baseName);
          if (baseIdx >= 0) return dae.getVarType(baseIdx);
          const baseId = dae.interner.intern(baseName);
          const baseIdx2 = dae.lookupVariable(baseId);
          if (baseIdx2 >= 0) return dae.getVarType(baseIdx2);
        }
      }
      return null;
    }
    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId) as BinOp;
      switch (op) {
        case BinOp.Eq:
        case BinOp.Neq:
        case BinOp.Lt:
        case BinOp.Gt:
        case BinOp.Lte:
        case BinOp.Gte:
        case BinOp.And:
        case BinOp.Or:
          return VarType.Boolean;
        case BinOp.Add:
        case BinOp.Sub:
        case BinOp.Mul:
        case BinOp.Div:
        case BinOp.Pow:
        case BinOp.ElemAdd:
        case BinOp.ElemSub:
        case BinOp.ElemMul:
        case BinOp.ElemDiv:
        case BinOp.ElemPow: {
          const lType = inferArenaExprVarType(dae, dae.getExprLeft(exprId));
          const rType = inferArenaExprVarType(dae, dae.getExprRight(exprId));
          if (lType === null || rType === null) return null;
          if (lType === VarType.Real || rType === VarType.Real) return VarType.Real;
          if (lType === VarType.Integer && rType === VarType.Integer) {
            return op === BinOp.Div || op === BinOp.ElemDiv || op === BinOp.Pow || op === BinOp.ElemPow
              ? VarType.Real
              : VarType.Integer;
          }
          return lType;
        }
      }
      return null;
    }
    case ExprKind.Unary: {
      const uop = dae.getExprData1(exprId) as UnaryOp;
      return uop === UnaryOp.Not ? VarType.Boolean : inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    }
    case ExprKind.Negate:
      return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    case ExprKind.Der:
      return VarType.Real;
    case ExprKind.Pre:
      return inferArenaExprVarType(dae, dae.getExprData1(exprId));
    case ExprKind.IfElse:
      return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    case ExprKind.ArrayCtor:
      return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    case ExprKind.Subscript: {
      const base = dae.getExprData1(exprId) || dae.getExprLeft(exprId);
      return inferArenaExprVarType(dae, base);
    }
    case ExprKind.Call: {
      const nameId = dae.getExprData1(exprId);
      const fnName = dae.interner.resolve(nameId);
      if (
        fnName === "integer" ||
        fnName === "floor" ||
        fnName === "ceil" ||
        fnName === "round" ||
        fnName === "div" ||
        fnName === "mod" ||
        fnName === "rem" ||
        fnName === "cardinality" ||
        fnName === "sign" ||
        fnName === "size" ||
        fnName === "ndims" ||
        fnName === "Integer" ||
        fnName === "/*Integer*/"
      ) {
        return VarType.Integer;
      }
      if (fnName === "Boolean" || fnName === "/*Boolean*/" || fnName === "initial" || fnName === "terminal")
        return VarType.Boolean;
      if (fnName === "sample") {
        const argCount = dae.getExprRight(exprId);
        if (argCount === 1) return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
        if (argCount === 2) {
          const arg1 = dae.getExprLeft(exprId + 1);
          const t1 = inferArenaExprVarType(dae, arg1);
          if (t1 === VarType.Real || t1 === VarType.Integer) {
            return VarType.Boolean;
          }
          const k1 = dae.getExprKind(arg1);
          if (k1 === ExprKind.RealLiteral || k1 === ExprKind.IntLiteral) {
            return VarType.Boolean;
          }
          return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
        }
      }
      if (fnName === "String" || fnName === "/*String*/" || fnName === "getInstanceName" || fnName === "typeName") {
        return VarType.String;
      }
      if (
        fnName === "Real" ||
        fnName === "/*Real*/" ||
        fnName === "sin" ||
        fnName === "cos" ||
        fnName === "tan" ||
        fnName === "asin" ||
        fnName === "acos" ||
        fnName === "atan" ||
        fnName === "atan2" ||
        fnName === "sinh" ||
        fnName === "cosh" ||
        fnName === "tanh" ||
        fnName === "exp" ||
        fnName === "log" ||
        fnName === "log10" ||
        fnName === "sqrt"
      ) {
        return VarType.Real;
      }
      if (fnName === "min" || fnName === "max" || fnName === "abs" || fnName === "sum" || fnName === "product") {
        const argCount = dae.getExprRight(exprId);
        if (argCount > 0) {
          const t0 = inferArenaExprVarType(dae, dae.getExprLeft(exprId));
          if (t0 !== null) return t0;
          for (let i = 1; i < argCount; i++) {
            const ti = inferArenaExprVarType(dae, dae.getExprLeft(exprId + i));
            if (ti !== null) return ti;
          }
        }
      }
      let fnDae = dae.getFunction(nameId) ?? (fnName ? dae.getFunction(fnName) : undefined);
      if (!fnDae && fnName && fnName.includes(".")) {
        const base = fnName.split(".").pop();
        if (base) fnDae = dae.getFunction(base);
      }
      if (fnDae) {
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Output) {
            return fnDae.getVarType(i);
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Checks whether a value of type `source` can be assigned or bound to a variable/parameter
 * of type `target` under Modelica's type coercion rules (`Integer` $\to$ `Real`, etc.).
 *
 * @param source - Inferred source expression `VarType` (or `null` if unknown).
 * @param target - Target variable/parameter `VarType`.
 * @param options - Optional conversion flags.
 * @returns `true` if `source` is assignable to `target`.
 */
export function isAssignableType(source: VarType | null, target: VarType, options?: AssignableTypeOptions): boolean {
  if (source === null) return false;
  if (source === target) return true;
  if (source === VarType.Integer && target === VarType.Real) return true;
  if (source === VarType.Integer && target === VarType.Enumeration) {
    return options?.intEnumConversion === true;
  }
  return false;
}

/**
 * Returns the canonical Modelica type name string (`"Real"`, `"Integer"`, `"Boolean"`,
 * `"String"`, `"Enumeration"`, `"Clock"`) for a {@link VarType} enum value.
 *
 * @param type - `VarType` enum value.
 * @returns Human-readable Modelica type name.
 */
export function varTypeName(type: VarType): string {
  switch (type) {
    case VarType.Real:
      return "Real";
    case VarType.Integer:
      return "Integer";
    case VarType.Boolean:
      return "Boolean";
    case VarType.String:
      return "String";
    case VarType.Enumeration:
      return "Enumeration";
    case VarType.Clock:
      return "Clock";
    default:
      return "Unknown";
  }
}
