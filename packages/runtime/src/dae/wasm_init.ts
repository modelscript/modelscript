// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dedicated Initialization BLT Transformer & Initial Equation Solver.
 *
 * Constructs bipartite graphs and solves initial conditions natively on the DAEBuilder
 * at t=0 before time integration begins:
 *   - Treats `fixed=true` variables and parameters as hard knowns
 *   - Rotates derivatives der(x) into pure algebraic unknowns
 *   - Solves explicit assignments and implicit algebraic loops via sparse analytical Newton-Raphson
 *   - Provides multi-strategy homotopy continuation fallback for stiff/nonlinear initialization
 */

import { type DomainBox, Interval, solveSBB } from "../analysis/wasm_interval.js";
import { StaticTapeBuilder, TapeOpKind, evaluateTapeForward, evaluateTapeReverse } from "../autodiff/wasm_tape.js";
import { luFactorFlat, luSolveFlat } from "../solvers/wasm_gaussian.js";
import {
  BinOp,
  DAEBuilder,
  EqKind,
  ExprKind,
  StmtKind,
  VarAttrKind,
  VarType,
  Variability,
  differentiateArenaExpressionWrt,
  substituteArenaExpr,
} from "./wasm_dae.js";
import { evaluateArenaRuntime } from "./wasm_evaluator.js";
import { executeArenaStatements } from "./wasm_statement_executor.js";

// ─────────────────────────────────────────────────────────────────────────
// Public Types: Initialization BLT
// ─────────────────────────────────────────────────────────────────────────

/** An explicit assignment block: target = expr (no unknowns on RHS). */
export interface ExplicitInitBlock {
  type: "explicit";
  /** Variable name being assigned. */
  target: string;
  /** Expression ID to evaluate. */
  expr: number;
}

/** An implicit algebraic loop block requiring Newton/homotopy solving. */
export interface ImplicitInitBlock {
  type: "implicit";
  /** Unknown variable names in this loop. */
  unknowns: string[];
  /** Equations in the loop (LHS = RHS pairs). */
  equations: { lhs: number; rhs: number }[];
  /** Whether this block contains discrete (Integer/Boolean) variables. */
  hasDiscreteVars: boolean;
}

export type InitBlock = ExplicitInitBlock | ImplicitInitBlock;

/** Result of the initialization BLT transformation. */
export interface InitBLTResult {
  /** Ordered sequence of init blocks (dependencies first). */
  blocks: InitBlock[];
  /** Set of known variable names (parameters, fixed, time). */
  knowns: Set<string>;
  /** Set of unknown variable names (to be solved). */
  unknowns: Set<string>;
  /** Total initial equations considered. */
  equationCount?: number;
  /** Number of equations matched into blocks. */
  matchedEquationCount?: number;
}

/** Result of initial equation solving natively on the arena. */
export interface ArenaInitSolverResult {
  valuesByStringId: Float64Array;
  iterations: number;
  residualNorm: number;
  converged: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Public Types: Homotopy Continuation
// ─────────────────────────────────────────────────────────────────────────

/** Homotopy continuation strategy mode. */
export type HomotopyMode = "none" | "residual" | "symbolic" | "fixed-point" | "parameter" | "auto";

/** Result of a homotopy solve attempt. */
export interface HomotopyResult {
  /** Solved variable values. */
  values: Map<string, number>;
  /** Total iterations used. */
  iterations: number;
  /** Final residual norm. */
  residualNorm: number;
  /** Whether the solver converged (λ reached 1). */
  converged: boolean;
  /** Strategy that was used. */
  strategy: string;
}

/** Common interface for all homotopy strategies. */
export interface HomotopyStrategy {
  /** Human-readable strategy name. */
  name: string;
  /** Attempt to solve the system via homotopy continuation. */
  solve(
    tapeData: { ops: StaticTapeBuilder; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult;
}

// ─────────────────────────────────────────────────────────────────────────
// Initialization BLT Algorithm
// ─────────────────────────────────────────────────────────────────────────

/** Expand a multi-dimensional shape (e.g. [2, 3]) into 1-based index strings ("1,1", "1,2", ...). */
function expandMultiDimIndices(shape: number[]): string[] {
  if (shape.length === 0) return [];
  let acc: string[] = [""];
  for (let d = 0; d < shape.length; d++) {
    const dim = shape[d] ?? 0;
    if (dim <= 0) return [];
    const next: string[] = [];
    for (const prefix of acc) {
      for (let k = 1; k <= dim; k++) {
        next.push(prefix ? `${prefix},${k}` : `${k}`);
      }
    }
    acc = next;
  }
  return acc;
}

/** Resolve a constant-index subscript expression (1D or multi-dimensional) to a scalarized name like "x[1]" or "A[1,2]". */
function resolveConstSubscriptName(exprId: number, arena: DAEBuilder): string | null {
  if (exprId < 0 || arena.getExprKind(exprId) !== ExprKind.Subscript) return null;
  let currentExprId = exprId;
  const indexVals: number[] = [];
  while (currentExprId >= 0 && arena.getExprKind(currentExprId) === ExprKind.Subscript) {
    const firstSubId = arena.getExprLeft(currentExprId);
    const subCount = arena.getExprRight(currentExprId);
    if (subCount <= 0 || firstSubId < 0) return null;
    const chunk: number[] = [];
    for (let i = 0; i < subCount; i++) {
      const slotIdx = currentExprId + i;
      const subExprId =
        i === 0
          ? firstSubId
          : slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
            ? arena.getExprLeft(slotIdx)
            : firstSubId + i;
      const val = evalRangeBoundArena(arena, subExprId);
      if (val === null || !Number.isFinite(val)) return null;
      chunk.push(Math.round(val));
    }
    indexVals.unshift(...chunk);
    currentExprId = arena.getExprData1(currentExprId);
  }
  if (currentExprId >= 0 && arena.getExprKind(currentExprId) === ExprKind.Name) {
    const baseName = arena.interner.resolve(arena.getExprData1(currentExprId));
    if (baseName && indexVals.length > 0) {
      return `${baseName}[${indexVals.join(",")}]`;
    }
  }
  return null;
}

function isEqInitialFlag(dae: DAEBuilder, eqIdx: number): boolean {
  if (typeof (dae as any).isEqInitial === "function") {
    return Boolean((dae as any).isEqInitial(eqIdx));
  }
  return (dae.getEqFlags(eqIdx) & 1) !== 0;
}

/** Unroll nested array constructor / tuple / bare array variable expressions into a flat list of scalar expression IDs. */
function flatElements(exprId: number, arena: DAEBuilder): number[] {
  if (exprId < 0) return [];
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.ArrayCtor || kind === ExprKind.Tuple) {
    const count = arena.getExprData1(exprId);
    const firstElemId = arena.getExprLeft(exprId);
    const elements: number[] = [];
    for (let i = 0; i < count; i++) {
      const elemExprId = i === 0 ? firstElemId : arena.getExprLeft(exprId + i);
      elements.push(...flatElements(elemExprId, arena));
    }
    return elements;
  }
  if (kind === ExprKind.Name) {
    const varName = arena.interner.resolve(arena.getExprData1(exprId));
    if (varName) {
      const varIdx = arena.getVarIdxByName(varName);
      const shape = varIdx !== -1 ? arena.getVarShape(varIdx) : (arena.getNamedArrayShape?.(varName) ?? []);
      if (shape.length > 0) {
        const idxStrings = expandMultiDimIndices(shape);
        if (idxStrings.length > 0) {
          return idxStrings.map((idxStr) => {
            const candidateName = `${varName}[${idxStr}]`;
            if (arena.getVarIdxByName(candidateName) !== -1) {
              return arena.addNameExpr(candidateName);
            }
            const idxExprs = idxStr.split(",").map((s) => arena.addIntLiteral(Number.parseInt(s, 10)));
            return arena.addSubscriptExpr(exprId, idxExprs);
          });
        }
      }
    }
  }
  return [exprId];
}

/** Collect all variable names referenced in an expression. */
function collectExprVarNames(exprId: number, arena: DAEBuilder, names: Set<string>): void {
  if (exprId < 0) return;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      names.add(arena.interner.resolve(nameId));
      break;
    }
    case ExprKind.RealLiteral:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.EnumLiteral:
    case ExprKind.Colon:
      break;
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Pre: {
      const operand = kind === ExprKind.Pre ? arena.getExprData1(exprId) : arena.getExprLeft(exprId);
      collectExprVarNames(operand, arena, names);
      break;
    }
    case ExprKind.Der: {
      const operand = arena.getExprData1(exprId);
      if (operand >= 0) {
        const opKind = arena.getExprKind(operand);
        if (opKind === ExprKind.Name) {
          const varName = arena.interner.resolve(arena.getExprData1(operand));
          names.add(`der(${varName})`);
        } else if (opKind === ExprKind.Subscript) {
          const subName = resolveConstSubscriptName(operand, arena);
          if (subName) names.add(`der(${subName})`);
        }
      }
      break;
    }
    case ExprKind.Binary: {
      collectExprVarNames(arena.getExprLeft(exprId), arena, names);
      collectExprVarNames(arena.getExprRight(exprId), arena, names);
      break;
    }
    case ExprKind.Call: {
      const nameId = arena.getExprData1(exprId);
      const funcName = arena.interner.resolve(nameId);
      const firstArgId = arena.getExprLeft(exprId);
      const argCount = arena.getExprRight(exprId);

      if (funcName === "der" && argCount === 1 && firstArgId >= 0) {
        const argExprId = firstArgId;
        const argKind = arena.getExprKind(argExprId);
        if (argKind === ExprKind.Name) {
          const varName = arena.interner.resolve(arena.getExprData1(argExprId));
          names.add(`der(${varName})`);
        } else if (argKind === ExprKind.Subscript) {
          const subName = resolveConstSubscriptName(argExprId, arena);
          if (subName) names.add(`der(${subName})`);
        }
        break;
      }

      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? firstArgId : arena.getExprLeft(exprId + i);
        collectExprVarNames(argExprId, arena, names);
      }
      break;
    }
    case ExprKind.Subscript: {
      const baseExprId = arena.getExprData1(exprId);
      const firstSubId = arena.getExprLeft(exprId);
      const subCount = arena.getExprRight(exprId);

      const subName = resolveConstSubscriptName(exprId, arena);
      if (subName) {
        names.add(subName);
      } else {
        collectExprVarNames(baseExprId, arena, names);
      }
      for (let i = 0; i < subCount; i++) {
        const subExprId = i === 0 ? firstSubId : arena.getExprLeft(exprId + i);
        collectExprVarNames(subExprId, arena, names);
      }
      break;
    }
    case ExprKind.ArrayCtor:
    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      const firstElemId = arena.getExprLeft(exprId);
      for (let i = 0; i < count; i++) {
        const elemExprId = i === 0 ? firstElemId : arena.getExprLeft(exprId + i);
        collectExprVarNames(elemExprId, arena, names);
      }
      break;
    }
    case ExprKind.IfElse: {
      collectExprVarNames(arena.getExprData1(exprId), arena, names);
      collectExprVarNames(arena.getExprLeft(exprId), arena, names);
      collectExprVarNames(arena.getExprRight(exprId), arena, names);
      break;
    }
    case ExprKind.Comprehension: {
      collectExprVarNames(arena.getExprLeft(exprId), arena, names);
      const iterCount = arena.getExprRight(exprId);
      for (let i = 0; i < iterCount; i++) {
        const iterNodeId = exprId + 1 + i;
        const rangeExpr = arena.getExprLeft(iterNodeId);
        if (rangeExpr >= 0) {
          collectExprVarNames(rangeExpr, arena, names);
        }
      }
      break;
    }
    case ExprKind.PartialFunc:
      break;
    case ExprKind.Object: {
      const count = arena.getExprData1(exprId);
      if (count > 0) {
        collectExprVarNames(arena.getExprLeft(exprId), arena, names);
        for (let i = 1; i < count; i++) {
          const fieldValueId = arena.getExprLeft(exprId + i);
          collectExprVarNames(fieldValueId, arena, names);
        }
      }
      break;
    }
    case ExprKind.Range: {
      collectExprVarNames(arena.getExprData1(exprId), arena, names);
      const step = arena.getExprLeft(exprId);
      if (step >= 0) collectExprVarNames(step, arena, names);
      collectExprVarNames(arena.getExprRight(exprId), arena, names);
      break;
    }
  }
}

