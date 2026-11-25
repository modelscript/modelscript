// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared low-level types, literal/type predicates, math/matrix builtins, and
 * array-index helpers used across constant evaluation, substitution, folding,
 * and batch scalarization over {@link DAEBuilder} linear-memory arenas.
 */

import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, UnaryOp, Variability, VarType } from "./wasm_dae.js";
import type { ArenaObjectValue } from "./wasm_evaluator.js";

/** Folded complex scalar value `{ re, im }`. */
export interface ArenaComplexValue {
  re: number;
  im: number;
}

/**
 * Compile-time constant value produced by {@link evaluateConstantArenaExpression}.
 * Represents scalars, complex pairs, evaluated record objects, or arbitrarily nested arrays.
 */
export type ArenaConstantValue =
  number | boolean | string | ArenaComplexValue | ArenaObjectValue | ArenaConstantValue[];

/**
 * Read-only parameter/constant lookup map accepted by evaluation and substitution passes.
 * Optional internal metadata fields allow passing memoization caches and instance context
 * without changing public function arity.
 */
export interface ArenaFoldParamLookup extends ReadonlyMap<string, ArenaConstantValue> {
  _bindMemo?: Map<number, ArenaConstantValue>;
  _instanceName?: string;
  _allParamMap?: ArenaFoldParamLookup;
  _shadowed?: ReadonlySet<string>;
}

/** Mutable parameter/constant map used internally during fixed-point folding passes. */
export interface ArenaFoldParamMap extends Map<string, ArenaConstantValue> {
  _bindMemo?: Map<number, ArenaConstantValue>;
  _instanceName?: string;
  _allParamMap?: ArenaFoldParamLookup;
  _shadowed?: ReadonlySet<string>;
}

/**
 * Typed view of optional runtime/flattener metadata properties attached to {@link DAEBuilder}
 * instances outside the core arena class definition.
 */
export interface DAEBuilderFoldExtensions {
  wasCalled?: boolean;
  isOperatorRecord?: boolean;
  _recordConstVarIndices?: Set<number>;
  foldedRecordTypes?: Map<string, string>;
  flattener?: { isComponentDisabled?: (name: string) => boolean };
}

/** Legacy equation tuple stored on `IfEquationMeta` / `WhenEquationMeta` / `ForEquationMeta`. */
export interface LegacyClauseEquation {
  kind: EqKind;
  lhs: number;
  rhs: number;
  aux?: number | undefined;
}

/** Typed `elseif` clause inside a structured `if` equation. */
export interface StructuredElseIfClause {
  conditionExprId: number;
  bodyEquations?: StructuredBodyEquation[];
  equations?: (StructuredBodyEquation | LegacyClauseEquation)[];
}

/**
 * Typed view of a body equation stored inside `IfEquationMeta`, `ForEquationMeta`,
 * or `WhenEquationMeta` (including nested `If` and `For` equations).
 */
export interface StructuredBodyEquation {
  kind: EqKind;
  lhsExprId: number;
  rhsExprId: number;
  auxExprId?: number | undefined;
  thenEquations?: StructuredBodyEquation[];
  elseIfClauses?: StructuredElseIfClause[];
  elseEquations?: StructuredBodyEquation[];
  bodyEquations?: StructuredBodyEquation[];
}

/** Type guard for `{ re: number, im: number }` complex constant values. */
export function isArenaComplexValue(v: unknown): v is ArenaComplexValue {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof (v as Partial<ArenaComplexValue>).re === "number" &&
    typeof (v as Partial<ArenaComplexValue>).im === "number"
  );
}

/** Coerces a scalar number or complex pair to an {@link ArenaComplexValue}, or `null`. */
export function toArenaComplexValue(v: unknown): ArenaComplexValue | null {
  if (isArenaComplexValue(v)) return v;
  if (typeof v === "number") return { re: v, im: 0 };
  return null;
}

/**
 * Evaluates an elementary math function on constant real inputs.
 */
