// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for Quasi-Dynamic Power Flow Simulation (QDSL).
 *
 * Implements zero-GC, flat linear-memory kernels for:
 * - Y-bus admittance matrix assembly with off-nominal transformer tap ratios (`qdsl_build_ybus`)
 * - Full AC Newton-Raphson power flow mismatch, Jacobian assembly, and LU solve (`qdsl_ac_powerflow_nr`)
 * - Coupled OLTC tap-stepping + Y-bus rebuild + AC NR power flow loop (`qdsl_solve_step_oltc`)
 * - Battery Energy Storage System (BESS) dispatch clamping & SoC integration (`qdsl_step_bess`)
 * - Branch loadings, branch losses, and transformer losses (`qdsl_branch_transformer_flows`)
 */

import { luFactor, luSolve } from "./matrix";

/**
 * Builds the dense N×N bus admittance matrices `Gbus` and `Bbus` in linear memory.
 *
 * Layout:
 * - `brIdxPtr`: `i32[3 * nBranches]` -> `[fromIdx, toIdx, status]`
 * - `brDataPtr`: `f64[4 * nBranches]` -> `[r, x, bShunt, rateA]` (`bShunt = b / 2`)
 * - `trIdxPtr`: `i32[3 * nTrans]` -> `[fromIdx, toIdx, status]`
 * - `trDataPtr`: `f64[2 * nTrans]` -> `[r12, x12]`
 * - `trTapPtr`: `f64[nTrans]` -> current off-nominal tap ratio per transformer
 * - `gBusOutPtr`, `bBusOutPtr`: `f64[nBus * nBus]` (zeroed and populated)
 */
export function qdsl_build_ybus(
  nBus: i32,
  nBranches: i32,
  brIdxPtr: usize,
  brDataPtr: usize,
  nTrans: i32,
  trIdxPtr: usize,
  trDataPtr: usize,
  trTapPtr: usize,
  gBusOutPtr: usize,
  bBusOutPtr: usize,
): void {
  if (nBus <= 0) return;

  const nnBytes = (<usize>(nBus * nBus)) << 3;
  memory.fill(gBusOutPtr, 0, nnBytes);
  memory.fill(bBusOutPtr, 0, nnBytes);

  for (let k: i32 = 0; k < nBranches; k++) {
    const iBase = (<usize>(k * 3)) << 2;
    const status = load<i32>(brIdxPtr + iBase + 8);
    if (status == 0) continue;

    const fromIdx = load<i32>(brIdxPtr + iBase);
    const toIdx = load<i32>(brIdxPtr + iBase + 4);
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= nBus || toIdx >= nBus) continue;

    const dBase = (<usize>(k * 4)) << 3;
    const r = load<f64>(brDataPtr + dBase);
    const x = load<f64>(brDataPtr + dBase + 8);
    const bShunt = load<f64>(brDataPtr + dBase + 16);
    const z2 = r * r + x * x;
    if (z2 < 1e-12) continue;

    const gSeries = r / z2;
    const bSeries = -x / z2;

    const ftOff = (<usize>(fromIdx * nBus + toIdx)) << 3;
    const tfOff = (<usize>(toIdx * nBus + fromIdx)) << 3;
    const ffOff = (<usize>(fromIdx * nBus + fromIdx)) << 3;
    const ttOff = (<usize>(toIdx * nBus + toIdx)) << 3;

    store<f64>(gBusOutPtr + ftOff, load<f64>(gBusOutPtr + ftOff) - gSeries);
    store<f64>(bBusOutPtr + ftOff, load<f64>(bBusOutPtr + ftOff) - bSeries);
    store<f64>(gBusOutPtr + tfOff, load<f64>(gBusOutPtr + tfOff) - gSeries);
    store<f64>(bBusOutPtr + tfOff, load<f64>(bBusOutPtr + tfOff) - bSeries);

    store<f64>(gBusOutPtr + ffOff, load<f64>(gBusOutPtr + ffOff) + gSeries);
    store<f64>(bBusOutPtr + ffOff, load<f64>(bBusOutPtr + ffOff) + bSeries + bShunt);
    store<f64>(gBusOutPtr + ttOff, load<f64>(gBusOutPtr + ttOff) + gSeries);
    store<f64>(bBusOutPtr + ttOff, load<f64>(bBusOutPtr + ttOff) + bSeries + bShunt);
  }

  for (let k: i32 = 0; k < nTrans; k++) {
    const iBase = (<usize>(k * 3)) << 2;
    const status = load<i32>(trIdxPtr + iBase + 8);
    if (status == 0) continue;

    const fromIdx = load<i32>(trIdxPtr + iBase);
    const toIdx = load<i32>(trIdxPtr + iBase + 4);
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= nBus || toIdx >= nBus) continue;

    const dBase = (<usize>(k * 2)) << 3;
    const r = load<f64>(trDataPtr + dBase);
    const x = load<f64>(trDataPtr + dBase + 8);
    const z2 = r * r + x * x;
    if (z2 < 1e-12) continue;

    const gSeries = r / z2;
    const bSeries = -x / z2;
    const tapRatio = load<f64>(trTapPtr + ((<usize>k) << 3));
    const invTap = 1.0 / tapRatio;
    const invA2 = invTap * invTap;

    const ftOff = (<usize>(fromIdx * nBus + toIdx)) << 3;
    const tfOff = (<usize>(toIdx * nBus + fromIdx)) << 3;
    const ffOff = (<usize>(fromIdx * nBus + fromIdx)) << 3;
    const ttOff = (<usize>(toIdx * nBus + toIdx)) << 3;

    store<f64>(gBusOutPtr + ftOff, load<f64>(gBusOutPtr + ftOff) - gSeries * invTap);
    store<f64>(bBusOutPtr + ftOff, load<f64>(bBusOutPtr + ftOff) - bSeries * invTap);
    store<f64>(gBusOutPtr + tfOff, load<f64>(gBusOutPtr + tfOff) - gSeries * invTap);
    store<f64>(bBusOutPtr + tfOff, load<f64>(bBusOutPtr + tfOff) - bSeries * invTap);

    store<f64>(gBusOutPtr + ffOff, load<f64>(gBusOutPtr + ffOff) + gSeries * invA2);
    store<f64>(bBusOutPtr + ffOff, load<f64>(bBusOutPtr + ffOff) + bSeries * invA2);
    store<f64>(gBusOutPtr + ttOff, load<f64>(gBusOutPtr + ttOff) + gSeries);
    store<f64>(bBusOutPtr + ttOff, load<f64>(bBusOutPtr + ttOff) + bSeries);
  }
}

