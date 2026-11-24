// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for AC Optimal Power Flow (AC-OPF).
 *
 * Implements zero-GC, flat linear-memory kernels for:
 * - Nodal admittance matrix Ybus = Gbus + j*Bbus assembly (`ac_opf_build_ybus`)
 * - Economic merit-order dispatch bisection (`ac_opf_merit_dispatch`)
 * - AC power injection & mismatch evaluation (`ac_opf_eval_injections`)
 * - Full AC Newton-Raphson Jacobian assembly (`ac_opf_assemble_jacobian`)
 * - Coupled AC Newton-Raphson power flow loop with row-equilibrated LU (`ac_opf_newton_powerflow`)
 * - Branch forward/reverse power flows, losses, and congestion metrics (`ac_opf_branch_flows`)
 */

import { luFactor, luSolve } from "./matrix";

/**
 * Builds the dense N x N nodal admittance matrices `Gbus` and `Bbus` in linear memory.
 *
 * Layout:
 * - `brIdxPtr`: `i32[2 * nBranches]` -> `[fromIdx, toIdx]`
 * - `brDataPtr`: `f64[4 * nBranches]` -> `[r, x, bChg, rateMva]`
 * - `gBusOutPtr`, `bBusOutPtr`: `f64[nBus * nBus]` (zeroed and populated)
 */
export function ac_opf_build_ybus(
  nBus: i32,
  nBranches: i32,
  brIdxPtr: usize,
  brDataPtr: usize,
  gBusOutPtr: usize,
  bBusOutPtr: usize,
): void {
  if (nBus <= 0) return;

  const nnBytes = (<usize>(nBus * nBus)) << 3;
  memory.fill(gBusOutPtr, 0, nnBytes);
  memory.fill(bBusOutPtr, 0, nnBytes);

  for (let k: i32 = 0; k < nBranches; k++) {
    const iBase = (<usize>(k * 2)) << 2;
    const f = load<i32>(brIdxPtr + iBase);
    const t = load<i32>(brIdxPtr + iBase + 4);
    if (f < 0 || t < 0 || f >= nBus || t >= nBus) continue;

    const dBase = (<usize>(k * 4)) << 3;
    const r = load<f64>(brDataPtr + dBase);
    const x = load<f64>(brDataPtr + dBase + 8);
    const bChg = load<f64>(brDataPtr + dBase + 16);

    const denom = r * r + x * x;
    if (denom <= 0.0) continue;

    const g = r / denom;
    const b = -x / denom;
    const bHalf = bChg * 0.5;

    const ffOff = (<usize>(f * nBus + f)) << 3;
    const ttOff = (<usize>(t * nBus + t)) << 3;
    const ftOff = (<usize>(f * nBus + t)) << 3;
    const tfOff = (<usize>(t * nBus + f)) << 3;

    store<f64>(gBusOutPtr + ffOff, load<f64>(gBusOutPtr + ffOff) + g);
    store<f64>(bBusOutPtr + ffOff, load<f64>(bBusOutPtr + ffOff) + b + bHalf);

    store<f64>(gBusOutPtr + ttOff, load<f64>(gBusOutPtr + ttOff) + g);
    store<f64>(bBusOutPtr + ttOff, load<f64>(bBusOutPtr + ttOff) + b + bHalf);

    store<f64>(gBusOutPtr + ftOff, load<f64>(gBusOutPtr + ftOff) - g);
    store<f64>(bBusOutPtr + ftOff, load<f64>(bBusOutPtr + ftOff) - b);

    store<f64>(gBusOutPtr + tfOff, load<f64>(gBusOutPtr + tfOff) - g);
    store<f64>(bBusOutPtr + tfOff, load<f64>(bBusOutPtr + tfOff) - b);
  }
}

/**
 * Computes optimal economic merit-order dispatch via 60-iteration lambda bisection.
 *
 * Layout:
 * - `genDataPtr`: `f64[4 * nGen]` -> `[pMinMw, pMaxMw, costC1, costC2]`
 * - `pgOutPtr`: `f64[nGen]` -> dispatched active power per generator in MW
 *
 * Returns the clearing marginal price `lambda` ($/MWh).
 */
