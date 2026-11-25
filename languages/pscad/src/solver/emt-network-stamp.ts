// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — 3-Phase Nodal Conductance Stamping, LU Caching & Dynamic Injection Assembly
 *
 * Implements:
 * - Dense / sparse CCS 3N x 3N phase-domain conductance matrix stamping (`G3`)
 * - 3-phase mutually coupled branch stamping with off-nominal tap ratios and ±30° Y-Delta incidence
 * - ULM & N-conductor ULM terminal admittance stamping
 * - Topology bitmask LRU cache for LU factors and surge arrester Thévenin vectors
 * - Dynamic 3-phase nodal injection current assembly (`J3`) across all network components
 */

import { computeAmdOrdering, sparseLuAnalyze, sparseLuRefactorize, sparseLuSolve } from "@modelscript/runtime";
import type { EmtdcHostBridge } from "../script/emtdc-abi-bridge.js";
import type { EmtNetlist } from "../types.js";
import type { CsmfControlEvaluator } from "./csmf-evaluator.js";
import { stepEmtdcCustomBlocksDsdyn } from "./emt-control-blocks.js";
import { computeLineHistoryCurrents } from "./emt-line-history.js";
import { cloneSparseFactors, factorizeDenseLU, solveDenseLU } from "./emt-linear-algebra.js";
import { updateSurgeArresterTheveninVectors } from "./emt-nonlinear-elements.js";
import type {
  BergeronLineState,
  BusInfo,
  CachedTopologyLu,
  CompanionBranch,
  ConverterBridgeRuntimeState,
  CustomBlockRuntimeState,
  EmtNetworkMatrixState,
  EmtSolverOptions,
  FmuState,
  IndMachineRuntimeState,
  MmcRuntimeState,
  NUlmLineRuntimeState,
  OltcState,
  SatXfmrRuntimeState,
  SourceInfo,
  SurgeArresterState,
  SwitchState,
  SyncGenState,
} from "./emt-solver-types.js";
import {
  stepNConductorUlm,
  stepUlmLine,
  type NConductorUlmData,
  type UniversalLineModelData,
} from "./universal-line-model.js";

export interface EmtNetworkStampContext {
  readonly netlist: EmtNetlist;
  readonly options: EmtSolverOptions;
  readonly timeStepSec: number;
  readonly omega: number;
  readonly nSteps: number;
  readonly busList: readonly BusInfo[];
  readonly busIdxMap: ReadonlyMap<string, number>;
  readonly busSources: ReadonlyMap<number, SourceInfo[]>;
  readonly companionBranches: readonly CompanionBranch[];
  readonly bergeronLines: readonly BergeronLineState[];
  readonly ulmLines: readonly UniversalLineModelData[];
  readonly nUlmLines: readonly NUlmLineRuntimeState[];
  readonly syncGenerators: readonly SyncGenState[];
  readonly oltcStates: readonly OltcState[];
  readonly bridgeRuntimeStates: readonly ConverterBridgeRuntimeState[];
  readonly switchStates: readonly SwitchState[];
  readonly fmuStates: readonly FmuState[];
  readonly surgeArresters: readonly SurgeArresterState[];
  readonly indMachineStates: readonly IndMachineRuntimeState[];
  readonly satXfmrStates: readonly SatXfmrRuntimeState[];
  readonly customBlockStates: readonly CustomBlockRuntimeState[];
  readonly csmfEvaluator: CsmfControlEvaluator | null;
  readonly emtdcHostBridge: EmtdcHostBridge | null;
  readonly vaStep: Float64Array;
  readonly vbStep: Float64Array;
  readonly vcStep: Float64Array;
  readonly mat: EmtNetworkMatrixState;
}

/**
 * Resets the conductance matrix `G3` (or sparse triplet builder) prior to assembly.
 */
export function resetConductanceMatrix(mat: EmtNetworkMatrixState): void {
  if (mat.useSparse && mat.gTriplets) {
    mat.gTriplets.clear();
  } else {
    mat.G3.fill(0);
  }
}

/**
 * Stamps a diagonal conductance `g` at scalar phase-node index `pNode` (`0..3N-1`).
 */
export function stampDiagonal(mat: EmtNetworkMatrixState, pNode: number, g: number): void {
  if (pNode < 0) return;
  if (mat.useSparse && mat.gTriplets) {
    mat.gTriplets.addStructural(pNode, pNode, g);
  } else {
    const n3 = mat.nPhaseNodes;
    mat.G3[pNode * n3 + pNode] = mat.G3[pNode * n3 + pNode]! + g;
  }
}

/**
 * Stamps a scalar entry `g` at `(r, c)` in `G3` or sparse triplets.
 */
export function stampEntry(mat: EmtNetworkMatrixState, r: number, c: number, g: number): void {
  if (r < 0 || c < 0) return;
  if (mat.useSparse && mat.gTriplets) {
    mat.gTriplets.addStructural(r, c, g);
  } else {
    const n3 = mat.nPhaseNodes;
    mat.G3[r * n3 + c] = mat.G3[r * n3 + c]! + g;
  }
}

/**
 * Stamps a scalar conductance `g` between two scalar phase-node indices (`p1`, `p2` in `0..3N-1`).
 */
export function stampNodeAdmittance(mat: EmtNetworkMatrixState, p1: number, p2: number, g: number): void {
  if (p1 >= 0) stampDiagonal(mat, p1, g);
  if (p2 >= 0) stampDiagonal(mat, p2, g);
  if (p1 >= 0 && p2 >= 0) {
    stampEntry(mat, p1, p2, -g);
    stampEntry(mat, p2, p1, -g);
  }
}

/**
 * In-place LU factorization with partial pivoting for the coupled 3N x 3N phase-domain matrix,
 * or sparse CCS symbolic-numeric factorization with cached AMD column permutation when `useSparse` is active.
 */
