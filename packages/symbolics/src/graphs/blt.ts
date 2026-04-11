import { isolateSymbolically } from "../ir/expressions.js";
import { egraphSimplify } from "../simplify/egraph.js";
import {
  ModelicaBooleanVariable,
  ModelicaDAE,
  ModelicaDAEVisitor,
  ModelicaEquation,
  ModelicaExpression,
  ModelicaFunctionCallEquation,
  ModelicaIntegerVariable,
  ModelicaNameExpression,
  ModelicaRealVariable,
  ModelicaSimpleEquation,
} from "../systems/index.js";

/**
 * Visitor that collects all variable names referenced in an expression/equation.
 */
class VariableNameCollector extends ModelicaDAEVisitor<Set<string>> {
  override visitNameExpression(node: ModelicaNameExpression, argument?: Set<string>): void {
    if (argument) argument.add(node.name);
  }
  override visitRealVariable(node: ModelicaRealVariable, argument?: Set<string>): void {
    if (argument) argument.add(node.name);
  }
  override visitIntegerVariable(node: ModelicaIntegerVariable, argument?: Set<string>): void {
    if (argument) argument.add(node.name);
  }
  override visitBooleanVariable(node: ModelicaBooleanVariable, argument?: Set<string>): void {
    if (argument) argument.add(node.name);
  }
}

/**
 * Check if the equation is a simple causal assignment for `v` (e.g., v = expr or expr = v)
 * where `v` does not appear on the other side.
 */
function isExplicitlySolvableFor(eq: ModelicaEquation, v: string): boolean {
  if (!(eq instanceof ModelicaSimpleEquation)) return false;
  const simpleEq = eq;
  if (!simpleEq.expression1 || !simpleEq.expression2) return false;

  const getNames = (expr: ModelicaExpression) => {
    const s = new Set<string>();
    const col = new VariableNameCollector();
    expr.accept(col, s);
    return s;
  };

  const lhsNames = getNames(simpleEq.expression1);
  const rhsNames = getNames(simpleEq.expression2);

  const isNameOrVar = (expr: ModelicaExpression, target: string) => {
    return (
      (expr instanceof ModelicaNameExpression && expr.name === target) ||
      (expr instanceof ModelicaRealVariable && expr.name === target) ||
      (expr instanceof ModelicaIntegerVariable && expr.name === target) ||
      (expr instanceof ModelicaBooleanVariable && expr.name === target)
    );
  };

  if (isNameOrVar(simpleEq.expression1, v)) {
    return !rhsNames.has(v);
  }
  if (isNameOrVar(simpleEq.expression2, v)) {
    return !lhsNames.has(v);
  }
  return false;
}

/**
 * Attempt to symbolically isolate `v` from a `ModelicaSimpleEquation`.
 *
 * Before isolation, applies E-Graph Equality Saturation to simplify both sides
 * of the equation (constant folding, identity elimination, exp/log/trig identities).
 * This canonicalization improves the chance of successful symbolic isolation.
 *
 * Returns a new explicit equation `v = expr` if successful, or null.
 */
function trySymbolicIsolation(eq: ModelicaEquation, v: string): ModelicaSimpleEquation | null {
  if (!(eq instanceof ModelicaSimpleEquation)) return null;
  if (!eq.expression1 || !eq.expression2) return null;

  // E-Graph pre-simplification: canonicalize expressions before isolation
  const lhs = egraphSimplify(eq.expression1);
  const rhs = egraphSimplify(eq.expression2);

  const result = isolateSymbolically(lhs, rhs, v);
  if (!result) return null;

  const nameExpr = new ModelicaNameExpression(v);
  return new ModelicaSimpleEquation(nameExpr, result);
}

/**
 * Perform a full Block Lower Triangular (BLT) Transformation on the DAE equations.
 */