export function ac_opf_merit_dispatch(
  nGen: i32,
  genDataPtr: usize,
  targetMw: f64,
  pgOutPtr: usize,
): f64 {
  let low: f64 = -1000.0;
  let high: f64 = 100000.0;

  for (let iter: i32 = 0; iter < 60; iter++) {
    const mid = 0.5 * (low + high);
    let sum: f64 = 0.0;
    for (let g: i32 = 0; g < nGen; g++) {
      const gBase = (<usize>(g * 4)) << 3;
      const pMin = load<f64>(genDataPtr + gBase);
      const pMax = load<f64>(genDataPtr + gBase + 8);
      const c1 = load<f64>(genDataPtr + gBase + 16);
      const c2 = load<f64>(genDataPtr + gBase + 24);
      let denom = 2.0 * c2;
      if (denom < 1e-4) denom = 1e-4;
      let p = (mid - c1) / denom;
      if (p < pMin) p = pMin;
      if (p > pMax) p = pMax;
      sum += p;
    }
    if (sum < targetMw) low = mid;
    else high = mid;
  }

  const lambda = 0.5 * (low + high);
  for (let g: i32 = 0; g < nGen; g++) {
    const gBase = (<usize>(g * 4)) << 3;
    const pMin = load<f64>(genDataPtr + gBase);
    const pMax = load<f64>(genDataPtr + gBase + 8);
    const c1 = load<f64>(genDataPtr + gBase + 16);
    const c2 = load<f64>(genDataPtr + gBase + 24);
    let denom = 2.0 * c2;
    if (denom < 1e-4) denom = 1e-4;
    let p = (lambda - c1) / denom;
    if (p < pMin) p = pMin;
    if (p > pMax) p = pMax;
    store<f64>(pgOutPtr + ((<usize>g) << 3), p);
  }

  return lambda;
}

/**
 * Evaluates bus active/reactive power injections (`Pcalc`, `Qcalc` in MW/Mvar)
 * and power balance residual vector `rhs = [dP_nonSlack; dQ_all]`.
 *
 * Returns `maxMismatch = max(|rhs|)`.
 */
export function ac_opf_eval_injections(
  nBus: i32,
  nNonSlack: i32,
  nonSlackIdxPtr: usize,
  gBusPtr: usize,
  bBusPtr: usize,
  vmPtr: usize,
  vaPtr: usize,
  pNetPtr: usize,
  qNetPtr: usize,
  sbase: f64,
  pCalcOutPtr: usize,
  qCalcOutPtr: usize,
  rhsOutPtr: usize,
): f64 {
  for (let i: i32 = 0; i < nBus; i++) {
    const iOff = (<usize>i) << 3;
    const vi = load<f64>(vmPtr + iOff);
    const vai = load<f64>(vaPtr + iOff);
    const rowBase = i * nBus;
    let pSum: f64 = 0.0;
    let qSum: f64 = 0.0;

    for (let k: i32 = 0; k < nBus; k++) {
      const kOff = (<usize>k) << 3;
      const vk = load<f64>(vmPtr + kOff);
      const th = vai - load<f64>(vaPtr + kOff);
      const ikOff = (<usize>(rowBase + k)) << 3;
      const g = load<f64>(gBusPtr + ikOff);
      const b = load<f64>(bBusPtr + ikOff);
      const cosTh = Math.cos(th);
      const sinTh = Math.sin(th);
      const vivkS = vi * vk * sbase;
      pSum += vivkS * (g * cosTh + b * sinTh);
      qSum += vivkS * (g * sinTh - b * cosTh);
    }

    store<f64>(pCalcOutPtr + iOff, pSum);
    store<f64>(qCalcOutPtr + iOff, qSum);
  }

  let maxMismatch: f64 = 0.0;
  for (let r: i32 = 0; r < nNonSlack; r++) {
    const i = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
    const iOff = (<usize>i) << 3;
    const dp = load<f64>(pNetPtr + iOff) - load<f64>(pCalcOutPtr + iOff);
    store<f64>(rhsOutPtr + ((<usize>r) << 3), dp);
    const adp = Math.abs(dp);
    if (adp > maxMismatch) maxMismatch = adp;
  }

  for (let i: i32 = 0; i < nBus; i++) {
    const iOff = (<usize>i) << 3;
    const dq = load<f64>(qNetPtr + iOff) - load<f64>(qCalcOutPtr + iOff);
    store<f64>(rhsOutPtr + ((<usize>(nNonSlack + i)) << 3), dq);
    const adq = Math.abs(dq);
    if (adq > maxMismatch) maxMismatch = adq;
  }

  return maxMismatch;
}