export function evalMathBuiltin(funcName: string, arg1: number, arg2: number): number | null {
  switch (funcName.toLowerCase()) {
    case "sin":
      return Math.sin(arg1);
    case "cos":
      return Math.cos(arg1);
    case "tan":
      return Math.tan(arg1);
    case "asin":
      return Math.asin(arg1);
    case "acos":
      return Math.acos(arg1);
    case "atan":
      return Math.atan(arg1);
    case "atan2":
      return Math.atan2(arg1, arg2);
    case "sinh":
      return Math.sinh(arg1);
    case "cosh":
      return Math.cosh(arg1);
    case "tanh":
      return Math.tanh(arg1);
    case "exp":
      return Math.exp(arg1);
    case "log":
      return arg1 > 0 ? Math.log(arg1) : null;
    case "log10":
      return arg1 > 0 ? Math.log10(arg1) : null;
    case "sqrt":
      return arg1 >= 0 ? Math.sqrt(arg1) : null;
    case "abs":
      return Math.abs(arg1);
    case "sign":
      return arg1 > 0 ? 1.0 : arg1 < 0 ? -1.0 : 0.0;
    case "min":
      return Math.min(arg1, arg2);
    case "max":
      return Math.max(arg1, arg2);
    case "floor":
      return Math.floor(arg1);
    case "integer":
      return Math.floor(arg1);
    case "ceil":
      return Math.ceil(arg1);
    case "pow":
      return Math.pow(arg1, arg2);
    case "div":
      return arg2 !== 0 ? Math.trunc(arg1 / arg2) : null;
    case "mod":
      return arg2 !== 0 ? arg1 - Math.floor(arg1 / arg2) * arg2 : null;
    case "rem":
      return arg2 !== 0 ? arg1 - Math.trunc(arg1 / arg2) * arg2 : null;
    case "noevent":
      return arg1;
    case "smooth":
      return arg2 !== undefined && !isNaN(arg2) ? arg2 : arg1;
    case "homotopy":
      return arg1;
    default:
      return null;
  }
}

/** Evaluates square matrix exponentiation `A ^ p` for non-negative integer `p`. */
export function evalMatrixPow(A: ArenaConstantValue[], p: number): number[][] | null {
  if (!Array.isArray(A) || A.length === 0 || !Array.isArray(A[0])) return null;
  const N = A.length;
  if (!A.every((row): row is ArenaConstantValue[] => Array.isArray(row) && row.length === N)) return null;
  if (!Number.isInteger(p) || p < 0) return null;

  if (p === 0) {
    const res: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) {
        row.push(i === j ? 1.0 : 0.0);
      }
      res.push(row);
    }
    return res;
  }

  const rows = A as ArenaConstantValue[][];
  let current: number[][] = rows.map((row) => row.map((v) => (typeof v === "number" ? v : Number(v))));
  for (let step = 1; step < p; step++) {
    const next: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let k = 0; k < N; k++) {
          sum += current[i]![k]! * Number(rows[k]![j]!);
        }
        row.push(sum);
      }
      next.push(row);
    }
    current = next;
  }
  return current;
}

export function isLiteralZero(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(exprId) === 0) return true;
  if (k === ExprKind.IntLiteral && dae.getExprData1(exprId) === 0) return true;
  return false;
}

export function isLiteralOne(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(exprId) === 1) return true;
  if (k === ExprKind.IntLiteral && dae.getExprData1(exprId) === 1) return true;
  return false;
}

export function isLiteralMinusOne(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(exprId) === -1) return true;
  if (k === ExprKind.IntLiteral && dae.getExprData1(exprId) === -1) return true;
  if (k === ExprKind.Negate) {
    return isLiteralOne(dae, dae.getExprLeft(exprId));
  }
  if (k === ExprKind.Unary && (dae.getExprData1(exprId) as UnaryOp) === UnaryOp.Negate) {
    return isLiteralOne(dae, dae.getExprLeft(exprId));
  }
  return false;
}

export function _getNegatedInner(dae: DAEBuilder, exprId: number): number | null {
  if (exprId < 0) return null;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.Negate) {
    return dae.getExprLeft(exprId);
  }
  if (k === ExprKind.Unary && (dae.getExprData1(exprId) as UnaryOp) === UnaryOp.Negate) {
    return dae.getExprLeft(exprId);
  }
  if (k === ExprKind.Binary && (dae.getExprData1(exprId) === BinOp.Mul || dae.getExprData1(exprId) === BinOp.ElemMul)) {
    const l = dae.getExprLeft(exprId);
    const r = dae.getExprRight(exprId);
    if (isLiteralMinusOne(dae, l)) return r;
    if (isLiteralMinusOne(dae, r)) return l;
  }
  return null;
}