export function performBltTransformation(dae: ModelicaDAE): {
  sortedEquations: ModelicaEquation[];
  algebraicLoops: { variables: string[]; equations: ModelicaEquation[] }[];
} {
  // 1. Identify all unknown variables (continuous states/algebraics, and discrete variables)
  const unknowns = new Set<string>();
  const unknownList: string[] = [];

  for (const v of dae.variables) {
    if (v instanceof ModelicaRealVariable && v.variability === null) {
      unknowns.add(v.name);
      unknownList.push(v.name);
    }
    // derivatives are unknowns too
    if (v instanceof ModelicaRealVariable && v.name.startsWith("der(")) {
      unknowns.add(v.name);
      unknownList.push(v.name);
    }
  }

  const equations: ModelicaEquation[] = [];
  const constraintEquations: ModelicaEquation[] = [];

  for (const eq of dae.equations) {
    if (eq instanceof ModelicaFunctionCallEquation) {
      constraintEquations.push(eq);
    } else {
      equations.push(eq);
    }
  }

  // 2. Build Bipartite Graph E -> V
  // eqDeps maps from equation index to set of unknown variable names it depends on
  const eqDeps = new Map<number, Set<string>>();
  const collector = new VariableNameCollector();

  for (let i = 0; i < equations.length; i++) {
    const eq = equations[i];
    if (!eq) continue;

    const deps = new Set<string>();
    eq.accept(collector, deps);

    const filteredDeps = new Set<string>();
    for (const d of deps) {
      if (unknowns.has(d)) filteredDeps.add(d);
    }
    eqDeps.set(i, filteredDeps);
  }

  // 3. Maximum Cardinality Bipartite Matching

  // Let's do standard Hopcroft-Karp or DFS max matching
  const match = new Map<string, number>(); // variable -> equation index
  const assignedEqs = new Set<number>(); // equation indices already matched

  for (let u = 0; u < equations.length; u++) {
    const visited = new Set<string>();
    const dfs = (eqIndex: number): boolean => {
      const deps = eqDeps.get(eqIndex) || new Set<string>();
      for (const v of deps) {
        if (!visited.has(v)) {
          visited.add(v);
          const previouslyAssignedEq = match.get(v);
          if (previouslyAssignedEq === undefined || dfs(previouslyAssignedEq)) {
            match.set(v, eqIndex);
            return true;
          }
        }
      }
      return false;
    };
    if (dfs(u)) {
      assignedEqs.add(u);
    }
  }

  // Diagnostics: Balanced system?
  if (match.size < unknowns.size) {
    console.warn(`[BLT] Under-determined system: ${match.size} equations matched to ${unknowns.size} unknowns.`);
  }
  if (assignedEqs.size < equations.length) {
    console.warn(`[BLT] Over-determined system: ${equations.length - assignedEqs.size} unused equations.`);
  }

  // 4. Build Directed Graph & Tarjan SCC
  // Nodes are equations (or we can do variables). Let's use variables.
  // Edge V1 -> V2 means V1 depends on V2.
  // eq = match.get(V1) is the equation computing V1.
  // The dependencies of V1 are essentially eqDeps.get(eq) minus {V1}.

  let indexCounter = 0;
  const indexMap = new Map<string, number>();
  const lowlinkMap = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const getVarDeps = (v: string): string[] => {
    const eqIdx = match.get(v);
    if (eqIdx === undefined) return [];
    return Array.from(eqDeps.get(eqIdx) || []).filter((dep) => dep !== v);
  };

  const strongconnect = (v: string) => {
    indexMap.set(v, indexCounter);
    lowlinkMap.set(v, indexCounter);
    indexCounter++;
    stack.push(v);
    onStack.add(v);

    for (const w of getVarDeps(v)) {
      if (!indexMap.has(w)) {
        strongconnect(w);
        const lowV = lowlinkMap.get(v);
        const lowW = lowlinkMap.get(w);
        if (lowV !== undefined && lowW !== undefined) {
          lowlinkMap.set(v, Math.min(lowV, lowW));
        }
      } else if (onStack.has(w)) {
        const lowV = lowlinkMap.get(v);
        const indexW = indexMap.get(w);
        if (lowV !== undefined && indexW !== undefined) {
          lowlinkMap.set(v, Math.min(lowV, indexW));
        }
      }
    }

    const currentLowLinkV = lowlinkMap.get(v);
    const currentIndexV = indexMap.get(v);
    if (currentLowLinkV !== undefined && currentIndexV !== undefined && currentLowLinkV === currentIndexV) {
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
    if (!indexMap.has(v)) {
      strongconnect(v);
    }
  }

  // Tarjan produces SCCs in reverse topological sort order.
  // To evaluate dependencies first, we should evaluate in the reverse order of Tarjan's output,
  // NO wait. V1 -> V2 means V1 depends on V2. Tarjan visits V1, then visits V2, pops V2, pops V1.
  // So Tarjan produces [V2, V1]. The first element in `sccs` is the SCC with NO outgoing edges (dependencies).
  // Thus, the `sccs` array is ALREADY in the correct topological order (independent first)!

  const sortedEquations: ModelicaEquation[] = [];
  const algebraicLoops: { variables: string[]; equations: ModelicaEquation[] }[] = [];

  for (const scc of sccs) {
    const sccEqs: ModelicaEquation[] = [];
    for (const v of scc) {
      const eqIdx = match.get(v);
      if (eqIdx !== undefined) {
        const matchingEq = equations[eqIdx];
        if (matchingEq) {
          sccEqs.push(matchingEq);
        }
      }
    }

    if (scc.length > 1) {
      algebraicLoops.push({ variables: scc, equations: sccEqs });
    } else if (scc.length === 1) {
      // check self loop
      const v = scc[0];
      if (v !== undefined) {
        const eqIdx = match.get(v);
        if (eqIdx !== undefined) {
          const deps = eqDeps.get(eqIdx);
          if (deps?.has(v)) {
            // It's a single variable assigned to this equation. But is it a true loop?
            // If it's a structural explicit assignment (v = ...), it's not an algebraic loop.
            const matchingEq = equations[eqIdx];
            if (matchingEq && !isExplicitlySolvableFor(matchingEq, v)) {
              // Try symbolic isolation before giving up
              const isolated = trySymbolicIsolation(matchingEq, v);
              if (isolated) {
                // Replace the implicit equation with the explicit one
                const idx = sccEqs.indexOf(matchingEq);
                if (idx >= 0) sccEqs[idx] = isolated;
                equations[eqIdx] = isolated;
                // Propagate back to the original DAE so output uses the isolated form
                const origIdx = dae.equations.indexOf(matchingEq);
                if (origIdx >= 0) dae.equations[origIdx] = isolated;
              } else {
                // implicit single variable loop — cannot isolate
                algebraicLoops.push({ variables: scc, equations: sccEqs });
              }
            }
          }
        }
      }
    }

    sortedEquations.push(...sccEqs);
  }

  // Add any unused equations at the end for logging/diagnostics
  for (let i = 0; i < equations.length; i++) {
    if (!assignedEqs.has(i)) {
      const eq = equations[i];
      if (eq) sortedEquations.push(eq);
    }
  }

  // Add constraint and assertion equations at the very end
  sortedEquations.push(...constraintEquations);

  return { sortedEquations, algebraicLoops };
}
