// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for DC Optimal Power Flow (DC-OPF).
 *
 * Implements zero-GC, flat linear-memory kernels for:
 * - Dense matrix inversion via row-equilibrated LU (`dc_opf_invert_dense`)
 * - Nodal susceptance Bbus, sensitivity Xbus, and PTDF matrix construction (`dc_opf_build_ptdf`)
 * - DC power flow bus angle and branch flow evaluation (`dc_opf_compute_flows`)
 * - Economic dispatch lambda bisection (`dc_opf_dispatch_bisection`)
 * - Iterative congestion-relief dispatch loop (`dc_opf_solve_dispatch`)
 * - Branch shadow price and nodal LMP decomposition (`dc_opf_compute_lmps`)
 */

import { luFactor, luSolve } from "./matrix";

/**
 * Inverts a dense n x n row-major matrix at `aPtr` into `invOutPtr` using
 * row-equilibrated LU factorization and back-substitution.
 *
 * Scratch requirements:
 * - `scratchF64Ptr`: `n * n + 3 * n` f64 elements (`work[n*n]`, `scale[n]`, `col[n]`, `luScratch[n]`)
 * - `scratchI32Ptr`: `n` i32 elements (`piv[n]`)
 *
 * Returns `1` on success, `0` if the matrix is singular or non-finite.
 */
export function dc_opf_invert_dense(
  n: i32,
  aPtr: usize,
  invOutPtr: usize,
  scratchF64Ptr: usize,
  scratchI32Ptr: usize,
): i32 {
  if (n <= 0) return 1;

  const nn = (<usize>n) * (<usize>n);
  const nBytes = (<usize>n) << 3;
  const nnBytes = nn << 3;

  const workPtr = scratchF64Ptr;
  const scalePtr = workPtr + nnBytes;
  const colPtr = scalePtr + nBytes;
  const luScratchPtr = colPtr + nBytes;

  memory.copy(workPtr, aPtr, nnBytes);

  if (!luFactor(workPtr as u32, scratchI32Ptr as u32, scalePtr as u32, n as u32)) {
    return 0;
  }

  // Verify diagonal pivots are finite and non-degenerate
  for (let i: i32 = 0; i < n; i++) {
    const diag = load<f64>(workPtr + (((<usize>i) * (<usize>n) + (<usize>i)) << 3));
    if (!isFinite<f64>(diag) || Math.abs(diag) < 1e-12) {
      return 0;
    }
  }

  for (let j: i32 = 0; j < n; j++) {
    memory.fill(colPtr, 0, nBytes);
    store<f64>(colPtr + ((<usize>j) << 3), 1.0);
    luSolve(
      workPtr as u32,
      scratchI32Ptr as u32,
      scalePtr as u32,
      colPtr as u32,
      luScratchPtr as u32,
      n as u32,
    );
    for (let i: i32 = 0; i < n; i++) {
      const val = load<f64>(colPtr + ((<usize>i) << 3));
      store<f64>(invOutPtr + (((<usize>i) * (<usize>n) + (<usize>j)) << 3), val);
    }
  }

  return 1;
}

/**
 * Constructs nodal susceptance Bbus, reduced inverse Xred, full bus sensitivity
 * matrix Xbus (N x N), and Power Transfer Distribution Factors PTDF (nBranches x N).
 *
 * Layout:
 * - `nonSlackIdxPtr`: `i32[nRed]` -> bus indices excluding slack bus
 * - `brIdxPtr`: `i32[2 * nBranches]` -> `[fromIdx, toIdx]`
 * - `brDataPtr`: `f64[2 * nBranches]` -> `[susceptance, rateMva]`
 * - `xBusOutPtr`: `f64[nBus * nBus]`
 * - `ptdfOutPtr`: `f64[nBranches * nBus]`
 *
 * Scratch requirements:
 * - `scratchF64Ptr`: `nBus * nBus + 3 * nRed * nRed + 3 * nRed` f64 elements
 * - `scratchI32Ptr`: `nRed` i32 elements
 *
 * Returns `1` if reduced B matrix inversion succeeded (or `nRed <= 0`), `0` if singular.
 */
