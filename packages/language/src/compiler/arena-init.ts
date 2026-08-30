// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dedicated Initialization BLT Transformer & Initial Equation Solver.
 *
 * Constructs bipartite graphs and solves initial conditions natively on the ArenaDAEBuilder
 * at t=0 before time integration begins:
 *   - Treats `fixed=true` variables and parameters as hard knowns
 *   - Rotates derivatives der(x) into pure algebraic unknowns
 *   - Solves explicit assignments and implicit algebraic loops via sparse analytical Newton-Raphson
 *   - Provides multi-strategy homotopy continuation fallback for stiff/nonlinear initialization
 */

import {
  ArenaDAEBuilder,
  BinOp,
  EqKind,
  ExprKind,
  VarType,
  Variability,
  differentiateArenaExpressionWrt,
} from "./dae-arena.js";
import { evaluateArenaRuntime } from "./simulator/evaluator/eval-runtime.js";
import { StaticTapeBuilder, evaluateTapeForward, evaluateTapeReverse } from "./tape.js";

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

/** Unroll nested array constructor / tuple expressions into a flat list of scalar expression IDs. */
function flatElements(exprId: number, arena: ArenaDAEBuilder): number[] {
  if (exprId < 0) return [];
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.ArrayCtor || kind === ExprKind.Tuple) {
    const count = arena.getExprData1(exprId);
    const firstElemId = arena.getExprLeft(exprId);
    const elements: number[] = [];
    for (let i = 0; i < count; i++) {
      const elemExprId = arena.getExprLeft(firstElemId + i);
      elements.push(...flatElements(elemExprId, arena));
    }
    return elements;
  }
  return [exprId];
}