/**
 * Assembles the dense `(nNonSlack + nBus) x (nNonSlack + nBus)` AC power flow
 * Newton-Raphson Jacobian `[dP/dVa, dP/dVm; dQ/dVa, dQ/dVm]` in row-major order.
 */
export function ac_opf_assemble_jacobian(
  nBus: i32,
  nNonSlack: i32,
  nonSlackIdxPtr: usize,
  gBusPtr: usize,
  bBusPtr: usize,
  vmPtr: usize,
  vaPtr: usize,
  pCalcPtr: usize,
  qCalcPtr: usize,
  sbase: f64,
  jacOutPtr: usize,
): void {
  const dim = nNonSlack + nBus;

  // Top rows: dP_i / dVa_k and dP_i / dVm_k for non-slack buses
  for (let r: i32 = 0; r < nNonSlack; r++) {
    const i = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
    const iOff = (<usize>i) << 3;
    const vi = load<f64>(vmPtr + iOff);
    const vai = load<f64>(vaPtr + iOff);
    const pci = load<f64>(pCalcPtr + iOff);
    const qci = load<f64>(qCalcPtr + iOff);
    const rowOff = r * dim;
    const busRow = i * nBus;
    const iiOff = (<usize>(busRow + i)) << 3;
    const gii = load<f64>(gBusPtr + iiOff);
    const bii = load<f64>(bBusPtr + iiOff);

    for (let c: i32 = 0; c < nNonSlack; c++) {
      const k = load<i32>(nonSlackIdxPtr + ((<usize>c) << 2));
      const jOff = (<usize>(rowOff + c)) << 3;
      if (i == k) {
        store<f64>(jacOutPtr + jOff, -qci - vi * vi * bii * sbase);
      } else {
        const kOff = (<usize>k) << 3;
        const vk = load<f64>(vmPtr + kOff);
        const th = vai - load<f64>(vaPtr + kOff);
        const ikOff = (<usize>(busRow + k)) << 3;
        const g = load<f64>(gBusPtr + ikOff);
        const b = load<f64>(bBusPtr + ikOff);
        store<f64>(jacOutPtr + jOff, vi * vk * (g * Math.sin(th) - b * Math.cos(th)) * sbase);
      }
    }

    for (let c: i32 = 0; c < nBus; c++) {
      const k = c;
      const jOff = (<usize>(rowOff + nNonSlack + c)) << 3;
      if (i == k) {
        store<f64>(jacOutPtr + jOff, (vi != 0.0 ? pci / vi : 0.0) + vi * gii * sbase);
      } else {
        const kOff = (<usize>k) << 3;
        const th = vai - load<f64>(vaPtr + kOff);
        const ikOff = (<usize>(busRow + k)) << 3;
        const g = load<f64>(gBusPtr + ikOff);
        const b = load<f64>(bBusPtr + ikOff);
        store<f64>(jacOutPtr + jOff, vi * (g * Math.cos(th) + b * Math.sin(th)) * sbase);
      }
    }
  }

  // Bottom rows: dQ_i / dVa_k and dQ_i / dVm_k for all buses
  for (let i: i32 = 0; i < nBus; i++) {
    const iOff = (<usize>i) << 3;
    const vi = load<f64>(vmPtr + iOff);
    const vai = load<f64>(vaPtr + iOff);
    const pci = load<f64>(pCalcPtr + iOff);
    const qci = load<f64>(qCalcPtr + iOff);
    const rowOff = (nNonSlack + i) * dim;
    const busRow = i * nBus;
    const iiOff = (<usize>(busRow + i)) << 3;
    const gii = load<f64>(gBusPtr + iiOff);
    const bii = load<f64>(bBusPtr + iiOff);

    for (let c: i32 = 0; c < nNonSlack; c++) {
      const k = load<i32>(nonSlackIdxPtr + ((<usize>c) << 2));
      const jOff = (<usize>(rowOff + c)) << 3;
      if (i == k) {
        store<f64>(jacOutPtr + jOff, pci - vi * vi * gii * sbase);
      } else {
        const kOff = (<usize>k) << 3;
        const vk = load<f64>(vmPtr + kOff);
        const th = vai - load<f64>(vaPtr + kOff);
        const ikOff = (<usize>(busRow + k)) << 3;
        const g = load<f64>(gBusPtr + ikOff);
        const b = load<f64>(bBusPtr + ikOff);
        store<f64>(jacOutPtr + jOff, -vi * vk * (g * Math.cos(th) + b * Math.sin(th)) * sbase);
      }
    }

    for (let c: i32 = 0; c < nBus; c++) {
      const k = c;
      const jOff = (<usize>(rowOff + nNonSlack + c)) << 3;
      if (i == k) {
        store<f64>(jacOutPtr + jOff, (vi != 0.0 ? qci / vi : 0.0) - vi * bii * sbase);
      } else {
        const kOff = (<usize>k) << 3;
        const th = vai - load<f64>(vaPtr + kOff);
        const ikOff = (<usize>(busRow + k)) << 3;
        const g = load<f64>(gBusPtr + ikOff);
        const b = load<f64>(bBusPtr + ikOff);
        store<f64>(jacOutPtr + jOff, vi * (g * Math.sin(th) - b * Math.cos(th)) * sbase);
      }
    }
  }
}