export function dc_opf_build_ptdf(
  nBus: i32,
  nRed: i32,
  nBranches: i32,
  nonSlackIdxPtr: usize,
  brIdxPtr: usize,
  brDataPtr: usize,
  xBusOutPtr: usize,
  ptdfOutPtr: usize,
  scratchF64Ptr: usize,
  scratchI32Ptr: usize,
): i32 {
  if (nBus <= 0) return 1;

  const nnBytes = ((<usize>nBus) * (<usize>nBus)) << 3;
  const nRedU = nRed > 0 ? (<usize>nRed) : 0;
  const redSqBytes = (nRedU * nRedU) << 3;

  const bBusPtr = scratchF64Ptr;
  const bRedPtr = bBusPtr + nnBytes;
  const xRedPtr = bRedPtr + redSqBytes;
  const invScratchPtr = xRedPtr + redSqBytes;

  // Assemble nodal susceptance matrix Bbus
  memory.fill(bBusPtr, 0, nnBytes);
  for (let b: i32 = 0; b < nBranches; b++) {
    const iBase = (<usize>(b * 2)) << 2;
    const f = load<i32>(brIdxPtr + iBase);
    const t = load<i32>(brIdxPtr + iBase + 4);
    if (f < 0 || t < 0 || f >= nBus || t >= nBus) continue;

    const susc = load<f64>(brDataPtr + ((<usize>(b * 2)) << 3));

    const ffOff = (((<usize>f) * (<usize>nBus) + (<usize>f)) << 3);
    const ttOff = (((<usize>t) * (<usize>nBus) + (<usize>t)) << 3);
    const ftOff = (((<usize>f) * (<usize>nBus) + (<usize>t)) << 3);
    const tfOff = (((<usize>t) * (<usize>nBus) + (<usize>f)) << 3);

    store<f64>(bBusPtr + ffOff, load<f64>(bBusPtr + ffOff) + susc);
    store<f64>(bBusPtr + ttOff, load<f64>(bBusPtr + ttOff) + susc);
    store<f64>(bBusPtr + ftOff, load<f64>(bBusPtr + ftOff) - susc);
    store<f64>(bBusPtr + tfOff, load<f64>(bBusPtr + tfOff) - susc);
  }

  // Zero Xbus output
  memory.fill(xBusOutPtr, 0, nnBytes);

  let ok: i32 = 1;
  if (nRed > 0) {
    // Extract reduced susceptance matrix Bred
    for (let r: i32 = 0; r < nRed; r++) {
      const busR = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
      const busRRow = (<usize>busR) * (<usize>nBus);
      const redRow = (<usize>r) * nRedU;
      for (let c: i32 = 0; c < nRed; c++) {
        const busC = load<i32>(nonSlackIdxPtr + ((<usize>c) << 2));
        const val = load<f64>(bBusPtr + ((busRRow + (<usize>busC)) << 3));
        store<f64>(bRedPtr + ((redRow + (<usize>c)) << 3), val);
      }
    }

    ok = dc_opf_invert_dense(nRed, bRedPtr, xRedPtr, invScratchPtr, scratchI32Ptr);
    if (ok != 0) {
      // Scatter Xred into full N x N sensitivity matrix Xbus
      for (let r: i32 = 0; r < nRed; r++) {
        const busR = load<i32>(nonSlackIdxPtr + ((<usize>r) << 2));
        const busRRow = (<usize>busR) * (<usize>nBus);
        const redRow = (<usize>r) * nRedU;
        for (let c: i32 = 0; c < nRed; c++) {
          const busC = load<i32>(nonSlackIdxPtr + ((<usize>c) << 2));
          const val = load<f64>(xRedPtr + ((redRow + (<usize>c)) << 3));
          store<f64>(xBusOutPtr + ((busRRow + (<usize>busC)) << 3), val);
        }
      }
    }
  }

  // Compute PTDF[b * nBus + i] = susc[b] * (Xbus[from * nBus + i] - Xbus[to * nBus + i])
  for (let b: i32 = 0; b < nBranches; b++) {
    const iBase = (<usize>(b * 2)) << 2;
    const f = load<i32>(brIdxPtr + iBase);
    const t = load<i32>(brIdxPtr + iBase + 4);
    const susc = load<f64>(brDataPtr + ((<usize>(b * 2)) << 3));

    const fRow = (<usize>f) * (<usize>nBus);
    const tRow = (<usize>t) * (<usize>nBus);
    const ptdfRow = (<usize>b) * (<usize>nBus);

    for (let i: i32 = 0; i < nBus; i++) {
      const iU = <usize>i;
      const xfi = load<f64>(xBusOutPtr + ((fRow + iU) << 3));
      const xti = load<f64>(xBusOutPtr + ((tRow + iU) << 3));
      store<f64>(ptdfOutPtr + ((ptdfRow + iU) << 3), susc * (xfi - xti));
    }
  }

  return ok;
}