/** Collect all variable names referenced in an expression. */
function collectExprVarNames(exprId: number, arena: ArenaDAEBuilder, names: Set<string>): void {
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
    case ExprKind.Der:
    case ExprKind.Pre: {
      const operand = arena.getExprLeft(exprId);
      if (kind === ExprKind.Der) {
        if (arena.getExprKind(operand) === ExprKind.Name) {
          const varName = arena.interner.resolve(arena.getExprData1(operand));
          names.add(`der(${varName})`);
        }
      }
      collectExprVarNames(operand, arena, names);
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

      if (funcName === "der" && argCount === 1) {
        const argExprId = arena.getExprLeft(firstArgId);
        if (arena.getExprKind(argExprId) === ExprKind.Name) {
          const varName = arena.interner.resolve(arena.getExprData1(argExprId));
          names.add(`der(${varName})`);
        }
      }

      for (let i = 0; i < argCount; i++) {
        const argExprId = arena.getExprLeft(firstArgId + i);
        collectExprVarNames(argExprId, arena, names);
      }
      break;
    }
    case ExprKind.Subscript: {
      const baseExprId = arena.getExprData1(exprId);
      const firstSubId = arena.getExprLeft(exprId);
      const subCount = arena.getExprRight(exprId);

      if (subCount === 1) {
        const indexExprId = arena.getExprLeft(firstSubId);
        if (arena.getExprKind(indexExprId) === ExprKind.IntLiteral) {
          const val = arena.getExprData1(indexExprId);
          if (arena.getExprKind(baseExprId) === ExprKind.Name) {
            const baseName = arena.interner.resolve(arena.getExprData1(baseExprId));
            names.add(`${baseName}[${val}]`);
          }
        }
      }

      collectExprVarNames(baseExprId, arena, names);
      for (let i = 0; i < subCount; i++) {
        const subExprId = arena.getExprLeft(firstSubId + i);
        collectExprVarNames(subExprId, arena, names);
      }
      break;
    }
    case ExprKind.ArrayCtor:
    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      const firstElemId = arena.getExprLeft(exprId);
      for (let i = 0; i < count; i++) {
        const elemExprId = arena.getExprLeft(firstElemId + i);
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

/**
 * Build the initialization BLT from a flattened DAE.
 *
 * @param dae The flattened DAE with initialEquations and variables
 * @returns Ordered sequence of init blocks ready for solving
 */
export function buildInitBLT(dae: ArenaDAEBuilder): InitBLTResult {
  // 1. Classify knowns vs unknowns
  const knowns = new Set<string>();
  const discreteVarNames = new Set<string>();
  knowns.add("time");

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const varName = dae.getVarName(i);
    const variability = dae.getVarVariability(i);
    const varType = dae.getVarType(i);

    // Parameters and constants are always known
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      knowns.add(varName);
      continue;
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

  // 2. Collect all equations for initialization
  const initEquations: { lhs: number; rhs: number; source: "initial" | "continuous" }[] = [];

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    const lhs = dae.getEqLhs(i);
    const rhs = dae.getEqRhs(i);

    if (kind === EqKind.InitialSimple || kind === EqKind.InitialFor) {
      if (kind === EqKind.InitialSimple) {
        const lhsElems = flatElements(lhs, dae);
        const rhsElems = flatElements(rhs, dae);
        const n = Math.max(lhsElems.length, rhsElems.length);
        for (let j = 0; j < n; j++) {
          const l = lhsElems[j] ?? lhsElems[0];
          const r = rhsElems[j] ?? rhsElems[0];
          if (l !== undefined && r !== undefined) {
            initEquations.push({ lhs: l, rhs: r, source: "initial" });
          }
        }
      }
    } else if (kind !== EqKind.When) {
      if (kind === EqKind.Array) {
        const lhsElems = flatElements(lhs, dae);
        const rhsElems = flatElements(rhs, dae);
        const n = Math.max(lhsElems.length, rhsElems.length);
        for (let j = 0; j < n; j++) {
          const l = lhsElems[j] ?? lhsElems[0];
          const r = rhsElems[j] ?? rhsElems[0];
          if (l !== undefined && r !== undefined) {
            initEquations.push({ lhs: l, rhs: r, source: "continuous" });
          }
        }
      } else if (kind === EqKind.Simple) {
        initEquations.push({ lhs, rhs, source: "continuous" });
      }
    }
  }

  if (initEquations.length === 0) {
    return { blocks: [], knowns, unknowns: new Set() };
  }

  // 3. Determine unknowns: all referenced vars that are not known
  const allReferenced = new Set<string>();
  for (const eq of initEquations) {
    collectExprVarNames(eq.lhs, dae, allReferenced);
    collectExprVarNames(eq.rhs, dae, allReferenced);
  }

  const unknowns = new Set<string>();
  for (const name of allReferenced) {
    if (!knowns.has(name)) unknowns.add(name);
  }

  // Expand array unknowns
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const varName = dae.getVarName(i);
    const shape = dae.getVarShape(i);
    if (shape.length > 0 && unknowns.has(varName)) {
      const size = shape.reduce((a: number, b: number) => a * b, 1);
      for (let j = 0; j < size; j++) unknowns.add(`${varName}[${j + 1}]`);
    }
  }

  if (unknowns.size === 0) {
    return { blocks: [], knowns, unknowns };
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

      if (lhsName === varName && !depsExcluding(deps, varName)) {
        blocks.push({ type: "explicit", target: varName, expr: eq.rhs });
      } else if (rhsName === varName && !depsExcluding(deps, varName)) {
        blocks.push({ type: "explicit", target: varName, expr: eq.lhs });
      } else if (derLhs && `der(${derLhs})` === varName && !depsExcluding(deps, varName)) {
        blocks.push({ type: "explicit", target: varName, expr: eq.rhs });
      } else if (derRhs && `der(${derRhs})` === varName && !depsExcluding(deps, varName)) {
        blocks.push({ type: "explicit", target: varName, expr: eq.lhs });
      } else {
        blocks.push({
          type: "implicit",
          unknowns: [varName],
          equations: [{ lhs: eq.lhs, rhs: eq.rhs }],
          hasDiscreteVars: discreteVarNames.has(varName),
        });
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
      }
      blocks.push({
        type: "implicit",
        unknowns: scc,
        equations: loopEqs,
        hasDiscreteVars: hasDiscrete,
      });
    }
  }

  return { blocks, knowns, unknowns };
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