export function factorize3Phase(
  mat: EmtNetworkMatrixState,
  A: Float64Array,
  LU: Float64Array,
  piv: Int32Array,
): boolean {
  if (mat.useSparse && mat.gTriplets) {
    if (
      mat.sparseCcs &&
      mat.gTripletMap &&
      mat.sparseFactors &&
      mat.gTriplets.updateCCSValues(mat.sparseCcs, mat.gTripletMap)
    ) {
      if (sparseLuRefactorize(mat.sparseCcs, mat.sparseFactors, { allowPerturbation: true })) {
        return true;
      }
      mat.sparseFactors = sparseLuAnalyze(mat.sparseCcs, {
        colPerm: mat.colPerm,
        allowPerturbation: true,
      });
      return mat.sparseFactors !== null;
    }

    const built = mat.gTriplets.buildCCSWithMap();
    mat.sparseCcs = built.ccs;
    mat.gTripletMap = built.tripletToCcsIdx;
    if (!mat.colPerm) {
      mat.colPerm = computeAmdOrdering(mat.sparseCcs);
    }
    mat.sparseFactors = sparseLuAnalyze(mat.sparseCcs, {
      colPerm: mat.colPerm,
      allowPerturbation: true,
    });
    return mat.sparseFactors !== null;
  }

  return factorizeDenseLU(A, LU, piv, mat.nPhaseNodes);
}

/**
 * Fast forward and back substitution using precomputed 3N x 3N LU factors (dense or sparse CCS).
 */
export function solveFromLU3Phase(
  mat: EmtNetworkMatrixState,
  LU: Float64Array,
  piv: Int32Array,
  b: Float64Array,
  x: Float64Array,
): void {
  if (mat.useSparse && mat.sparseFactors) {
    sparseLuSolve(mat.sparseFactors, b, x);
    return;
  }
  solveDenseLU(LU, piv, b, x, mat.nPhaseNodes);
}

/**
 * Solves `A * out = rhs` using a cached topology LU entry (dense or sparse).
 */
export function solveWithCachedLu(
  entry: CachedTopologyLu,
  rhs: Float64Array,
  out: Float64Array,
  nPhaseNodes: number,
): void {
  if (entry.sparse) {
    sparseLuSolve(entry.sparse, rhs, out);
    return;
  }
  if (!entry.dense) return;
  solveDenseLU(entry.dense.lu, entry.dense.piv, rhs, out, nPhaseNodes);
}

/**
 * Computes a canonical topology bitmask key for per-phase switches, active faults, and OLTC taps.
 * Returns `""` if time-varying `boundaryFeeds` supply dynamic Thévenin conductances.
 */
export function computeTopologyKey(
  options: EmtSolverOptions,
  netlist: EmtNetlist,
  switchStates: readonly SwitchState[],
  oltcStates: readonly OltcState[],
  t: number,
): string {
  if (options?.boundaryFeeds?.some((bf) => Boolean(bf.thevenin) || Boolean(bf.threePhaseThevenin))) {
    return "";
  }
  let swKey = "";
  for (let i = 0; i < switchStates.length; i++) {
    const p = switchStates[i]!.phaseClosed;
    swKey += (p[0] ? "1" : "0") + (p[1] ? "1" : "0") + (p[2] ? "1" : "0");
  }
  let fltKey = "";
  const faults = netlist.faults;
  if (faults && faults.length > 0) {
    for (let i = 0; i < faults.length; i++) {
      const flt = faults[i]!;
      fltKey += t >= flt.startSec && t <= flt.endSec ? "1" : "0";
    }
  }
  let oltcKey = "";
  if (oltcStates.length > 0) {
    for (let i = 0; i < oltcStates.length; i++) {
      oltcKey += `|${oltcStates[i]!.tapPu.toFixed(5)}`;
    }
  }
  return `sw:${swKey}|flt:${fltKey}${oltcKey ? `|oltc:${oltcKey}` : ""}`;
}

export function saveTopologyToCache(
  mat: EmtNetworkMatrixState,
  surgeArresters: readonly SurgeArresterState[],
  key: string,
): void {
  if (!key) return;
  const MAX_ENTRIES = 16;
  if (mat.luCache.has(key)) {
    mat.luCache.delete(key);
  } else if (mat.luCache.size >= MAX_ENTRIES) {
    const oldest = mat.luCache.keys().next().value;
    if (oldest !== undefined) mat.luCache.delete(oldest);
  }

  const arresterThevenin =
    surgeArresters.length > 0
      ? surgeArresters.map((arr) => ({
          zThPhase: [arr.zThPhase[0], arr.zThPhase[1], arr.zThPhase[2]] as [number, number, number],
          xThPhase: [arr.xThPhase[0].slice(), arr.xThPhase[1].slice(), arr.xThPhase[2].slice()] as [
            Float64Array,
            Float64Array,
            Float64Array,
          ],
        }))
      : undefined;

  mat.luCache.set(key, {
    dense: !mat.useSparse ? { lu: mat.LU3.slice(), piv: mat.piv3.slice() } : undefined,
    sparse: mat.useSparse && mat.sparseFactors ? cloneSparseFactors(mat.sparseFactors) : undefined,
    zArresterPorts: mat.zArresterPorts.length > 0 ? mat.zArresterPorts.slice() : undefined,
    arresterThevenin,
  });
}

export function restoreTopologyFromCache(
  mat: EmtNetworkMatrixState,
  surgeArresters: readonly SurgeArresterState[],
  entry: CachedTopologyLu,
): void {
  if (entry.dense) {
    mat.LU3.set(entry.dense.lu);
    mat.piv3.set(entry.dense.piv);
  } else if (entry.sparse) {
    mat.sparseFactors = cloneSparseFactors(entry.sparse);
  }
  if (entry.zArresterPorts && mat.zArresterPorts.length === entry.zArresterPorts.length) {
    mat.zArresterPorts.set(entry.zArresterPorts);
  }
  if (entry.arresterThevenin) {
    for (let i = 0; i < surgeArresters.length && i < entry.arresterThevenin.length; i++) {
      const dst = surgeArresters[i]!;
      const src = entry.arresterThevenin[i]!;
      dst.zThPhase = [src.zThPhase[0], src.zThPhase[1], src.zThPhase[2]];
      dst.xThPhase[0].set(src.xThPhase[0]);
      dst.xThPhase[1].set(src.xThPhase[1]);
      dst.xThPhase[2].set(src.xThPhase[2]);
    }
  }
}

/**
 * Stamps a 3x3 phase-coupled branch (self conductance `gSelf`, mutual conductance `gMut`,
 * off-nominal tap ratio `a = V_sec/V_prim`, and exact ±30° Y-Delta vector group incidence)
 * between bus `i` and bus `j` in the 3N x 3N matrix `G3`.
 */