/**
 * Computes DC bus voltage angles (degrees) and branch MW flows from generator dispatch.
 *
 * Scratch requirements:
 * - `scratchF64Ptr`: `2 * nBus` f64 elements (`Pinj[nBus]`, `theta[nBus]`)
 */
export function dc_opf_compute_flows(
  nBus: i32,
  slackIdx: i32,
  nGen: i32,
  nBranches: i32,
  sbase: f64,
  pLoadMwPtr: usize,
  genBusIdxPtr: usize,
  pgMwPtr: usize,
  xBusPtr: usize,
  brIdxPtr: usize,
  brDataPtr: usize,
  thetaDegOutPtr: usize,
  flowsOutPtr: usize,
  scratchF64Ptr: usize,
): void {
  if (nBus <= 0) return;

  const nBytes = (<usize>nBus) << 3;
  const pInjPtr = scratchF64Ptr;
  const thetaPtr = pInjPtr + nBytes;

  // Net active power injections: Pinj = Pg - Pload
  for (let i: i32 = 0; i < nBus; i++) {
    const off = (<usize>i) << 3;
    store<f64>(pInjPtr + off, -load<f64>(pLoadMwPtr + off));
  }
  for (let g: i32 = 0; g < nGen; g++) {
    const busIdx = load<i32>(genBusIdxPtr + ((<usize>g) << 2));
    if (busIdx >= 0 && busIdx < nBus) {
      const bOff = (<usize>busIdx) << 3;
      const pg = load<f64>(pgMwPtr + ((<usize>g) << 3));
      store<f64>(pInjPtr + bOff, load<f64>(pInjPtr + bOff) + pg);
    }
  }

  const invSbase: f64 = 1.0 / sbase;
  const radToDeg: f64 = 180.0 / Math.PI;

  // Bus angles theta = Xbus * (Pinj / sbase)
  for (let i: i32 = 0; i < nBus; i++) {
    const iOff = (<usize>i) << 3;
    if (i == slackIdx) {
      store<f64>(thetaPtr + iOff, 0.0);
      store<f64>(thetaDegOutPtr + iOff, 0.0);
      continue;
    }
    const rowBase = (<usize>i) * (<usize>nBus);
    let sum: f64 = 0.0;
    for (let j: i32 = 0; j < nBus; j++) {
      const jU = <usize>j;
      sum += load<f64>(xBusPtr + ((rowBase + jU) << 3)) * (load<f64>(pInjPtr + (jU << 3)) * invSbase);
    }
    store<f64>(thetaPtr + iOff, sum);
    store<f64>(thetaDegOutPtr + iOff, sum * radToDeg);
  }

  // Branch MW flows: susc * sbase * (theta[from] - theta[to])
  for (let b: i32 = 0; b < nBranches; b++) {
    const iBase = (<usize>(b * 2)) << 2;
    const f = load<i32>(brIdxPtr + iBase);
    const t = load<i32>(brIdxPtr + iBase + 4);
    const susc = load<f64>(brDataPtr + ((<usize>(b * 2)) << 3));
    const thF = load<f64>(thetaPtr + ((<usize>f) << 3));
    const thT = load<f64>(thetaPtr + ((<usize>t) << 3));
    store<f64>(flowsOutPtr + ((<usize>b) << 3), susc * sbase * (thF - thT));
  }
}

/**
 * Economic dispatch solver using 70-iteration bisection on marginal price lambda.
 *
 * Layout:
 * - `genDataPtr`: `f64[3 * nGen]` -> `[pMinMw, pMaxMw, costC1]`
 * - `qEffPtr`, `cEffPtr`: `f64[nGen]` -> effective quadratic & linear cost weights
 * - `pgOutPtr`: `f64[nGen]` -> dispatched active power per generator in MW
 *
 * Returns the clearing marginal price `lambda` ($/MWh).
 */
