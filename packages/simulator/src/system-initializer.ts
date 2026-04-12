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

import { ModelicaVariability } from "@modelscript/modelica-ast";
import {
  ModelicaArray,
  ModelicaArrayEquation,
  ModelicaBooleanLiteral,
  ModelicaBooleanVariable,
  type ModelicaDAE,
  type ModelicaExpression,
  ModelicaFunctionCallExpression,
  ModelicaIntegerVariable,
  ModelicaNameExpression,
} from "@modelscript/symbolics";

// ── Public types ──

/** An explicit assignment block: target = expr (no unknowns on RHS). */
export interface ExplicitInitBlock {
  type: "explicit";
  /** Variable name being assigned. */
  target: string;
  /** Expression to evaluate. */
  expr: ModelicaExpression;
}

/** An implicit algebraic loop block requiring Newton/homotopy solving. */
export interface ImplicitInitBlock {
  type: "implicit";
  /** Unknown variable names in this loop. */
  unknowns: string[];
  /** Equations in the loop (LHS = RHS pairs). */
  equations: { lhs: ModelicaExpression; rhs: ModelicaExpression }[];
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

/** Collect all variable names referenced in an expression. */
function collectExprVarNames(expr: ModelicaExpression, names: Set<string>): void {
  if (!expr || typeof expr !== "object") return;
  if (expr instanceof ModelicaNameExpression) {
    names.add(expr.name);
    return;
  }
  if (expr instanceof ModelicaArray) {
    for (const elem of expr.flatElements) collectExprVarNames(elem, names);
    return;
  }
  if ("name" in expr) names.add((expr as { name: string }).name);
  if ("operand" in expr) collectExprVarNames((expr as { operand: ModelicaExpression }).operand, names);
  if ("operand1" in expr) collectExprVarNames((expr as { operand1: ModelicaExpression }).operand1, names);
  if ("operand2" in expr) collectExprVarNames((expr as { operand2: ModelicaExpression }).operand2, names);
  if (expr instanceof ModelicaFunctionCallExpression) {
    if (expr.functionName === "der" && expr.args.length === 1) {
      const a = expr.args[0];
      if (a && typeof a === "object" && "name" in a) {
        names.add(`der(${(a as { name: string }).name})`);
      }
    }
    for (const arg of expr.args) collectExprVarNames(arg, names);
  }
}

// ── Core algorithm ──

/**
 * Build the initialization BLT from a flattened DAE.
 *
 * @param dae The flattened DAE with initialEquations and variables
 * @returns Ordered sequence of init blocks ready for solving
 */
export function buildInitBLT(dae: ModelicaDAE): InitBLTResult {
  // 1. Classify knowns vs unknowns
  const knowns = new Set<string>();
  const discreteVarNames = new Set<string>();
  knowns.add("time");

  for (const v of dae.variables) {
    // Parameters and constants are always known
    if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
      knowns.add(v.name);
      continue;
    }
    // Fixed=true variables are known (their start value is the solution)
    const fixedAttr = v.attributes.get("fixed");
    if (fixedAttr && fixedAttr instanceof ModelicaBooleanLiteral && fixedAttr.value) {
      knowns.add(v.name);
      continue;
    }
    // Track discrete variables
    if (v instanceof ModelicaIntegerVariable || v instanceof ModelicaBooleanVariable) {
      discreteVarNames.add(v.name);
    }
  }

  // 2. Collect all equations for initialization
  //    - Initial equations (explicit initial conditions)
  //    - Continuous equations evaluated at t=0 (dynamic constraints)
  const initEquations: { lhs: ModelicaExpression; rhs: ModelicaExpression; source: "initial" | "continuous" }[] = [];

  for (const eq of dae.initialEquations) {
    if (eq instanceof ModelicaArrayEquation) {
      // Unroll array equations element-wise
      const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
      const lhsElems = se.expression1 instanceof ModelicaArray ? [...se.expression1.flatElements] : [se.expression1];
      const rhsElems = se.expression2 instanceof ModelicaArray ? [...se.expression2.flatElements] : [se.expression2];
      const n = Math.max(lhsElems.length, rhsElems.length);
      for (let i = 0; i < n; i++) {
        const lhs = lhsElems[i] ?? lhsElems[0];
        const rhs = rhsElems[i] ?? rhsElems[0];
        if (lhs && rhs) initEquations.push({ lhs, rhs, source: "initial" });
      }
    } else if ("expression1" in eq && "expression2" in eq) {
      const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
      initEquations.push({ lhs: se.expression1, rhs: se.expression2, source: "initial" });
    }
  }

