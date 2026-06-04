// SPDX-License-Identifier: AGPL-3.0-or-later

import { alloc, computeBlt, memory } from "../build/release.js";
import { ArenaDAEBuilder, EqKind, ExprKind, Variability } from "./dae-arena.js";

/**
 * Collects all variable indices referenced in an expression.
 *
 * @param excludeDer - If true, variables inside `der()` are excluded from
 *   the dependency set. This is needed for BLT matching where `der(x) = expr`
 *   defines der(x), not x. The integrator handles state updates.
 */
export function collectArenaExprDeps(
  arena: ArenaDAEBuilder,
  exprId: number,
  deps: Set<number>,
  excludeDer = false,
): void {
  if (exprId < 0) return;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const varIdx = resolveArenaVarIdx(arena, nameId);
      if (varIdx !== -1) deps.add(varIdx);
      break;
    }
    case ExprKind.Binary:
      collectArenaExprDeps(arena, arena.getExprLeft(exprId), deps, excludeDer);
      collectArenaExprDeps(arena, arena.getExprRight(exprId), deps, excludeDer);
      break;
    case ExprKind.Unary:
    case ExprKind.Negate:
      collectArenaExprDeps(arena, arena.getExprLeft(exprId), deps, excludeDer);
      break;
    case ExprKind.Der: {
      // Always treat der(x) as a separate algebraic variable if it exists in the arena
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const nameId = arena.getExprData1(argId);
        const name = arena.interner.resolve(nameId);
        if (name) {
          const derVarIdx = arena.getVarIdxByName(`der(${name})`);
          if (derVarIdx !== -1) {
            deps.add(derVarIdx);
          }
        }
      }
      // excludeDer only controls whether we recursively collect the inner variable 'x'.
      // Usually we don't, because der(x) defines the derivative, not the state x.
      if (!excludeDer) {
        collectArenaExprDeps(arena, arena.getExprData1(exprId), deps, excludeDer);
      }
      break;
    }
    case ExprKind.Pre:
      // Pre stores its argument in data1.
      collectArenaExprDeps(arena, arena.getExprData1(exprId), deps, excludeDer);
      break;
    case ExprKind.IfElse:
      collectArenaExprDeps(arena, arena.getExprData1(exprId), deps, excludeDer);
      collectArenaExprDeps(arena, arena.getExprLeft(exprId), deps, excludeDer);
      collectArenaExprDeps(arena, arena.getExprRight(exprId), deps, excludeDer);
      break;
    case ExprKind.Call: {
      // Function call: left is first arg, right is arg count
      const argCount = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);
      for (let i = 0; i < argCount; i++) {
        collectArenaExprDeps(arena, firstArg + i, deps, excludeDer);
      }
      break;
    }
    case ExprKind.Subscript:
      collectArenaExprDeps(arena, arena.getExprData1(exprId), deps, excludeDer);
      collectArenaExprDeps(arena, arena.getExprLeft(exprId), deps, excludeDer);
      break;
    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      const first = arena.getExprLeft(exprId);
      for (let i = 0; i < count; i++) {
        collectArenaExprDeps(arena, first + i, deps, excludeDer);
      }
      break;
    }
    case ExprKind.Tuple: {
      const tcount = arena.getExprData1(exprId);
      const tfirst = arena.getExprLeft(exprId);
      for (let i = 0; i < tcount; i++) {
        collectArenaExprDeps(arena, tfirst + i, deps, excludeDer);
      }
      break;
    }
    case ExprKind.Range:
      collectArenaExprDeps(arena, arena.getExprData1(exprId), deps, excludeDer);
      if (arena.getExprLeft(exprId) >= 0) collectArenaExprDeps(arena, arena.getExprLeft(exprId), deps, excludeDer);
      collectArenaExprDeps(arena, arena.getExprRight(exprId), deps, excludeDer);
      break;
    // Literals, Colon, Object: no variable dependencies
  }
}

/**
 * Resolves a StringId to a VarIdx.
 * Note: ArenaDAEBuilder should ideally have a Map<StringId, number> for O(1) lookup.
 */