export function dc_opf_dispatch_bisection(
  nGen: i32,
  genDataPtr: usize,
  qEffPtr: usize,
  cEffPtr: usize,
  totalDemandMw: f64,
  pgOutPtr: usize,
): f64 {
  let low: f64 = -1000.0;
  let high: f64 = 100000.0;

  for (let iter: i32 = 0; iter < 70; iter++) {
    const mid = 0.5 * (low + high);
    let sumP: f64 = 0.0;
    for (let g: i32 = 0; g < nGen; g++) {
      const gOff = (<usize>g) << 3;
      const dBase = (<usize>(g * 3)) << 3;
      const pMin = load<f64>(genDataPtr + dBase);
      const pMax = load<f64>(genDataPtr + dBase + 8);
      const cEff = load<f64>(cEffPtr + gOff);
      const qEff = load<f64>(qEffPtr + gOff);

      let p = (mid - cEff) / qEff;
      if (p < pMin) p = pMin;
      if (p > pMax) p = pMax;
      sumP += p;
    }
    if (sumP < totalDemandMw) low = mid;
    else high = mid;
  }

  const lmp = 0.5 * (low + high);
  for (let g: i32 = 0; g < nGen; g++) {
    const gOff = (<usize>g) << 3;
    const dBase = (<usize>(g * 3)) << 3;
    const pMin = load<f64>(genDataPtr + dBase);
    const pMax = load<f64>(genDataPtr + dBase + 8);
    const cEff = load<f64>(cEffPtr + gOff);
    const qEff = load<f64>(qEffPtr + gOff);

    let p = (lmp - cEff) / qEff;
    if (p < pMin) p = pMin;
    if (p > pMax) p = pMax;
    store<f64>(pgOutPtr + gOff, p);
  }

  return lmp;
}

/**
 * Iterative economic dispatch with quadratic-penalty transmission congestion relief.
 *
 * Layout:
 * - `genBusIdxPtr`: `i32[nGen]` -> generator bus indices
 * - `genDataPtr`: `f64[3 * nGen]` -> `[pMinMw, pMaxMw, costC1]`
 * - `brIdxPtr`: `i32[2 * nBranches]` -> `[fromIdx, toIdx]`
 * - `brDataPtr`: `f64[2 * nBranches]` -> `[susceptance, rateMva]`
 * - `xBusPtr`: `f64[nBus * nBus]`
 * - `ptdfPtr`: `f64[nBranches * nBus]`
 * - `pgOutPtr`: `f64[nGen]`
 * - `thetaDegOutPtr`: `f64[nBus]`
 * - `flowsOutPtr`: `f64[nBranches]`
 *
 * Scratch requirements:
 * - `scratchF64Ptr`: `2 * nGen + 2 * nBus` f64 elements (`qEff[nGen]`, `cEff[nGen]`, `flowScratch[2*nBus]`)
 *
 * Returns the system energy marginal price `systemLmp` ($/MWh).
 */
export function dc_opf_solve_dispatch(
  nBus: i32,
  slackIdx: i32,
  nGen: i32,
  nBranches: i32,
  sbase: f64,
  totalDemandMw: f64,
  enforceLimits: i32,
  maxIter: i32,
  pLoadMwPtr: usize,
  genBusIdxPtr: usize,
  genDataPtr: usize,
  brIdxPtr: usize,
  brDataPtr: usize,
  xBusPtr: usize,
  ptdfPtr: usize,
  pgOutPtr: usize,
  thetaDegOutPtr: usize,
  flowsOutPtr: usize,
  scratchF64Ptr: usize,
): f64 {
  const nGenBytes = (<usize>(nGen > 0 ? nGen : 0)) << 3;
  const qEffPtr = scratchF64Ptr;
  const cEffPtr = qEffPtr + nGenBytes;
  const flowScratchPtr = cEffPtr + nGenBytes;

  for (let g: i32 = 0; g < nGen; g++) {
    const gOff = (<usize>g) << 3;
    store<f64>(qEffPtr + gOff, 1e-4);
    store<f64>(cEffPtr + gOff, load<f64>(genDataPtr + ((<usize>(g * 3 + 2)) << 3)));
  }

  let systemLmp: f64 = 20.0;
  const iters = maxIter > 0 ? maxIter : 10;

  for (let iter: i32 = 0; iter < iters; iter++) {
    systemLmp = dc_opf_dispatch_bisection(nGen, genDataPtr, qEffPtr, cEffPtr, totalDemandMw, pgOutPtr);

    if (enforceLimits == 0) break;

    dc_opf_compute_flows(
      nBus,
      slackIdx,
      nGen,
      nBranches,
      sbase,
      pLoadMwPtr,
      genBusIdxPtr,
      pgOutPtr,
      xBusPtr,
      brIdxPtr,
      brDataPtr,
      thetaDegOutPtr,
      flowsOutPtr,
      flowScratchPtr,
    );

    let anyCongested = false;

    // Reset effective weights
    for (let g: i32 = 0; g < nGen; g++) {
      const gOff = (<usize>g) << 3;
      store<f64>(qEffPtr + gOff, 1e-4);
      store<f64>(cEffPtr + gOff, load<f64>(genDataPtr + ((<usize>(g * 3 + 2)) << 3)));
    }

    for (let b: i32 = 0; b < nBranches; b++) {
      const rateMva = load<f64>(brDataPtr + ((<usize>(b * 2 + 1)) << 3));
      if (rateMva >= 9000.0) continue;

      const flow = load<f64>(flowsOutPtr + ((<usize>b) << 3));
      const over = Math.abs(flow) - rateMva;
      if (over > 0.01) {
        anyCongested = true;
        const sgn: f64 = flow > 0.0 ? 1.0 : -1.0;
        const penaltyWeight: f64 = 200.0;
        const linScale = penaltyWeight * over * sgn;
        const ptdfRow = (<usize>b) * (<usize>nBus);

        for (let g: i32 = 0; g < nGen; g++) {
          const busIdx = load<i32>(genBusIdxPtr + ((<usize>g) << 2));
          const ptdfVal = load<f64>(ptdfPtr + ((ptdfRow + (<usize>busIdx)) << 3));
          const gOff = (<usize>g) << 3;
          store<f64>(qEffPtr + gOff, load<f64>(qEffPtr + gOff) + penaltyWeight * ptdfVal * ptdfVal);
          store<f64>(cEffPtr + gOff, load<f64>(cEffPtr + gOff) + linScale * ptdfVal);
        }
      }
    }

    if (!anyCongested) break;
  }

  // Final DC power flow matching dispatched Pg
  dc_opf_compute_flows(
    nBus,
    slackIdx,
    nGen,
    nBranches,
    sbase,
    pLoadMwPtr,
    genBusIdxPtr,
    pgOutPtr,
    xBusPtr,
    brIdxPtr,
    brDataPtr,
    thetaDegOutPtr,
    flowsOutPtr,
    flowScratchPtr,
  );

  return systemLmp;
}

