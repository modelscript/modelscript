// SPDX-License-Identifier: AGPL-3.0-or-later
import { ArenaDAEBuilder, EqKind, ExprKind, Variability } from "./wasm_dae.js";

// WASM Exports mapped globally within this module
export let alloc: (size: number) => number;
export let computeBlt: (
  varCount: number,
  eqCount: number,
  adjPtr: number,
  outEqsPtr: number,
  outBlocksPtr: number,
) => number;
export let memory: WebAssembly.Memory;

let isInitialized = false;

/**
 * Initializes the WASM-based BLT transformation engine.
 * Must be called before `performBltTransformationArena` can be used.
 */
export async function initBltWasm(urlOverride?: string | URL): Promise<void> {
  if (isInitialized) return;
  let url: string | URL;

  const isNodeOrBun =
    typeof process != "undefined" &&
    process.versions != null &&
    (process.versions.node != null || process.versions.bun != null);

  if (urlOverride) {
    url = urlOverride;
  } else {
    if (isNodeOrBun) {
      // In Node.js, read from file system relative to dist/ or src/
      const { join } = await import("path");
      const { existsSync } = await import("node:fs");
      const candidate1 = join(import.meta.dirname, "..", "build", "release.wasm");
      const candidate2 = join(import.meta.dirname, "..", "..", "build", "release.wasm");
      url = existsSync(candidate1) ? candidate1 : candidate2;
    } else {
      // In browser context, use relative URL from the current module
      url = new URL("../build/release.wasm", import.meta.url);
    }
  }

  let module: WebAssembly.Module;
  if (isNodeOrBun) {
    const fs = await import("node:fs/promises");
    module = await globalThis.WebAssembly.compile(await fs.readFile(url));
  } else {
    module = await globalThis.WebAssembly.compileStreaming(globalThis.fetch(url));
  }

  const instance = await globalThis.WebAssembly.instantiate(module, {
    env: {
      abort: () => {
        /* empty */
      },
    },
  });
  const exports = instance.exports as Record<string, unknown>;
  alloc = exports.alloc as (size: number) => number;
  computeBlt = exports.computeBlt as typeof computeBlt;
  memory = exports.memory as WebAssembly.Memory;
  isInitialized = true;
}

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
 * Performs Block Lower Triangular (BLT) transformation natively on the ArenaDAEBuilder
 * by constructing adjacency matrices directly from arena expression graphs.
 */
export function performBltTransformationArena(
  arena: ArenaDAEBuilder,
  stateVars?: Set<string | number>,
  dummyDerivatives?: Set<string | number>,
): ArenaBltResult {
  if (!isInitialized) {
    throw new Error("BLT WASM engine not initialized. Call initBltWasm() first.");
  }

  // 1. Identify active continuous/discrete variables and non-binding equations
  const activeVarIndices: number[] = [];
  const varToActiveMap = new Map<number, number>();

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const variability = arena.getVarVariability(i);
    // Ignore parameter/constant variables during dynamic equation BLT
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      continue;
    }
    // If state variables are specified, the state variable x itself is known at each integration step
    // (its derivative der(x) is what needs to be solved, unless in dummyDerivatives).
    if (stateVars && stateVars.has(i) && (!dummyDerivatives || !dummyDerivatives.has(i))) {
      continue;
    }
    varToActiveMap.set(i, activeVarIndices.length);
    activeVarIndices.push(i);
  }

  const activeEqIndices: number[] = [];
  for (let i = 0; i < arena.eqCount; i++) {
    const kind = arena.getEqKind(i);
    // Include dynamic Simple and InitialSimple equations
    if (kind === EqKind.Simple || kind === EqKind.InitialSimple) {
      activeEqIndices.push(i);
    }
  }

  const varCount = activeVarIndices.length;
  const eqCount = activeEqIndices.length;

  if (varCount === 0 || eqCount === 0) {
    return { sortedEquations: [], blocks: [] };
  }

  // 2. Build Adjacency List (CSR format expected by computeBlt)
  const eqActiveDeps: number[][] = [];
  let totalInts = 0;

  for (let e = 0; e < eqCount; e++) {
    const eqIdx = activeEqIndices[e]!;
    const lhs = arena.getEqLhs(eqIdx);
    const rhs = arena.getEqRhs(eqIdx);

    const deps = new Set<number>();
    collectArenaExprDeps(arena, lhs, deps, true);
    collectArenaExprDeps(arena, rhs, deps, true);

    const activeList: number[] = [];
    for (const varIdx of deps) {
      const activeIdx = varToActiveMap.get(varIdx);
      if (activeIdx !== undefined) {
        activeList.push(activeIdx);
      }
    }
    eqActiveDeps.push(activeList);
    totalInts += 1 + activeList.length;
  }

  const adjPtr = alloc(totalInts * 4);
  const adjView = new Int32Array(memory.buffer, adjPtr, totalInts);
  let cursor = 0;
  for (let e = 0; e < eqCount; e++) {
    const list = eqActiveDeps[e]!;
    adjView[cursor++] = list.length;
    for (const activeIdx of list) {
      adjView[cursor++] = activeIdx;
    }
  }

  // 3. Allocate outputs
  // outEqs: i32[eqCount]
  // outBlocks: i32[1 + eqCount * 2 + varCount * 2]
  const blocksBufCapacity = 1 + (eqCount + varCount) * 2;
  const outEqsPtr = alloc(eqCount * 4);
  const outBlocksPtr = alloc(blocksBufCapacity * 4);

  // 4. Compute BLT in WASM
  const numBlocks = computeBlt(varCount, eqCount, adjPtr, outEqsPtr, outBlocksPtr);

  // 5. Read back results
  const outEqsView = new Int32Array(memory.buffer, outEqsPtr, eqCount);
  const sortedEquations: number[] = [];
  for (let i = 0; i < eqCount; i++) {
    const activeEqIdx = outEqsView[i]!;
    const origIdx = activeEqIndices[activeEqIdx];
    if (origIdx !== undefined) {
      sortedEquations.push(origIdx);
    }
  }

  const outBlocksView = new Int32Array(memory.buffer, outBlocksPtr, blocksBufCapacity);
  const blocks: { eqIdxs: number[]; vars: number[] }[] = [];

  let blocksCursor = 1;
  for (let b = 0; b < numBlocks; b++) {
    const bEqCount = outBlocksView[blocksCursor++] ?? 0;
    const bVarCount = outBlocksView[blocksCursor++] ?? 0;

    const bEqs: number[] = [];
    for (let k = 0; k < bEqCount; k++) {
      const activeEqIdx = outBlocksView[blocksCursor++] ?? 0;
      const origEqIdx = activeEqIndices[activeEqIdx];
      if (origEqIdx !== undefined) bEqs.push(origEqIdx);
    }

    const bVars: number[] = [];
    for (let k = 0; k < bVarCount; k++) {
      const activeVarIdx = outBlocksView[blocksCursor++] ?? 0;
      const origVarIdx = activeVarIndices[activeVarIdx];
      if (origVarIdx !== undefined) bVars.push(origVarIdx);
    }

    blocks.push({ eqIdxs: bEqs, vars: bVars });
  }

  return {
    sortedEquations,
    blocks,
  };
}