function canonicalizeScalarizedSubscripts(dae: DAEBuilder, exprId: number): number {
  if (exprId < 0) return exprId;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name && dae.getVarIdxByName(name) === -1 && name.includes("[")) {
      const m = /^(.+)(\[[^\][]+])\.([^.[\]]+)$/.exec(name);
      if (m) {
        const transposed = `${m[1]}.${m[3]}${m[2]}`;
        if (dae.getVarIdxByName(transposed) !== -1) {
          return dae.addNameExpr(transposed);
        }
      }
    }
    return exprId;
  }
  if (kind === ExprKind.Subscript) {
    const directSubName = resolveConstSubscriptName(exprId, dae);
    if (directSubName && dae.getVarIdxByName(directSubName) !== -1) {
      return dae.addNameExpr(directSubName);
    }
    const baseExpr = dae.getExprData1(exprId);
    const firstSub = dae.getExprLeft(exprId);
    const subCount = dae.getExprRight(exprId);
    const cBase = canonicalizeScalarizedSubscripts(dae, baseExpr);
    let changed = cBase !== baseExpr;
    const cSubs: number[] = [];
    for (let j = 0; j < subCount; j++) {
      const slotIdx = exprId + j;
      const origSub =
        j === 0
          ? firstSub
          : slotIdx < dae.exprCount && dae.getExprKind(slotIdx) === ExprKind.Tuple
            ? dae.getExprLeft(slotIdx)
            : firstSub + j;
      const cSub = canonicalizeScalarizedSubscripts(dae, origSub);
      if (cSub !== origSub) changed = true;
      cSubs.push(cSub);
    }
    if (dae.getExprKind(cBase) === ExprKind.Name) {
      const baseName = dae.interner.resolve(dae.getExprData1(cBase));
      const idxVals: number[] = [];
      let allConst = true;
      for (const cSub of cSubs) {
        const v = evalRangeBoundArena(dae, cSub);
        if (v !== null && Number.isFinite(v)) {
          idxVals.push(Math.round(v));
        } else {
          allConst = false;
          break;
        }
      }
      if (baseName && allConst && idxVals.length > 0) {
        const candidateName = `${baseName}[${idxVals.join(",")}]`;
        if (dae.getVarIdxByName(candidateName) !== -1) {
          return dae.addNameExpr(candidateName);
        }
      }
    }
    return changed ? dae.addSubscriptExpr(cBase, cSubs) : exprId;
  }
  if (kind === ExprKind.Der) {
    const arg = dae.getExprData1(exprId);
    const cArg = canonicalizeScalarizedSubscripts(dae, arg);
    return cArg !== arg ? dae.addDerExpr(cArg) : exprId;
  }
  if (kind === ExprKind.Binary) {
    const l = dae.getExprLeft(exprId);
    const r = dae.getExprRight(exprId);
    const cl = canonicalizeScalarizedSubscripts(dae, l);
    const cr = canonicalizeScalarizedSubscripts(dae, r);
    return cl !== l || cr !== r ? dae.addBinaryExpr(dae.getExprData1(exprId), cl, cr) : exprId;
  }
  if (kind === ExprKind.Negate) {
    const l = dae.getExprLeft(exprId);
    const cl = canonicalizeScalarizedSubscripts(dae, l);
    return cl !== l ? dae.addNegateExpr(cl) : exprId;
  }
  if (kind === ExprKind.Unary) {
    const l = dae.getExprLeft(exprId);
    const cl = canonicalizeScalarizedSubscripts(dae, l);
    return cl !== l ? dae.addUnaryExpr(dae.getExprData1(exprId), cl) : exprId;
  }
  if (kind === ExprKind.IfElse) {
    const c = dae.getExprData1(exprId);
    const l = dae.getExprLeft(exprId);
    const r = dae.getExprRight(exprId);
    const cc = canonicalizeScalarizedSubscripts(dae, c);
    const cl = canonicalizeScalarizedSubscripts(dae, l);
    const cr = canonicalizeScalarizedSubscripts(dae, r);
    return cc !== c || cl !== l || cr !== r ? dae.addExpression(ExprKind.IfElse, cc, cl, cr) : exprId;
  }
  if (kind === ExprKind.Call) {
    const funcNameId = dae.getExprData1(exprId);
    const firstArg = dae.getExprLeft(exprId);
    const count = dae.getExprRight(exprId);
    if (count <= 0 || firstArg < 0) return exprId;
    let changed = false;
    const newArgs: number[] = [];
    for (let j = 0; j < count; j++) {
      const slotIdx = exprId + j;
      const origArg =
        j === 0
          ? firstArg
          : slotIdx < dae.exprCount && dae.getExprKind(slotIdx) === ExprKind.Tuple
            ? dae.getExprLeft(slotIdx)
            : firstArg + j;
      const cArg = canonicalizeScalarizedSubscripts(dae, origArg);
      if (cArg !== origArg) changed = true;
      newArgs.push(cArg);
    }
    if (!changed) return exprId;
    const callId = dae.addExpression(ExprKind.Call, funcNameId, newArgs[0]!, count);
    for (let j = 1; j < count; j++) {
      dae.addExpression(ExprKind.Tuple, 0, newArgs[j]!, 0);
    }
    return callId;
  }
  return exprId;
}

function evalRangeBoundArena(dae: DAEBuilder, exprId: number): number | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.IntLiteral) return dae.getExprData1(exprId);
  if (kind === ExprKind.RealLiteral) return dae.getExprRealValue(exprId);
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      const varIdx = dae.getVarIdxByName(name);
      if (varIdx !== -1) {
        return dae.getVarStartValue(varIdx);
      }
    }
  }
  try {
    const val = evaluateArenaRuntime(dae, exprId, new Float64Array(0));
    if (Number.isFinite(val)) return val;
  } catch {
    // Fallback below
  }
  return null;
}

function expandForEquationArena(dae: DAEBuilder, eqIdx: number): { lhs: number; rhs: number }[] {
  const expanded: { lhs: number; rhs: number }[] = [];
  const meta = dae.getForEquationMeta?.(eqIdx);
  if (!meta) return expanded;

  const rangeExprId = meta.rangeExprId;
  if (rangeExprId < 0 || dae.getExprKind(rangeExprId) !== ExprKind.Range) return expanded;

  const startExpr = dae.getExprData1(rangeExprId);
  const stepExpr = dae.getExprLeft(rangeExprId);
  const stopExpr = dae.getExprRight(rangeExprId);

  const startVal = evalRangeBoundArena(dae, startExpr);
  const stopVal = evalRangeBoundArena(dae, stopExpr);
  const stepVal = stepExpr >= 0 ? (evalRangeBoundArena(dae, stepExpr) ?? 1) : 1;

  if (startVal === null || stopVal === null || stepVal === 0) return expanded;

  const bodyEqs = meta.equations ?? meta.bodyEquations ?? [];
  const maxIter = 10000;
  let iterCount = 0;

  for (let idxVal = startVal; stepVal > 0 ? idxVal <= stopVal + 1e-12 : idxVal >= stopVal - 1e-12; idxVal += stepVal) {
    if (++iterCount > maxIter) break;
    const kExpr = dae.addIntLiteral(Math.round(idxVal));
    for (const bEq of bodyEqs) {
      const rawLhs = "lhs" in bEq ? bEq.lhs : (bEq as any).lhsExprId;
      const rawRhs = "rhs" in bEq ? bEq.rhs : (bEq as any).rhsExprId;
      const substLhs = canonicalizeScalarizedSubscripts(dae, substituteArenaExpr(dae, rawLhs, meta.indexNameId, kExpr));
      const substRhs = canonicalizeScalarizedSubscripts(dae, substituteArenaExpr(dae, rawRhs, meta.indexNameId, kExpr));
      expanded.push({ lhs: substLhs, rhs: substRhs });
    }
  }

  return expanded;
}

/**
 * Build the initialization BLT from a flattened DAE.
 *
 * @param dae The flattened DAE with initialEquations and variables
 * @returns Ordered sequence of init blocks ready for solving
 */