  // Add continuous equations (they also hold at t=0)
  for (const eq of dae.equations) {
    if (eq instanceof ModelicaArrayEquation) {
      const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
      const lhsElems = se.expression1 instanceof ModelicaArray ? [...se.expression1.flatElements] : [se.expression1];
      const rhsElems = se.expression2 instanceof ModelicaArray ? [...se.expression2.flatElements] : [se.expression2];
      const n = Math.max(lhsElems.length, rhsElems.length);
      for (let i = 0; i < n; i++) {
        const lhs = lhsElems[i] ?? lhsElems[0];
        const rhs = rhsElems[i] ?? rhsElems[0];
        if (lhs && rhs) initEquations.push({ lhs, rhs, source: "continuous" });
      }
    } else if ("expression1" in eq && "expression2" in eq) {
      const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
      initEquations.push({ lhs: se.expression1, rhs: se.expression2, source: "continuous" });
    }
  }

  if (initEquations.length === 0) {
    return { blocks: [], knowns, unknowns: new Set() };
  }

  // 3. Determine unknowns: all referenced vars that are not known
  const allReferenced = new Set<string>();
  for (const eq of initEquations) {
    collectExprVarNames(eq.lhs, allReferenced);
    collectExprVarNames(eq.rhs, allReferenced);
  }

  const unknowns = new Set<string>();
  for (const name of allReferenced) {
    if (!knowns.has(name)) unknowns.add(name);
  }

  // Expand array unknowns
  for (const v of dae.variables) {
    if (v.arrayDimensions && v.arrayDimensions.length > 0 && unknowns.has(v.name)) {
      const size = v.arrayDimensions.reduce((a: number, b: number) => a * b, 1);
      for (let i = 0; i < size; i++) unknowns.add(`${v.name}[${i + 1}]`);
    }
  }

  if (unknowns.size === 0) {
    return { blocks: [], knowns, unknowns };
  }

  // 4. Build bipartite graph: equation index → set of unknown variable names
  const eqDeps = new Map<number, Set<string>>();
  for (let i = 0; i < initEquations.length; i++) {
    const eq = initEquations[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const refs = new Set<string>();
    collectExprVarNames(eq.lhs, refs);
    collectExprVarNames(eq.rhs, refs);
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
        lowlinkMap.set(v, Math.min(lowlinkMap.get(v)!, lowlinkMap.get(w)!)); // eslint-disable-line @typescript-eslint/no-non-null-assertion
      } else if (onStack.has(w)) {
        lowlinkMap.set(v, Math.min(lowlinkMap.get(v)!, indexMap.get(w)!)); // eslint-disable-line @typescript-eslint/no-non-null-assertion
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
      const varName = scc[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const eqIdx = matchVarToEq.get(varName);
      if (eqIdx === undefined) continue;
      const eq = initEquations[eqIdx]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const deps = eqDeps.get(eqIdx) ?? new Set();

      // Check if it's explicitly solvable: LHS or RHS is just the variable
      const lhsName = extractSimpleName(eq.lhs);
      const rhsName = extractSimpleName(eq.rhs);
      const derLhs = extractDerName(eq.lhs);
      const derRhs = extractDerName(eq.rhs);

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
      const loopEqs: { lhs: ModelicaExpression; rhs: ModelicaExpression }[] = [];
      let hasDiscrete = false;
      for (const v of scc) {
        const eqIdx = matchVarToEq.get(v);
        if (eqIdx !== undefined) {
          const eq = initEquations[eqIdx]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
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

function extractSimpleName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaNameExpression) return expr.name;
  if (expr && typeof expr === "object" && "name" in expr && !("operand" in expr) && !("operand1" in expr)) {
    return (expr as { name: string }).name;
  }
  return null;
}

function extractDerName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaFunctionCallExpression && expr.functionName === "der" && expr.args.length === 1) {
    const a = expr.args[0];
    if (a && typeof a === "object" && "name" in a) return (a as { name: string }).name;
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