/**
 * Full AC Newton-Raphson power flow loop with voltage magnitude clamping in linear memory.
 *
 * Scratch requirements (`dim = nNonSlack + nBus`):
 * - `scratchF64Ptr`: at least `2 * nBus + dim * dim + 3 * dim` f64 elements
 * - `scratchI32Ptr`: at least `dim` i32 elements
 *
 * Returns:
 * - `>= 0`: converged in `ret` iterations
 * - `< 0`: failed to converge or singular Jacobian
 */
export function ac_opf_newton_powerflow(
  nBus: i32,
  nNonSlack: i32,
  nonSlackIdxPtr: usize,
  gBusPtr: usize,
  bBusPtr: usize,
  pNetPtr: usize,
  qNetPtr: usize,
  vmPtr: usize,
  vaPtr: usize,
  sbase: f64,
  vMin: f64,
  vMax: f64,
  tol: f64,
  maxIter: i32,
  scratchF64Ptr: usize,
  scratchI32Ptr: usize,
): i32 {
  const dim = nNonSlack + nBus;
  if (nBus <= 0 || dim <= 0) return 0;

  const pCalcPtr = scratchF64Ptr;
  const qCalcPtr = pCalcPtr + ((<usize>nBus) << 3);
  const jacPtr = qCalcPtr + ((<usize>nBus) << 3);
  const rhsPtr = jacPtr + ((<usize>(dim * dim)) << 3);
  const scalePtr = rhsPtr + ((<usize>dim) << 3);
  const luScratchPtr = scalePtr + ((<usize>dim) << 3);
  const pivPtr = scratchI32Ptr;

  for (let iter: i32 = 0; iter < maxIter; iter++) {
    const maxMismatch = ac_opf_eval_injections(
      nBus,
      nNonSlack,
      nonSlackIdxPtr,
      gBusPtr,
      bBusPtr,
      vmPtr,
      vaPtr,
      pNetPtr,
      qNetPtr,
      sbase,
      pCalcPtr,
      qCalcPtr,
      rhsPtr,
    );

    if (maxMismatch < tol) {
      return iter;
    }

    ac_opf_assemble_jacobian(
      nBus,
      nNonSlack,
      nonSlackIdxPtr,
      gBusPtr,
      bBusPtr,
      vmPtr,
      vaPtr,
      pCalcPtr,
      qCalcPtr,
      sbase,
      jacPtr,
    );

    if (!luFactor(jacPtr as u32, pivPtr as u32, scalePtr as u32, dim as u32)) {
      return -(iter + 1);
    }
    luSolve(jacPtr as u32, pivPtr as u32, scalePtr as u32, rhsPtr as u32, luScratchPtr as u32, dim as u32);

    for (let r: i32 = 0; r < nNonSlack; r++) {
      const idx = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
      const idxOff = (<usize>idx) << 3;
      store<f64>(vaPtr + idxOff, load<f64>(vaPtr + idxOff) + load<f64>(rhsPtr + ((<usize>r) << 3)));
    }
    for (let i: i32 = 0; i < nBus; i++) {
      const iOff = (<usize>i) << 3;
      let newV = load<f64>(vmPtr + iOff) + load<f64>(rhsPtr + ((<usize>(nNonSlack + i)) << 3));
      if (newV < vMin) newV = vMin;
      if (newV > vMax) newV = vMax;
      store<f64>(vmPtr + iOff, newV);
    }
  }

  return -(maxIter + 1);
}