export function buildInitBLT(dae: DAEBuilder): InitBLTResult {
  // 1. Classify knowns vs unknowns
  const knowns = new Set<string>();
  const discreteVarNames = new Set<string>();
  knowns.add("time");

  const paramWithExprs: { varIdx: number; varName: string; exprId: number }[] = [];

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const varName = dae.getVarName(i);
    const variability = dae.getVarVariability(i);
    const varType = dae.getVarType(i);

    if (variability === Variability.Constant) {
      knowns.add(varName);
      continue;
    }
    // Parameters without a binding expression are known if fixed=true;
    // parameters with a binding expression are checked below for dependencies on unknowns.
    if (variability === Variability.Parameter) {
      const exprId = typeof dae.getVarExpression === "function" ? dae.getVarExpression(i) : -1;
      if (typeof exprId === "number" && exprId >= 0) {
        paramWithExprs.push({ varIdx: i, varName, exprId });
        continue;
      }
      if (dae.isVarFixed(i) || dae.hasExplicitVarExpression(i)) {
        knowns.add(varName);
        continue;
      }
    }
    // Fixed=true variables are known (their start value is the solution)
    if (dae.isVarFixed(i)) {
      knowns.add(varName);
      continue;
    }
    // Track discrete variables
    if (varType === VarType.Integer || varType === VarType.Boolean) {
      discreteVarNames.add(varName);
    }
  }

  // Fixed-point propagation: a parameter with a binding expression is known only if all
  // variables referenced in its binding expression are also known at t=0.
  let paramKnownChanged = true;
  while (paramKnownChanged) {
    paramKnownChanged = false;
    for (const p of paramWithExprs) {
      if (knowns.has(p.varName)) continue;
      const refs = new Set<string>();
      collectExprVarNames(p.exprId, dae, refs);
      let allRefsKnown = true;
      for (const r of refs) {
        if (knowns.has(r)) continue;
        const rIdx = dae.getVarIdxByName(r);
        if (rIdx >= 0) {
          allRefsKnown = false;
          break;
        }
        const bracketPos = r.indexOf("[");
        if (bracketPos > 0) {
          const baseName = r.slice(0, bracketPos);
          if (dae.getVarIdxByName(baseName) >= 0 && !knowns.has(baseName)) {
            allRefsKnown = false;
            break;
          }
        }
      }
      if (allRefsKnown) {
        knowns.add(p.varName);
        paramKnownChanged = true;
      }
    }
  }

  // 2. Collect all equations for initialization
  const initEquations: { lhs: number; rhs: number; source: "initial" | "continuous" }[] = [];
  const allDerRefs = new Set<string>();
  const initReferenced = new Set<string>();

  // Any parameter whose binding expression depends on non-known variables (e.g. continuous
  // variables or fixed=false parameters) is solved during initialization via varName = exprId.
  for (const p of paramWithExprs) {
    if (knowns.has(p.varName)) continue;
    if (dae.getVarShape(p.varIdx).length > 0) continue;
    const cl = dae.addNameExpr(p.varName);
    const cr = canonicalizeScalarizedSubscripts(dae, p.exprId);
    initEquations.push({ lhs: cl, rhs: cr, source: "initial" });
    collectExprVarNames(cl, dae, initReferenced);
    collectExprVarNames(cr, dae, initReferenced);
  }

  // Statements from initial algorithm sections (MLS §8.6.1)
  if (dae.initialAlgorithmSections && dae.initialAlgorithmSections.length > 0) {
    for (const sec of dae.initialAlgorithmSections) {
      for (let s = sec.start; s < sec.start + sec.count; s++) {
        if (dae.getStmtKind(s) === StmtKind.Assignment) {
          const lhs = dae.getStmtData1(s);
          const rhs = dae.getStmtLeft(s);
          if (lhs >= 0 && rhs >= 0) {
            initEquations.push({ lhs, rhs, source: "initial" });
            collectExprVarNames(lhs, dae, initReferenced);
            collectExprVarNames(rhs, dae, initReferenced);
          }
        }
      }
    }
  } else if (dae.stmtCount > 0) {
    for (let s = 0; s < dae.stmtCount; s++) {
      if (dae.getStmtKind(s) === StmtKind.Assignment) {
        const lhs = dae.getStmtData1(s);
        const rhs = dae.getStmtLeft(s);
        if (lhs >= 0 && rhs >= 0) {
          initEquations.push({ lhs, rhs, source: "initial" });
          collectExprVarNames(lhs, dae, initReferenced);
          collectExprVarNames(rhs, dae, initReferenced);
        }
      }
    }
  }

  for (let i = 0; i < dae.eqCount; i++) {
    if (dae.isEqRemoved(i)) continue;
    const kind = dae.getEqKind(i);
    const lhs = dae.getEqLhs(i);
    const rhs = dae.getEqRhs(i);
    const isInit = kind === EqKind.InitialSimple || kind === EqKind.InitialFor || isEqInitialFlag(dae, i);
    if (!isInit) continue;

    if (kind === EqKind.InitialSimple || kind === EqKind.Simple || kind === EqKind.Array) {
      const lhsElems = flatElements(lhs, dae);
      const rhsElems = flatElements(rhs, dae);
      const n = Math.max(lhsElems.length, rhsElems.length);
      for (let j = 0; j < n; j++) {
        const l = lhsElems[j] ?? lhsElems[0];
        const r = rhsElems[j] ?? rhsElems[0];
        if (l !== undefined && r !== undefined) {
          const cl = canonicalizeScalarizedSubscripts(dae, l);
          const cr = canonicalizeScalarizedSubscripts(dae, r);
          initEquations.push({ lhs: cl, rhs: cr, source: "initial" });
          collectExprVarNames(cl, dae, initReferenced);
          collectExprVarNames(cr, dae, initReferenced);
        }
      }
    } else if (kind === EqKind.InitialFor || kind === EqKind.For) {
      const expanded = expandForEquationArena(dae, i);
      for (const eq of expanded) {
        initEquations.push({ lhs: eq.lhs, rhs: eq.rhs, source: "initial" });
        collectExprVarNames(eq.lhs, dae, initReferenced);
        collectExprVarNames(eq.rhs, dae, initReferenced);
      }
    }
  }

  for (let i = 0; i < dae.eqCount; i++) {
    if (dae.isEqRemoved(i)) continue;
    const kind = dae.getEqKind(i);
    const lhs = dae.getEqLhs(i);
    const rhs = dae.getEqRhs(i);
    const isInit = kind === EqKind.InitialSimple || kind === EqKind.InitialFor || isEqInitialFlag(dae, i);
    if (isInit || kind === EqKind.When) continue;

    if (kind === EqKind.Array || kind === EqKind.Simple) {
      const eqRefs = new Set<string>();
      collectExprVarNames(lhs, dae, eqRefs);
      collectExprVarNames(rhs, dae, eqRefs);
      for (const r of eqRefs) {
        if (r.startsWith("der(") && r.endsWith(")")) allDerRefs.add(r);
      }
      // Skip continuous ODE evolution equations der(x) = rhs unless der(x) is explicitly
      // constrained by an initial equation (e.g. `initial equation der(x) = 0;`).
      if (dae.getExprKind(lhs) === ExprKind.Der) {
        const derTarget = extractDerName(lhs, dae);
        if (!derTarget || !initReferenced.has(`der(${derTarget})`)) {
          continue;
        }
      }
      const lhsElems = flatElements(lhs, dae);
      const rhsElems = flatElements(rhs, dae);
      const n = Math.max(lhsElems.length, rhsElems.length);
      for (let j = 0; j < n; j++) {
        const l = lhsElems[j] ?? lhsElems[0];
        const r = rhsElems[j] ?? rhsElems[0];
        if (l !== undefined && r !== undefined) {
          initEquations.push({
            lhs: canonicalizeScalarizedSubscripts(dae, l),
            rhs: canonicalizeScalarizedSubscripts(dae, r),
            source: "continuous",
          });
        }
      }
    } else if (kind === EqKind.For) {
      const expanded = expandForEquationArena(dae, i);
      for (const eq of expanded) {
        const eqRefs = new Set<string>();
        collectExprVarNames(eq.lhs, dae, eqRefs);
        collectExprVarNames(eq.rhs, dae, eqRefs);
        for (const r of eqRefs) {
          if (r.startsWith("der(") && r.endsWith(")")) allDerRefs.add(r);
        }
        if (dae.getExprKind(eq.lhs) === ExprKind.Der) {
          const derTarget = extractDerName(eq.lhs, dae);
          if (!derTarget || !initReferenced.has(`der(${derTarget})`)) {
            continue;
          }
        }
        initEquations.push({ lhs: eq.lhs, rhs: eq.rhs, source: "continuous" });
      }
    } else if (kind === EqKind.If) {
      const meta = dae.getIfEquationMeta(i);
      if (
        meta &&
        meta.thenEquations.length > 0 &&
        meta.elseEquations &&
        meta.elseEquations.length === meta.thenEquations.length
      ) {
        const elseIfs = meta.elseIfClauses ?? [];
        if (elseIfs.every((c) => c.bodyEquations.length === meta.thenEquations.length)) {
          const sameLhs = (a: number, b: number) =>
            dae.getExprKind(a) === ExprKind.Name &&
            dae.getExprKind(b) === ExprKind.Name &&
            dae.getExprData1(a) === dae.getExprData1(b);
          const toRes = (eq: { lhsExprId: number; rhsExprId: number }) =>
            dae.addBinaryExpr(
              BinOp.Sub,
              canonicalizeScalarizedSubscripts(dae, eq.lhsExprId),
              canonicalizeScalarizedSubscripts(dae, eq.rhsExprId),
            );
          for (let k = 0; k < meta.thenEquations.length; k++) {
            const tEq = meta.thenEquations[k]!;
            const eEq = meta.elseEquations[k]!;
            if (tEq.kind !== EqKind.Simple || eEq.kind !== EqKind.Simple) continue;
            const allSame =
              sameLhs(tEq.lhsExprId, eEq.lhsExprId) &&
              elseIfs.every((c) => sameLhs(tEq.lhsExprId, c.bodyEquations[k]!.lhsExprId));
            let combinedLhs: number;
            let combinedRhs: number;
            if (allSame) {
              let rhsChain = canonicalizeScalarizedSubscripts(dae, eEq.rhsExprId);
              for (let ci = elseIfs.length - 1; ci >= 0; ci--) {
                rhsChain = dae.addIfElseExpr(
                  canonicalizeScalarizedSubscripts(dae, elseIfs[ci]!.conditionExprId),
                  canonicalizeScalarizedSubscripts(dae, elseIfs[ci]!.bodyEquations[k]!.rhsExprId),
                  rhsChain,
                );
              }
              combinedLhs = canonicalizeScalarizedSubscripts(dae, tEq.lhsExprId);
              combinedRhs = dae.addIfElseExpr(
                canonicalizeScalarizedSubscripts(dae, meta.conditionExprId),
                canonicalizeScalarizedSubscripts(dae, tEq.rhsExprId),
                rhsChain,
              );
            } else {
              let resChain = toRes(eEq);
              for (let ci = elseIfs.length - 1; ci >= 0; ci--) {
                resChain = dae.addIfElseExpr(
                  canonicalizeScalarizedSubscripts(dae, elseIfs[ci]!.conditionExprId),
                  toRes(elseIfs[ci]!.bodyEquations[k]!),
                  resChain,
                );
              }
              combinedLhs = dae.addRealLiteral(0.0);
              combinedRhs = dae.addIfElseExpr(
                canonicalizeScalarizedSubscripts(dae, meta.conditionExprId),
                toRes(tEq),
                resChain,
              );
            }
            const eqRefs = new Set<string>();
            collectExprVarNames(combinedLhs, dae, eqRefs);
            collectExprVarNames(combinedRhs, dae, eqRefs);
            for (const r of eqRefs) {
              if (r.startsWith("der(") && r.endsWith(")")) allDerRefs.add(r);
            }
            if (dae.getExprKind(combinedLhs) === ExprKind.Der) {
              const derTarget = extractDerName(combinedLhs, dae);
              if (!derTarget || !initReferenced.has(`der(${derTarget})`)) {
                continue;
              }
            }
            initEquations.push({ lhs: combinedLhs, rhs: combinedRhs, source: "continuous" });
          }
        }
      }
    }
  }

  if (initEquations.length === 0) {
    return { blocks: [], knowns, unknowns: new Set(), equationCount: 0, matchedEquationCount: 0 };
  }

  // 3. Determine unknowns: all referenced vars that are not known
  const allReferenced = new Set<string>();
  for (const eq of initEquations) {
    collectExprVarNames(eq.lhs, dae, allReferenced);
    collectExprVarNames(eq.rhs, dae, allReferenced);
  }
  for (const r of allReferenced) {
    if (r.startsWith("der(") && r.endsWith(")")) allDerRefs.add(r);
  }

  const unknowns = new Set<string>();
  for (const name of allReferenced) {
    if (knowns.has(name)) continue;
    if (
      name.startsWith("der(") ||
      dae.getVarIdxByName(name) >= 0 ||
      Boolean(dae.getNamedArrayShape && dae.getNamedArrayShape(name)?.length)
    ) {
      unknowns.add(name);
    }
  }

  // Expand array unknowns (including multi-dimensional arrays)
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const varName = dae.getVarName(i);
    const shape = dae.getVarShape(i);
    if (shape.length > 0 && unknowns.has(varName)) {
      const idxStrings = expandMultiDimIndices(shape);
      for (const idxStr of idxStrings) {
        const elemName = `${varName}[${idxStr}]`;
        if (!knowns.has(elemName)) unknowns.add(elemName);
      }
    }
  }

  // Filter out 0-unknown equations and duplicate simple Name=Name equations across initial/continuous sections
  const seenSimplePairs = new Set<string>();
  let writeIdx = 0;
  for (let i = 0; i < initEquations.length; i++) {
    const eq = initEquations[i]!;
    const refs = new Set<string>();
    collectExprVarNames(eq.lhs, dae, refs);
    collectExprVarNames(eq.rhs, dae, refs);
    let hasUnknown = false;
    for (const r of refs) {
      if (unknowns.has(r)) {
        hasUnknown = true;
        break;
      }
    }
    if (!hasUnknown) continue;
    if (dae.getExprKind(eq.lhs) === ExprKind.Name && dae.getExprKind(eq.rhs) === ExprKind.Name) {
      const lName = dae.interner.resolve(dae.getExprData1(eq.lhs)) ?? "";
      const rName = dae.interner.resolve(dae.getExprData1(eq.rhs)) ?? "";
      if (lName === rName) continue;
      const pairKey = lName < rName ? `${lName}==${rName}` : `${rName}==${lName}`;
      if (seenSimplePairs.has(pairKey)) continue;
      seenSimplePairs.add(pairKey);
    }
    initEquations[writeIdx++] = eq;
  }
  initEquations.length = writeIdx;

  // If there are more unknowns than initialization equations (e.g. states without explicit
  // `fixed = true` and without corresponding `initial equation`s), fix state variables at
  // their `start` values per MLS §8.6.1.
  // CRITICAL: NEVER fix states whose derivative or value is explicitly constrained in initial equations!
  if (unknowns.size > initEquations.length) {
    for (const allowExplicitFixedFalse of [false, true]) {
      if (unknowns.size <= initEquations.length) break;
      for (const ref of allDerRefs) {
        if (unknowns.size <= initEquations.length) break;
        if (ref.startsWith("der(") && ref.endsWith(")")) {
          const stateName = ref.slice(4, -1);
          if (initReferenced.has(stateName) || initReferenced.has(ref)) {
            continue;
          }
          if (!unknowns.has(stateName)) continue;
          if (!allowExplicitFixedFalse) {
            const vIdx = dae.getVarIdxByName(stateName);
            const hasExplicitFixedFalse =
              vIdx >= 0 &&
              !dae.isVarFixed(vIdx) &&
              (dae.getVarAttrExprId(vIdx, "fixed") !== undefined ||
                (typeof dae.getVarAttrExpr === "function" && dae.getVarAttrExpr(vIdx, VarAttrKind.Fixed) >= 0));
            if (hasExplicitFixedFalse) continue;
          }
          unknowns.delete(stateName);
          knowns.add(stateName);
        }
      }
    }
  }

  if (unknowns.size === 0) {
    return { blocks: [], knowns, unknowns, equationCount: initEquations.length, matchedEquationCount: 0 };
  }

  // 4. Build bipartite graph: equation index → set of unknown variable names
  const eqDeps = new Map<number, Set<string>>();
  for (let i = 0; i < initEquations.length; i++) {
    const eq = initEquations[i]!;
    const refs = new Set<string>();
    collectExprVarNames(eq.lhs, dae, refs);
    collectExprVarNames(eq.rhs, dae, refs);
    const filtered = new Set<string>();
    for (const r of refs) {
      if (unknowns.has(r)) filtered.add(r);
    }
    eqDeps.set(i, filtered);
  }

  // 5. Maximum bipartite matching (Hopcroft-Karp style DFS)
  const unknownList = Array.from(unknowns);
  const matchVarToEq = new Map<string, number>();
  const matchEqToVar = new Map<number, string>();

  for (let u = 0; u < initEquations.length; u++) {
    const visited = new Set<string>();
    augmentInit(u, eqDeps, matchVarToEq, matchEqToVar, visited);
  }

  // 6. Build directed graph for Tarjan SCC
  const getVarDeps = (v: string): string[] => {
    const eqIdx = matchVarToEq.get(v);
    if (eqIdx === undefined) return [];
    return Array.from(eqDeps.get(eqIdx) ?? []).filter((dep) => dep !== v);
  };

  let indexCounter = 0;
  const indexMap = new Map<string, number>();
  const lowlinkMap = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string): void => {
    indexMap.set(v, indexCounter);
    lowlinkMap.set(v, indexCounter);
    indexCounter++;
    stack.push(v);
    onStack.add(v);

    for (const w of getVarDeps(v)) {
      if (!indexMap.has(w)) {
        strongconnect(w);
        lowlinkMap.set(v, Math.min(lowlinkMap.get(v)!, lowlinkMap.get(w)!));
      } else if (onStack.has(w)) {
        lowlinkMap.set(v, Math.min(lowlinkMap.get(v)!, indexMap.get(w)!));
      }
    }

    if (lowlinkMap.get(v) === indexMap.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        const popped = stack.pop();
        if (popped === undefined) break;
        w = popped;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };

  for (const v of unknownList) {
    if (matchVarToEq.has(v) && !indexMap.has(v)) {
      strongconnect(v);
    }
  }

  // 7. Convert SCCs to init blocks
  const blocks: InitBlock[] = [];
  const solvedVars = new Set<string>();

  const hasUnsolvedDeps = (deps: Set<string>, exclude: string): boolean => {
    for (const d of deps) {
      if (d !== exclude && !solvedVars.has(d)) return true;
    }
    return false;
  };

  for (const scc of sccs) {
    if (scc.length === 1) {
      const varName = scc[0]!;
      const eqIdx = matchVarToEq.get(varName);
      if (eqIdx === undefined) continue;
      const eq = initEquations[eqIdx]!;
      const deps = eqDeps.get(eqIdx) ?? new Set();

      const lhsName = extractSimpleName(eq.lhs, dae);
      const rhsName = extractSimpleName(eq.rhs, dae);
      const derLhs = extractDerName(eq.lhs, dae);
      const derRhs = extractDerName(eq.rhs, dae);

      const lhsRefs = new Set<string>();
      collectExprVarNames(eq.lhs, dae, lhsRefs);
      const rhsRefs = new Set<string>();
      collectExprVarNames(eq.rhs, dae, rhsRefs);

      if (lhsName === varName && !rhsRefs.has(varName) && !hasUnsolvedDeps(deps, varName)) {
        blocks.push({ type: "explicit", target: varName, expr: eq.rhs });
        solvedVars.add(varName);
      } else if (rhsName === varName && !lhsRefs.has(varName) && !hasUnsolvedDeps(deps, varName)) {
        blocks.push({ type: "explicit", target: varName, expr: eq.lhs });
        solvedVars.add(varName);
      } else if (derLhs && `der(${derLhs})` === varName && !rhsRefs.has(varName) && !hasUnsolvedDeps(deps, varName)) {
        blocks.push({ type: "explicit", target: varName, expr: eq.rhs });
        solvedVars.add(varName);
      } else if (derRhs && `der(${derRhs})` === varName && !lhsRefs.has(varName) && !hasUnsolvedDeps(deps, varName)) {
        blocks.push({ type: "explicit", target: varName, expr: eq.lhs });
        solvedVars.add(varName);
      } else {
        blocks.push({
          type: "implicit",
          unknowns: [varName],
          equations: [{ lhs: eq.lhs, rhs: eq.rhs }],
          hasDiscreteVars: discreteVarNames.has(varName),
        });
        solvedVars.add(varName);
      }
    } else {
      const loopEqs: { lhs: number; rhs: number }[] = [];
      let hasDiscrete = false;
      for (const v of scc) {
        const eqIdx = matchVarToEq.get(v);
        if (eqIdx !== undefined) {
          const eq = initEquations[eqIdx]!;
          loopEqs.push({ lhs: eq.lhs, rhs: eq.rhs });
        }
        if (discreteVarNames.has(v)) hasDiscrete = true;
        solvedVars.add(v);
      }
      blocks.push({
        type: "implicit",
        unknowns: scc,
        equations: loopEqs,
        hasDiscreteVars: hasDiscrete,
      });
    }
  }

  return {
    blocks,
    knowns,
    unknowns,
    equationCount: initEquations.length,
    matchedEquationCount: matchVarToEq.size,
  };
}