export function isRealTypedArenaExpr(arena: DAEBuilder, id: number, nameToIdx?: Map<string, number>): boolean {
  if (id < 0 || id >= arena.exprCount) return false;
  const k = arena.getExprKind(id);
  if (k === ExprKind.RealLiteral || k === ExprKind.Der) return true;
  if (
    k === ExprKind.IntLiteral ||
    k === ExprKind.BoolLiteral ||
    k === ExprKind.StringLiteral ||
    k === ExprKind.EnumLiteral
  ) {
    return false;
  }
  if (k === ExprKind.Name) {
    const varName = arena.interner.resolve(arena.getExprData1(id));
    const varIdx = nameToIdx ? nameToIdx.get(varName) : arena.getVarIdxByName(varName);
    return varIdx !== undefined && varIdx >= 0 ? arena.getVarType(varIdx) === VarType.Real : false;
  }
  if (k === ExprKind.Unary || k === ExprKind.Negate) {
    return isRealTypedArenaExpr(arena, arena.getExprLeft(id), nameToIdx);
  }
  if (k === ExprKind.Binary) {
    const op = arena.getExprData1(id) as BinOp;
    if (op === BinOp.Div || op === BinOp.ElemDiv) return true;
    return (
      isRealTypedArenaExpr(arena, arena.getExprLeft(id), nameToIdx) ||
      isRealTypedArenaExpr(arena, arena.getExprRight(id), nameToIdx)
    );
  }
  if (k === ExprKind.IfElse) {
    return (
      isRealTypedArenaExpr(arena, arena.getExprLeft(id), nameToIdx) ||
      isRealTypedArenaExpr(arena, arena.getExprRight(id), nameToIdx)
    );
  }
  if (k === ExprKind.Call) {
    const fnName = (arena.interner.resolve(arena.getExprData1(id)) || "").toLowerCase();
    if (
      fnName === "integer" ||
      fnName === "div" ||
      fnName === "cardinality" ||
      fnName === "size" ||
      fnName === "ndims"
    ) {
      return false;
    }
    if (
      fnName === "/*real*/" ||
      fnName === "real" ||
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
      fnName === "sqrt" ||
      fnName === "floor" ||
      fnName === "ceil" ||
      fnName === "der" ||
      fnName === "homotopy" ||
      fnName === "semilinear"
    ) {
      return true;
    }
    const argCount = arena.getExprRight(id);
    for (let i = 0; i < argCount; i++) {
      const argId = i === 0 ? arena.getExprLeft(id) : arena.getExprLeft(id + i);
      if (isRealTypedArenaExpr(arena, argId, nameToIdx)) return true;
    }
  }
  return false;
}

export function isRealType(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return true;
  if (kind === ExprKind.Der) {
    return isRealType(dae, dae.getExprData1(exprId));
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      let vIdx = dae.getVarIdxByName(name);
      if (vIdx < 0 && name.includes("[")) {
        vIdx = dae.getVarIdxByName(name.split("[")[0]!);
      }
      if (vIdx >= 0) return dae.getVarType(vIdx) === VarType.Real;
    }
  }
  return false;
}

interface ComplexRecordFieldsCarrier {
  __kind?: string;
  fields?: Map<string, unknown>;
  __fields?: Map<string, unknown>;
}

/**
 * Lowers a folded constant value (scalar, complex record, or nested array) into a
 * linear-memory arena expression node.
 */
export function arrayValueToArenaExpr(arena: DAEBuilder, val: ArenaConstantValue, varType: VarType): number {
  if (Array.isArray(val)) {
    const elemIds = val.map((item) => arrayValueToArenaExpr(arena, item, varType));
    return arena.addArrayCtorExpr(elemIds);
  }
  if (typeof val === "number") {
    return varType === VarType.Integer ? arena.addIntLiteral(Math.trunc(val)) : arena.addRealLiteral(val);
  }
  if (typeof val === "boolean") {
    return arena.addBoolLiteral(val);
  }
  if (typeof val === "string") {
    return arena.addStringLiteral(val);
  }
  if (val !== null && typeof val === "object") {
    let reVal: unknown;
    let imVal: unknown;
    if (isArenaComplexValue(val)) {
      reVal = val.re;
      imVal = val.im;
    } else {
      const carrier = val as ComplexRecordFieldsCarrier;
      if (carrier.__kind === "object" && carrier.fields instanceof Map && carrier.fields.size === 2) {
        reVal = carrier.fields.get("re");
        imVal = carrier.fields.get("im");
      } else if (carrier.__fields instanceof Map && carrier.__fields.size === 2) {
        reVal = carrier.__fields.get("re");
        imVal = carrier.__fields.get("im");
      }
    }
    if (typeof reVal === "number" && typeof imVal === "number") {
      return arena.addCallExpr("Complex", [arena.addRealLiteral(reVal), arena.addRealLiteral(imVal)]);
    }
  }
  return arena.addRealLiteral(Number(val));
}