/**
 * Full AC Power Flow Newton-Raphson solver in flat linear memory.
 *
 * Scratch requirements:
 * - `scratchF64Ptr`: at least `(2 * nBus + nVars * nVars + 3 * nVars)` f64 elements, where `nVars = nP + nQ`.
 * - `scratchI32Ptr`: at least `nVars` i32 elements.
 *
 * Returns:
 * - `>= 0`: converged in `ret` iterations
 * - `< 0`: failed to converge (or singular Jacobian); iteration count is `-ret - 1`
 */
export function qdsl_ac_powerflow_nr(
  nBus: i32,
  nP: i32,
  nQ: i32,
  nonSlackIdxPtr: usize,
  pqIdxPtr: usize,
  gBusPtr: usize,
  bBusPtr: usize,
  pSpecPuPtr: usize,
  qSpecPuPtr: usize,
  vmPtr: usize,
  vaPtr: usize,
  tol: f64,
  maxIter: i32,
  scratchF64Ptr: usize,
  scratchI32Ptr: usize,
): i32 {
  const nVars = nP + nQ;
  if (nBus <= 0 || nVars <= 0) return 0;

  const pCalcPtr = scratchF64Ptr;
  const qCalcPtr = pCalcPtr + ((<usize>nBus) << 3);
  const jacPtr = qCalcPtr + ((<usize>nBus) << 3);
  const rhsPtr = jacPtr + ((<usize>(nVars * nVars)) << 3);
  const scalePtr = rhsPtr + ((<usize>nVars) << 3);
  const luScratchPtr = scalePtr + ((<usize>nVars) << 3);
  const pivPtr = scratchI32Ptr;

  for (let iter: i32 = 0; iter < maxIter; iter++) {
    // 1. Power injections Pcalc, Qcalc
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
        const vivk = vi * vk;
        pSum += vivk * (g * cosTh + b * sinTh);
        qSum += vivk * (g * sinTh - b * cosTh);
      }

      store<f64>(pCalcPtr + iOff, pSum);
      store<f64>(qCalcPtr + iOff, qSum);
    }

    // 2. Active & reactive power mismatches directly into rhsPtr
    let maxMismatch: f64 = 0.0;
    for (let r: i32 = 0; r < nP; r++) {
      const i = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
      const iOff = (<usize>i) << 3;
      const dp = load<f64>(pSpecPuPtr + iOff) - load<f64>(pCalcPtr + iOff);
      store<f64>(rhsPtr + ((<usize>r) << 3), dp);
      const adp = Math.abs(dp);
      if (adp > maxMismatch) maxMismatch = adp;
    }

    for (let r: i32 = 0; r < nQ; r++) {
      const i = load<i32>(pqIdxPtr + ((<usize>r) << 2));
      const iOff = (<usize>i) << 3;
      const dq = load<f64>(qSpecPuPtr + iOff) - load<f64>(qCalcPtr + iOff);
      store<f64>(rhsPtr + ((<usize>(nP + r)) << 3), dq);
      const adq = Math.abs(dq);
      if (adq > maxMismatch) maxMismatch = adq;
    }

    if (maxMismatch < tol) {
      return iter;
    }

    // 3. Assemble Jacobian blocks:
    //    [ dP/dVa (nP x nP)   dP/dVm (nP x nQ) ]
    //    [ dQ/dVa (nQ x nP)   dQ/dVm (nQ x nQ) ]

    // Block 1: dP / dVa (nP x nP)
    for (let r: i32 = 0; r < nP; r++) {
      const i = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
      const iOff = (<usize>i) << 3;
      const vi = load<f64>(vmPtr + iOff);
      const vai = load<f64>(vaPtr + iOff);
      const rowOff = r * nVars;
      const busRow = i * nBus;
      const qci = load<f64>(qCalcPtr + iOff);

      for (let c: i32 = 0; c < nP; c++) {
        const k = load<i32>(nonSlackIdxPtr + ((<usize>c) << 2));
        const jOff = (<usize>(rowOff + c)) << 3;
        if (i == k) {
          const bii = load<f64>(bBusPtr + ((<usize>(busRow + i)) << 3));
          store<f64>(jacPtr + jOff, -qci - vi * vi * bii);
        } else {
          const kOff = (<usize>k) << 3;
          const th = vai - load<f64>(vaPtr + kOff);
          const ikOff = (<usize>(busRow + k)) << 3;
          const g = load<f64>(gBusPtr + ikOff);
          const b = load<f64>(bBusPtr + ikOff);
          store<f64>(jacPtr + jOff, vi * load<f64>(vmPtr + kOff) * (g * Math.sin(th) - b * Math.cos(th)));
        }
      }
    }

    // Block 2: dP / dVm (nP x nQ)
    for (let r: i32 = 0; r < nP; r++) {
      const i = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
      const iOff = (<usize>i) << 3;
      const vi = load<f64>(vmPtr + iOff);
      const vai = load<f64>(vaPtr + iOff);
      const rowOff = r * nVars;
      const busRow = i * nBus;
      const pci = load<f64>(pCalcPtr + iOff);

      for (let c: i32 = 0; c < nQ; c++) {
        const k = load<i32>(pqIdxPtr + ((<usize>c) << 2));
        const jOff = (<usize>(rowOff + nP + c)) << 3;
        if (i == k) {
          const gii = load<f64>(gBusPtr + ((<usize>(busRow + i)) << 3));
          store<f64>(jacPtr + jOff, pci / vi + vi * gii);
        } else {
          const kOff = (<usize>k) << 3;
          const th = vai - load<f64>(vaPtr + kOff);
          const ikOff = (<usize>(busRow + k)) << 3;
          const g = load<f64>(gBusPtr + ikOff);
          const b = load<f64>(bBusPtr + ikOff);
          store<f64>(jacPtr + jOff, vi * (g * Math.cos(th) + b * Math.sin(th)));
        }
      }
    }

    // Block 3: dQ / dVa (nQ x nP)
    for (let r: i32 = 0; r < nQ; r++) {
      const i = load<i32>(pqIdxPtr + ((<usize>r) << 2));
      const iOff = (<usize>i) << 3;
      const vi = load<f64>(vmPtr + iOff);
      const vai = load<f64>(vaPtr + iOff);
      const rowOff = (nP + r) * nVars;
      const busRow = i * nBus;
      const pci = load<f64>(pCalcPtr + iOff);

      for (let c: i32 = 0; c < nP; c++) {
        const k = load<i32>(nonSlackIdxPtr + ((<usize>c) << 2));
        const jOff = (<usize>(rowOff + c)) << 3;
        if (i == k) {
          const gii = load<f64>(gBusPtr + ((<usize>(busRow + i)) << 3));
          store<f64>(jacPtr + jOff, pci - vi * vi * gii);
        } else {
          const kOff = (<usize>k) << 3;
          const th = vai - load<f64>(vaPtr + kOff);
          const ikOff = (<usize>(busRow + k)) << 3;
          const g = load<f64>(gBusPtr + ikOff);
          const b = load<f64>(bBusPtr + ikOff);
          store<f64>(jacPtr + jOff, -vi * load<f64>(vmPtr + kOff) * (g * Math.cos(th) + b * Math.sin(th)));
        }
      }
    }

    // Block 4: dQ / dVm (nQ x nQ)
    for (let r: i32 = 0; r < nQ; r++) {
      const i = load<i32>(pqIdxPtr + ((<usize>r) << 2));
      const iOff = (<usize>i) << 3;
      const vi = load<f64>(vmPtr + iOff);
      const vai = load<f64>(vaPtr + iOff);
      const rowOff = (nP + r) * nVars;
      const busRow = i * nBus;
      const qci = load<f64>(qCalcPtr + iOff);

      for (let c: i32 = 0; c < nQ; c++) {
        const k = load<i32>(pqIdxPtr + ((<usize>c) << 2));
        const jOff = (<usize>(rowOff + nP + c)) << 3;
        if (i == k) {
          const bii = load<f64>(bBusPtr + ((<usize>(busRow + i)) << 3));
          store<f64>(jacPtr + jOff, qci / vi - vi * bii);
        } else {
          const kOff = (<usize>k) << 3;
          const th = vai - load<f64>(vaPtr + kOff);
          const ikOff = (<usize>(busRow + k)) << 3;
          const g = load<f64>(gBusPtr + ikOff);
          const b = load<f64>(bBusPtr + ikOff);
          store<f64>(jacPtr + jOff, vi * (g * Math.sin(th) - b * Math.cos(th)));
        }
      }
    }

    // 4. Solve Jac * delta = rhs in-place via row-equilibrated LU
    if (!luFactor(jacPtr as u32, pivPtr as u32, scalePtr as u32, nVars as u32)) {
      return -(iter + 1);
    }
    luSolve(jacPtr as u32, pivPtr as u32, scalePtr as u32, rhsPtr as u32, luScratchPtr as u32, nVars as u32);

    // 5. Update voltage angles and magnitudes
    for (let r: i32 = 0; r < nP; r++) {
      const idx = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
      const idxOff = (<usize>idx) << 3;
      store<f64>(vaPtr + idxOff, load<f64>(vaPtr + idxOff) + load<f64>(rhsPtr + ((<usize>r) << 3)));
    }
    for (let r: i32 = 0; r < nQ; r++) {
      const k = load<i32>(pqIdxPtr + ((<usize>r) << 2));
      const kOff = (<usize>k) << 3;
      let newV = load<f64>(vmPtr + kOff) + load<f64>(rhsPtr + ((<usize>(nP + r)) << 3));
      if (newV < 0.5) newV = 0.5;
      else if (newV > 1.5) newV = 1.5;
      store<f64>(vmPtr + kOff, newV);
    }
  }

  return -(maxIter + 1);
}