function augmentInit(
  eqIdx: number,
  eqDeps: Map<number, Set<string>>,
  matchVarToEq: Map<string, number>,
  matchEqToVar: Map<number, string>,
  visited: Set<string>,
): boolean {
  const deps = eqDeps.get(eqIdx);
  if (!deps) return false;

  for (const v of deps) {
    if (visited.has(v)) continue;
    visited.add(v);

    const prevEq = matchVarToEq.get(v);
    if (prevEq === undefined || augmentInit(prevEq, eqDeps, matchVarToEq, matchEqToVar, visited)) {
      matchVarToEq.set(v, eqIdx);
      matchEqToVar.set(eqIdx, v);
      return true;
    }
  }
  return false;
}

function extractSimpleName(exprId: number, arena: DAEBuilder): string | null {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    return arena.interner.resolve(arena.getExprData1(exprId));
  }
  if (kind === ExprKind.Subscript) {
    return resolveConstSubscriptName(exprId, arena);
  }
  return null;
}

function extractDerName(exprId: number, arena: DAEBuilder): string | null {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Der) {
    const operand = arena.getExprData1(exprId);
    if (operand >= 0) {
      if (arena.getExprKind(operand) === ExprKind.Name) {
        return arena.interner.resolve(arena.getExprData1(operand));
      }
      if (arena.getExprKind(operand) === ExprKind.Subscript) {
        return resolveConstSubscriptName(operand, arena);
      }
    }
  } else if (kind === ExprKind.Call) {
    const nameId = arena.getExprData1(exprId);
    const funcName = arena.interner.resolve(nameId);
    const firstArgId = arena.getExprLeft(exprId);
    const argCount = arena.getExprRight(exprId);
    if (funcName === "der" && argCount === 1 && firstArgId >= 0) {
      const argExprId = firstArgId;
      if (arena.getExprKind(argExprId) === ExprKind.Name) {
        return arena.interner.resolve(arena.getExprData1(argExprId));
      }
      if (arena.getExprKind(argExprId) === ExprKind.Subscript) {
        return resolveConstSubscriptName(argExprId, arena);
      }
    }
  }
  return null;
}

export function _depsExcluding(deps: Set<string>, exclude: string): boolean {
  for (const d of deps) {
    if (d !== exclude) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Initial Equation Solving: LU & Newton-Raphson with Sparse Analytical Jacobian
// ─────────────────────────────────────────────────────────────────────────

function solveLU(A: number[][], b: number[], n: number): number[] {
  const flatA = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const row = A[i];
    if (row) {
      const offset = i * n;
      for (let j = 0; j < n; j++) {
        flatA[offset + j] = row[j] ?? 0;
      }
    }
  }
  const fact = luFactorFlat(flatA, n);
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) rhs[i] = b[i] ?? 0;
  luSolveFlat(fact, rhs);
  return Array.from(rhs);
}

function collectExprNameIds(arena: DAEBuilder, exprId: number, nameIds: Set<number>): void {
  if (exprId < 0) return;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    nameIds.add(arena.getExprData1(exprId));
    return;
  }
  const data1 = arena.getExprData1(exprId);
  const left = arena.getExprLeft(exprId);
  const right = arena.getExprRight(exprId);

  if (kind === ExprKind.Der) {
    if (arena.getExprKind(data1) === ExprKind.Name) {
      const nameId = arena.getExprData1(data1);
      const name = arena.interner.resolve(nameId);
      if (name) {
        const derNameId = arena.interner.intern(`der(${name})`);
        nameIds.add(derNameId);
      }
    } else if (arena.getExprKind(data1) === ExprKind.Subscript) {
      const subName = resolveConstSubscriptName(data1, arena);
      if (subName) {
        nameIds.add(arena.interner.intern(`der(${subName})`));
      }
      collectExprNameIds(arena, data1, nameIds);
    } else {
      collectExprNameIds(arena, data1, nameIds);
    }
    return;
  }

  switch (kind) {
    case ExprKind.Unary:
    case ExprKind.Negate:
      collectExprNameIds(arena, left, nameIds);
      break;
    case ExprKind.Pre:
      collectExprNameIds(arena, data1, nameIds);
      break;
    case ExprKind.Binary:
      collectExprNameIds(arena, left, nameIds);
      collectExprNameIds(arena, right, nameIds);
      break;
    case ExprKind.IfElse:
      collectExprNameIds(arena, data1, nameIds);
      collectExprNameIds(arena, left, nameIds);
      collectExprNameIds(arena, right, nameIds);
      break;
    case ExprKind.Call: {
      const argCount = right;
      if (argCount > 0) collectExprNameIds(arena, left, nameIds);
      for (let i = 1; i < argCount; i++) {
        collectExprNameIds(arena, arena.getExprLeft(exprId + i), nameIds);
      }
      break;
    }
    case ExprKind.Subscript: {
      const subName = resolveConstSubscriptName(exprId, arena);
      if (subName) {
        nameIds.add(arena.interner.intern(subName));
      }
      collectExprNameIds(arena, data1, nameIds);
      if (right > 0) collectExprNameIds(arena, left, nameIds);
      for (let i = 1; i < right; i++) {
        collectExprNameIds(arena, arena.getExprLeft(exprId + i), nameIds);
      }
      break;
    }
    case ExprKind.ArrayCtor: {
      const count = data1;
      if (count > 0) collectExprNameIds(arena, left, nameIds);
      for (let i = 1; i < count; i++) {
        collectExprNameIds(arena, arena.getExprLeft(exprId + i), nameIds);
      }
      break;
    }
    case ExprKind.Range:
      collectExprNameIds(arena, data1, nameIds);
      if (left >= 0) collectExprNameIds(arena, left, nameIds);
      collectExprNameIds(arena, right, nameIds);
      break;
    default:
      break;
  }
}

/**
 * Solve the initial equations natively on the DAEBuilder using Newton-Raphson
 * with structural sparsity, exact symbolic Jacobians, and homotopy continuation fallback.
 *
 * @param arena The DAEBuilder containing the equations.
 * @param initialValues A Float64Array populated with start values and parameters.
 * @returns Solver result with computed initial values.
 */
function containsHomotopyCall(arena: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Call) {
    const nameId = arena.getExprData1(exprId);
    if (arena.interner.resolve(nameId) === "homotopy") return true;
    const firstArgId = arena.getExprLeft(exprId);
    const argCount = arena.getExprRight(exprId);
    for (let i = 0; i < argCount; i++) {
      const argId = i === 0 ? firstArgId : arena.getExprLeft(exprId + i);
      if (containsHomotopyCall(arena, argId)) return true;
    }
    return false;
  }
  if (kind === ExprKind.Binary) {
    return (
      containsHomotopyCall(arena, arena.getExprLeft(exprId)) || containsHomotopyCall(arena, arena.getExprRight(exprId))
    );
  }
  if (kind === ExprKind.Negate || kind === ExprKind.Unary) {
    return containsHomotopyCall(arena, arena.getExprLeft(exprId));
  }
  if (kind === ExprKind.Der || kind === ExprKind.Pre) {
    return containsHomotopyCall(arena, arena.getExprData1(exprId));
  }
  if (kind === ExprKind.IfElse) {
    return (
      containsHomotopyCall(arena, arena.getExprData1(exprId)) ||
      containsHomotopyCall(arena, arena.getExprLeft(exprId)) ||
      containsHomotopyCall(arena, arena.getExprRight(exprId))
    );
  }
  return false;
}

function evaluateInitJacobianEntry(
  arena: DAEBuilder,
  resExprId: number,
  jExprId: number,
  zj: number,
  rBase: number,
  valuesByStringId: Float64Array,
): number {
  let val = jExprId !== -1 ? evaluateArenaRuntime(arena, jExprId, valuesByStringId) : 0;
  if ((!Number.isFinite(val) || val === 0) && resExprId !== -1 && zj >= 0 && Number.isFinite(rBase)) {
    const orig = valuesByStringId[zj] ?? 0;
    const eps = 1.4901161193847656e-8 * Math.max(Math.abs(orig), 1.0);
    valuesByStringId[zj] = orig + eps;
    try {
      const rPert = evaluateArenaRuntime(arena, resExprId, valuesByStringId);
      if (Number.isFinite(rPert)) {
        val = (rPert - rBase) / eps;
      }
    } catch {
      // ignore domain errors during finite difference probe
    } finally {
      valuesByStringId[zj] = orig;
    }
  }
  return Number.isFinite(val) ? val : 0;
}

function runOperatorHomotopy(
  arena: DAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  jacobianExprIds: (number | -1)[][],
  sparsityPattern: Set<number>[],
  unknownList: number[],
  nSolve: number,
  tol: number,
  bounds?: VariableBoundsAndNominal[],
): boolean {
  let lambda = 0.0;
  let lambdaStep = 0.25;
  const maxTotalIter = 100;
  let totalIter = 0;

  try {
    arena.homotopyLambda = 0.0;
    // Step 0: solve simplified system at lambda = 0
    let convergedAtLambda = runNewton(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      25,
      tol * 10,
      bounds,
    );

    while (lambda < 1.0 && totalIter < maxTotalIter) {
      const targetLambda = Math.min(lambda + lambdaStep, 1.0);
      arena.homotopyLambda = targetLambda;
      totalIter++;

      convergedAtLambda = runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        20,
        tol,
        bounds,
      );

      if (convergedAtLambda) {
        lambda = targetLambda;
        lambdaStep = Math.min(lambdaStep * 1.5, 0.5);
      } else {
        lambdaStep *= 0.5;
        if (lambdaStep < 1e-4) break;
      }
    }
  } finally {
    arena.homotopyLambda = undefined;
  }

  return lambda >= 1.0 - 1e-6;
}

function runSbbFallback(
  arena: DAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  unknownList: number[],
  nSolve: number,
  tol = 1e-4,
): boolean {
  if (nSolve === 0 || nSolve > 8) return false;

  const unknownNames = unknownList.map((id) => arena.interner.resolve(id));
  const box: DomainBox = new Map();

  for (let i = 0; i < nSolve; i++) {
    const nameId = unknownList[i]!;
    const name = unknownNames[i]!;
    const currentVal = result.valuesByStringId[nameId] ?? 0;
    const varIdx = arena.getVarIdxByName(name);
    let min = -1e4;
    let max = 1e4;
    if (varIdx >= 0) {
      const minAttr = getAttrValue(arena, varIdx, "min", result.valuesByStringId);
      const maxAttr = getAttrValue(arena, varIdx, "max", result.valuesByStringId);
      if (minAttr !== undefined && Number.isFinite(minAttr)) min = minAttr;
      if (maxAttr !== undefined && Number.isFinite(maxAttr)) max = maxAttr;
    }
    if (min === -1e4 && max === 1e4) {
      min = currentVal - 1000;
      max = currentVal + 1000;
    }
    box.set(name, new Interval(min, max));
  }

  const objTape = new StaticTapeBuilder(arena.interner);
  let sumSqIdx = -1;
  const constraintTapes: { ops: StaticTapeBuilder; outputIndex: number }[] = [];

  for (let i = 0; i < nSolve; i++) {
    const exprId = residualExprIds[i] ?? -1;
    if (exprId === -1) continue;
    const rIdx = objTape.addExpression(exprId, arena);
    const sqIdx = objTape.pushScalarOp(TapeOpKind.Mul, rIdx, rIdx);
    if (sumSqIdx === -1) {
      sumSqIdx = sqIdx;
    } else {
      sumSqIdx = objTape.pushScalarOp(TapeOpKind.Add, sumSqIdx, sqIdx);
    }

    const cTape = new StaticTapeBuilder(arena.interner);
    const cIdx = cTape.addExpression(exprId, arena);
    constraintTapes.push({ ops: cTape, outputIndex: cIdx });
  }

  if (sumSqIdx === -1) return false;

  const sbbRes = solveSBB({ ops: objTape, outputIndex: sumSqIdx }, constraintTapes, unknownNames, box, {
    absTol: tol,
    maxNodes: 500,
  });

  if (sbbRes.objectiveValue < tol) {
    for (let i = 0; i < nSolve; i++) {
      const name = unknownNames[i]!;
      const nameId = unknownList[i]!;
      const val = sbbRes.solution.get(name);
      if (val !== undefined && isFinite(val)) {
        result.valuesByStringId[nameId] = val;
      }
    }
    return true;
  }

  return false;
}