/**
 * Computes branch congestion shadow prices and nodal Locational Marginal Prices (LMPs).
 *
 * Layout:
 * - `brDataPtr`: `f64[2 * nBranches]` -> `[susceptance, rateMva]`
 * - `flowsPtr`: `f64[nBranches]`
 * - `ptdfPtr`: `f64[nBranches * nBus]`
 * - `shadowPricesOutPtr`: `f64[nBranches]`
 * - `busLmpsOutPtr`: `f64[nBus]`
 *
 * Returns the sum of nodal LMPs across all buses.
 */
export function dc_opf_compute_lmps(
  nBus: i32,
  nBranches: i32,
  brDataPtr: usize,
  flowsPtr: usize,
  ptdfPtr: usize,
  systemLmp: f64,
  shadowPricesOutPtr: usize,
  busLmpsOutPtr: usize,
): f64 {
  for (let i: i32 = 0; i < nBus; i++) {
    store<f64>(busLmpsOutPtr + ((<usize>i) << 3), systemLmp);
  }
  if (nBranches > 0) {
    memory.fill(shadowPricesOutPtr, 0, (<usize>nBranches) << 3);
  }

  for (let b: i32 = 0; b < nBranches; b++) {
    const rateMva = load<f64>(brDataPtr + ((<usize>(b * 2 + 1)) << 3));
    if (rateMva <= 0.0) continue;

    const flow = load<f64>(flowsPtr + ((<usize>b) << 3));
    const absFlow = Math.abs(flow);
    const loading = (absFlow / rateMva) * 100.0;
    if (loading >= 99.0) {
      let sp = (absFlow - rateMva * 0.99) * 10.0;
      if (sp < 1.0) sp = 1.0;
      store<f64>(shadowPricesOutPtr + ((<usize>b) << 3), sp);

      const sgn: f64 = flow > 0.0 ? 1.0 : -1.0;
      const spSgn = sp * sgn;
      const ptdfRow = (<usize>b) * (<usize>nBus);
      for (let i: i32 = 0; i < nBus; i++) {
        const iOff = (<usize>i) << 3;
        const ptdfVal = load<f64>(ptdfPtr + ((ptdfRow + (<usize>i)) << 3));
        store<f64>(busLmpsOutPtr + iOff, load<f64>(busLmpsOutPtr + iOff) + ptdfVal * spSgn);
      }
    }
  }

  let sumLmp: f64 = 0.0;
  for (let i: i32 = 0; i < nBus; i++) {
    const iOff = (<usize>i) << 3;
    let lmp = load<f64>(busLmpsOutPtr + iOff);
    if (lmp <= 0.0) {
      lmp = systemLmp;
      store<f64>(busLmpsOutPtr + iOff, lmp);
    }
    sumLmp += lmp;
  }

  return sumLmp;
}