/**
 * Executes a single QDSL time-step's coupled OLTC tap-stepping + Y-bus rebuild + AC NR solve loop.
 *
 * Layout:
 * - `tcIdxPtr`: `i32[2 * nTaps]` -> `[transformerIndex, controlledBusIdx]`
 * - `tcParamsPtr`: `f64[5 * nTaps]` -> `[targetVoltagePu, deadbandPu, stepSizeRatio, minTapRatio, maxTapRatio]`
 * - `tcTapRatioPtr`: `f64[nTaps]` -> in/out current tap ratios
 *
 * Returns the final `qdsl_ac_powerflow_nr` return code (`>= 0` converged with `ret` iterations, `< 0` unconverged).
 */
export function qdsl_solve_step_oltc(
  nBus: i32,
  nP: i32,
  nQ: i32,
  nonSlackIdxPtr: usize,
  pqIdxPtr: usize,
  nBranches: i32,
  brIdxPtr: usize,
  brDataPtr: usize,
  nTrans: i32,
  trIdxPtr: usize,
  trDataPtr: usize,
  trTapPtr: usize,
  nTaps: i32,
  tcIdxPtr: usize,
  tcParamsPtr: usize,
  tcTapRatioPtr: usize,
  pSpecPuPtr: usize,
  qSpecPuPtr: usize,
  vmPtr: usize,
  vaPtr: usize,
  tol: f64,
  maxNrIter: i32,
  maxOltcIter: i32,
  gBusPtr: usize,
  bBusPtr: usize,
  scratchF64Ptr: usize,
  scratchI32Ptr: usize,
): i32 {
  let lastRet: i32 = -1;
  const iters = maxOltcIter > 0 ? maxOltcIter : 1;

  for (let oltcIter: i32 = 0; oltcIter < iters; oltcIter++) {
    // Sync tap changer ratios into transformer tap array
    for (let t: i32 = 0; t < nTaps; t++) {
      const trIdx = load<i32>(tcIdxPtr + ((<usize>(t * 2)) << 2));
      if (trIdx >= 0 && trIdx < nTrans) {
        const ratio = load<f64>(tcTapRatioPtr + ((<usize>t) << 3));
        store<f64>(trTapPtr + ((<usize>trIdx) << 3), ratio);
      }
    }

    qdsl_build_ybus(
      nBus,
      nBranches,
      brIdxPtr,
      brDataPtr,
      nTrans,
      trIdxPtr,
      trDataPtr,
      trTapPtr,
      gBusPtr,
      bBusPtr,
    );

    lastRet = qdsl_ac_powerflow_nr(
      nBus,
      nP,
      nQ,
      nonSlackIdxPtr,
      pqIdxPtr,
      gBusPtr,
      bBusPtr,
      pSpecPuPtr,
      qSpecPuPtr,
      vmPtr,
      vaPtr,
      tol,
      maxNrIter,
      scratchF64Ptr,
      scratchI32Ptr,
    );

    let tapChanged = false;
    for (let t: i32 = 0; t < nTaps; t++) {
      const cBusIdx = load<i32>(tcIdxPtr + ((<usize>(t * 2 + 1)) << 2));
      if (cBusIdx < 0 || cBusIdx >= nBus) continue;

      const vAct = load<f64>(vmPtr + ((<usize>cBusIdx) << 3));
      const pBase = (<usize>(t * 5)) << 3;
      const vSet = load<f64>(tcParamsPtr + pBase);
      const db = load<f64>(tcParamsPtr + pBase + 8);
      const step = load<f64>(tcParamsPtr + pBase + 16);
      const minTap = load<f64>(tcParamsPtr + pBase + 24);
      const maxTap = load<f64>(tcParamsPtr + pBase + 32);

      const tapOff = (<usize>t) << 3;
      let curTap = load<f64>(tcTapRatioPtr + tapOff);

      if (vAct < vSet - db && curTap > minTap) {
        const nextTap = curTap - step;
        curTap = nextTap > minTap ? nextTap : minTap;
        store<f64>(tcTapRatioPtr + tapOff, curTap);
        tapChanged = true;
      } else if (vAct > vSet + db && curTap < maxTap) {
        const nextTap = curTap + step;
        curTap = nextTap < maxTap ? nextTap : maxTap;
        store<f64>(tcTapRatioPtr + tapOff, curTap);
        tapChanged = true;
      }
    }

    if (!tapChanged) break;
  }

  return lastRet;
}

