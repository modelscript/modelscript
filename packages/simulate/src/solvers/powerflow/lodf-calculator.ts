// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Analytical PTDF and LODF Matrix Calculator.
 *
 * Implements DC power flow linear sensitivity matrices:
 *   - PTDF: Power Transfer Distribution Factors mapping bus injections to branch flows.
 *   - LODF: Line Outage Distribution Factors mapping branch outages to flow changes on surviving branches.
 *
 * Academic References:
 *   - Wood, A. J., Wollenberg, B. F., & Sheblé, G. B. (2013). Power Generation, Operation, and Control. Wiley.
 *   - Zimmerman, R. D., et al. (2011). "MATPOWER: Steady-State Operations, Planning, and Analysis Tools". IEEE Trans. Power Syst.
 */

import { luFactorFlat, luSolveFlat } from "@modelscript/runtime/wasm_gaussian.js";
import { wasmComputePtdfLodf } from "../../wasm/simulate-wasm.js";
import type { GenericPowerCase } from "../opf/types.js";

export interface BranchSensitivityInfo {
  fromBus: number;
  toBus: number;
  reactance: number; // in p.u.
  rating: number; // in MVA or MW
  status: number; // 1 = in-service, 0 = out-of-service
}

export interface NetworkSensitivityMatrices {
  busCount: number;
  branchCount: number;
  slackBus: number;
  /** Flattened row-major PTDF matrix of dimension [L x B] (Float32Array for WebGPU/SIMD) */
  ptdf: Float32Array;
  /** Flattened column-major or row-major LODF matrix of dimension [K x L] where K is outage lines, L is monitored */
  lodf: Float32Array;
  /** Pre-contingency line ratings [L] */
  ratings: Float32Array;
  /** Map from bus ID (e.g. number or name) to internal 0-based index */
  busIndexMap: Map<string | number, number>;
}

/**
 * Computes the full PTDF and LODF matrices for a transmission network.
 */