function extractSimpleName(exprId: number, arena: ArenaDAEBuilder): string | null {
  if (exprId < 0) return null;
  if (arena.getExprKind(exprId) === ExprKind.Name) {
    return arena.interner.resolve(arena.getExprData1(exprId));
  }
  return null;
}

function extractDerName(exprId: number, arena: ArenaDAEBuilder): string | null {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Der) {
    const operand = arena.getExprLeft(exprId);
    if (arena.getExprKind(operand) === ExprKind.Name) {
      return arena.interner.resolve(arena.getExprData1(operand));
    }
  } else if (kind === ExprKind.Call) {
    const nameId = arena.getExprData1(exprId);
    const funcName = arena.interner.resolve(nameId);
    const firstArgId = arena.getExprLeft(exprId);
    const argCount = arena.getExprRight(exprId);
    if (funcName === "der" && argCount === 1) {
      const argExprId = arena.getExprLeft(firstArgId);
      if (arena.getExprKind(argExprId) === ExprKind.Name) {
        return arena.interner.resolve(arena.getExprData1(argExprId));
      }
    }
  }
  return null;
}

function depsExcluding(deps: Set<string>, exclude: string): boolean {
  for (const d of deps) {
    if (d !== exclude) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Initial Equation Solving: LU & Newton-Raphson with Sparse Analytical Jacobian
// ─────────────────────────────────────────────────────────────────────────

function solveLU(A: number[][], b: number[], n: number): number[] {
  const M = A.map((row) => [...row]);
  const rhs = [...b];

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(M[k]?.[k] ?? 0);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const val = Math.abs(M[i]?.[k] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = i;
      }
    }
    if (maxRow !== k) {
      [M[k], M[maxRow]] = [M[maxRow] ?? [], M[k] ?? []];
      [rhs[k], rhs[maxRow]] = [rhs[maxRow] ?? 0, rhs[k] ?? 0];
    }
    const pivot = M[k]?.[k] ?? 0;
    if (Math.abs(pivot) < 1e-30) continue;

    for (let i = k + 1; i < n; i++) {
      const row = M[i];
      const pivotRow = M[k];
      if (!row || !pivotRow) continue;
      const factor = (row[k] ?? 0) / pivot;
      row[k] = factor;
      for (let j = k + 1; j < n; j++) {
        row[j] = (row[j] ?? 0) - factor * (pivotRow[j] ?? 0);
      }
      rhs[i] = (rhs[i] ?? 0) - factor * (rhs[k] ?? 0);
    }
  }

  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i] ?? 0;
    const row = M[i];
    if (row) {
      for (let j = i + 1; j < n; j++) {
        sum -= (row[j] ?? 0) * (x[j] ?? 0);
      }
      const diag = row[i] ?? 1;
      x[i] = Math.abs(diag) > 1e-30 ? sum / diag : 0;
    }
  }
  return x;
}