export function stamp3PhaseBranch(
  mat: EmtNetworkMatrixState,
  i: number,
  j: number,
  gSelf: number,
  gMut: number = 0,
  tapRatio: number = 1.0,
  windingConnection?: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D" | undefined,
): void {
  const a = tapRatio > 0 ? tapRatio : 1.0;
  const invA = 1.0 / a;
  if (windingConnection === "Yg-D" || windingConnection === "D-Yg") {
    // Yd1 coupled winding incidence matrix: M_delta = (1/sqrt(3)) * [[1,-1,0],[0,1,-1],[-1,0,1]]
    const invSqrt3 = 1.0 / Math.sqrt(3.0);
    const mp =
      windingConnection === "D-Yg"
        ? [
            [invSqrt3, -invSqrt3, 0],
            [0, invSqrt3, -invSqrt3],
            [-invSqrt3, 0, invSqrt3],
          ]
        : [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ];
    const ms =
      windingConnection === "Yg-D"
        ? [
            [invSqrt3 * invA, -invSqrt3 * invA, 0],
            [0, invSqrt3 * invA, -invSqrt3 * invA],
            [-invSqrt3 * invA, 0, invSqrt3 * invA],
          ]
        : [
            [invA, 0, 0],
            [0, invA, 0],
            [0, 0, invA],
          ];
    const Gp = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === c ? gSelf : gMut)));
    for (let w1 = 0; w1 < 3; w1++) {
      for (let w2 = 0; w2 < 3; w2++) {
        const gw = Gp[w1]![w2]!;
        if (Math.abs(gw) <= 1e-18) continue;
        for (let p1 = 0; p1 < 3; p1++) {
          for (let p2 = 0; p2 < 3; p2++) {
            const alphaP1 = mp[w1]![p1]!;
            const alphaP2 = mp[w2]![p2]!;
            const betaS1 = ms[w1]![p1]!;
            const betaS2 = ms[w2]![p2]!;
            if (i >= 0 && alphaP1 !== 0 && alphaP2 !== 0) {
              stampEntry(mat, 3 * i + p1, 3 * i + p2, gw * alphaP1 * alphaP2);
            }
            if (j >= 0 && betaS1 !== 0 && betaS2 !== 0) {
              stampEntry(mat, 3 * j + p1, 3 * j + p2, gw * betaS1 * betaS2);
            }
            if (i >= 0 && j >= 0 && alphaP1 !== 0 && betaS2 !== 0) {
              stampEntry(mat, 3 * i + p1, 3 * j + p2, -gw * alphaP1 * betaS2);
            }
            if (i >= 0 && j >= 0 && betaS1 !== 0 && alphaP2 !== 0) {
              stampEntry(mat, 3 * j + p1, 3 * i + p2, -gw * betaS1 * alphaP2);
            }
          }
        }
      }
    }
    // Stabilize ungrounded zero-sequence mode on the Delta side without affecting positive/negative sequence
    const dIdx = windingConnection === "Yg-D" ? j : i;
    if (dIdx >= 0) {
      const gZ0 = Math.max(1e-9, gSelf * 1e-6);
      for (let p = 0; p < 3; p++) stampDiagonal(mat, 3 * dIdx + p, gZ0);
    }
    return;
  }

  const invA2 = invA * invA;
  for (let p = 0; p < 3; p++) {
    const pi = i >= 0 ? 3 * i + p : -1;
    const pj = j >= 0 ? 3 * j + p : -1;
    if (Math.abs(a - 1.0) < 1e-9) {
      stampNodeAdmittance(mat, pi, pj, gSelf);
    } else {
      if (pi >= 0) stampDiagonal(mat, pi, gSelf);
      if (pj >= 0) stampDiagonal(mat, pj, gSelf * invA2);
      if (pi >= 0 && pj >= 0) {
        stampEntry(mat, pi, pj, -gSelf * invA);
        stampEntry(mat, pj, pi, -gSelf * invA);
      }
    }
  }
  if (Math.abs(gMut) > 1e-18) {
    for (let p1 = 0; p1 < 3; p1++) {
      for (let p2 = 0; p2 < 3; p2++) {
        if (p1 === p2) continue;
        const pi1 = i >= 0 ? 3 * i + p1 : -1;
        const pi2 = i >= 0 ? 3 * i + p2 : -1;
        const pj1 = j >= 0 ? 3 * j + p1 : -1;
        const pj2 = j >= 0 ? 3 * j + p2 : -1;
        if (pi1 >= 0 && pi2 >= 0) {
          stampEntry(mat, pi1, pi2, gMut);
        }
        if (pj1 >= 0 && pj2 >= 0) {
          stampEntry(mat, pj1, pj2, gMut * invA2);
        }
        if (pi1 >= 0 && pj2 >= 0) {
          stampEntry(mat, pi1, pj2, -gMut * invA);
          stampEntry(mat, pj2, pi1, -gMut * invA);
        }
      }
    }
  }
}

export function computeCompanionDrop(
  br: CompanionBranch,
  v3Step: Float64Array,
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  useV3Step: boolean = false,
): [number, number, number] {
  const vfa = br.fromIdx >= 0 ? (useV3Step ? v3Step[3 * br.fromIdx + 0]! : vaStep[br.fromIdx]!) : 0.0;
  const vfb = br.fromIdx >= 0 ? (useV3Step ? v3Step[3 * br.fromIdx + 1]! : vbStep[br.fromIdx]!) : 0.0;
  const vfc = br.fromIdx >= 0 ? (useV3Step ? v3Step[3 * br.fromIdx + 2]! : vcStep[br.fromIdx]!) : 0.0;
  const vta = br.toIdx >= 0 ? (useV3Step ? v3Step[3 * br.toIdx + 0]! : vaStep[br.toIdx]!) : 0.0;
  const vtb = br.toIdx >= 0 ? (useV3Step ? v3Step[3 * br.toIdx + 1]! : vbStep[br.toIdx]!) : 0.0;
  const vtc = br.toIdx >= 0 ? (useV3Step ? v3Step[3 * br.toIdx + 2]! : vcStep[br.toIdx]!) : 0.0;
  const invA = 1.0 / (br.tapRatio && br.tapRatio > 0 ? br.tapRatio : 1.0);
  const invSqrt3 = 1.0 / Math.sqrt(3.0);
  if (br.windingConnection === "Yg-D") {
    return [
      vfa - invSqrt3 * invA * (vta - vtb),
      vfb - invSqrt3 * invA * (vtb - vtc),
      vfc - invSqrt3 * invA * (vtc - vta),
    ];
  }
  if (br.windingConnection === "D-Yg") {
    return [
      invSqrt3 * (vfa - vfb) - invA * vta,
      invSqrt3 * (vfb - vfc) - invA * vtb,
      invSqrt3 * (vfc - vfa) - invA * vtc,
    ];
  }
  return [vfa - invA * vta, vfb - invA * vtb, vfc - invA * vtc];
}