export function calculateNetworkSensitivities(
  branches: BranchSensitivityInfo[],
  busCount: number,
  slackBus = 0,
): { ptdf: Float32Array; lodf: Float32Array } {
  const L = branches.length;
  const B = busCount;

  // Fast-path: execute B_red assembly, inversion, PTDF & LODF in simulate.wasm linear memory
  if (B > 1 && L > 0) {
    const fromArr = new Int32Array(L);
    const toArr = new Int32Array(L);
    const xArr = new Float64Array(L);
    for (let l = 0; l < L; l++) {
      const br = branches[l]!;
      fromArr[l] = br.fromBus;
      toArr[l] = br.toBus;
      xArr[l] = br.status === 0 ? 0.0 : Math.abs(br.reactance) > 1e-6 ? br.reactance : 1e-4;
    }
    const wasmRes = wasmComputePtdfLodf(B, slackBus, fromArr, toArr, xArr);
    if (wasmRes) {
      const ptdf = new Float32Array(L * B);
      for (let i = 0; i < L * B; i++) ptdf[i] = wasmRes.ptdf[i]!;
      const lodf = new Float32Array(L * L);
      // Transpose WASM [l * L + k] -> [k * L + l] to match row=outage k, col=monitored l
      for (let k = 0; k < L; k++) {
        if (branches[k]!.status === 0) continue;
        for (let l = 0; l < L; l++) {
          lodf[k * L + l] = l === k ? -1.0 : branches[l]!.status === 0 ? 0.0 : wasmRes.lodf[l * L + k]!;
        }
      }
      return { ptdf, lodf };
    }
  }

  // 1. Assemble B_bus matrix (B x B)
  const Bbus = new Float64Array(B * B);
  const bLine = new Float64Array(L);

  for (let l = 0; l < L; l++) {
    const br = branches[l]!;
    if (br.status === 0) continue;
    const x = Math.abs(br.reactance) > 1e-6 ? br.reactance : 1e-4;
    const b = 1.0 / x;
    bLine[l] = b;

    const from = br.fromBus;
    const to = br.toBus;
    if (from >= 0 && from < B && to >= 0 && to < B) {
      Bbus[from * B + from]! += b;
      Bbus[to * B + to]! += b;
      Bbus[from * B + to]! -= b;
      Bbus[to * B + from]! -= b;
    }
  }

  // 2. Invert reduced B_bus (omitting reference slack bus) to obtain X_bus
  const nRed = B - 1;
  const busMap = new Int32Array(B);
  let redIdx = 0;
  for (let b = 0; b < B; b++) {
    if (b === slackBus) {
      busMap[b] = -1;
    } else {
      busMap[b] = redIdx++;
    }
  }

  const BbusRed = new Float64Array(nRed * nRed);
  for (let i = 0; i < B; i++) {
    const ri = busMap[i]!;
    if (ri < 0) continue;
    for (let j = 0; j < B; j++) {
      const rj = busMap[j]!;
      if (rj < 0) continue;
      BbusRed[ri * nRed + rj] = Bbus[i * B + j]!;
    }
  }

  // Factorize reduced Bbus
  const fact = luFactorFlat(BbusRed, nRed);

  // Compute full X_bus (B x B) by solving BbusRed * x_col = e_col
  const Xbus = Array.from({ length: B }, () => new Float64Array(B));
  const e = new Float64Array(nRed);

  for (let col = 0; col < nRed; col++) {
    e.fill(0);
    e[col] = 1.0;
    luSolveFlat(fact, e);

    // Map reduced column back to original bus index
    let origCol = 0;
    for (let b = 0; b < B; b++) {
      if (busMap[b] === col) {
        origCol = b;
        break;
      }
    }

    for (let b = 0; b < B; b++) {
      const rb = busMap[b]!;
      Xbus[b]![origCol] = rb >= 0 ? e[rb]! : 0.0;
    }
  }

  // 3. Compute PTDF matrix: PTDF(l, b) = b_l * (Xbus(from_l, b) - Xbus(to_l, b))
  const ptdf = new Float32Array(L * B);
  for (let l = 0; l < L; l++) {
    const br = branches[l]!;
    if (br.status === 0) continue;
    const b = bLine[l]!;
    const from = br.fromBus;
    const to = br.toBus;

    for (let bus = 0; bus < B; bus++) {
      const xFrom = from >= 0 && from < B ? Xbus[from]![bus]! : 0;
      const xTo = to >= 0 && to < B ? Xbus[to]![bus]! : 0;
      ptdf[l * B + bus] = (b * (xFrom - xTo)) as number;
    }
  }

  // 4. Compute LODF matrix:
  // For each tripped line k and monitored line l:
  //   deltaPTDF = PTDF(l, from_k) - PTDF(l, to_k)
  //   denom = 1.0 - (PTDF(k, from_k) - PTDF(k, to_k))
  //   LODF(k, l) = deltaPTDF / denom (with LODF(k, k) = -1.0)
  // Dimension: K x L (where K = L, flattened row-major: k * L + l)
  const lodf = new Float32Array(L * L);

  for (let k = 0; k < L; k++) {
    const brK = branches[k]!;
    if (brK.status === 0) continue;

    const fromK = brK.fromBus;
    const toK = brK.toBus;

    const ptdfK_from = fromK >= 0 && fromK < B ? ptdf[k * B + fromK]! : 0;
    const ptdfK_to = toK >= 0 && toK < B ? ptdf[k * B + toK]! : 0;
    const deltaK_K = ptdfK_from - ptdfK_to;
    const denom = 1.0 - deltaK_K;
    const isBridge = Math.abs(denom) < 1e-5;

    for (let l = 0; l < L; l++) {
      const outIdx = k * L + l;
      if (l === k) {
        lodf[outIdx] = -1.0;
        continue;
      }

      if (isBridge || branches[l]!.status === 0) {
        lodf[outIdx] = 0.0;
        continue;
      }

      const ptdfL_from = fromK >= 0 && fromK < B ? ptdf[l * B + fromK]! : 0;
      const ptdfL_to = toK >= 0 && toK < B ? ptdf[l * B + toK]! : 0;
      const deltaL_K = ptdfL_from - ptdfL_to;
      lodf[outIdx] = (deltaL_K / denom) as number;
    }
  }

  return { ptdf, lodf };
}

/**
 * Extracts network sensitivities directly from a GenericPowerCase.
 */
export function calculateSensitivitiesFromCase(powerCase: GenericPowerCase): NetworkSensitivityMatrices {
  const busIndexMap = new Map<string | number, number>();
  let busIdx = 0;
  for (const [busNum] of powerCase.buses) {
    if (!busIndexMap.has(busNum)) {
      busIndexMap.set(busNum, busIdx++);
    }
  }
  const busCount = busIndexMap.size;

  const branchInfos: BranchSensitivityInfo[] = [];
  const ratingsList: number[] = [];

  for (const br of powerCase.branches) {
    const fIdx = busIndexMap.get(br.i) ?? 0;
    const tIdx = busIndexMap.get(br.j) ?? 0;
    const rate = br.rateA && br.rateA > 0 ? br.rateA : br.ratea && br.ratea > 0 ? br.ratea : 9999.0;

    branchInfos.push({
      fromBus: fIdx,
      toBus: tIdx,
      reactance: br.x !== 0 ? br.x : 0.01,
      rating: rate,
      status: br.st ?? 1,
    });
    ratingsList.push(rate);
  }

  const { ptdf, lodf } = calculateNetworkSensitivities(branchInfos, busCount, 0);

  return {
    busCount,
    branchCount: branchInfos.length,
    slackBus: 0,
    ptdf,
    lodf,
    ratings: new Float32Array(ratingsList),
    busIndexMap,
  };
}
