// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, EqKind, ExprKind, Variability } from "./dae-arena.js";

/**
 * Collects all variable indices referenced in an expression.
 */
export function collectArenaExprDeps(arena: ArenaDAEBuilder, exprId: number, deps: Set<number>): void {
  if (exprId === -1) return;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      // We need to resolve NameId to VarIdx.
      // ArenaDAEBuilder has varCount, but no fast NameId -> VarIdx lookup yet.
      // We must build it or assume we have it.
      // For now, let's assume `resolveArenaVarIdx(arena, nameId)` exists.
      const varIdx = resolveArenaVarIdx(arena, nameId);
      if (varIdx !== -1) deps.add(varIdx);
      break;
    }
    case ExprKind.Binary:
      collectArenaExprDeps(arena, arena.getExprLeft(exprId), deps);
      collectArenaExprDeps(arena, arena.getExprRight(exprId), deps);
      break;
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      collectArenaExprDeps(arena, arena.getExprLeft(exprId), deps);
      break;
    case ExprKind.Call: {
      // Function call: left is first arg, right is arg count
      const argCount = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);
      for (let i = 0; i < argCount; i++) {
        collectArenaExprDeps(arena, firstArg + i, deps);
      }
      break;
    }
    case ExprKind.Subscript:
      collectArenaExprDeps(arena, arena.getExprData1(exprId), deps);
      collectArenaExprDeps(arena, arena.getExprLeft(exprId), deps);
      break;
    // Handle other compound types appropriately
  }
}

/**
 * Resolves a StringId to a VarIdx.
 * Note: ArenaDAEBuilder should ideally have a Map<StringId, number> for O(1) lookup.
 */
function resolveArenaVarIdx(arena: ArenaDAEBuilder, nameId: number): number {
  // O(N) fallback if not cached
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i) && arena.getVarNameId(i) === nameId) {
      return i;
    }
  }
  return -1;
}

export interface ArenaBltResult {
  sortedEquations: number[];
  blocks: { eqIdxs: number[]; vars: number[] }[];
}

/**
 * Performs Block Lower Triangular (BLT) Transformation natively on the DAE arena.
 */
export function performBltTransformationArena(arena: ArenaDAEBuilder): ArenaBltResult {
  const unknowns = new Set<number>();
  const unknownList: number[] = [];

  // 1. Identify unknown variables (Continuous, Discrete)
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Continuous || v === Variability.Discrete) {
      unknowns.add(i);
      unknownList.push(i);
    }
  }

  // 2. Map equations to dependencies
  const eqDeps = new Map<number, Set<number>>();
  const equations: number[] = [];

  for (let i = 0; i < arena.eqCount; i++) {
    if (arena.getEqKind(i) === EqKind.Simple) {
      equations.push(i);
      const deps = new Set<number>();
      collectArenaExprDeps(arena, arena.getEqLhs(i), deps);
      collectArenaExprDeps(arena, arena.getEqRhs(i), deps);

      const filteredDeps = new Set<number>();
      for (const d of deps) {
        if (unknowns.has(d)) filteredDeps.add(d);
      }
      eqDeps.set(i, filteredDeps);
    }
  }

  // 3. Maximum Cardinality Bipartite Matching (DFS / Hopcroft-Karp)
  const match = new Map<number, number>(); // VarIdx -> EqIdx
  const assignedEqs = new Set<number>();

  for (const eqIdx of equations) {
    const visited = new Set<number>();
    const dfs = (e: number): boolean => {
      const deps = eqDeps.get(e);
      if (!deps) return false;
      for (const v of deps) {
        if (!visited.has(v)) {
          visited.add(v);
          const previouslyAssignedEq = match.get(v);
          if (previouslyAssignedEq === undefined || dfs(previouslyAssignedEq)) {
            match.set(v, e);
            return true;
          }
        }
      }
      return false;
    };
    if (dfs(eqIdx)) {
      assignedEqs.add(eqIdx);
    }
  }

  // 4. Tarjan's SCC on the matching
  let indexCounter = 0;
  const indexMap = new Map<number, number>();
  const lowlinkMap = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const sccs: number[][] = []; // Array of VarIdx arrays

  const strongconnect = (v: number) => {
    indexMap.set(v, indexCounter);
    lowlinkMap.set(v, indexCounter);
    indexCounter++;
    stack.push(v);
    onStack.add(v);

    const eqIdx = match.get(v);
    const deps = eqIdx !== undefined ? Array.from(eqDeps.get(eqIdx) || []) : [];

    for (const w of deps) {
      if (w === v) continue;
      if (!indexMap.has(w)) {
        strongconnect(w);
        lowlinkMap.set(v, Math.min(lowlinkMap.get(v) ?? 0, lowlinkMap.get(w) ?? 0));
      } else if (onStack.has(w)) {
        lowlinkMap.set(v, Math.min(lowlinkMap.get(v) ?? 0, indexMap.get(w) ?? 0));
      }
    }

    if (lowlinkMap.get(v) === indexMap.get(v)) {
      const scc: number[] = [];
      let w: number;
      do {
        w = stack.pop() ?? -1;
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

  // 5. Build Sorted Equations
  const sortedEquations: number[] = [];
  const blocks: { eqIdxs: number[]; vars: number[] }[] = [];

  for (const scc of sccs) {
    const sccEqs: number[] = [];
    for (const v of scc) {
      const eqIdx = match.get(v);
      if (eqIdx !== undefined) sccEqs.push(eqIdx);
    }
    blocks.push({ eqIdxs: sccEqs, vars: scc });
    sortedEquations.push(...sccEqs);
  }

  // Unused equations
  for (const eqIdx of equations) {
    if (!assignedEqs.has(eqIdx)) {
      sortedEquations.push(eqIdx);
    }
  }

  return { sortedEquations, blocks };
}