/**
 * Solve an implicit algebraic loop block using sparse Newton with Armijo line search,
 * operator homotopy, auto homotopy, and sBB fallback.
 */
export function solveImplicitBlock(
  arena: DAEBuilder,
  block: ImplicitInitBlock,
  valuesByStringId: Float64Array,
  tol = 1e-10,
): { converged: boolean; iterations: number; residualNorm: number } {
  const result: ArenaInitSolverResult = {
    valuesByStringId,
    iterations: 0,
    residualNorm: 0,
    converged: false,
  };

  const unknownList = block.unknowns.map((name) => arena.interner.intern(name));
  const residualExprIds = block.equations.map((eq) => arena.addBinaryExpr(BinOp.Sub, eq.lhs, eq.rhs));
  const nSolve = Math.min(unknownList.length, residualExprIds.length);
  if (nSolve === 0) return { converged: true, iterations: 0, residualNorm: 0 };

  const initialValuesSnapshot = new Float64Array(nSolve);
  for (let i = 0; i < nSolve; i++) {
    initialValuesSnapshot[i] = valuesByStringId[unknownList[i]!] ?? 0;
  }

  const sparsityPattern: Set<number>[] = [];
  for (let i = 0; i < nSolve; i++) {
    const exprId = residualExprIds[i] ?? -1;
    const deps = new Set<number>();
    collectExprNameIds(arena, exprId, deps);
    const nonzeroCols = new Set<number>();
    for (let j = 0; j < nSolve; j++) {
      if (deps.has(unknownList[j]!)) nonzeroCols.add(j);
    }
    sparsityPattern.push(nonzeroCols);
  }

  const jacobianExprIds: (number | -1)[][] = [];
  for (let i = 0; i < nSolve; i++) {
    const row: (number | -1)[] = new Array(nSolve).fill(-1);
    const Ri = residualExprIds[i] ?? -1;
    if (Ri !== -1) {
      for (const j of sparsityPattern[i]!) {
        row[j] = differentiateArenaExpressionWrt(arena, Ri, unknownList[j]!);
      }
    }
    jacobianExprIds.push(row);
  }

  // Extract variable bounds and nominal values for numerical conditioning
  const varBounds = extractVariableBoundsAndNominal(arena, unknownList, valuesByStringId);

  // Check if system explicitly uses homotopy(actual, simplified) per MLS §3.7.2
  const hasHomotopy = block.equations.some(
    (eq) => containsHomotopyCall(arena, eq.lhs) || containsHomotopyCall(arena, eq.rhs),
  );

  let converged = false;
  if (hasHomotopy) {
    // Modelica Language Specification MLS §3.7.2:
    // When homotopy(actual, simplified) is present, initialize starting from the
    // simplified model (lambda = 0) and continue toward the actual model (lambda = 1).
    converged = runOperatorHomotopy(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      tol,
      varBounds,
    );
    if (converged) {
      runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        10,
        tol,
        varBounds,
      );
    }
  }

  if (!converged) {
    // Tier 1 default: Sparse Damped Newton with Armijo Line Search, Nominal Scaling & Box Bounds
    converged = runNewton(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      50,
      tol,
      varBounds,
    );
  }

  // Tier 3: Adaptive Pseudo-Arc-Length Homotopy Continuation (Keller's Method for Limit Points)
  if (!converged) {
    const snapshotF64 = new Float64Array(arena.interner.size + 16);
    for (let i = 0; i < nSolve; i++) {
      const zj = unknownList[i]!;
      snapshotF64[zj] = initialValuesSnapshot[i]!;
    }
    converged = runArcLengthHomotopy(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      tol,
      snapshotF64,
      varBounds,
    );
    if (converged) {
      runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        5,
        tol,
        varBounds,
      );
    }
  }

  // Tier 4: Switched Evolution Pseudo-Transient Relaxation (False Transient Continuation)
  if (!converged) {
    converged = runPseudoTransientRelaxation(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      tol,
      varBounds,
    );
    if (converged) {
      runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        5,
        tol,
        varBounds,
      );
    }
  }

  // Tier 5: sBB Fallback (for small stubborn non-convex loops <= 8 variables)
  if (!converged && nSolve <= 8) {
    converged = runSbbFallback(arena, result, residualExprIds, unknownList, nSolve, 1e-4);
    if (converged) {
      runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        5,
        tol,
        varBounds,
      );
    }
  }

  if (!converged) {
    for (let i = 0; i < nSolve; i++) {
      valuesByStringId[unknownList[i]!] = initialValuesSnapshot[i]!;
    }
  }

  result.converged = converged;
  return { converged, iterations: result.iterations, residualNorm: result.residualNorm };
}

/**
 * Solve the initial equations natively on the DAEBuilder using block-decomposed Init BLT,
 * sparse analytical Newton with Armijo backtracking line search, operator homotopy, and sBB fallback.
 *
 * @param arena The DAEBuilder containing the equations.
 * @param initialValues A Float64Array populated with start values and parameters.
 * @returns Solver result with computed initial values.
 */
export function solveInitialEquationsArena(arena: DAEBuilder, initialValues: Float64Array): ArenaInitSolverResult {
  (arena as any)._isInitialPhase = true;
  try {
    return solveInitialEquationsArenaInner(arena, initialValues);
  } finally {
    (arena as any)._isInitialPhase = false;
  }
}

function solveInitialEquationsArenaInner(arena: DAEBuilder, initialValues: Float64Array): ArenaInitSolverResult {
  const result: ArenaInitSolverResult = {
    valuesByStringId: new Float64Array(initialValues),
    iterations: 0,
    residualNorm: 0,
    converged: true,
  };

  if (arena.initialAlgorithmSections && arena.initialAlgorithmSections.length > 0) {
    for (const sec of arena.initialAlgorithmSections) {
      executeArenaStatements(arena, sec.start, sec.count, result.valuesByStringId);
    }
  }

  // Pre-collect variable start/fixed metadata and simple alias pairs (u = v) once
  const envLen = result.valuesByStringId.length;
  const isLocked = new Uint8Array(envLen);
  const hasExplicitStart = new Uint8Array(envLen);
  const aliasPairs: number[] = [];

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const uId = arena.getVarNameId(i);
    if (uId >= 0 && uId < envLen) {
      const variability = arena.getVarVariability(i);
      if (
        variability === Variability.Constant ||
        arena.isVarFixed(i) ||
        (variability === Variability.Parameter && arena.hasExplicitVarExpression(i))
      ) {
        isLocked[uId] = 1;
        hasExplicitStart[uId] = 1;
      } else if (
        arena.getVarAttrExprId(i, "start") !== undefined ||
        (typeof arena.getVarAttrExpr === "function" && arena.getVarAttrExpr(i, VarAttrKind.Start) > 0) ||
        arena.hasExplicitVarExpression(i)
      ) {
        hasExplicitStart[uId] = 1;
      }
    }
    const exprId = arena.getVarExpression(i);
    if (exprId !== undefined && exprId >= 0 && arena.getExprKind(exprId) === ExprKind.Name) {
      const vId = arena.getExprData1(exprId);
      if (uId >= 0 && vId >= 0 && uId !== vId) {
        aliasPairs.push(uId, vId);
      }
    }
  }

  for (let i = 0; i < arena.eqCount; i++) {
    if (arena.isEqRemoved(i)) continue;
    if (arena.getEqKind(i) === EqKind.Simple) {
      const lhs = arena.getEqLhs(i);
      const rhs = arena.getEqRhs(i);
      if (arena.getExprKind(lhs) === ExprKind.Name && arena.getExprKind(rhs) === ExprKind.Name) {
        const uId = arena.getExprData1(lhs);
        const vId = arena.getExprData1(rhs);
        if (uId >= 0 && vId >= 0 && uId !== vId) {
          aliasPairs.push(uId, vId);
        }
      }
    }
  }

  // Transitive propagation across bindings and simple equality equations u = v
  let changed = true;
  let pass = 0;
  while (changed && pass < 10) {
    changed = false;
    pass++;
    for (let p = 0; p < aliasPairs.length; p += 2) {
      const uId = aliasPairs[p]!;
      const vId = aliasPairs[p + 1]!;
      const uVal = result.valuesByStringId[uId] ?? 0;
      const vVal = result.valuesByStringId[vId] ?? 0;
      const uExp = hasExplicitStart[uId] ?? 0;
      const vExp = hasExplicitStart[vId] ?? 0;

      if (uExp > vExp && !isLocked[vId]) {
        if (vVal !== uVal || vExp === 0) {
          result.valuesByStringId[vId] = uVal;
          hasExplicitStart[vId] = 1;
          changed = true;
        }
      } else if (vExp > uExp && !isLocked[uId]) {
        if (uVal !== vVal || uExp === 0) {
          result.valuesByStringId[uId] = vVal;
          hasExplicitStart[uId] = 1;
          changed = true;
        }
      } else if (uVal !== 0 && vVal === 0 && !isLocked[vId]) {
        result.valuesByStringId[vId] = uVal;
        changed = true;
      } else if (vVal !== 0 && uVal === 0 && !isLocked[uId]) {
        result.valuesByStringId[uId] = vVal;
        changed = true;
      }
    }
  }

  // 0. Attempt block-by-block BLT initialization first
  try {
    const initBlt = buildInitBLT(arena);
    if (initBlt.blocks.length > 0) {
      let allConverged = true;
      let matchedCount = 0;
      for (const block of initBlt.blocks) {
        if (block.type === "explicit") {
          matchedCount++;
          const targetId = arena.interner.intern(block.target);
          result.valuesByStringId[targetId] = evaluateArenaRuntime(arena, block.expr, result.valuesByStringId);
        } else if (block.type === "implicit") {
          matchedCount += block.unknowns.length;
          const blockRes = solveImplicitBlock(arena, block, result.valuesByStringId, 1e-10);
          result.iterations += blockRes.iterations;
          result.residualNorm = Math.max(result.residualNorm, blockRes.residualNorm);
          if (!blockRes.converged) {
            allConverged = false;
          }
        }
      }
      const allEqsMatched = (initBlt.matchedEquationCount ?? matchedCount) >= (initBlt.equationCount ?? 0);
      if (allConverged && (matchedCount >= initBlt.unknowns.size || allEqsMatched)) {
        result.converged = true;
        return result;
      }
    } else if (initBlt.unknowns.size === 0) {
      result.converged = true;
      return result;
    }
  } catch {
    // If BLT encounters an unsupported structure, fall back to monolithic solver below
  }

  // 1. Collect initial equations (Monolithic fallback, including expanded For/InitialFor)
  const initialEqPairs: { lhs: number; rhs: number }[] = [];
  let explicitInitialCount = 0;
  for (let i = 0; i < arena.eqCount; i++) {
    const kind = arena.getEqKind(i);
    const isInit = kind === EqKind.InitialSimple || kind === EqKind.InitialFor || isEqInitialFlag(arena, i);
    if (kind === EqKind.InitialSimple || kind === EqKind.Simple || kind === EqKind.Array) {
      const eqLhs = arena.getEqLhs(i);
      if (!isInit && arena.getExprKind(eqLhs) === ExprKind.Der) continue;
      const lhsElems = flatElements(eqLhs, arena);
      const rhsElems = flatElements(arena.getEqRhs(i), arena);
      const n = Math.max(lhsElems.length, rhsElems.length);
      for (let j = 0; j < n; j++) {
        const l = lhsElems[j] ?? lhsElems[0];
        const r = rhsElems[j] ?? rhsElems[0];
        if (l !== undefined && r !== undefined) {
          initialEqPairs.push({
            lhs: canonicalizeScalarizedSubscripts(arena, l),
            rhs: canonicalizeScalarizedSubscripts(arena, r),
          });
          if (isInit) explicitInitialCount++;
        }
      }
    } else if (kind === EqKind.InitialFor || kind === EqKind.For) {
      const expanded = expandForEquationArena(arena, i);
      for (const eq of expanded) {
        initialEqPairs.push(eq);
        if (isInit) explicitInitialCount++;
      }
    }
  }
  if (initialEqPairs.length === 0) return result;

  // 2. Identify unknowns
  const stateVars = new Set<number>();
  for (let i = 0; i < arena.exprCount; i++) {
    if (arena.getExprKind(i) === ExprKind.Der) {
      const argId = arena.getExprData1(i);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const nameId = arena.getExprData1(argId);
        const name = arena.interner.resolve(nameId);
        if (name) {
          const varIdx = arena.getVarIdxByName(name);
          if (varIdx !== -1) {
            stateVars.add(varIdx);
          }
        }
      } else if (arena.getExprKind(argId) === ExprKind.Subscript) {
        const subName = resolveConstSubscriptName(argId, arena);
        if (subName) {
          const varIdx = arena.getVarIdxByName(subName);
          if (varIdx !== -1) {
            stateVars.add(varIdx);
          }
        }
      }
    }
  }

  const solvableVarNameIds = new Set<number>();
  let freeStatesAdded = 0;
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) continue;

    if (stateVars.has(i)) {
      const derNameId = arena.interner.intern(`der(${arena.getVarName(i)})`);
      solvableVarNameIds.add(derNameId);
      if (!arena.isVarFixed(i) && freeStatesAdded < explicitInitialCount) {
        solvableVarNameIds.add(arena.getVarNameId(i));
        freeStatesAdded++;
      }
      continue;
    }

    if (arena.isVarFixed(i)) continue;

    const nameId = arena.getVarNameId(i);
    solvableVarNameIds.add(nameId);
  }

  const referencedNameIds = new Set<number>();
  for (const eq of initialEqPairs) {
    collectExprNameIds(arena, eq.lhs, referencedNameIds);
    collectExprNameIds(arena, eq.rhs, referencedNameIds);
  }

  const timeId = arena.interner.intern("time");
  referencedNameIds.delete(timeId);

  const unknownList: number[] = [];
  for (const nameId of referencedNameIds) {
    if (solvableVarNameIds.has(nameId)) {
      unknownList.push(nameId);
    }
  }

  const nUnknowns = unknownList.length;
  const nResiduals = initialEqPairs.length;
  if (nResiduals === 0 || nUnknowns === 0) return result;
  const nSolve = Math.min(nResiduals, nUnknowns);

  // 3. Build residual expressions R_i = LHS_i - RHS_i
  const residualExprIds: number[] = [];
  for (let i = 0; i < nSolve; i++) {
    const eq = initialEqPairs[i];
    if (!eq) continue;
    residualExprIds.push(arena.addBinaryExpr(BinOp.Sub, eq.lhs, eq.rhs));
  }

  // 4. Compute structural sparsity pattern
  const sparsityPattern: Set<number>[] = [];
  for (let i = 0; i < nSolve; i++) {
    const exprId = residualExprIds[i] ?? -1;
    const deps = new Set<number>();
    collectExprNameIds(arena, exprId, deps);

    const nonzeroColumns = new Set<number>();
    for (let j = 0; j < nSolve; j++) {
      const zj = unknownList[j] as number;
      if (deps.has(zj)) {
        nonzeroColumns.add(j);
      }
    }
    sparsityPattern.push(nonzeroColumns);
  }

  // 5. Precompute symbolic Jacobian entries
  const jacobianExprIds: (number | -1)[][] = [];
  for (let i = 0; i < nSolve; i++) {
    const row: (number | -1)[] = new Array(nSolve).fill(-1) as (number | -1)[];
    const Ri = residualExprIds[i] ?? -1;
    if (Ri === -1) {
      jacobianExprIds.push(row);
      continue;
    }
    const pattern = sparsityPattern[i] as Set<number>;
    for (const j of pattern) {
      const zj = unknownList[j] as number;
      row[j] = differentiateArenaExpressionWrt(arena, Ri, zj);
    }
    jacobianExprIds.push(row);
  }

  // Extract variable bounds and nominal values for numerical conditioning
  const varBounds = extractVariableBoundsAndNominal(arena, unknownList, result.valuesByStringId);
  const postBltValues = new Float64Array(result.valuesByStringId);

  // 6. Tier 1: Newton-Raphson iteration with Armijo line search & nominal scaling
  const maxIter = 50;
  const tol = 1e-10;

  let converged = runNewton(
    arena,
    result,
    residualExprIds,
    jacobianExprIds,
    sparsityPattern,
    unknownList,
    nSolve,
    maxIter,
    tol,
    varBounds,
  );

  // 7. Tier 2: Operator Homotopy continuation
  if (!converged && residualExprIds.some((exprId) => containsHomotopyCall(arena, exprId))) {
    converged = runOperatorHomotopy(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      tol,
    );
    if (converged) {
      runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        5,
        tol,
        varBounds,
      );
    }
  }

  // 8. Tier 3: Adaptive Pseudo-Arc-Length Homotopy continuation (Keller's Method)
  if (!converged) {
    const homotopyConverged = runArcLengthHomotopy(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      tol,
      postBltValues,
      varBounds,
    );
    converged = homotopyConverged;
    if (converged) {
      runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        5,
        tol,
        varBounds,
      );
    }
  }

  // 9. Tier 4: Switched Evolution Pseudo-Transient Relaxation
  if (!converged) {
    converged = runPseudoTransientRelaxation(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      tol,
      varBounds,
    );
    if (converged) {
      runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        5,
        tol,
        varBounds,
      );
    }
  }

  // 10. Tier 5: sBB fallback (for small loops <= 8 unknowns)
  if (!converged && nSolve <= 8) {
    const sbbConverged = runSbbFallback(arena, result, residualExprIds, unknownList, nSolve, 1e-4);
    converged = sbbConverged;
    if (converged) {
      runNewton(
        arena,
        result,
        residualExprIds,
        jacobianExprIds,
        sparsityPattern,
        unknownList,
        nSolve,
        5,
        tol,
        varBounds,
      );
    }
  }

  result.converged = converged;
  return result;
}