export function injectCompanionHistory(J3: Float64Array, br: CompanionBranch): void {
  const invA = 1.0 / (br.tapRatio && br.tapRatio > 0 ? br.tapRatio : 1.0);
  const invSqrt3 = 1.0 / Math.sqrt(3.0);
  if (br.fromIdx >= 0) {
    if (br.windingConnection === "D-Yg") {
      J3[3 * br.fromIdx + 0] = J3[3 * br.fromIdx + 0]! - invSqrt3 * (br.iHistA - br.iHistC);
      J3[3 * br.fromIdx + 1] = J3[3 * br.fromIdx + 1]! - invSqrt3 * (br.iHistB - br.iHistA);
      J3[3 * br.fromIdx + 2] = J3[3 * br.fromIdx + 2]! - invSqrt3 * (br.iHistC - br.iHistB);
    } else {
      J3[3 * br.fromIdx + 0] = J3[3 * br.fromIdx + 0]! - br.iHistA;
      J3[3 * br.fromIdx + 1] = J3[3 * br.fromIdx + 1]! - br.iHistB;
      J3[3 * br.fromIdx + 2] = J3[3 * br.fromIdx + 2]! - br.iHistC;
    }
  }
  if (br.toIdx >= 0) {
    if (br.windingConnection === "Yg-D") {
      const s = invSqrt3 * invA;
      J3[3 * br.toIdx + 0] = J3[3 * br.toIdx + 0]! + s * (br.iHistA - br.iHistC);
      J3[3 * br.toIdx + 1] = J3[3 * br.toIdx + 1]! + s * (br.iHistB - br.iHistA);
      J3[3 * br.toIdx + 2] = J3[3 * br.toIdx + 2]! + s * (br.iHistC - br.iHistB);
    } else {
      J3[3 * br.toIdx + 0] = J3[3 * br.toIdx + 0]! + br.iHistA * invA;
      J3[3 * br.toIdx + 1] = J3[3 * br.toIdx + 1]! + br.iHistB * invA;
      J3[3 * br.toIdx + 2] = J3[3 * br.toIdx + 2]! + br.iHistC * invA;
    }
  }
}

/**
 * Stamps a 3-phase Universal Line Model (ULM) high-frequency terminal admittance matrix `G_eq` (3x3)
 * into the diagonal blocks of terminal bus K (`fromIdx`) and terminal bus M (`toIdx`).
 */
export function stampUlmModel(mat: EmtNetworkMatrixState, ulm: UniversalLineModelData): void {
  if (ulm.fromIdx >= 0) {
    const baseK = 3 * ulm.fromIdx;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        stampEntry(mat, baseK + r, baseK + c, ulm.gEq[r * 3 + c]!);
      }
    }
  }
  if (ulm.toIdx >= 0) {
    const baseM = 3 * ulm.toIdx;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        stampEntry(mat, baseM + r, baseM + c, ulm.gEq[r * 3 + c]!);
      }
    }
  }
}

export function stampNUlmModel(
  mat: EmtNetworkMatrixState,
  nu: { fromIdx: number; toIdx: number; model: NConductorUlmData },
): void {
  const n = nu.model.nCond;
  const pMax = Math.min(3, n);
  if (nu.fromIdx >= 0) {
    const baseK = 3 * nu.fromIdx;
    for (let r = 0; r < pMax; r++) {
      for (let c = 0; c < pMax; c++) {
        stampEntry(mat, baseK + r, baseK + c, nu.model.gEq[r * n + c]!);
      }
    }
  }
  if (nu.toIdx >= 0) {
    const baseM = 3 * nu.toIdx;
    for (let r = 0; r < pMax; r++) {
      for (let c = 0; c < pMax; c++) {
        stampEntry(mat, baseM + r, baseM + c, nu.model.gEq[r * n + c]!);
      }
    }
  }
}

/**
 * Ensures the coupled 3N x 3N conductance matrix is factorized for the current topology at time `t`,
 * swapping cached LU factors in O(1) on topology bitmask hit or assembling & factorizing on miss.
 * Returns the canonical topology key `topoKey`.
 */
