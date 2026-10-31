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

export interface BltCausalAssignment {
  eqIdx: number;
  solvedVar: number;
}

export interface BltBlockTearing {
  tearingVars: number[];
  residualEqs: number[];
  causalChain: Array<{ eqIdx: number; solvedVar: number }>;
}

export interface ArenaBltBlock {
  eqIdxs: number[];
  vars: number[];
  tearing?: BltBlockTearing | undefined;
}

export interface ArenaBltResult {
  sortedEquations: number[];
  blocks: ArenaBltBlock[];
}

function isTargetVarExpr(arena: DAEBuilder, exprId: number, varIdx: number): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    return resolveArenaVarIdx(arena, arena.getExprData1(exprId)) === varIdx;
  }
  if (kind === ExprKind.Der) {
    const argId = arena.getExprData1(exprId);
    if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
      const name = arena.interner.resolve(arena.getExprData1(argId));
      if (name) {
        return arena.getVarIdxByName(`der(${name})`) === varIdx;
      }
    }
  }
  return false;
}

function analyzeExprPivot(
  arena: DAEBuilder,
  exprId: number,
  varIdx: number,
  blockVarSet: Set<number>,
): { count: number; linear: boolean; monomial: boolean } {
  if (exprId < 0) return { count: 0, linear: true, monomial: true };
  if (isTargetVarExpr(arena, exprId, varIdx)) {
    return { count: 1, linear: true, monomial: true };
  }

  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Negate: {
      const inner = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
      return analyzeExprPivot(arena, inner, varIdx, blockVarSet);
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);
      if ((op === BinOp.Mul || op === BinOp.ElemMul) && (isZeroExpr(arena, left) || isZeroExpr(arena, right))) {
        return { count: 0, linear: true, monomial: true };
      }
      const lRes = analyzeExprPivot(arena, left, varIdx, blockVarSet);
      const rRes = analyzeExprPivot(arena, right, varIdx, blockVarSet);
      const totalCount = lRes.count + rRes.count;
      if (totalCount === 0) return { count: 0, linear: true, monomial: true };
      if (totalCount > 1) return { count: totalCount, linear: false, monomial: false };

      if (op === BinOp.Add || op === BinOp.Sub) {
        const active = lRes.count === 1 ? lRes : rRes;
        return { count: 1, linear: active.linear, monomial: active.monomial };
      }
      if (op === BinOp.Mul || op === BinOp.ElemMul) {
        const active = lRes.count === 1 ? lRes : rRes;
        const otherExpr = lRes.count === 1 ? right : left;
        const otherDeps = new Set<number>();
        collectArenaExprDeps(arena, otherExpr, otherDeps, true);
        let otherHasBlockVar = false;
        for (const d of otherDeps) {
          if (blockVarSet.has(d)) {
            otherHasBlockVar = true;
            break;
          }
        }
        return {
          count: 1,
          linear: active.linear && !otherHasBlockVar,
          monomial: active.monomial,
        };
      }
      if (op === BinOp.Div || op === BinOp.ElemDiv) {
        if (lRes.count === 1 && rRes.count === 0) {
          const rightDeps = new Set<number>();
          collectArenaExprDeps(arena, right, rightDeps, true);
          let rightHasBlockVar = false;
          for (const d of rightDeps) {
            if (blockVarSet.has(d)) {
              rightHasBlockVar = true;
              break;
            }
          }
          return {
            count: 1,
            linear: lRes.linear && !rightHasBlockVar,
            monomial: lRes.monomial,
          };
        }
        return { count: 1, linear: false, monomial: false };
      }
      return { count: 1, linear: false, monomial: false };
    }
    default: {
      const deps = new Set<number>();
      collectArenaExprDeps(arena, exprId, deps, true);
      if (!deps.has(varIdx)) return { count: 0, linear: true, monomial: true };
      return { count: 2, linear: false, monomial: false };
    }
  }
}

function computeKronPivotScore(arena: DAEBuilder, eqIdx: number, varIdx: number, blockVarSet: Set<number>): number {
  if (arena.getEqKind(eqIdx) !== EqKind.Simple) return 10;
  const lhs = arena.getEqLhs(eqIdx);
  const rhs = arena.getEqRhs(eqIdx);
  const lRes = analyzeExprPivot(arena, lhs, varIdx, blockVarSet);
  const rRes = analyzeExprPivot(arena, rhs, varIdx, blockVarSet);
  const totalCount = lRes.count + rRes.count;
  if (totalCount === 0) return 0;
  if (totalCount > 1) return 10;

  if (isTargetVarExpr(arena, lhs, varIdx) || isTargetVarExpr(arena, rhs, varIdx)) {
    return 1000;
  }
  const active = lRes.count === 1 ? lRes : rRes;
  if (active.linear) return 800;
  if (active.monomial) return 500;
  return 100;
}