function resolveArenaVarIdx(arena: ArenaDAEBuilder, nameId: number): number {
  // O(1): resolve StringId → name string → VarIdx via name index
  const name = arena.interner.resolve(nameId);
  if (!name) return -1;
  return arena.getVarIdxByName(name);
}

export interface ArenaBltResult {
  sortedEquations: number[];
  blocks: { eqIdxs: number[]; vars: number[] }[];
}

/**
 * Performs Block Lower Triangular (BLT) Transformation natively on the DAE arena.
 */
export function performBltTransformationArena(
  arena: ArenaDAEBuilder,
  stateVars: Set<number>,
  dummyDerivatives: Set<number>,
): ArenaBltResult {
  // 1. Identify unknown variables (Continuous, Discrete)
  const unknowns = new Set<number>();
  const unknownList: number[] = [];

  // 1. Identify unknown variables (Continuous, Discrete)
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Continuous || v === Variability.Discrete) {
      if (stateVars.has(i) && !dummyDerivatives.has(i)) {
        // State variables are managed by the ODE integrator and their values are known
        continue;
      }
      unknowns.add(i);
      unknownList.push(i);
    }
  }

  // 2. Map equations to dependencies
  const eqDepsArr = new Array<number[]>(arena.eqCount);
  let totalDepsCount = 0;

  for (let i = 0; i < arena.eqCount; i++) {
    eqDepsArr[i] = [];
    if (arena.getEqKind(i) !== EqKind.Simple) continue;

    const deps = new Set<number>();
    // excludeDer=true: variables inside der() are states managed by the
    // ODE integrator, not algebraic unknowns for the BLT to solve.
    collectArenaExprDeps(arena, arena.getEqLhs(i), deps, /* excludeDer */ true);
    collectArenaExprDeps(arena, arena.getEqRhs(i), deps, /* excludeDer */ true);

    const filteredDeps: number[] = [];
    for (const d of deps) {
      if (unknowns.has(d)) filteredDeps.push(d);
    }
    eqDepsArr[i] = filteredDeps;
    totalDepsCount += 1 + filteredDeps.length;
  }

  // 3. Allocate and write to WASM memory
  const adjSize = totalDepsCount * 4;
  const adjPtr = alloc(adjSize);
  const adjMem = new Int32Array(memory.buffer, adjPtr, totalDepsCount);
  let adjOffset = 0;
  for (let i = 0; i < arena.eqCount; i++) {
    const deps = eqDepsArr[i] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!;
    adjMem[adjOffset++] = deps.length;
    for (const d of deps) {
      adjMem[adjOffset++] = d;
    }
  }

  const outEqsSize = arena.eqCount * 4;
  const outEqsPtr = alloc(outEqsSize);

  const outBlocksMax = 1 + arena.eqCount * 2 + arena.varCount;
  const outBlocksSize = outBlocksMax * 4;
  const outBlocksPtr = alloc(outBlocksSize);

  // 4. Execute WASM BLT
  const blockCount = computeBlt(arena.varCount, arena.eqCount, adjPtr, outEqsPtr, outBlocksPtr);

  // 5. Read outputs
  const outEqsMem = new Int32Array(memory.buffer, outEqsPtr, arena.eqCount);
  const sortedEquations = Array.from(outEqsMem);

  const outBlocksMem = new Int32Array(memory.buffer, outBlocksPtr, outBlocksMax);
  const blocks: { eqIdxs: number[]; vars: number[] }[] = [];

  let bOffset = 1;
  for (let i = 0; i < blockCount; i++) {
    const eqLen = outBlocksMem[bOffset++] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!;
    const vLen = outBlocksMem[bOffset++] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!;
    const eqIdxs: number[] = [];
    for (let j = 0; j < eqLen; j++) {
      eqIdxs.push(outBlocksMem[bOffset++] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!);
    }
    const blockVars: number[] = [];
    for (let j = 0; j < vLen; j++) {
      blockVars.push(outBlocksMem[bOffset++] /* eslint-disable-line @typescript-eslint/no-non-null-assertion */!);
    }
    blocks.push({ eqIdxs, vars: blockVars });
  }

  return { sortedEquations, blocks };
}