export interface VariableBoundsAndNominal {
  min: number;
  max: number;
  nominal: number;
}

function getAttrValue(
  arena: DAEBuilder,
  varIdx: number,
  attrName: string,
  valuesByStringId: Float64Array,
): number | undefined {
  const rawNumeric = (arena as any).rawVarAttrs?.get(varIdx)?.get(attrName);
  if (typeof rawNumeric === "number" && Number.isFinite(rawNumeric)) {
    return rawNumeric;
  }

  const raw =
    typeof arena.getVarAttrExprId === "function"
      ? arena.getVarAttrExprId(varIdx, attrName)
      : arena.getVarAttr(varIdx, attrName);
  if (raw === undefined || typeof raw !== "number") return undefined;
  if (!Number.isInteger(raw)) return Number.isFinite(raw) ? raw : undefined;

  if (raw >= 0 && raw < arena.exprCount) {
    const kind = arena.getExprKind(raw);
    if (kind === ExprKind.RealLiteral) {
      return arena.getExprRealValue(raw);
    }
    if (kind === ExprKind.IntLiteral) {
      return arena.getExprData1(raw);
    }
    try {
      const val = evaluateArenaRuntime(arena, raw, valuesByStringId);
      if (typeof val === "number" && Number.isFinite(val)) return val;
    } catch {
      // ignore
    }
    return undefined;
  }

  return Number.isFinite(raw) ? raw : undefined;
}

export function extractVariableBoundsAndNominal(
  arena: DAEBuilder,
  unknownList: number[],
  valuesByStringId: Float64Array,
): VariableBoundsAndNominal[] {
  const result: VariableBoundsAndNominal[] = [];
  for (let i = 0; i < unknownList.length; i++) {
    const nameId = unknownList[i]!;
    const name = arena.interner.resolve(nameId);
    let min = -1e12;
    let max = 1e12;
    let nominal = 1.0;

    if (name) {
      const isDer = name.startsWith("der(") && name.endsWith(")");
      const baseName = isDer ? name.slice(4, -1) : name;
      const varIdx = arena.getVarIdxByName(baseName);
      if (varIdx >= 0) {
        if (!isDer) {
          const rawMin = getAttrValue(arena, varIdx, "min", valuesByStringId);
          if (rawMin !== undefined && Number.isFinite(rawMin)) min = rawMin;

          const rawMax = getAttrValue(arena, varIdx, "max", valuesByStringId);
          if (rawMax !== undefined && Number.isFinite(rawMax)) max = rawMax;
        }

        const rawNom = getAttrValue(arena, varIdx, "nominal", valuesByStringId);
        if (rawNom !== undefined && Number.isFinite(rawNom) && Math.abs(rawNom) > 1e-12) {
          nominal = Math.abs(rawNom);
        } else {
          const startVal = arena.getVarStartValue(varIdx);
          const currentVal = valuesByStringId[nameId] ?? 0;
          const candidate = Math.abs(startVal) > 1e-4 ? Math.abs(startVal) : Math.abs(currentVal);
          if (candidate > 1e-4 && candidate < 1e8) {
            nominal = candidate;
          }
        }
      }
    }

    result.push({ min, max, nominal });
  }
  return result;
}

function runNewton(
  arena: DAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  jacobianExprIds: (number | -1)[][],
  sparsityPattern: Set<number>[],
  unknownList: number[],
  nSolve: number,
  maxIter: number,
  tol: number,
  bounds?: VariableBoundsAndNominal[],
): boolean {
  const varBounds = bounds ?? extractVariableBoundsAndNominal(arena, unknownList, result.valuesByStringId);
  let lmLambda = 1e-3;

  for (let iter = 0; iter < maxIter; iter++) {
    result.iterations = iter + 1;

    const R = new Array(nSolve).fill(0) as number[];
    for (let i = 0; i < nSolve; i++) {
      const exprId = residualExprIds[i] ?? -1;
      if (exprId !== -1) {
        R[i] = evaluateArenaRuntime(arena, exprId, result.valuesByStringId);
      }
    }

    let norm = 0;
    for (let i = 0; i < nSolve; i++) norm += Math.abs(R[i] ?? 0);
    result.residualNorm = norm;

    if (norm < tol) {
      result.converged = true;
      return true;
    }

    // 1 & 2. Evaluate Jacobian directly into row-major flat Float64Array with nominal scaling
    const flatJ = new Float64Array(nSolve * nSolve);
    for (let i = 0; i < nSolve; i++) {
      const pattern = sparsityPattern[i] as Set<number>;
      const jRow = jacobianExprIds[i];
      const rowOffset = i * nSolve;
      if (jRow) {
        for (const j of pattern) {
          const jExprId = jRow[j] ?? -1;
          const val = evaluateInitJacobianEntry(
            arena,
            residualExprIds[i] ?? -1,
            jExprId,
            unknownList[j] ?? -1,
            R[i] ?? 0,
            result.valuesByStringId,
          );
          const nom = varBounds[j]?.nominal ?? 1.0;
          flatJ[rowOffset + j] = val * nom;
        }
      }
      if (nSolve === 1 && Math.abs(flatJ[rowOffset + i] ?? 0) < 1e-12) {
        flatJ[rowOffset + i] = (flatJ[rowOffset + i] ?? 0) + 1e-8;
      }
    }

    const du = new Float64Array(nSolve);
    for (let i = 0; i < nSolve; i++) {
      du[i] = -(R[i] ?? 0);
    }
    const fact = luFactorFlat(new Float64Array(flatJ), nSolve);
    luSolveFlat(fact, du);

    // Unscale search direction: dz[j] = du[j] * nominal[j]
    const dz = new Float64Array(nSolve);
    for (let j = 0; j < nSolve; j++) {
      const nom = varBounds[j]?.nominal ?? 1.0;
      dz[j] = (du[j] ?? 0) * nom;
    }

    // 3. Armijo Backtracking Line Search with Box Bounds Projection
    const minAlpha = 1e-4;
    const c1 = 1e-4;
    const currentNorm = norm;
    let stepAccepted = false;

    const origZ = new Float64Array(nSolve);
    for (let i = 0; i < nSolve; i++) {
      const zj = unknownList[i] ?? -1;
      origZ[i] = zj !== -1 ? (result.valuesByStringId[zj] ?? 0) : 0;
    }

    const tryLineSearch = (stepDz: Float64Array): boolean => {
      let a = 1.0;
      while (a >= minAlpha) {
        for (let i = 0; i < nSolve; i++) {
          const zj = unknownList[i] ?? -1;
          if (zj !== -1) {
            const rawNext = (origZ[i] ?? 0) + a * (stepDz[i] ?? 0);
            const b = varBounds[i];
            const clampedNext = b ? Math.max(b.min, Math.min(b.max, rawNext)) : rawNext;
            result.valuesByStringId[zj] = clampedNext;
          }
        }

        let trialNorm = 0;
        let valid = true;
        for (let i = 0; i < nSolve; i++) {
          const exprId = residualExprIds[i] ?? -1;
          if (exprId !== -1) {
            const resVal = evaluateArenaRuntime(arena, exprId, result.valuesByStringId);
            if (!isFinite(resVal) || isNaN(resVal)) {
              valid = false;
              break;
            }
            trialNorm += Math.abs(resVal);
          }
        }

        if (valid && (trialNorm <= currentNorm * (1 - c1 * a) || trialNorm < tol)) {
          return true;
        }
        a *= 0.5;
      }
      return false;
    };

    stepAccepted = tryLineSearch(dz);

    // 4. Levenberg-Marquardt Regularization Fallback if standard Newton step was rejected
    if (!stepAccepted && nSolve > 1) {
      const JTJ = new Float64Array(nSolve * nSolve);
      const JTR = new Float64Array(nSolve);
      for (let k = 0; k < nSolve; k++) {
        const pattern = sparsityPattern[k] as Set<number>;
        const kOffset = k * nSolve;
        const r_k = R[k] ?? 0;
        for (const i of pattern) {
          const J_ki = flatJ[kOffset + i] ?? 0;
          if (J_ki === 0) continue;
          JTR[i] = (JTR[i] ?? 0) + J_ki * r_k;
          const iOffset = i * nSolve;
          for (const j of pattern) {
            JTJ[iOffset + j] = (JTJ[iOffset + j] ?? 0) + J_ki * (flatJ[kOffset + j] ?? 0);
          }
        }
      }

      for (let lmTry = 0; lmTry < 6 && !stepAccepted; lmTry++) {
        const A = new Float64Array(JTJ);
        for (let i = 0; i < nSolve; i++) {
          const diag = JTJ[i * nSolve + i] ?? 0;
          A[i * nSolve + i] = diag + lmLambda * Math.max(diag, 1.0);
        }
        const lmDu = new Float64Array(nSolve);
        for (let i = 0; i < nSolve; i++) lmDu[i] = -JTR[i]!;
        const lmFact = luFactorFlat(A, nSolve);
        luSolveFlat(lmFact, lmDu);

        const lmDz = new Float64Array(nSolve);
        for (let j = 0; j < nSolve; j++) {
          const nom = varBounds[j]?.nominal ?? 1.0;
          lmDz[j] = (lmDu[j] ?? 0) * nom;
        }

        if (tryLineSearch(lmDz)) {
          stepAccepted = true;
          lmLambda = Math.max(lmLambda * 0.2, 1e-9);
        } else {
          lmLambda *= 5.0;
        }
      }
    }

    if (!stepAccepted) {
      // Revert to original point if line search failed to find acceptable reduction
      for (let i = 0; i < nSolve; i++) {
        const zj = unknownList[i] ?? -1;
        if (zj !== -1) {
          result.valuesByStringId[zj] = origZ[i] ?? 0;
        }
      }
      break;
    }

    if (iter === maxIter - 1) {
      result.converged = false;
    }
  }

  return false;
}

