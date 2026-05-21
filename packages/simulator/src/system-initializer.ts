/* eslint-disable */
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dedicated Initialization BLT Transformer.
 *
 * Constructs a separate bipartite graph strictly for solving the t=0
 * initialization problem. Unlike the simulation BLT (blt.ts), this module:
 *
 *   - Treats `fixed=true` variables and parameters as hard knowns
 *   - Rotates derivatives der(x) into pure algebraic unknowns
 *   - Merges `initial equation` clauses with continuous equations evaluated at t=0
 *   - Runs aggressive tearing to minimize algebraic loop sizes
 *
 * The output is a sequence of InitBlock objects — either explicit assignments
 * or implicit algebraic loops — that the init-solver can process sequentially.
 */

import { ArenaDAEBuilder, EqKind, ExprKind, Variability, VarType } from "@modelscript/compiler";

// ── Public types ──

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
        // First field value is in left of the Object header
        collectExprVarNames(arena.getExprLeft(exprId), arena, names);
        // Subsequent field values are in left of Tuple entries
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

// ── Core algorithm ──

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
  //    - Initial equations (explicit initial conditions)
  //    - Continuous equations evaluated at t=0 (dynamic constraints)
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
  const matchVarToEq = new Map<string, number>(); // variable → equation index
  const matchEqToVar = new Map<number, string>(); // equation → variable

  for (let u = 0; u < initEquations.length; u++) {
    const visited = new Set<string>();
    augmentInit(u, eqDeps, matchVarToEq, matchEqToVar, visited);
  }

  // 6. Build directed graph for Tarjan SCC
  // V1 → V2 means V1's computing equation depends on V2
  const getVarDeps = (v: string): string[] => {
    const eqIdx = matchVarToEq.get(v);
    if (eqIdx === undefined) return [];
    return Array.from(eqDeps.get(eqIdx) ?? []).filter((dep) => dep !== v);
  };

  // Tarjan SCC
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

  // 7. Convert SCCs to init blocks (Tarjan produces correct topological order)
  const blocks: InitBlock[] = [];

  for (const scc of sccs) {
    if (scc.length === 1) {
      const varName = scc[0]!;
      const eqIdx = matchVarToEq.get(varName);
      if (eqIdx === undefined) continue;
      const eq = initEquations[eqIdx]!;
      const deps = eqDeps.get(eqIdx) ?? new Set();

      // Check if it's explicitly solvable: LHS or RHS is just the variable
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
        // Single-variable implicit equation (self-referencing)
        blocks.push({
          type: "implicit",
          unknowns: [varName],
          equations: [{ lhs: eq.lhs, rhs: eq.rhs }],
          hasDiscreteVars: discreteVarNames.has(varName),
        });
      }
    } else {
      // Multi-variable algebraic loop
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

// ── Helpers ──

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

/** Returns true if `deps` contains any unknown other than `exclude`. */
function depsExcluding(deps: Set<string>, exclude: string): boolean {
  for (const d of deps) {
    if (d !== exclude) return true;
  }
  return false;
}