/**
 * Steps all Battery Energy Storage Systems (BESS) for one time interval `dt` (hours),
 * updating State of Charge (`socPtr`), actual dispatch power (`actualMwOutPtr`),
 * and accumulating net load impact into `pLoadMwPtr`.
 *
 * Layout:
 * - `bessBusIdxPtr`: `i32[nBess]` -> bus index (`-1` if unmapped)
 * - `bessParamsPtr`: `f64[7 * nBess]` -> `[capMwh, maxChgMw, maxDisMw, minSoc, maxSoc, etaChg, etaDis]`
 * - `desiredMwPtr`: `f64[nBess]` -> scheduled dispatch (+MW charging, -MW discharging)
 * - `socPtr`: `f64[nBess]` -> in/out State of Charge in `[0, 1]`
 * - `actualMwOutPtr`: `f64[nBess]` -> out realized power in MW
 * - `pLoadMwPtr`: `f64[nBus]` -> in/out bus active load in MW
 */
export function qdsl_step_bess(
  nBess: i32,
  nBus: i32,
  dt: f64,
  bessBusIdxPtr: usize,
  bessParamsPtr: usize,
  desiredMwPtr: usize,
  socPtr: usize,
  actualMwOutPtr: usize,
  pLoadMwPtr: usize,
): void {
  for (let b: i32 = 0; b < nBess; b++) {
    const bOff = (<usize>b) << 3;
    const desiredMw = load<f64>(desiredMwPtr + bOff);
    const pBase = (<usize>(b * 7)) << 3;
    const capMwh = load<f64>(bessParamsPtr + pBase);
    const maxChgMw = load<f64>(bessParamsPtr + pBase + 8);
    const maxDisMw = load<f64>(bessParamsPtr + pBase + 16);
    const minSoc = load<f64>(bessParamsPtr + pBase + 24);
    const maxSoc = load<f64>(bessParamsPtr + pBase + 32);
    const etaChg = load<f64>(bessParamsPtr + pBase + 40);
    const etaDis = load<f64>(bessParamsPtr + pBase + 48);

    let soc = load<f64>(socPtr + bOff);
    const bIdx = load<i32>(bessBusIdxPtr + ((<usize>b) << 2));
    let actualMw: f64 = 0.0;

    if (desiredMw > 0.0) {
      const maxChgLimit = maxChgMw < desiredMw ? maxChgMw : desiredMw;
      const energySpaceMwh = (maxSoc - soc) * capMwh;
      const maxPossibleMw = dt > 0.0 ? energySpaceMwh / (etaChg * dt) : 0.0;
      actualMw = maxChgLimit < maxPossibleMw ? maxChgLimit : maxPossibleMw;
      if (actualMw < 0.0) actualMw = 0.0;
      soc += (actualMw * etaChg * dt) / capMwh;
      if (bIdx >= 0 && bIdx < nBus) {
        const busOff = (<usize>bIdx) << 3;
        store<f64>(pLoadMwPtr + busOff, load<f64>(pLoadMwPtr + busOff) + actualMw);
      }
    } else if (desiredMw < 0.0) {
      const reqDisMw = -desiredMw;
      const maxDisLimit = maxDisMw < reqDisMw ? maxDisMw : reqDisMw;
      const energyAvailableMwh = (soc - minSoc) * capMwh;
      const maxPossibleMw = dt > 0.0 ? (energyAvailableMwh * etaDis) / dt : 0.0;
      let disMw = maxDisLimit < maxPossibleMw ? maxDisLimit : maxPossibleMw;
      if (disMw < 0.0) disMw = 0.0;
      actualMw = -disMw;
      soc -= ((disMw / etaDis) * dt) / capMwh;
      if (bIdx >= 0 && bIdx < nBus) {
        const busOff = (<usize>bIdx) << 3;
        store<f64>(pLoadMwPtr + busOff, load<f64>(pLoadMwPtr + busOff) + actualMw);
      }
    }

    if (soc < 0.0) soc = 0.0;
    else if (soc > 1.0) soc = 1.0;

    store<f64>(socPtr + bOff, soc);
    store<f64>(actualMwOutPtr + bOff, actualMw);
  }
}

