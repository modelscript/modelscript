// SPDX-License-Identifier: AGPL-3.0-or-later
import { BinOp, DAEBuilder, EqKind, ExprKind, Variability } from "../dae/wasm_dae.js";

// WASM Exports mapped globally within this module
export let alloc: (size: number) => number;
export let free: (ptr: number) => void;
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
    (process.versions.node != null || process.versions["bun"] != null);

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
      // In browser context, use relative URL from serverDistBase or current module
      const serverDist = (globalThis as any).serverDistBase;
      if (serverDist) {
        url = `${serverDist}/release.wasm`;
      } else {
        const base =
          typeof import.meta !== "undefined" && import.meta.url
            ? import.meta.url
            : (typeof self !== "undefined" && self.location?.href) ||
              (typeof document !== "undefined" && document.baseURI) ||
              "http://localhost/";
        try {
          url = new URL("../build/release.wasm", base);
        } catch {
          url = "/release.wasm";
        }
      }
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
  alloc = exports["alloc"] as (size: number) => number;
  free = exports["free"] as (ptr: number) => void;
  computeBlt = exports["computeBlt"] as typeof computeBlt;
  memory = exports["memory"] as WebAssembly.Memory;
  isInitialized = true;
}

/**
 * Checks if an expression statically evaluates to zero (e.g. numeric literal 0 or parameter/constant with value 0).
 */
export function isZeroExpr(arena: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = arena.getExprKind(exprId);
  if (k === ExprKind.RealLiteral) return arena.getExprRealValue(exprId) === 0;
  if (k === ExprKind.IntLiteral) return arena.getExprData1(exprId) === 0;
  if (k === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const varIdx = resolveArenaVarIdx(arena, nameId);
    if (varIdx !== -1) {
      const v = arena.getVarVariability(varIdx);
      if (v === Variability.Parameter || v === Variability.Constant) {
        if (arena.getVarStartValue(varIdx) === 0) {
          const expr = arena.getVarExpression(varIdx);
          if (expr === -1 || expr === undefined) return true;
          return isZeroExpr(arena, expr);
        }
      }
    }
  }
  if (k === ExprKind.Negate) {
    const left = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
    return isZeroExpr(arena, left);
  }
  if (k === ExprKind.Binary) {
    const op = arena.getExprData1(exprId);
    if (op === BinOp.Mul || op === BinOp.ElemMul) {
      return isZeroExpr(arena, arena.getExprLeft(exprId)) || isZeroExpr(arena, arena.getExprRight(exprId));
    }
  }
  return false;
}

/**
 * Collects all variable indices referenced in an expression.
 *
 * @param excludeDer - If true, variables inside `der()` are excluded from
 *   the dependency set. This is needed for BLT matching where `der(x) = expr`
 *   defines der(x), not x. The integrator handles state updates.
 */