/**
 * Computes branch active/reactive power flows, apparent power loading %,
 * congestion flags, shadow prices, and total active transmission losses.
 *
 * Layout:
 * - `brIdxPtr`: `i32[2 * nBranches]` -> `[fromIdx, toIdx]`
 * - `brDataPtr`: `f64[4 * nBranches]` -> `[r, x, bChg, rateMva]`
 * - `brOutPtr`: `f64[5 * nBranches]` -> `[pFwd, qFwd, loadingPct, congestedFlag, shadowPrice]`
 *
 * Returns `totalLossMw`.
 */
export function ac_opf_branch_flows(
  nBranches: i32,
  brIdxPtr: usize,
  brDataPtr: usize,
  vmPtr: usize,
  vaPtr: usize,
  sbase: f64,
  enforceLimits: i32,
  brOutPtr: usize,
): f64 {
  let totalLossMw: f64 = 0.0;

  for (let k: i32 = 0; k < nBranches; k++) {
    const iBase = (<usize>(k * 2)) << 2;
    const f = load<i32>(brIdxPtr + iBase);
    const t = load<i32>(brIdxPtr + iBase + 4);

    const dBase = (<usize>(k * 4)) << 3;
    const r = load<f64>(brDataPtr + dBase);
    const x = load<f64>(brDataPtr + dBase + 8);
    const bChg = load<f64>(brDataPtr + dBase + 16);
    const rateMva = load<f64>(brDataPtr + dBase + 24);

    const fOff = (<usize>f) << 3;
    const tOff = (<usize>t) << 3;
    const vf = load<f64>(vmPtr + fOff);
    const vt = load<f64>(vmPtr + tOff);
    const thFt = load<f64>(vaPtr + fOff) - load<f64>(vaPtr + tOff);
    const cosFt = Math.cos(thFt);
    const sinFt = Math.sin(thFt);

    const denom = r * r + x * x;
    const g = denom > 0.0 ? r / denom : 0.0;
    const b = denom > 0.0 ? -x / denom : 0.0;

    const pFwd = (vf * vf * g - vf * vt * (g * cosFt + b * sinFt)) * sbase;
    const qFwd = (-vf * vf * (b + bChg * 0.5) - vf * vt * (g * sinFt - b * cosFt)) * sbase;
    const sFwd = Math.sqrt(pFwd * pFwd + qFwd * qFwd);

    // thTf = -thFt => cos(thTf) = cosFt, sin(thTf) = -sinFt
    const pRev = (vt * vt * g - vt * vf * (g * cosFt - b * sinFt)) * sbase;
    let lossBranch = pFwd + pRev;
    if (lossBranch < 0.0) lossBranch = 0.0;
    totalLossMw += lossBranch;

    const loadingPct: f64 = rateMva > 0.0 ? (sFwd / rateMva) * 100.0 : 0.0;
    const isCongested = enforceLimits != 0 && loadingPct >= 99.0;
    let shadowPrice: f64 = 0.0;
    if (isCongested) {
      const excess = sFwd - rateMva;
      shadowPrice = excess > 0.0 ? excess * 5.0 : 0.0;
    }

    const outBase = (<usize>(k * 5)) << 3;
    store<f64>(brOutPtr + outBase, pFwd);
    store<f64>(brOutPtr + outBase + 8, qFwd);
    store<f64>(brOutPtr + outBase + 16, loadingPct);
    store<f64>(brOutPtr + outBase + 24, isCongested ? 1.0 : 0.0);
    store<f64>(brOutPtr + outBase + 32, shadowPrice);
  }

  return totalLossMw;
}