/**
 * Computes branch thermal loadings (%), total active/reactive losses across all branches
 * and transformers, and peak branch loading for a single solved time step.
 *
 * Outputs:
 * - `branchLoadingsPtr`: `f64[nBranches]` -> percentage loading per branch
 * - `summaryOutPtr`: `f64[4]` -> `[stepLossMw, stepLossMvar, maxLoadingPct, maxLoadingBranchIdx]`
 */
export function qdsl_branch_transformer_flows(
  nBus: i32,
  sbase: f64,
  vmPtr: usize,
  vaPtr: usize,
  nBranches: i32,
  brIdxPtr: usize,
  brDataPtr: usize,
  nTrans: i32,
  trIdxPtr: usize,
  trDataPtr: usize,
  branchLoadingsPtr: usize,
  summaryOutPtr: usize,
): void {
  let stepLossMw: f64 = 0.0;
  let stepLossMvar: f64 = 0.0;
  let maxLoadingPct: f64 = 0.0;
  let maxLoadingBranch: i32 = 0;

  for (let brIdx: i32 = 0; brIdx < nBranches; brIdx++) {
    const iBase = (<usize>(brIdx * 3)) << 2;
    const fromIdx = load<i32>(brIdxPtr + iBase);
    const toIdx = load<i32>(brIdxPtr + iBase + 4);
    const loadOff = (<usize>brIdx) << 3;

    if (fromIdx < 0 || toIdx < 0 || fromIdx >= nBus || toIdx >= nBus) {
      store<f64>(branchLoadingsPtr + loadOff, 0.0);
      continue;
    }

    const fOff = (<usize>fromIdx) << 3;
    const tOff = (<usize>toIdx) << 3;
    const vf = load<f64>(vmPtr + fOff);
    const vt = load<f64>(vmPtr + tOff);
    const thFt = load<f64>(vaPtr + fOff) - load<f64>(vaPtr + tOff);

    const dBase = (<usize>(brIdx * 4)) << 3;
    const r = load<f64>(brDataPtr + dBase);
    const x = load<f64>(brDataPtr + dBase + 8);
    const bShunt = load<f64>(brDataPtr + dBase + 16);
    const rateA = load<f64>(brDataPtr + dBase + 24);

    const z2 = r * r + x * x;
    const g = r / z2;
    const b = -x / z2;

    const cosTh = Math.cos(thFt);
    const sinTh = Math.sin(thFt);
    const vf2 = vf * vf;
    const vt2 = vt * vt;
    const vfvt = vf * vt;

    const pFrom = (vf2 * g - vfvt * (g * cosTh + b * sinTh)) * sbase;
    const qFrom = (-vf2 * (b + bShunt) - vfvt * (g * sinTh - b * cosTh)) * sbase;

    // cos(-th) = cosTh, sin(-th) = -sinTh
    const pTo = (vt2 * g - vfvt * (g * cosTh - b * sinTh)) * sbase;
    const qTo = (-vt2 * (b + bShunt) - vfvt * (-g * sinTh - b * cosTh)) * sbase;

    const pLossSum = pFrom + pTo;
    if (pLossSum > 0.0) stepLossMw += pLossSum;
    stepLossMvar += qFrom + qTo;

    const sMva = Math.sqrt(pFrom * pFrom + qFrom * qFrom);
    const loadingPct = (sMva / rateA) * 100.0;
    store<f64>(branchLoadingsPtr + loadOff, loadingPct);

    if (loadingPct > maxLoadingPct) {
      maxLoadingPct = loadingPct;
      maxLoadingBranch = brIdx;
    }
  }

  for (let trIdx: i32 = 0; trIdx < nTrans; trIdx++) {
    const iBase = (<usize>(trIdx * 3)) << 2;
    const fromIdx = load<i32>(trIdxPtr + iBase);
    const toIdx = load<i32>(trIdxPtr + iBase + 4);
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= nBus || toIdx >= nBus) continue;

    const fOff = (<usize>fromIdx) << 3;
    const tOff = (<usize>toIdx) << 3;
    const vf = load<f64>(vmPtr + fOff);
    const vt = load<f64>(vmPtr + tOff);
    const thFt = load<f64>(vaPtr + fOff) - load<f64>(vaPtr + tOff);

    const dBase = (<usize>(trIdx * 2)) << 3;
    const r = load<f64>(trDataPtr + dBase);
    const x = load<f64>(trDataPtr + dBase + 8);
    const z2 = r * r + x * x;
    const g = r / z2;
    const b = -x / z2;

    const cosTh = Math.cos(thFt);
    const sinTh = Math.sin(thFt);
    const vf2 = vf * vf;
    const vt2 = vt * vt;
    const vfvt = vf * vt;

    const pFrom = (vf2 * g - vfvt * (g * cosTh + b * sinTh)) * sbase;
    const qFrom = (-vf2 * b - vfvt * (g * sinTh - b * cosTh)) * sbase;
    const pTo = (vt2 * g - vfvt * (g * cosTh - b * sinTh)) * sbase;
    const qTo = (-vt2 * b - vfvt * (-g * sinTh - b * cosTh)) * sbase;

    const pLossSum = pFrom + pTo;
    if (pLossSum > 0.0) stepLossMw += pLossSum;
    stepLossMvar += qFrom + qTo;
  }

  store<f64>(summaryOutPtr, stepLossMw);
  store<f64>(summaryOutPtr + 8, stepLossMvar);
  store<f64>(summaryOutPtr + 16, maxLoadingPct);
  store<f64>(summaryOutPtr + 24, <f64>maxLoadingBranch);
}