export function collectArenaExprDeps(arena: DAEBuilder, exprId: number, deps: Set<number>, excludeDer = false): void {
  if (exprId < 0) return;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const varIdx = resolveArenaVarIdx(arena, nameId);
      if (varIdx !== -1) deps.add(varIdx);
      break;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);
      if (op === BinOp.Mul || op === BinOp.ElemMul) {
        if (isZeroExpr(arena, left) || isZeroExpr(arena, right)) {
          break;
        }
      }
      collectArenaExprDeps(arena, left, deps, excludeDer);
      collectArenaExprDeps(arena, right, deps, excludeDer);
      break;
    }
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
      // Function call: left is first arg, right is arg count; trailing args stored in left of (exprId + i)
      const argCount = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);
      for (let i = 0; i < argCount; i++) {
        const argExpr = i === 0 ? firstArg : arena.getExprLeft(exprId + i);
        if (argExpr >= 0) collectArenaExprDeps(arena, argExpr, deps, excludeDer);
      }
      break;
    }
    case ExprKind.Subscript: {
      collectArenaExprDeps(arena, arena.getExprData1(exprId), deps, excludeDer);
      const subCount = Math.max(1, arena.getExprRight(exprId));
      const firstSub = arena.getExprLeft(exprId);
      for (let i = 0; i < subCount; i++) {
        const subExpr = i === 0 ? firstSub : arena.getExprLeft(exprId + i);
        if (subExpr >= 0 && subExpr !== 0xffffffff) collectArenaExprDeps(arena, subExpr, deps, excludeDer);
      }
      break;
    }
    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      for (let i = 0; i < count; i++) {
        const elem = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        if (elem >= 0) collectArenaExprDeps(arena, elem, deps, excludeDer);
      }
      break;
    }
    case ExprKind.Tuple: {
      const tcount = arena.getExprData1(exprId);
      for (let i = 0; i < tcount; i++) {
        const elem = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        if (elem >= 0) collectArenaExprDeps(arena, elem, deps, excludeDer);
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
 * Note: DAEBuilder should ideally have a Map<StringId, number> for O(1) lookup.
 */
function resolveArenaVarIdx(arena: DAEBuilder, nameId: number): number {
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
 * Performs Block Lower Triangular (BLT) transformation natively on the DAEBuilder
 * by constructing adjacency matrices directly from arena expression graphs.
 */
export function performBltTransformationArena(
  arena: DAEBuilder,
  stateVars?: Set<string | number>,
  dummyDerivatives?: Set<string | number>,
  parameterVars?: Set<number>,
): ArenaBltResult {
  const stateKey = stateVars ? Array.from(stateVars).sort().join(",") : "";
  const dummyKey = dummyDerivatives ? Array.from(dummyDerivatives).sort().join(",") : "";
  const cached = (arena as any).cachedBlt;
  if (
    cached &&
    cached.varCount === arena.varCount &&
    cached.eqCount === arena.eqCount &&
    cached.stateKey === stateKey &&
    cached.dummyKey === dummyKey
  ) {
    return cached;
  }

  if (!isInitialized) {
    throw new Error("BLT WASM engine not initialized. Call initBltWasm() first.");
  }

  // 1. Identify active continuous/discrete variables and non-binding equations
  const activeVarIndices: number[] = [];
  const varToActiveMap = new Map<number, number>();

  // Identify variables produced by FMU subsystems (known at each step, solved outside Modelica algebraic loops)
  const fmuOutputVarIndices = new Set<number>();
  const fmuInstances = arena.extensionMetadata?.fmuInstances as any[] | undefined;
  if (Array.isArray(fmuInstances)) {
    for (const fmu of fmuInstances) {
      for (const outName of fmu.outputs || []) {
        const fullName = fmu.instanceName ? `${fmu.instanceName}.${outName}` : outName;
        const vId = arena.getVarIdxByName(fullName);
        if (vId >= 0) fmuOutputVarIndices.add(vId);
      }
    }
  }

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    if (fmuOutputVarIndices.has(i)) continue;
    const variability = arena.getVarVariability(i);
    // Ignore parameter/constant variables during dynamic equation BLT
    if (
      variability === Variability.Parameter ||
      variability === Variability.Constant ||
      variability === Variability.Discrete ||
      (parameterVars ? parameterVars.has(i) : arena.hasExplicitVarExpression?.(i) && (!stateVars || !stateVars.has(i)))
    ) {
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
    if (arena.isEqRemoved?.(i) || arena.isEqInitial?.(i)) continue;
    const eqFlags = arena.getEqFlags?.(i) ?? 0;
    if (eqFlags !== -1 && eqFlags >>> 0 !== 0xffffffff && (eqFlags & 1) /* FLAG_EQ_INITIAL */ !== 0) continue;
    const kind = arena.getEqKind(i);
    // Include only dynamic Simple and For equations (exclude InitialSimple and InitialFor)
    if (kind === EqKind.Simple) {
      const lhs = arena.getEqLhs(i);
      const rhs = arena.getEqRhs(i);
      if (lhs === rhs) continue;
      if (
        lhs >= 0 &&
        rhs >= 0 &&
        arena.getExprKind(lhs) === ExprKind.Name &&
        arena.getExprKind(rhs) === ExprKind.Name &&
        arena.getExprData1(lhs) === arena.getExprData1(rhs)
      ) {
        continue;
      }
      activeEqIndices.push(i);
    } else if (kind === EqKind.For) {
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
    const kind = arena.getEqKind(eqIdx);
    const deps = new Set<number>();

    if (kind === EqKind.For) {
      const meta = arena.getForEquationMeta?.(eqIdx);
      if (meta) {
        const bodyEqs = meta.equations ?? meta.bodyEquations ?? [];
        for (const bEq of bodyEqs) {
          const bLhs = "lhs" in bEq ? bEq.lhs : (bEq as any).lhsExprId;
          const bRhs = "rhs" in bEq ? bEq.rhs : (bEq as any).rhsExprId;
          collectArenaExprDeps(arena, bLhs, deps, true);
          collectArenaExprDeps(arena, bRhs, deps, true);
        }
      }
    } else {
      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);
      collectArenaExprDeps(arena, lhs, deps, true);
      collectArenaExprDeps(arena, rhs, deps, true);
    }

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

  let adjPtr = 0;
  let outEqsPtr = 0;
  let outBlocksPtr = 0;
  const sortedEquations: number[] = [];
  const blocks: { eqIdxs: number[]; vars: number[] }[] = [];

  try {
    adjPtr = alloc(totalInts * 4);
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
    // outBlocks: i32[1 + (eqCount + varCount) * 4]
    const blocksBufCapacity = 1 + (eqCount + varCount) * 4;
    outEqsPtr = alloc(eqCount * 4);
    outBlocksPtr = alloc(blocksBufCapacity * 4);

    // 4. Compute BLT in WASM
    const numBlocks = computeBlt(varCount, eqCount, adjPtr, outEqsPtr, outBlocksPtr);

    // 5. Read back results
    const outEqsView = new Int32Array(memory.buffer, outEqsPtr, eqCount);
    for (let i = 0; i < eqCount; i++) {
      const activeEqIdx = outEqsView[i]!;
      const origIdx = activeEqIndices[activeEqIdx];
      if (origIdx !== undefined) {
        sortedEquations.push(origIdx);
      }
    }

    const outBlocksView = new Int32Array(memory.buffer, outBlocksPtr, blocksBufCapacity);
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
  } finally {
    if (typeof free === "function") {
      if (outBlocksPtr !== 0) free(outBlocksPtr);
      if (outEqsPtr !== 0) free(outEqsPtr);
      if (adjPtr !== 0) free(adjPtr);
    }
  }

  const result = {
    sortedEquations,
    blocks,
  };

  (arena as any).cachedBlt = {
    ...result,
    varCount: arena.varCount,
    eqCount: arena.eqCount,
    stateKey,
    dummyKey,
  };

  return result;
}