export function ensureConductanceMatrixFactorized(ctx: EmtNetworkStampContext, t: number): string {
  const {
    mat,
    options,
    netlist,
    busIdxMap,
    busSources,
    syncGenerators,
    companionBranches,
    bergeronLines,
    ulmLines,
    nUlmLines,
    switchStates,
    oltcStates,
    surgeArresters,
  } = ctx;
  const topoKey = computeTopologyKey(options, netlist, switchStates, oltcStates, t);
  const needsRebuild = !mat.luValid || topoKey === "" || topoKey !== mat.activeTopoKey;
  const cachedLu = needsRebuild && topoKey !== "" ? mat.luCache.get(topoKey) : undefined;
  if (cachedLu) {
    mat.luCache.delete(topoKey);
    mat.luCache.set(topoKey, cachedLu);
    restoreTopologyFromCache(mat, surgeArresters, cachedLu);
    mat.activeTopoKey = topoKey;
    mat.luValid = true;
    mat.luCacheHitsCount++;
    return topoKey;
  }

  if (!needsRebuild) {
    return topoKey;
  }

  resetConductanceMatrix(mat);

  // Sources
  for (const [bIdx, srcs] of busSources.entries()) {
    for (const s of srcs) {
      for (let p = 0; p < 3; p++) {
        stampDiagonal(mat, 3 * bIdx + p, s.gSrc);
      }
    }
  }

  // Synchronous Generators Norton subtransient conductance
  for (const sg of syncGenerators) {
    for (let p = 0; p < 3; p++) {
      stampDiagonal(mat, 3 * sg.busIdx + p, sg.gGen);
    }
  }

  // Boundary feeds Thévenin source conductances
  if (options?.boundaryFeeds) {
    for (const bf of options.boundaryFeeds) {
      const bIdx = busIdxMap.get(bf.busId);
      if (bIdx === undefined) continue;
      if (bf.thevenin) {
        const th = bf.thevenin(t);
        const gSrc = th?.gSrc ?? 10.0;
        for (let p = 0; p < 3; p++) {
          stampDiagonal(mat, 3 * bIdx + p, gSrc);
        }
      }
      if (bf.threePhaseThevenin) {
        const th3 = bf.threePhaseThevenin(t);
        if (th3) {
          const gm = th3.gMatrix3x3;
          if (gm && gm.length >= 9) {
            for (let p = 0; p < 3; p++) {
              for (let q = 0; q < 3; q++) {
                const val = gm[p * 3 + q]!;
                if (val !== 0) {
                  stampEntry(mat, 3 * bIdx + p, 3 * bIdx + q, val);
                }
              }
            }
          } else {
            const gSrc = th3.gSrc ?? 10.0;
            for (let p = 0; p < 3; p++) {
              stampDiagonal(mat, 3 * bIdx + p, gSrc);
            }
          }
          if (th3.mutualCouplings) {
            for (const mc of th3.mutualCouplings) {
              const peerIdx = busIdxMap.get(mc.peerBusId);
              if (peerIdx === undefined || mc.gMatrix3x3.length < 9) continue;
              for (let p = 0; p < 3; p++) {
                for (let q = 0; q < 3; q++) {
                  const val = mc.gMatrix3x3[p * 3 + q]!;
                  if (val !== 0) {
                    stampEntry(mat, 3 * bIdx + p, 3 * peerIdx + q, val);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Companion branches (including mutual coupling, tap ratio & exact ±30° Y-Delta incidence)
  for (const br of companionBranches) {
    const gTotal = br.gEq + 0.5 * br.shuntG;
    stamp3PhaseBranch(mat, br.fromIdx, br.toIdx, gTotal, br.gMut, br.tapRatio ?? 1.0, br.windingConnection);
  }

  // Bergeron / ULM distributed traveling-wave lines (coupled Norton shunt for modal lines)
  for (const bl of bergeronLines) {
    if (bl.hasModal) {
      for (let p = 0; p < 3; p++) {
        if (bl.fromIdx >= 0) {
          stampDiagonal(mat, 3 * bl.fromIdx + p, bl.gSelf);
          for (let q = 0; q < 3; q++) {
            if (p !== q) stampEntry(mat, 3 * bl.fromIdx + p, 3 * bl.fromIdx + q, bl.gMutual);
          }
        }
        if (bl.toIdx >= 0) {
          stampDiagonal(mat, 3 * bl.toIdx + p, bl.gSelf);
          for (let q = 0; q < 3; q++) {
            if (p !== q) stampEntry(mat, 3 * bl.toIdx + p, 3 * bl.toIdx + q, bl.gMutual);
          }
        }
      }
    } else {
      for (let p = 0; p < 3; p++) {
        if (bl.fromIdx >= 0) {
          stampDiagonal(mat, 3 * bl.fromIdx + p, bl.gBerg);
        }
        if (bl.toIdx >= 0) {
          stampDiagonal(mat, 3 * bl.toIdx + p, bl.gBerg);
        }
      }
    }
  }

  for (const ulm of ulmLines) {
    stampUlmModel(mat, ulm);
  }
  for (const nu of nUlmLines) {
    stampNUlmModel(mat, nu);
  }

  // Switches (per-phase independent conductances for pole scatter)
  for (const swState of switchStates) {
    for (let p = 0; p < 3; p++) {
      const isClosed = swState.phaseClosed[p];
      const rSw = isClosed ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4) : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
      const gSw = 1.0 / rSw;
      const u = swState.fromIdx >= 0 ? 3 * swState.fromIdx + p : -1;
      const v = swState.toIdx >= 0 ? 3 * swState.toIdx + p : -1;
      if (u >= 0) stampDiagonal(mat, u, gSw);
      if (v >= 0) stampDiagonal(mat, v, gSw);
      if (u >= 0 && v >= 0) {
        stampEntry(mat, u, v, -gSw);
        stampEntry(mat, v, u, -gSw);
      }
    }
  }

  // Faults (3PH, SLG, DLG, and phase-to-phase LL)
  for (const flt of netlist.faults ?? []) {
    if (t >= flt.startSec && t <= flt.endSec) {
      const bIdx = busIdxMap.get(flt.bus) ?? 0;
      const rFlt = flt.rFaultOhm !== undefined && flt.rFaultOhm > 0 ? flt.rFaultOhm : 0.5;
      const gFlt = 1.0 / rFlt;
      const pA = 3 * bIdx + 0;
      const pB = 3 * bIdx + 1;
      const pC = 3 * bIdx + 2;
      if (flt.faultType === "3PH") {
        stampDiagonal(mat, pA, gFlt);
        stampDiagonal(mat, pB, gFlt);
        stampDiagonal(mat, pC, gFlt);
      } else if (flt.faultType === "SLG") {
        // Single line-to-ground fault on Phase A
        stampDiagonal(mat, pA, gFlt);
      } else if (flt.faultType === "DLG") {
        // Double line-to-ground fault on Phases B and C
        stampDiagonal(mat, pB, gFlt);
        stampDiagonal(mat, pC, gFlt);
        stampNodeAdmittance(mat, pB, pC, 0.5 * gFlt);
      } else {
        // Phase-to-phase (LL) fault directly coupling Phase B and Phase C
        stampNodeAdmittance(mat, pB, pC, gFlt);
      }
    }
  }

  // Compute coupled 3-phase LU factorization and store in topology bitmask LRU cache
  factorize3Phase(mat, mat.G3, mat.LU3, mat.piv3);
  mat.luFactorizationCount++;
  mat.luValid = true;
  mat.zArresterPorts = updateSurgeArresterTheveninVectors(
    surgeArresters,
    mat.nPhaseNodes,
    (rhs, out) => solveFromLU3Phase(mat, mat.LU3, mat.piv3, rhs, out),
    mat.zArresterPorts,
  );
  mat.activeTopoKey = topoKey;
  if (topoKey) {
    saveTopologyToCache(mat, surgeArresters, topoKey);
  }
  return topoKey;
}

/**
 * Assembles the coupled 3N phase-domain nodal injection current vector `J3` at time `t`.
 */
export function assembleDynamicInjections(
  ctx: EmtNetworkStampContext,
  t: number,
  k: number,
  isMainStep: boolean,
  anyFaultActive: boolean,
  mmcRuntimeStates: readonly MmcRuntimeState[],
): void {
  const {
    mat,
    netlist,
    options,
    timeStepSec,
    omega,
    nSteps,
    busList,
    busIdxMap,
    busSources,
    indMachineStates,
    satXfmrStates,
    syncGenerators,
    companionBranches,
    bergeronLines,
    ulmLines,
    nUlmLines,
    fmuStates,
    bridgeRuntimeStates,
    customBlockStates,
    csmfEvaluator,
    emtdcHostBridge,
    vaStep,
    vbStep,
    vcStep,
  } = ctx;
  const J3 = mat.J3;
  J3.fill(0);

  for (const [bIdx, srcs] of busSources.entries()) {
    for (const s of srcs) {
      const ea = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad);
      const eb = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad - (2 * Math.PI) / 3);
      const ec = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad + (2 * Math.PI) / 3);
      J3[3 * bIdx + 0] = J3[3 * bIdx + 0]! + s.gSrc * ea;
      J3[3 * bIdx + 1] = J3[3 * bIdx + 1]! + s.gSrc * eb;
      J3[3 * bIdx + 2] = J3[3 * bIdx + 2]! + s.gSrc * ec;
    }
  }

  for (const cs of netlist.currentSources ?? []) {
    const bIdx = busIdxMap.get(cs.bus);
    if (bIdx === undefined) continue;
    const w = 2 * Math.PI * (cs.frequencyHz || 60.0);
    const ph = cs.phaseRad || 0;
    J3[3 * bIdx + 0] = J3[3 * bIdx + 0]! + cs.iPeakA * Math.sin(w * t + ph);
    J3[3 * bIdx + 1] = J3[3 * bIdx + 1]! + cs.iPeakA * Math.sin(w * t + ph - (2 * Math.PI) / 3);
    J3[3 * bIdx + 2] = J3[3 * bIdx + 2]! + cs.iPeakA * Math.sin(w * t + ph + (2 * Math.PI) / 3);
  }

  for (const im of indMachineStates) {
    const theta = omega * t + im.thetaR;
    const ePeak = im.eInternalPu * im.vPeak;
    J3[3 * im.busIdx + 0] = J3[3 * im.busIdx + 0]! + im.gStator * ePeak * Math.sin(theta);
    J3[3 * im.busIdx + 1] = J3[3 * im.busIdx + 1]! + im.gStator * ePeak * Math.sin(theta - (2 * Math.PI) / 3);
    J3[3 * im.busIdx + 2] = J3[3 * im.busIdx + 2]! + im.gStator * ePeak * Math.sin(theta + (2 * Math.PI) / 3);
  }

  for (const xf of satXfmrStates) {
    J3[3 * xf.primIdx + 0] = J3[3 * xf.primIdx + 0]! - xf.iMagA;
    J3[3 * xf.primIdx + 1] = J3[3 * xf.primIdx + 1]! - xf.iMagB;
    J3[3 * xf.primIdx + 2] = J3[3 * xf.primIdx + 2]! - xf.iMagC;
  }

  if (options?.boundaryFeeds) {
    for (const bf of options.boundaryFeeds) {
      const bIdx = busIdxMap.get(bf.busId);
      if (bIdx === undefined) continue;
      if (bf.thevenin) {
        const th = bf.thevenin(t);
        if (th) {
          J3[3 * bIdx + 0] = J3[3 * bIdx + 0]! + th.gSrc * th.vPeak * Math.sin(th.freqRad * t + th.phaseRad);
          J3[3 * bIdx + 1] =
            J3[3 * bIdx + 1]! + th.gSrc * th.vPeak * Math.sin(th.freqRad * t + th.phaseRad - (2 * Math.PI) / 3);
          J3[3 * bIdx + 2] =
            J3[3 * bIdx + 2]! + th.gSrc * th.vPeak * Math.sin(th.freqRad * t + th.phaseRad + (2 * Math.PI) / 3);
        }
      }
      if (bf.threePhaseThevenin) {
        const th3 = bf.threePhaseThevenin(t);
        if (th3) {
          const gm = th3.gMatrix3x3;
          if (gm && gm.length >= 9) {
            J3[3 * bIdx + 0] =
              J3[3 * bIdx + 0]! + gm[0]! * th3.ea + gm[1]! * th3.eb + gm[2]! * th3.ec + (th3.iHistA ?? 0.0);
            J3[3 * bIdx + 1] =
              J3[3 * bIdx + 1]! + gm[3]! * th3.ea + gm[4]! * th3.eb + gm[5]! * th3.ec + (th3.iHistB ?? 0.0);
            J3[3 * bIdx + 2] =
              J3[3 * bIdx + 2]! + gm[6]! * th3.ea + gm[7]! * th3.eb + gm[8]! * th3.ec + (th3.iHistC ?? 0.0);
          } else {
            J3[3 * bIdx + 0] = J3[3 * bIdx + 0]! + th3.gSrc * th3.ea + (th3.iHistA ?? 0.0);
            J3[3 * bIdx + 1] = J3[3 * bIdx + 1]! + th3.gSrc * th3.eb + (th3.iHistB ?? 0.0);
            J3[3 * bIdx + 2] = J3[3 * bIdx + 2]! + th3.gSrc * th3.ec + (th3.iHistC ?? 0.0);
          }
        }
      }
      if (bf.currentInjection) {
        const cinj = bf.currentInjection(t);
        if (cinj) {
          J3[3 * bIdx + 0] = J3[3 * bIdx + 0]! + cinj.ia;
          J3[3 * bIdx + 1] = J3[3 * bIdx + 1]! + cinj.ib;
          J3[3 * bIdx + 2] = J3[3 * bIdx + 2]! + cinj.ic;
        }
      }
    }
  }

  for (const sg of syncGenerators) {
    const thetaE = sg.omega0 * t + sg.deltaRad;
    const ea = sg.vPeak * (sg.eqSubPu * Math.sin(thetaE) + sg.edSubPu * Math.cos(thetaE));
    const eb =
      sg.vPeak *
      (sg.eqSubPu * Math.sin(thetaE - (2 * Math.PI) / 3) + sg.edSubPu * Math.cos(thetaE - (2 * Math.PI) / 3));
    const ec =
      sg.vPeak *
      (sg.eqSubPu * Math.sin(thetaE + (2 * Math.PI) / 3) + sg.edSubPu * Math.cos(thetaE + (2 * Math.PI) / 3));
    J3[3 * sg.busIdx + 0] = J3[3 * sg.busIdx + 0]! + sg.gGen * ea + sg.iHistA;
    J3[3 * sg.busIdx + 1] = J3[3 * sg.busIdx + 1]! + sg.gGen * eb + sg.iHistB;
    J3[3 * sg.busIdx + 2] = J3[3 * sg.busIdx + 2]! + sg.gGen * ec + sg.iHistC;
  }

  for (const ms of mmcRuntimeStates) {
    if (ms.busIdx === undefined) continue;
    J3[3 * ms.busIdx + 0] = J3[3 * ms.busIdx + 0]! + ms.gArm * ms.vAcA;
    J3[3 * ms.busIdx + 1] = J3[3 * ms.busIdx + 1]! + ms.gArm * ms.vAcB;
    J3[3 * ms.busIdx + 2] = J3[3 * ms.busIdx + 2]! + ms.gArm * ms.vAcC;
  }

  for (const br of companionBranches) {
    injectCompanionHistory(J3, br);
  }

  for (const bl of bergeronLines) {
    const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = computeLineHistoryCurrents(bl, false);
    if (bl.fromIdx >= 0) {
      J3[3 * bl.fromIdx + 0] = J3[3 * bl.fromIdx + 0]! - iHistKmA;
      J3[3 * bl.fromIdx + 1] = J3[3 * bl.fromIdx + 1]! - iHistKmB;
      J3[3 * bl.fromIdx + 2] = J3[3 * bl.fromIdx + 2]! - iHistKmC;
    }
    if (bl.toIdx >= 0) {
      J3[3 * bl.toIdx + 0] = J3[3 * bl.toIdx + 0]! - iHistMkA;
      J3[3 * bl.toIdx + 1] = J3[3 * bl.toIdx + 1]! - iHistMkB;
      J3[3 * bl.toIdx + 2] = J3[3 * bl.toIdx + 2]! - iHistMkC;
    }
  }

  for (const ulm of ulmLines) {
    const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = stepUlmLine(ulm, 0, 0, 0, 0, 0, 0, false);
    if (ulm.fromIdx >= 0) {
      J3[3 * ulm.fromIdx + 0] = J3[3 * ulm.fromIdx + 0]! - iHistKmA;
      J3[3 * ulm.fromIdx + 1] = J3[3 * ulm.fromIdx + 1]! - iHistKmB;
      J3[3 * ulm.fromIdx + 2] = J3[3 * ulm.fromIdx + 2]! - iHistKmC;
    }
    if (ulm.toIdx >= 0) {
      J3[3 * ulm.toIdx + 0] = J3[3 * ulm.toIdx + 0]! - iHistMkA;
      J3[3 * ulm.toIdx + 1] = J3[3 * ulm.toIdx + 1]! - iHistMkB;
      J3[3 * ulm.toIdx + 2] = J3[3 * ulm.toIdx + 2]! - iHistMkC;
    }
  }

  for (const nu of nUlmLines) {
    const { iHistK, iHistM } = stepNConductorUlm(nu.model, nu.vK, nu.vM, false);
    const pMax = Math.min(3, nu.model.nCond);
    if (nu.fromIdx >= 0) {
      for (let p = 0; p < pMax; p++) J3[3 * nu.fromIdx + p] = J3[3 * nu.fromIdx + p]! - iHistK[p]!;
    }
    if (nu.toIdx >= 0) {
      for (let p = 0; p < pMax; p++) J3[3 * nu.toIdx + p] = J3[3 * nu.toIdx + p]! - iHistM[p]!;
    }
  }

  const tauLvrtPre = 0.008;
  const alphaLvrtPre = 1.0 - Math.exp(-timeStepSec / tauLvrtPre);
  for (const fmuState of fmuStates) {
    const { busIdx, iRatedPeak } = fmuState;
    if (fmuState.companion) {
      if (isMainStep) {
        const { gEq, iHist } = fmuState.companion.stampCompanion(t, timeStepSec);
        const lastG = fmuState.lastGEq!;
        const lastI = fmuState.lastIHist!;
        let gChanged = false;
        for (let r = 0; r < 3; r++) {
          const ih = iHist[r] ?? 0;
          lastI[r] = ih;
          J3[3 * busIdx + r] = J3[3 * busIdx + r]! + ih;
          for (let c = 0; c < 3; c++) {
            const gVal = gEq[r * 3 + c] ?? 0;
            if (gVal !== lastG[r * 3 + c]) {
              stampEntry(mat, 3 * busIdx + r, 3 * busIdx + c, gVal - lastG[r * 3 + c]!);
              lastG[r * 3 + c] = gVal;
              gChanged = true;
            }
          }
        }
        if (gChanged) {
          factorize3Phase(mat, mat.G3, mat.LU3, mat.piv3);
          mat.luFactorizationCount++;
          mat.activeTopoKey = "";
          mat.luValid = false;
        }
      } else if (fmuState.lastIHist) {
        for (let r = 0; r < 3; r++) {
          J3[3 * busIdx + r] = J3[3 * busIdx + r]! + (fmuState.lastIHist[r] ?? 0);
        }
      }
      continue;
    }
    const vNomPeak = busList[busIdx]!.vPeak;
    let vPu = 1.0;
    if (k > 0) {
      const vaPrev = vaStep[busIdx]!;
      const vbPrev = vbStep[busIdx]!;
      const vcPrev = vcStep[busIdx]!;
      const vEnvPrev = Math.sqrt((2.0 / 3.0) * (vaPrev * vaPrev + vbPrev * vbPrev + vcPrev * vcPrev));
      vPu = vNomPeak > 0 ? vEnvPrev / vNomPeak : 1.0;
    }
    const isVoltageDip = anyFaultActive || vPu < 0.9;
    const iqEst = isVoltageDip ? fmuState.iqState + alphaLvrtPre * (0.85 * iRatedPeak - fmuState.iqState) : 0.0;
    const idEst = isVoltageDip ? 0.35 * iRatedPeak : 0.7 * iRatedPeak;
    J3[3 * busIdx + 0] = J3[3 * busIdx + 0]! + idEst * Math.sin(omega * t) - iqEst * Math.cos(omega * t);
    J3[3 * busIdx + 1] =
      J3[3 * busIdx + 1]! +
      idEst * Math.sin(omega * t - (2 * Math.PI) / 3) -
      iqEst * Math.cos(omega * t - (2 * Math.PI) / 3);
    J3[3 * busIdx + 2] =
      J3[3 * busIdx + 2]! +
      idEst * Math.sin(omega * t + (2 * Math.PI) / 3) -
      iqEst * Math.cos(omega * t + (2 * Math.PI) / 3);
  }

  const SQRT3 = Math.sqrt(3);
  for (const br of bridgeRuntimeStates) {
    const bIdx = br.acBusIdx;
    const va = k > 0 ? (vaStep[bIdx] ?? 0) : 0;
    const vb = k > 0 ? (vbStep[bIdx] ?? 0) : 0;
    const vc = k > 0 ? (vcStep[bIdx] ?? 0) : 0;
    const vMag = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
    const thetaRaw = vMag > 1e-3 ? Math.atan2((vb - vc) / SQRT3, (2 * va - vb - vc) / 3.0) : omega * t;
    const phase = Number.isFinite(thetaRaw) ? thetaRaw : omega * t;

    if (br.conv.kind === "lcc_6pulse") {
      // True 6-pulse thyristor bridge switching function with commutation overlap mu:
      // Conducting DC current iDcAmp splits across positive & negative valve groups per 60-deg sector.
      const alphaRad = ((br.conv.firingAngleDeg ?? 15.0) * Math.PI) / 180.0;
      const elecAngle = (((phase - alphaRad) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const switchWave = (ang: number): number => {
        const u = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const halfRamp = Math.max(0.02, 0.5 * br.muRad);
        // Positive half-cycle: [pi/6 .. 5pi/6], Negative: [7pi/6 .. 11pi/6]
        const sPos =
          Math.max(0, Math.min(1, (u - (Math.PI / 6 - halfRamp)) / (2 * halfRamp))) -
          Math.max(0, Math.min(1, (u - ((5 * Math.PI) / 6 - halfRamp)) / (2 * halfRamp)));
        const sNeg =
          Math.max(0, Math.min(1, (u - ((7 * Math.PI) / 6 - halfRamp)) / (2 * halfRamp))) -
          Math.max(0, Math.min(1, (u - ((11 * Math.PI) / 6 - halfRamp)) / (2 * halfRamp)));
        return sPos - sNeg;
      };
      const sa = switchWave(elecAngle);
      const sb = switchWave(elecAngle - (2 * Math.PI) / 3);
      const sc = switchWave(elecAngle + (2 * Math.PI) / 3);
      J3[3 * bIdx + 0] = J3[3 * bIdx + 0]! - br.iDcAmp * sa;
      J3[3 * bIdx + 1] = J3[3 * bIdx + 1]! - br.iDcAmp * sb;
      J3[3 * bIdx + 2] = J3[3 * bIdx + 2]! - br.iDcAmp * sc;
    } else {
      // Switched 2-level VSC PWM Norton injection through R_f-L_f choke companion: I = gChoke * (vPole - vAc) + iHistChoke
      J3[3 * bIdx + 0] = J3[3 * bIdx + 0]! + br.gChoke * br.vPoleA + br.iHistChokeA;
      J3[3 * bIdx + 1] = J3[3 * bIdx + 1]! + br.gChoke * br.vPoleB + br.iHistChokeB;
      J3[3 * bIdx + 2] = J3[3 * bIdx + 2]! + br.gChoke * br.vPoleC + br.iHistChokeC;
    }

    if (br.dcBusIdx >= 0) {
      const gDc = 1.0 / Math.max(0.05, 0.01 * br.rDcLoadOhm);
      J3[3 * br.dcBusIdx + 0] = J3[3 * br.dcBusIdx + 0]! + gDc * br.vDcVolts;
    }
  }

  for (const vdl of netlist.voltageDependentLoads ?? []) {
    const bIdx = busIdxMap.get(vdl.busId);
    if (bIdx === undefined) continue;
    const va = k > 0 ? (vaStep[bIdx] ?? 0) : 0;
    const vb = k > 0 ? (vbStep[bIdx] ?? 0) : 0;
    const vc = k > 0 ? (vcStep[bIdx] ?? 0) : 0;
    const vPeak = Math.sqrt((2 / 3) * (va * va + vb * vb + vc * vc));
    const v0Peak = (vdl.v0KvLL * 1e3 * Math.SQRT2) / SQRT3;
    if (vPeak > 1.0 && v0Peak > 1.0) {
      const vPu = Math.max(0.2, Math.min(2.0, vPeak / v0Peak));
      const pLoad = vdl.p0Mw * 1e6 * Math.pow(vPu, vdl.np);
      const qLoad = vdl.q0Mvar * 1e6 * Math.pow(vPu, vdl.nq);
      const vSq = Math.max(1.0, va * va + vb * vb + vc * vc);
      const vaPerp = (vb - vc) / SQRT3;
      const vbPerp = (vc - va) / SQRT3;
      const vcPerp = (va - vb) / SQRT3;
      J3[3 * bIdx + 0] = J3[3 * bIdx + 0]! - (pLoad * va + qLoad * vaPerp) / vSq;
      J3[3 * bIdx + 1] = J3[3 * bIdx + 1]! - (pLoad * vb + qLoad * vbPerp) / vSq;
      J3[3 * bIdx + 2] = J3[3 * bIdx + 2]! - (pLoad * vc + qLoad * vcPerp) / vSq;
    }
  }

  if (isMainStep) {
    stepEmtdcCustomBlocksDsdyn(
      emtdcHostBridge,
      customBlockStates,
      csmfEvaluator,
      vaStep,
      vbStep,
      vcStep,
      J3,
      t,
      k,
      nSteps,
    );
  }
}