/**
 * Checks if an arena expression is already a literal holding the exact same value.
 * Prevents allocating redundant monotonic literal IDs that falsely trigger fixed-point loops.
 */
export function isExprAlreadyLiteral(arena: DAEBuilder, exprId: number, val: ArenaConstantValue): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (typeof val === "number") {
    if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId) === val;
    if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId) === Math.trunc(val);
  } else if (typeof val === "boolean") {
    if (kind === ExprKind.BoolLiteral) return Boolean(arena.getExprData1(exprId)) === val;
  } else if (typeof val === "string") {
    if (kind === ExprKind.StringLiteral) {
      const strId = arena.getExprData1(exprId);
      return arena.interner.resolve(strId) === val;
    }
  }
  return false;
}

const WASM_FOLDABLE_MATH_BUILTINS = new Set<string>([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "exp",
  "log",
  "log10",
  "sqrt",
  "abs",
  "sign",
  "min",
  "max",
  "floor",
  "ceil",
  "pow",
  "noevent",
  "smooth",
  "homotopy",
]);

interface WasmFoldExports {
  dae_foldConstantsEx?: (ptr: number, maxIter: number, onlyConst: boolean) => number;
}

export function canPreFoldInWasm(arena: DAEBuilder): boolean {
  if (
    arena.ptr === 0 ||
    !arena.exports ||
    typeof (arena.exports as WasmFoldExports).dae_foldConstantsEx !== "function"
  ) {
    return false;
  }
  if (typeof process !== "undefined" && process.env?.["MSX_WASM_FOLD"] === "ts") {
    return false;
  }
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    if (arena.isVarEvaluate(i)) return false;
    if (arena.getVarCausality(i) === Causality.Input) return false;
    const vt = arena.getVarType(i);
    if (vt !== VarType.Real && vt !== VarType.Integer && vt !== VarType.Boolean) return false;
    if (arena.getVarShapeDim(i, 0) > 0) return false;
    const vari = arena.getVarVariability(i);
    if (vari === Variability.Parameter && !arena.isVarFixed(i) && !arena.hasExplicitVarExpression(i)) {
      return false;
    }
    // Skip WASM pre-pass if any variable has non-binding/start attribute expressions (e.g., fixed=false, min/max)
    const attrs = arena.getVarAttrExprIds(i);
    if (attrs !== undefined) {
      for (const k of attrs.keys()) {
        if (k !== "binding" && k !== "start") return false;
      }
    }
  }
  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (arena.isEqRemoved(eq)) continue;
    const ek = arena.getEqKind(eq);
    if (ek !== EqKind.Simple && ek !== EqKind.InitialSimple && ek !== EqKind.Array && ek !== EqKind.Boundary) {
      return false;
    }
  }
  for (let e = 0; e < arena.exprCount; e++) {
    const k = arena.getExprKind(e);
    if (
      k === ExprKind.ArrayCtor ||
      k === ExprKind.StringLiteral ||
      k === ExprKind.Range ||
      k === ExprKind.Subscript ||
      k === ExprKind.EnumLiteral
    ) {
      return false;
    }
    if (k === ExprKind.Call) {
      const argc = arena.getExprRight(e);
      if (argc < 1 || argc > 2) return false;
      const funcName = arena.interner.resolve(arena.getExprData1(e));
      if (!funcName || !WASM_FOLDABLE_MATH_BUILTINS.has(funcName.toLowerCase())) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Generates all multi-dimensional 1-based indices for a given shape.
 * Example: shape `[2, 3]` -> `[[1,1], [1,2], [1,3], [2,1], [2,2], [2,3]]`
 */
export function generateIndices(shape: number[]): number[][] {
  if (shape.length === 0 || shape.some((d) => d <= 0)) return [];
  const result: number[][] = [];
  const current: number[] = new Array<number>(shape.length).fill(1);

  while (true) {
    result.push([...current]);
    let i = shape.length - 1;
    while (i >= 0) {
      current[i] = current[i]! + 1;
      if (current[i]! <= shape[i]!) break;
      current[i] = 1;
      i--;
    }
    if (i < 0) break;
  }
  return result;
}

/**
 * Extracts an element from a multi-dimensional or 1D `ArrayCtor` expression.
 * Returns `-1` if index is invalid or expression is not an `ArrayCtor`.
 */
export function getArrayCtorElement(dae: DAEBuilder, ctorId: number, idx: number[]): number {
  let depth = 0;
  let probe = ctorId;
  while (probe >= 0 && dae.getExprKind(probe) === ExprKind.ArrayCtor) {
    depth++;
    probe = dae.getExprLeft(probe);
  }
  const effectiveIdx = depth > 0 && depth < idx.length ? idx.slice(idx.length - depth) : idx;
  let curr = ctorId;
  for (const index of effectiveIdx) {
    const k = index - 1; // 1-based index to 0-based
    if (dae.getExprKind(curr) !== ExprKind.ArrayCtor) {
      return -1;
    }
    const count = dae.getExprData1(curr);
    if (k < 0 || k >= count) return -1;
    curr = k === 0 ? dae.getExprLeft(curr) : dae.getExprLeft(curr + k);
  }
  return curr;
}

export const BUILTIN_UNQUALIFIED_FUNCTIONS = new Set([
  "abs",
  "sign",
  "sqrt",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "exp",
  "log",
  "log10",
  "min",
  "max",
  "sum",
  "product",
  "mod",
  "rem",
  "div",
  "ceil",
  "floor",
  "integer",
  "homotopy",
  "semiLinear",
  "smooth",
  "noEvent",
  "initial",
  "terminal",
  "sample",
  "pre",
  "edge",
  "change",
  "reinit",
  "delay",
  "spatialDistribution",
  "cardinality",
  "size",
  "ndims",
  "zeros",
  "ones",
  "fill",
  "identity",
  "diagonal",
  "linspace",
  "transpose",
  "outerProduct",
  "symmetric",
  "cross",
  "skew",
  "scalar",
  "vector",
  "matrix",
  "String",
  "Real",
  "Integer",
  "Boolean",
  "der",
  "actualStream",
  "inStream",
]);

export function lookupRecordFunctionInDae(dae: DAEBuilder, rawFnName: string | undefined): DAEBuilder | null {
  if (!rawFnName) return null;
  const fnName = rawFnName.startsWith(".") ? rawFnName.slice(1) : rawFnName;
  const parts = fnName.split(".");
  if (parts.length === 1 && BUILTIN_UNQUALIFIED_FUNCTIONS.has(fnName)) {
    return null;
  }
  const shortName = parts[parts.length - 1]!;
  const isBuiltinShort = BUILTIN_UNQUALIFIED_FUNCTIONS.has(shortName);
  const lastTwo = parts.length >= 2 ? `${parts[parts.length - 2]}.${shortName}` : null;
  const direct =
    dae.functions.get(rawFnName) ||
    dae.functions.get(fnName) ||
    (!isBuiltinShort ? dae.functions.get(shortName) : null) ||
    (dae.name ? dae.functions.get(`${dae.name}.${fnName}`) : null) ||
    (!isBuiltinShort && dae.name ? dae.functions.get(`${dae.name}.${shortName}`) : null);
  if (direct) return direct;
  let twoSegMatch: DAEBuilder | null = null;
  let suffixMatch: DAEBuilder | null = null;
  const shortSuffix = `.${shortName}`;
  const twoSegSuffix = lastTwo ? `.${lastTwo}` : null;
  for (const [k, v] of dae.functions.entries()) {
    if (typeof k === "string") {
      if (k.endsWith(`.${fnName}`)) return v;
      if (twoSegSuffix && k.endsWith(twoSegSuffix) && !twoSegMatch) {
        twoSegMatch = v;
      }
      if (!isBuiltinShort && k.endsWith(shortSuffix) && !suffixMatch) {
        suffixMatch = v;
      }
    }
  }
  return twoSegMatch || suffixMatch;
}