/**
 * Keller's Adaptive Pseudo-Arc-Length Homotopy Continuation.
 * Tracks the equilibrium path from lambda = 0 (z = z0) to lambda = 1 (F(z) = 0).
 * By solving the augmented (n+1) x (n+1) bordered system, it traverses limit points (fold bifurcations)
 * where the standard Jacobian matrix becomes singular.
 */
function runArcLengthHomotopy(
  arena: DAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  jacobianExprIds: (number | -1)[][],
  sparsityPattern: Set<number>[],
  unknownList: number[],
  nSolve: number,
  tol: number,
  initialValues: Float64Array,
  bounds?: VariableBoundsAndNominal[],
): boolean {
  const varBounds = bounds ?? extractVariableBoundsAndNominal(arena, unknownList, initialValues);
  const z0 = new Float64Array(nSolve);
  for (let i = 0; i < nSolve; i++) {
    const zj = unknownList[i] as number;
    z0[i] = initialValues[zj] ?? 0;
  }

  // Current point on curve (z, lambda)
  const z = new Float64Array(z0);
  let lambda = 0.0;
  let ds = 0.1;
  const dsMin = 1e-5;
  const dsMax = 0.35;
  const maxTotalSteps = 120;

  // Tangent vector v = [dz_ds; dlambda_ds] of length nSolve + 1
  let v = new Float64Array(nSolve + 1);

  // Compute initial tangent at lambda = 0: H(z, 0) = z - z0 => J_z = I, J_lambda = F(z0)
  for (let i = 0; i < nSolve; i++) {
    const zj = unknownList[i]!;
    result.valuesByStringId[zj] = z0[i]!;
  }
  const f0 = new Float64Array(nSolve);
  let f0Norm = 0;
  for (let i = 0; i < nSolve; i++) {
    const exprId = residualExprIds[i] ?? -1;
    f0[i] = exprId !== -1 ? evaluateArenaRuntime(arena, exprId, result.valuesByStringId) : 0;
    f0Norm += Math.abs(f0[i]!);
  }

  if (f0Norm < tol) {
    // Initial guess already satisfies system
    result.converged = true;
    return true;
  }

  // Tangent equation: J_z * dz + J_lambda * dlambda = 0 => dz = -f0 * dlambda
  for (let i = 0; i < nSolve; i++) {
    v[i] = -f0[i]!;
  }
  v[nSolve] = 1.0;
  let vNorm = 0;
  for (let i = 0; i <= nSolve; i++) vNorm += v[i]! * v[i]!;
  vNorm = Math.sqrt(vNorm);
  if (vNorm > 1e-12) {
    for (let i = 0; i <= nSolve; i++) v[i] = v[i]! / vNorm;
  }

  for (let step = 0; step < maxTotalSteps; step++) {
    result.iterations++;

    // 1. Predictor step along tangent
    const zPred = new Float64Array(nSolve);
    for (let i = 0; i < nSolve; i++) {
      zPred[i] = z[i]! + ds * v[i]!;
    }
    let lambdaPred = lambda + ds * v[nSolve]!;

    // 2. Newton-Keller Corrector
    const zCurr = new Float64Array(zPred);
    let lambdaCurr = lambdaPred;
    let correctorConverged = false;
    let correctorIters = 0;

    for (let cIter = 0; cIter < 15; cIter++) {
      correctorIters++;
      for (let i = 0; i < nSolve; i++) {
        const zj = unknownList[i]!;
        result.valuesByStringId[zj] = zCurr[i]!;
      }

      // Evaluate H_i(z, lambda) = lambda * F_i(z) + (1 - lambda) * (z_i - z0_i)
      const H = new Float64Array(nSolve);
      const F = new Float64Array(nSolve);
      for (let i = 0; i < nSolve; i++) {
        const exprId = residualExprIds[i] ?? -1;
        F[i] = exprId !== -1 ? evaluateArenaRuntime(arena, exprId, result.valuesByStringId) : 0;
        H[i] = lambdaCurr * F[i]! + (1.0 - lambdaCurr) * (zCurr[i]! - z0[i]!);
      }

      // Arc-length constraint: v^T * ([zCurr; lambdaCurr] - [z; lambda]) - ds = 0
      let N_arc = 0;
      for (let i = 0; i < nSolve; i++) {
        N_arc += v[i]! * (zCurr[i]! - z[i]!);
      }
      N_arc += v[nSolve]! * (lambdaCurr - lambda) - ds;

      let resNorm = Math.abs(N_arc);
      for (let i = 0; i < nSolve; i++) resNorm += Math.abs(H[i]!);

      if (resNorm < tol) {
        correctorConverged = true;
        break;
      }

      // Build augmented Jacobian matrix: (nSolve + 1) x (nSolve + 1)
      const augJ: number[][] = [];
      for (let i = 0; i < nSolve; i++) {
        const row = new Array(nSolve + 1).fill(0) as number[];
        // dH/dz
        row[i] = 1.0 - lambdaCurr;
        const pattern = sparsityPattern[i] as Set<number>;
        const jRow = jacobianExprIds[i];
        if (jRow) {
          for (const j of pattern) {
            const jExprId = jRow[j] ?? -1;
            const dVal = evaluateInitJacobianEntry(
              arena,
              residualExprIds[i] ?? -1,
              jExprId,
              unknownList[j] ?? -1,
              F[i] ?? 0,
              result.valuesByStringId,
            );
            row[j] = (row[j] ?? 0) + lambdaCurr * dVal;
          }
        }
        // dH/dlambda = F_i(z) - (z_i - z0_i)
        row[nSolve] = F[i]! - (zCurr[i]! - z0[i]!);
        augJ.push(row);
      }

      // Arc-length row: [v[0], ..., v[nSolve]]
      const arcRow = new Array(nSolve + 1).fill(0) as number[];
      for (let j = 0; j <= nSolve; j++) {
        arcRow[j] = v[j]!;
      }
      augJ.push(arcRow);

      const rhs = new Array(nSolve + 1).fill(0) as number[];
      for (let i = 0; i < nSolve; i++) rhs[i] = -H[i]!;
      rhs[nSolve] = -N_arc;

      const dSol = solveLU(augJ, rhs, nSolve + 1);

      for (let i = 0; i < nSolve; i++) {
        const raw = zCurr[i]! + (dSol[i] ?? 0);
        const b = varBounds[i];
        zCurr[i] = b ? Math.max(b.min, Math.min(b.max, raw)) : raw;
      }
      lambdaCurr += dSol[nSolve] ?? 0;
    }

    if (correctorConverged) {
      // Compute secant tangent vector from accepted step before overwriting z and lambda
      const newV = new Float64Array(nSolve + 1);
      let normSq = 0;
      for (let i = 0; i < nSolve; i++) {
        const dz = zCurr[i]! - z[i]!;
        newV[i] = dz;
        normSq += dz * dz;
      }
      const dLambda = lambdaCurr - lambda;
      newV[nSolve] = dLambda;
      normSq += dLambda * dLambda;

      // Step accepted! Update path point
      for (let i = 0; i < nSolve; i++) z[i] = zCurr[i]!;
      lambda = lambdaCurr;

      // Check if we reached target actual system (lambda >= 1.0)
      if (lambda >= 1.0 - 1e-4) {
        for (let i = 0; i < nSolve; i++) {
          const zj = unknownList[i]!;
          result.valuesByStringId[zj] = z[i]!;
        }
        const polished = runNewton(
          arena,
          result,
          residualExprIds,
          jacobianExprIds,
          sparsityPattern,
          unknownList,
          nSolve,
          10,
          tol,
          varBounds,
        );
        if (polished) {
          result.converged = true;
          return true;
        }
      }

      if (normSq > 1e-24) {
        const invNorm = 1.0 / Math.sqrt(normSq);
        for (let i = 0; i <= nSolve; i++) newV[i] = newV[i]! * invNorm;
      } else {
        newV.fill(0);
        newV[nSolve] = 1.0;
      }
      let dot = 0;
      for (let i = 0; i <= nSolve; i++) dot += newV[i]! * v[i]!;
      if (dot < 0) {
        for (let i = 0; i <= nSolve; i++) newV[i] = -newV[i]!;
      }
      v = newV;

      // Adapt step size based on convergence rate
      if (correctorIters <= 3) {
        ds = Math.min(ds * 1.3, dsMax);
      } else if (correctorIters > 8) {
        ds = Math.max(ds * 0.7, dsMin);
      }
    } else {
      // Corrector failed: shrink step size and retry from (z, lambda)
      ds *= 0.5;
      if (ds < dsMin) {
        break; // Path blocked, fallback to Tier 4
      }
    }
  }

  return false;
}

/**
 * Switched Evolution Pseudo-Transient Relaxation (SER).
 * Solves non-linear algebraic systems by embedding F(x) = 0 into an artificial dynamical system:
 *   C * dx/dtau = -F(x)
 * As pseudo-time tau advances from small values (damped gradient descent) to infinity (pure Newton),
 * transient dynamics dissipate and converge robustly to the algebraic equilibrium.
 */