function collectExprNameIds(arena: ArenaDAEBuilder, exprId: number, nameIds: Set<number>): void {
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
    } else {
      collectExprNameIds(arena, data1, nameIds);
    }
    return;
  }

  switch (kind) {
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Pre:
      collectExprNameIds(arena, left, nameIds);
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
    case ExprKind.Subscript:
      collectExprNameIds(arena, data1, nameIds);
      collectExprNameIds(arena, left, nameIds);
      break;
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
 * Solve the initial equations natively on the ArenaDAEBuilder using Newton-Raphson
 * with structural sparsity, exact symbolic Jacobians, and homotopy continuation fallback.
 *
 * @param arena The ArenaDAEBuilder containing the equations.
 * @param initialValues A Float64Array populated with start values and parameters.
 * @returns Solver result with computed initial values.
 */
export function solveInitialEquationsArena(arena: ArenaDAEBuilder, initialValues: Float64Array): ArenaInitSolverResult {
  const result: ArenaInitSolverResult = {
    valuesByStringId: new Float64Array(initialValues),
    iterations: 0,
    residualNorm: 0,
    converged: true,
  };

  // 1. Collect initial equations
  const initialEqIndices: number[] = [];
  for (let i = 0; i < arena.eqCount; i++) {
    const kind = arena.getEqKind(i);
    if (kind === EqKind.InitialSimple || kind === EqKind.Simple) {
      initialEqIndices.push(i);
    }
  }
  if (initialEqIndices.length === 0) return result;

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
      }
    }
  }

  const solvableVarNameIds = new Set<number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) continue;

    if (stateVars.has(i)) {
      const derNameId = arena.interner.intern(`der(${arena.getVarName(i)})`);
      solvableVarNameIds.add(derNameId);
      continue;
    }

    if (arena.isVarFixed(i)) continue;

    const nameId = arena.getVarNameId(i);
    solvableVarNameIds.add(nameId);
  }

  const referencedNameIds = new Set<number>();
  for (const eqIdx of initialEqIndices) {
    collectExprNameIds(arena, arena.getEqLhs(eqIdx), referencedNameIds);
    collectExprNameIds(arena, arena.getEqRhs(eqIdx), referencedNameIds);
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
  const nResiduals = initialEqIndices.length;
  if (nResiduals === 0 || nUnknowns === 0) return result;
  const nSolve = Math.min(nResiduals, nUnknowns);

  // 3. Build residual expressions R_i = LHS_i - RHS_i
  const residualExprIds: number[] = [];
  for (let i = 0; i < nSolve; i++) {
    const eqIdx = initialEqIndices[i] ?? -1;
    if (eqIdx === -1) continue;
    const lhs = arena.getEqLhs(eqIdx);
    const rhs = arena.getEqRhs(eqIdx);
    residualExprIds.push(arena.addBinaryExpr(BinOp.Sub, lhs, rhs));
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

  // 6. Newton-Raphson iteration
  const maxIter = 50;
  const tol = 1e-10;

  const converged = runNewton(
    arena,
    result,
    residualExprIds,
    jacobianExprIds,
    sparsityPattern,
    unknownList,
    nSolve,
    maxIter,
    tol,
  );

  // 7. Homotopy continuation fallback
  if (!converged) {
    const homotopyConverged = runHomotopy(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      tol,
      initialValues,
    );
    result.converged = homotopyConverged;
  }

  return result;
}

function runNewton(
  arena: ArenaDAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  jacobianExprIds: (number | -1)[][],
  sparsityPattern: Set<number>[],
  unknownList: number[],
  nSolve: number,
  maxIter: number,
  tol: number,
): boolean {
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

    const J: number[][] = [];
    for (let i = 0; i < nSolve; i++) {
      const row = new Array(nSolve).fill(0) as number[];
      const pattern = sparsityPattern[i] as Set<number>;
      const jRow = jacobianExprIds[i];
      if (jRow) {
        for (const j of pattern) {
          const jExprId = jRow[j] ?? -1;
          if (jExprId !== -1) {
            row[j] = evaluateArenaRuntime(arena, jExprId, result.valuesByStringId);
          }
        }
      }
      J.push(row);
    }

    const negR = R.map((r) => -r);
    const dz = solveLU(J, negR, nSolve);

    for (let i = 0; i < nSolve; i++) {
      const zj = unknownList[i] ?? -1;
      if (zj !== -1) {
        result.valuesByStringId[zj] = (result.valuesByStringId[zj] ?? 0) + (dz[i] ?? 0);
      }
    }

    if (iter === maxIter - 1) {
      result.converged = false;
    }
  }

  return false;
}