/**
 * Computes Kron's Algebraic Loop Tearing for a single strongly connected BLT block.
 * Selects a minimal set of tearing variables (`tearingVars`) and matched residual
 * equations (`residualEqs`) such that the remaining equations form a strictly
 * lower-triangular causal assignment chain (`causalChain`), preferring linear/monomial
 * occurrence-1 pivots along the causal chain.
 */
export function tearBltBlock(arena: DAEBuilder, eqIdxs: number[], vars: number[]): BltBlockTearing {
  if (eqIdxs.length <= 1 || vars.length <= 1) {
    return {
      tearingVars: [...vars],
      residualEqs: [...eqIdxs],
      causalChain: [],
    };
  }

  const blockVarSet = new Set<number>(vars);
  const eqDepsMap = new Map<number, number[]>();
  const pivotScores = new Map<number, Map<number, number>>();

  for (const eqIdx of eqIdxs) {
    const kind = arena.getEqKind(eqIdx);
    const deps = new Set<number>();
    if (kind === EqKind.For) {
      const meta = arena.getForEquationMeta?.(eqIdx);
      if (meta) {
        const bodyEqs = meta.equations ?? meta.bodyEquations ?? [];
        for (const bEq of bodyEqs) {
          const bLhs = "lhs" in bEq ? bEq.lhs : (bEq as { lhsExprId: number }).lhsExprId;
          const bRhs = "rhs" in bEq ? bEq.rhs : (bEq as { rhsExprId: number }).rhsExprId;
          collectArenaExprDeps(arena, bLhs, deps, true);
          collectArenaExprDeps(arena, bRhs, deps, true);
        }
      }
    } else {
      collectArenaExprDeps(arena, arena.getEqLhs(eqIdx), deps, true);
      collectArenaExprDeps(arena, arena.getEqRhs(eqIdx), deps, true);
    }

    const blockDeps: number[] = [];
    const scoreMap = new Map<number, number>();
    for (const v of vars) {
      if (deps.has(v)) {
        blockDeps.push(v);
        scoreMap.set(v, computeKronPivotScore(arena, eqIdx, v, blockVarSet));
      }
    }
    eqDepsMap.set(eqIdx, blockDeps);
    pivotScores.set(eqIdx, scoreMap);
  }

  const simulateFromTearingSet = (
    initialTearingVars: number[],
    minPivotScore: number,
  ): {
    complete: boolean;
    score: number;
    causalChain: Array<{ eqIdx: number; solvedVar: number }>;
    residualEqs: number[];
    knownVars: Set<number>;
    usedEqs: Set<number>;
  } => {
    const knownVars = new Set<number>(initialTearingVars);
    const usedEqs = new Set<number>();
    const causalChain: Array<{ eqIdx: number; solvedVar: number }> = [];
    let score = 0;

    while (knownVars.size < vars.length) {
      let bestEq = -1;
      let bestVar = -1;
      let bestPScore = -1;
      let bestDepLen = Infinity;

      for (const eqIdx of eqIdxs) {
        if (usedEqs.has(eqIdx)) continue;
        const deps = eqDepsMap.get(eqIdx) ?? [];
        let unknownCount = 0;
        let singleUnknown = -1;
        for (const v of deps) {
          if (!knownVars.has(v)) {
            unknownCount++;
            singleUnknown = v;
            if (unknownCount > 1) break;
          }
        }
        if (unknownCount === 1 && singleUnknown !== -1) {
          const pScore = pivotScores.get(eqIdx)?.get(singleUnknown) ?? 10;
          if (pScore < minPivotScore) continue;
          if (pScore > bestPScore || (pScore === bestPScore && deps.length < bestDepLen)) {
            bestPScore = pScore;
            bestEq = eqIdx;
            bestVar = singleUnknown;
            bestDepLen = deps.length;
          }
        }
      }

      if (bestEq === -1 || bestVar === -1) break;
      causalChain.push({ eqIdx: bestEq, solvedVar: bestVar });
      usedEqs.add(bestEq);
      knownVars.add(bestVar);
      score += bestPScore;
    }

    const residualEqs = eqIdxs.filter((e) => !usedEqs.has(e));
    // Prefer leaving nonlinear equations as residual equations
    for (const rEq of residualEqs) {
      const sMap = pivotScores.get(rEq);
      if (sMap) {
        let minS = Infinity;
        for (const s of sMap.values()) {
          if (s < minS) minS = s;
        }
        if (minS <= 100) score += 25;
      }
    }

    return {
      complete: knownVars.size === vars.length,
      score,
      causalChain,
      residualEqs,
      knownVars,
      usedEqs,
    };
  };

  // 1. Try size-1 tearing variable sets (preferring linear/monomial occurrence-1 pivots >= 500)
  for (const minPivot of [500, 100, 10]) {
    let bestRes: BltBlockTearing | null = null;
    let bestScore = -Infinity;
    for (const v of vars) {
      const sim = simulateFromTearingSet([v], minPivot);
      if (sim.complete && sim.score > bestScore) {
        bestScore = sim.score;
        bestRes = {
          tearingVars: [v],
          residualEqs: sim.residualEqs,
          causalChain: sim.causalChain,
        };
      }
    }
    if (bestRes) return bestRes;
  }

  // 2. For moderate blocks, try size-2 tearing variable sets
  if (vars.length <= 16) {
    for (const minPivot of [500, 100, 10]) {
      let bestRes: BltBlockTearing | null = null;
      let bestScore = -Infinity;
      for (let i = 0; i < vars.length; i++) {
        for (let j = i + 1; j < vars.length; j++) {
          const pair = [vars[i]!, vars[j]!];
          const sim = simulateFromTearingSet(pair, minPivot);
          if (sim.complete && sim.score > bestScore) {
            bestScore = sim.score;
            bestRes = {
              tearingVars: pair,
              residualEqs: sim.residualEqs,
              causalChain: sim.causalChain,
            };
          }
        }
      }
      if (bestRes) return bestRes;
    }
  }

  // 3. General Kron greedy lookahead tearing for arbitrary-size blocks
  const tearingVars: number[] = [];
  let currentSim = simulateFromTearingSet([], 500);
  while (!currentSim.complete) {
    let bestCandidate = -1;
    let bestSolvedCount = -1;
    let bestScore = -Infinity;
    let bestDegree = -1;

    for (const v of vars) {
      if (currentSim.knownVars.has(v)) continue;
      const trial = simulateFromTearingSet([...tearingVars, v], 500);
      let degree = 0;
      for (const eqIdx of eqIdxs) {
        if (!currentSim.usedEqs.has(eqIdx) && (eqDepsMap.get(eqIdx) ?? []).includes(v)) {
          degree++;
        }
      }
      const solvedCount = trial.knownVars.size;
      if (
        solvedCount > bestSolvedCount ||
        (solvedCount === bestSolvedCount && trial.score > bestScore) ||
        (solvedCount === bestSolvedCount && trial.score === bestScore && degree > bestDegree)
      ) {
        bestCandidate = v;
        bestSolvedCount = solvedCount;
        bestScore = trial.score;
        bestDegree = degree;
      }
    }

    if (bestCandidate === -1) break;
    tearingVars.push(bestCandidate);
    currentSim = simulateFromTearingSet(tearingVars, 500);
    if (!currentSim.complete && tearingVars.length + 1 >= vars.length) {
      currentSim = simulateFromTearingSet(tearingVars, 10);
      break;
    }
  }

  return {
    tearingVars,
    residualEqs: currentSim.residualEqs,
    causalChain: currentSim.causalChain,
  };
}

/**
 * Computes and attaches Kron's tearing metadata (`block.tearing`) to all
 * multi-equation algebraic loop blocks (`block.eqIdxs.length > 1 && block.vars.length > 1`).
 */
export function tearBltBlocksArena(arena: DAEBuilder, blocks: ArenaBltBlock[]): ArenaBltBlock[] {
  for (const block of blocks) {
    if (block.eqIdxs.length > 1 && block.vars.length > 1) {
      block.tearing = tearBltBlock(arena, block.eqIdxs, block.vars);
    }
  }
  return blocks;
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
          const bLhs = "lhs" in bEq ? bEq.lhs : (bEq as { lhsExprId: number }).lhsExprId;
          const bRhs = "rhs" in bEq ? bEq.rhs : (bEq as { rhsExprId: number }).rhsExprId;
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
  const blocks: ArenaBltBlock[] = [];

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

  tearBltBlocksArena(arena, blocks);

  const result: ArenaBltResult = {
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