function runPseudoTransientRelaxation(
  arena: DAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  jacobianExprIds: (number | -1)[][],
  sparsityPattern: Set<number>[],
  unknownList: number[],
  nSolve: number,
  tol: number,
  bounds: VariableBoundsAndNominal[],
): boolean {
  let deltaTau = 1e-3;
  const maxDeltaTau = 1e4;
  const minDeltaTau = 1e-7;
  const maxSteps = 100;
  const currentZ = new Float64Array(nSolve);

  for (let i = 0; i < nSolve; i++) {
    const zj = unknownList[i]!;
    currentZ[i] = result.valuesByStringId[zj] ?? 0;
  }

  for (let step = 0; step < maxSteps; step++) {
    result.iterations++;

    // 1. Evaluate current residual
    const R = new Array(nSolve).fill(0) as number[];
    for (let i = 0; i < nSolve; i++) {
      const exprId = residualExprIds[i] ?? -1;
      R[i] = exprId !== -1 ? evaluateArenaRuntime(arena, exprId, result.valuesByStringId) : 0;
    }

    let norm = 0;
    for (let i = 0; i < nSolve; i++) norm += Math.abs(R[i] ?? 0);
    result.residualNorm = norm;

    if (norm < tol) {
      result.converged = true;
      return true;
    }

    // 2. Evaluate Jacobian
    const J: number[][] = [];
    for (let i = 0; i < nSolve; i++) {
      const row = new Array(nSolve).fill(0) as number[];
      const pattern = sparsityPattern[i] as Set<number>;
      const jRow = jacobianExprIds[i];
      if (jRow) {
        for (const j of pattern) {
          const jExprId = jRow[j] ?? -1;
          row[j] = evaluateInitJacobianEntry(
            arena,
            residualExprIds[i] ?? -1,
            jExprId,
            unknownList[j] ?? -1,
            R[i] ?? 0,
            result.valuesByStringId,
          );
        }
      }
      J.push(row);
    }

    // 3. Form augmented pseudo-transient matrix: A = J + (1 / deltaTau) * diag(capacitance)
    const A: number[][] = [];
    for (let i = 0; i < nSolve; i++) {
      const row = new Array(nSolve).fill(0) as number[];
      const cap = bounds[i]?.nominal ?? 1.0;
      for (let j = 0; j < nSolve; j++) {
        row[j] = (J[i]?.[j] ?? 0) + (i === j ? (1.0 / deltaTau) * cap : 0);
      }
      A.push(row);
    }

    const negR = R.map((r) => -r);
    const dz = solveLU(A, negR, nSolve);

    // 4. Trial step with bounds clamping
    const trialZ = new Float64Array(nSolve);
    for (let i = 0; i < nSolve; i++) {
      const b = bounds[i];
      const raw = (currentZ[i] ?? 0) + (dz[i] ?? 0);
      trialZ[i] = b ? Math.max(b.min, Math.min(b.max, raw)) : raw;
      const zj = unknownList[i]!;
      result.valuesByStringId[zj] = trialZ[i]!;
    }

    let trialNorm = 0;
    let isFiniteStep = true;
    for (let i = 0; i < nSolve; i++) {
      const exprId = residualExprIds[i] ?? -1;
      if (exprId !== -1) {
        const val = evaluateArenaRuntime(arena, exprId, result.valuesByStringId);
        if (!isFinite(val) || isNaN(val)) {
          isFiniteStep = false;
          break;
        }
        trialNorm += Math.abs(val);
      }
    }

    if (isFiniteStep && trialNorm < norm * 1.05) {
      // Step accepted! Update current state
      for (let i = 0; i < nSolve; i++) currentZ[i] = trialZ[i]!;

      // Switched Evolution Relaxation (SER) step acceleration
      const ratio = Math.max(0.5, Math.min(2.5, norm / Math.max(trialNorm, 1e-12)));
      deltaTau = Math.min(deltaTau * ratio, maxDeltaTau);

      if (trialNorm < tol) {
        result.converged = true;
        result.residualNorm = trialNorm;
        return true;
      }
    } else {
      // Step rejected: restore current state and damp deltaTau
      for (let i = 0; i < nSolve; i++) {
        const zj = unknownList[i]!;
        result.valuesByStringId[zj] = currentZ[i] ?? 0;
      }
      deltaTau = Math.max(deltaTau * 0.3, minDeltaTau);
      if (deltaTau <= minDeltaTau) {
        break;
      }
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Homotopy Continuation Strategies
// ─────────────────────────────────────────────────────────────────────────

export class ResidualHomotopy implements HomotopyStrategy {
  name = "residual";

  solve(
    tapeData: { ops: StaticTapeBuilder; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult {
    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "residual",
      (Ri, zRow, z0Row, lambda) => lambda * Ri + (1 - lambda) * (zRow - z0Row),
      (dRdz, row, col, lambda) => lambda * dRdz + (row === col ? 1 - lambda : 0),
    );
  }
}

export class FixedPointHomotopy implements HomotopyStrategy {
  name = "fixed-point";

  solve(
    tapeData: { ops: StaticTapeBuilder; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult {
    const nUnknowns = unknownList.length;
    const z0 = unknownList.map((name) => startValues.get(name) ?? env.get(name) ?? 0);
    const envCopy = new Map(env);
    for (let i = 0; i < nUnknowns; i++) {
      const name = unknownList[i];
      if (name) envCopy.set(name, z0[i] ?? 0);
    }

    // Compute diagonal scaling factors G_i = sign(dF_i/dz_i(z0)) * max(|dF_i/dz_i(z0)|, 1)
    // so the fixed-point embedding H(z, lambda) = lambda * F(z) + (1 - lambda) * G * (z - z0)
    // matches the local Jacobian orientation at z0 and avoids artificial sign-flip singularities.
    const diagScale = new Float64Array(nSolve);
    for (let row = 0; row < nSolve; row++) {
      diagScale[row] = 1.0;
      const td = tapeData[row];
      if (!td) continue;
      const t = evaluateTapeForward(td.ops, envCopy);
      const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);
      const varName = unknownList[row];
      if (varName) {
        const dDiag = grads.get(varName) ?? 0;
        const sign = dDiag < 0 ? -1.0 : 1.0;
        diagScale[row] = sign * Math.max(Math.abs(dDiag), 1.0);
      }
    }

    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "fixed-point",
      (Ri, zRow, z0Row, lambda, row) => lambda * Ri + (1 - lambda) * (diagScale[row] ?? 1.0) * (zRow - z0Row),
      (dRdz, row, col, lambda) => lambda * dRdz + (row === col ? (1 - lambda) * (diagScale[row] ?? 1.0) : 0),
      { initialStep: 0.02, maxGrowth: 1.2, dampingFactor: 0.5 },
    );
  }
}

export class SymbolicHomotopy implements HomotopyStrategy {
  name = "symbolic";

  solve(
    tapeData: { ops: StaticTapeBuilder; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult {
    const nUnknowns = unknownList.length;
    const z0 = unknownList.map((name) => startValues.get(name) ?? env.get(name) ?? 0);

    const envCopy = new Map(env);
    for (let i = 0; i < nUnknowns; i++) {
      const name = unknownList[i];
      if (name) envCopy.set(name, z0[i] ?? 0);
    }

    const R0 = new Array(nSolve).fill(0) as number[];
    const J0: number[][] = [];
    for (let i = 0; i < nSolve; i++) J0[i] = new Array(nSolve).fill(0) as number[];

    for (let row = 0; row < nSolve; row++) {
      const td = tapeData[row];
      if (!td) continue;
      const t = evaluateTapeForward(td.ops, envCopy);
      R0[row] = t[td.outputIndex] ?? 0;
      const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);
      const jRow = J0[row];
      if (!jRow) continue;
      for (let col = 0; col < nSolve; col++) {
        const varName = unknownList[col];
        if (varName) jRow[col] = grads.get(varName) ?? 0;
      }
    }

    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "symbolic",
      (Ri, _zRow, _z0Row, lambda, row, z) => {
        let linearR = R0[row] ?? 0;
        const jRow = J0[row];
        if (jRow) {
          for (let col = 0; col < nSolve; col++) {
            linearR += (jRow[col] ?? 0) * ((z[col] ?? 0) - (z0[col] ?? 0));
          }
        }
        return lambda * Ri + (1 - lambda) * linearR;
      },
      (dRdz, row, col, lambda) => {
        const jVal = J0[row]?.[col] ?? 0;
        return lambda * dRdz + (1 - lambda) * jVal;
      },
    );
  }
}

export class ParameterContinuation implements HomotopyStrategy {
  name = "parameter";

  solve(
    tapeData: { ops: StaticTapeBuilder; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult {
    const unknownSet = new Set(unknownList);
    const paramNames: string[] = [];
    const paramOriginal = new Map<string, number>();
    const paramStart = new Map<string, number>();
    for (const [name, val] of env) {
      if (!unknownSet.has(name) && name !== "time") {
        paramNames.push(name);
        paramOriginal.set(name, val);
        // Start from unit-scaled non-zero nominal value to avoid division-by-zero at small lambda
        const startVal = Math.abs(val) > 1.0 ? Math.sign(val) : val;
        paramStart.set(name, startVal);
      }
    }

    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "parameter",
      (Ri, zRow, z0Row, lambda) => Ri + (1 - lambda) * 1e-2 * (zRow - z0Row),
      (dRdz, row, col, lambda) => dRdz + (row === col ? (1 - lambda) * 1e-2 : 0),
      {
        beforeStep: (lambda: number) => {
          for (const name of paramNames) {
            const p0 = paramStart.get(name) ?? 0;
            const p1 = paramOriginal.get(name) ?? 0;
            env.set(name, (1 - lambda) * p0 + lambda * p1);
          }
        },
        afterSolve: () => {
          for (const [name, val] of paramOriginal) env.set(name, val);
        },
      },
    );
  }
}

const AUTO_STRATEGIES: HomotopyStrategy[] = [
  new ResidualHomotopy(),
  new FixedPointHomotopy(),
  new SymbolicHomotopy(),
  new ParameterContinuation(),
];

export function resolveStrategies(mode: HomotopyMode): HomotopyStrategy[] {
  switch (mode) {
    case "none":
      return [];
    case "residual":
      return [new ResidualHomotopy()];
    case "fixed-point":
      return [new FixedPointHomotopy()];
    case "symbolic":
      return [new SymbolicHomotopy()];
    case "parameter":
      return [new ParameterContinuation()];
    case "auto":
    default:
      return AUTO_STRATEGIES;
  }
}

export function solveWithAutoHomotopy(
  mode: HomotopyMode,
  tapeData: { ops: StaticTapeBuilder; outputIndex: number }[],
  unknownList: string[],
  nSolve: number,
  env: Map<string, number>,
  startValues: Map<string, number>,
  maxSteps: number,
): HomotopyResult {
  const strategies = resolveStrategies(mode);

  for (const strategy of strategies) {
    const envSnapshot = new Map(env);
    const result = strategy.solve(tapeData, unknownList, nSolve, env, startValues, maxSteps);
    if (result.converged) return result;
    for (const [k, v] of envSnapshot) env.set(k, v);
  }

  return {
    values: new Map<string, number>(),
    iterations: 0,
    residualNorm: Infinity,
    converged: false,
    strategy: "none",
  };
}

interface ContinuationOptions {
  initialStep?: number | undefined;
  maxGrowth?: number | undefined;
  dampingFactor?: number | undefined;
  beforeStep?: ((lambda: number) => void) | undefined;
  afterSolve?: (() => void) | undefined;
}

type ResidualFn = (Ri: number, zRow: number, z0Row: number, lambda: number, row: number, z: number[]) => number;
type JacobianFn = (dRdz: number, row: number, col: number, lambda: number) => number;

function runHomotopyContinuation(
  tapeData: { ops: StaticTapeBuilder; outputIndex: number }[],
  unknownList: string[],
  nSolve: number,
  env: Map<string, number>,
  startValues: Map<string, number>,
  maxSteps: number,
  strategyName: string,
  hResidual: ResidualFn,
  hJacobian: JacobianFn,
  options?: ContinuationOptions,
): HomotopyResult {
  const result: HomotopyResult = {
    values: new Map<string, number>(),
    iterations: 0,
    residualNorm: Infinity,
    converged: false,
    strategy: strategyName,
  };

  const nUnknowns = unknownList.length;
  const z0 = unknownList.map((name) => startValues.get(name) ?? env.get(name) ?? 0);
  const z = [...z0];

  let lambda = 0;
  let lambdaStep = options?.initialStep ?? 0.1;
  const maxGrowth = options?.maxGrowth ?? 1.5;
  const damping = options?.dampingFactor ?? 1.0;
  const maxTotalIter = maxSteps * 20;
  let totalIter = 0;

  while (lambda < 1.0 && totalIter < maxTotalIter) {
    const targetLambda = Math.min(lambda + lambdaStep, 1.0);

    options?.beforeStep?.(targetLambda);

    let convergedAtLambda = false;
    const maxNewtonIter = 20;

    for (let iter = 0; iter < maxNewtonIter && totalIter < maxTotalIter; iter++) {
      totalIter++;
      result.iterations = totalIter;

      for (let i = 0; i < nUnknowns; i++) {
        const name = unknownList[i];
        if (name) env.set(name, z[i] ?? 0);
      }

      const H = new Array(nSolve).fill(0) as number[];
      const J: number[][] = [];
      for (let i = 0; i < nSolve; i++) J[i] = new Array(nSolve).fill(0) as number[];

      for (let row = 0; row < nSolve; row++) {
        const td = tapeData[row];
        if (!td) continue;

        const t = evaluateTapeForward(td.ops, env);
        const Ri = t[td.outputIndex] ?? 0;
        const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);

        const zRow = row < nUnknowns ? (z[row] ?? 0) : 0;
        const z0Row = row < nUnknowns ? (z0[row] ?? 0) : 0;
        H[row] = hResidual(Ri, zRow, z0Row, targetLambda, row, z);

        const jRow = J[row];
        if (!jRow) continue;
        for (let col = 0; col < nSolve; col++) {
          const varName = unknownList[col];
          if (!varName) continue;
          const dRdz = grads.get(varName) ?? 0;
          jRow[col] = hJacobian(dRdz, row, col, targetLambda);
        }
      }

      let norm = 0;
      for (let i = 0; i < nSolve; i++) norm += Math.abs(H[i] ?? 0);
      result.residualNorm = norm;

      if (norm < 1e-10) {
        convergedAtLambda = true;
        break;
      }

      const negH = H.map((h) => -(h ?? 0));
      const dz = solveLU(J, negH, nSolve);
      for (let i = 0; i < nSolve; i++) {
        z[i] = (z[i] ?? 0) + damping * (dz[i] ?? 0);
      }
    }

    if (convergedAtLambda) {
      lambda = targetLambda;
      lambdaStep = Math.min(lambdaStep * maxGrowth, 0.5);
    } else {
      lambdaStep *= 0.5;
      if (lambdaStep < 1e-6) break;
    }
  }

  options?.afterSolve?.();

  for (let i = 0; i < nUnknowns; i++) {
    const name = unknownList[i];
    if (name) {
      env.set(name, z[i] ?? 0);
      result.values.set(name, z[i] ?? 0);
    }
  }

  // Verify true system residual norm at lambda = 1 with restored parameters
  let finalTrueNorm = 0;
  for (let row = 0; row < nSolve; row++) {
    const td = tapeData[row];
    if (!td) continue;
    const t = evaluateTapeForward(td.ops, env);
    const Ri = t[td.outputIndex] ?? 0;
    finalTrueNorm += Math.abs(Ri);
  }
  result.residualNorm = finalTrueNorm;
  result.converged = lambda >= 1.0 - 1e-10 && Number.isFinite(finalTrueNorm) && finalTrueNorm < 1e-6;

  return result;
}