function runHomotopy(
  arena: ArenaDAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  jacobianExprIds: (number | -1)[][],
  sparsityPattern: Set<number>[],
  unknownList: number[],
  nSolve: number,
  tol: number,
  initialValues: Float64Array,
): boolean {
  const z0 = new Float64Array(nSolve);
  for (let i = 0; i < nSolve; i++) {
    const zj = unknownList[i] as number;
    z0[i] = initialValues[zj] ?? 0;
  }

  for (let i = 0; i < nSolve; i++) {
    const zj = unknownList[i] as number;
    result.valuesByStringId[zj] = z0[i] as number;
  }

  let lambda = 0;
  let lambdaStep = 0.1;
  const maxTotalIter = 200;
  let totalIter = 0;

  while (lambda < 1.0 && totalIter < maxTotalIter) {
    const targetLambda = Math.min(lambda + lambdaStep, 1.0);

    let convergedAtLambda = false;
    const maxNewtonIter = 20;

    for (let iter = 0; iter < maxNewtonIter && totalIter < maxTotalIter; iter++) {
      totalIter++;
      result.iterations++;

      const H = new Array(nSolve).fill(0) as number[];
      for (let i = 0; i < nSolve; i++) {
        const exprId = residualExprIds[i] ?? -1;
        const Ri = exprId !== -1 ? evaluateArenaRuntime(arena, exprId, result.valuesByStringId) : 0;
        const zj = unknownList[i] as number;
        const zi = result.valuesByStringId[zj] ?? 0;
        H[i] = targetLambda * Ri + (1 - targetLambda) * (zi - (z0[i] as number));
      }

      let norm = 0;
      for (let i = 0; i < nSolve; i++) norm += Math.abs(H[i] ?? 0);
      result.residualNorm = norm;

      if (norm < tol) {
        convergedAtLambda = true;
        break;
      }

      const J: number[][] = [];
      for (let i = 0; i < nSolve; i++) {
        const row = new Array(nSolve).fill(0) as number[];
        row[i] = 1 - targetLambda;

        const pattern = sparsityPattern[i] as Set<number>;
        const jRow = jacobianExprIds[i];
        if (jRow) {
          for (const j of pattern) {
            const jExprId = jRow[j] ?? -1;
            if (jExprId !== -1) {
              row[j] = (row[j] ?? 0) + targetLambda * evaluateArenaRuntime(arena, jExprId, result.valuesByStringId);
            }
          }
        }
        J.push(row);
      }

      const negH = H.map((h) => -(h ?? 0));
      const dz = solveLU(J, negH, nSolve);

      for (let i = 0; i < nSolve; i++) {
        const zj = unknownList[i] as number;
        result.valuesByStringId[zj] = (result.valuesByStringId[zj] ?? 0) + (dz[i] ?? 0);
      }
    }

    if (convergedAtLambda) {
      lambda = targetLambda;
      lambdaStep = Math.min(lambdaStep * 1.5, 0.5);
    } else {
      lambdaStep *= 0.5;
      if (lambdaStep < 1e-6) break;
    }
  }

  return lambda >= 1.0 - 1e-10;
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
    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "fixed-point",
      (Ri, zRow, z0Row, lambda) => lambda * Ri + (1 - lambda) * (zRow - z0Row),
      (dRdz, row, col, lambda) => lambda * dRdz + (row === col ? 1 - lambda : 0),
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
    for (const [name, val] of env) {
      if (!unknownSet.has(name) && name !== "time") {
        paramNames.push(name);
        paramOriginal.set(name, val);
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
      (Ri, zRow, z0Row, lambda) => lambda * Ri + (1 - lambda) * (zRow - z0Row),
      (dRdz, row, col, lambda) => lambda * dRdz + (row === col ? 1 - lambda : 0),
      {
        beforeStep: (lambda: number) => {
          for (const name of paramNames) {
            env.set(name, lambda * (paramOriginal.get(name) ?? 0));
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
  initialStep?: number;
  maxGrowth?: number;
  dampingFactor?: number;
  beforeStep?: (lambda: number) => void;
  afterSolve?: () => void;
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

  result.converged = lambda >= 1.0 - 1e-10;
  for (let i = 0; i < nUnknowns; i++) {
    const name = unknownList[i];
    if (name) result.values.set(name, z[i] ?? 0);
  }

  return result;
}
