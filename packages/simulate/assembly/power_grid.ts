// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Power Grid Numerical Kernels:
 * - Complex Y-bus matrix assembly (G + jB)
 * - Full AC Powerflow Newton-Raphson solver in linear memory
 * - DC-OPF PTDF / LODF sensitivity matrix computation
 * - Multi-frequency Harmonic Admittance Y(h) sweep & Bus THD computation
 */

/**
 * Assembles dense complex Y-bus (G_mat, B_mat of size nBus x nBus) from branch list.
 * branch arrays: from[m], to[m], r[m], x[m], bShunt[m], tap[m], shiftRad[m].
 */
export function grid_assembleYbus(
  nBus: i32,
  nBranch: i32,
  fromPtr: usize,
  toPtr: usize,
  rPtr: usize,
  xPtr: usize,
  bShuntPtr: usize,
  tapPtr: usize,
  shiftPtr: usize,
  busGShuntPtr: usize,
  busBShuntPtr: usize,
  outGPtr: usize,
  outBPtr: usize,
): void {
  const nn = <usize>(nBus * nBus) << 3;
  memory.fill(outGPtr, 0, nn);
  memory.fill(outBPtr, 0, nn);

  if (busGShuntPtr != 0 && busBShuntPtr != 0) {
    for (let i: i32 = 0; i < nBus; i++) {
      const diagOff = <usize>(i * nBus + i) << 3;
      store<f64>(outGPtr + diagOff, load<f64>(busGShuntPtr + (<usize>i << 3)));
      store<f64>(outBPtr + diagOff, load<f64>(busBShuntPtr + (<usize>i << 3)));
    }
  }

  for (let k: i32 = 0; k < nBranch; k++) {
    const f = load<i32>(fromPtr + (<usize>k << 2));
    const t = load<i32>(toPtr + (<usize>k << 2));
    if (f < 0 || f >= nBus || t < 0 || t >= nBus) continue;

    const r = load<f64>(rPtr + (<usize>k << 3));
    const x = load<f64>(xPtr + (<usize>k << 3));
    const bCh = load<f64>(bShuntPtr + (<usize>k << 3));
    let tap = tapPtr != 0 ? load<f64>(tapPtr + (<usize>k << 3)) : 1.0;
    if (tap <= 1e-12) tap = 1.0;
    const shift = shiftPtr != 0 ? load<f64>(shiftPtr + (<usize>k << 3)) : 0.0;

    const z2 = r * r + x * x;
    if (z2 < 1e-24) continue;
    const g = r / z2;
    const b = -x / z2;

    const cosS = Math.cos(shift);
    const sinS = Math.sin(shift);
    const invTap = 1.0 / tap;
    const invTap2 = invTap * invTap;

    // Y_ff += (g + j(b + bCh/2)) / tap^2
    const ffOff = <usize>(f * nBus + f) << 3;
    store<f64>(outGPtr + ffOff, load<f64>(outGPtr + ffOff) + g * invTap2);
    store<f64>(outBPtr + ffOff, load<f64>(outBPtr + ffOff) + (b + 0.5 * bCh) * invTap2);

    // Y_tt += g + j(b + bCh/2)
    const ttOff = <usize>(t * nBus + t) << 3;
    store<f64>(outGPtr + ttOff, load<f64>(outGPtr + ttOff) + g);
    store<f64>(outBPtr + ttOff, load<f64>(outBPtr + ttOff) + b + 0.5 * bCh);

    // Y_ft -= (g + jb) / (tap * e^{-j*shift}) = -(g + jb) * (cosS + j*sinS) / tap
    const gFt = -(g * cosS - b * sinS) * invTap;
    const bFt = -(g * sinS + b * cosS) * invTap;
    const ftOff = <usize>(f * nBus + t) << 3;
    store<f64>(outGPtr + ftOff, load<f64>(outGPtr + ftOff) + gFt);
    store<f64>(outBPtr + ftOff, load<f64>(outBPtr + ftOff) + bFt);

    // Y_tf -= (g + jb) / (tap * e^{+j*shift}) = -(g + jb) * (cosS - j*sinS) / tap
    const gTf = -(g * cosS + b * sinS) * invTap;
    const bTf = -(-g * sinS + b * cosS) * invTap;
    const tfOff = <usize>(t * nBus + f) << 3;
    store<f64>(outGPtr + tfOff, load<f64>(outGPtr + tfOff) + gTf);
    store<f64>(outBPtr + tfOff, load<f64>(outBPtr + tfOff) + bTf);
  }
}

function solveLinearInPlace(aPtr: usize, bPtr: usize, n: i32, outXPtr: usize): bool {
  for (let k: i32 = 0; k < n; k++) {
    let pivotRow = k;
    let pivotVal = Math.abs(load<f64>(aPtr + (<usize>(k * n + k) << 3)));
    for (let i: i32 = k + 1; i < n; i++) {
      const v = Math.abs(load<f64>(aPtr + (<usize>(i * n + k) << 3)));
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = i;
      }
    }
    if (pivotVal < 1e-14) return false;
    if (pivotRow != k) {
      for (let j: i32 = k; j < n; j++) {
        const o1 = aPtr + (<usize>(k * n + j) << 3);
        const o2 = aPtr + (<usize>(pivotRow * n + j) << 3);
        const tmp = load<f64>(o1);
        store<f64>(o1, load<f64>(o2));
        store<f64>(o2, tmp);
      }
      const r1 = bPtr + (<usize>k << 3);
      const r2 = bPtr + (<usize>pivotRow << 3);
      const tr = load<f64>(r1);
      store<f64>(r1, load<f64>(r2));
      store<f64>(r2, tr);
    }

    const diag = load<f64>(aPtr + (<usize>(k * n + k) << 3));
    for (let i: i32 = k + 1; i < n; i++) {
      const factor = load<f64>(aPtr + (<usize>(i * n + k) << 3)) / diag;
      store<f64>(aPtr + (<usize>(i * n + k) << 3), 0.0);
      for (let j: i32 = k + 1; j < n; j++) {
        const oij = aPtr + (<usize>(i * n + j) << 3);
        store<f64>(oij, load<f64>(oij) - factor * load<f64>(aPtr + (<usize>(k * n + j) << 3)));
      }
      const ri = bPtr + (<usize>i << 3);
      store<f64>(ri, load<f64>(ri) - factor * load<f64>(bPtr + (<usize>k << 3)));
    }
  }

  for (let i: i32 = n - 1; i >= 0; i--) {
    let sum = load<f64>(bPtr + (<usize>i << 3));
    for (let j: i32 = i + 1; j < n; j++) {
      sum -= load<f64>(aPtr + (<usize>(i * n + j) << 3)) * load<f64>(outXPtr + (<usize>j << 3));
    }
    store<f64>(outXPtr + (<usize>i << 3), sum / load<f64>(aPtr + (<usize>(i * n + i) << 3)));
  }
  return true;
}

/**
 * Full AC Powerflow Newton-Raphson solver in polar coordinates (Vm, Va).
 * busTypePtr: u8[nBus] — 1 = PQ, 2 = PV, 3 = Slack.
 * Updates vmPtr & vaPtr in place.
 * Returns number of iterations if converged (> 0), or -1 if failed/diverged.
 */
export function grid_acPowerflowNR(
  nBus: i32,
  busTypePtr: usize,
  gPtr: usize,
  bPtr: usize,
  pSpecPtr: usize,
  qSpecPtr: usize,
  vmPtr: usize,
  vaPtr: usize,
  tol: f64,
  maxIter: i32,
): i32 {
  if (nBus <= 1) return 1;

  // Map non-slack buses (angle unknowns) and PQ buses (voltage magnitude unknowns)
  const nonSlackPtr = heap.alloc(<usize>nBus << 2);
  const pqPtr = heap.alloc(<usize>nBus << 2);
  let nP: i32 = 0;
  let nQ: i32 = 0;
  for (let i: i32 = 0; i < nBus; i++) {
    const bt = load<u8>(busTypePtr + <usize>i);
    if (bt != 3) {
      store<i32>(nonSlackPtr + (<usize>nP << 2), i);
      nP++;
    }
    if (bt == 1) {
      store<i32>(pqPtr + (<usize>nQ << 2), i);
      nQ++;
    }
  }

  const dim = nP + nQ;
  if (dim == 0) {
    heap.free(nonSlackPtr);
    heap.free(pqPtr);
    return 1;
  }

  const pCalcPtr = heap.alloc(<usize>nBus << 3);
  const qCalcPtr = heap.alloc(<usize>nBus << 3);
  const mismatchPtr = heap.alloc(<usize>dim << 3);
  const jacPtr = heap.alloc(<usize>(dim * dim) << 3);
  const dxPtr = heap.alloc(<usize>dim << 3);

  let convergedIter: i32 = -1;

  for (let iter: i32 = 1; iter <= maxIter; iter++) {
    // 1. Compute P_calc, Q_calc at all buses
    for (let i: i32 = 0; i < nBus; i++) {
      const vi = load<f64>(vmPtr + (<usize>i << 3));
      const ai = load<f64>(vaPtr + (<usize>i << 3));
      let pi: f64 = 0.0;
      let qi: f64 = 0.0;
      for (let j: i32 = 0; j < nBus; j++) {
        const vj = load<f64>(vmPtr + (<usize>j << 3));
        const aj = load<f64>(vaPtr + (<usize>j << 3));
        const gij = load<f64>(gPtr + (<usize>(i * nBus + j) << 3));
        const bij = load<f64>(bPtr + (<usize>(i * nBus + j) << 3));
        if (gij == 0.0 && bij == 0.0) continue;
        const theta = ai - aj;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const vivj = vi * vj;
        pi += vivj * (gij * cosT + bij * sinT);
        qi += vivj * (gij * sinT - bij * cosT);
      }
      store<f64>(pCalcPtr + (<usize>i << 3), pi);
      store<f64>(qCalcPtr + (<usize>i << 3), qi);
    }

    // 2. Build mismatch vector [dP; dQ] and check infinity norm
    let maxMis: f64 = 0.0;
    for (let r: i32 = 0; r < nP; r++) {
      const bi = load<i32>(nonSlackPtr + (<usize>r << 2));
      const dp = load<f64>(pSpecPtr + (<usize>bi << 3)) - load<f64>(pCalcPtr + (<usize>bi << 3));
      store<f64>(mismatchPtr + (<usize>r << 3), dp);
      const adp = Math.abs(dp);
      if (adp > maxMis) maxMis = adp;
    }
    for (let r: i32 = 0; r < nQ; r++) {
      const bi = load<i32>(pqPtr + (<usize>r << 2));
      const dq = load<f64>(qSpecPtr + (<usize>bi << 3)) - load<f64>(qCalcPtr + (<usize>bi << 3));
      store<f64>(mismatchPtr + (<usize>(nP + r) << 3), dq);
      const adq = Math.abs(dq);
      if (adq > maxMis) maxMis = adq;
    }

    if (maxMis < tol) {
      convergedIter = iter;
      break;
    }

    // 3. Assemble Jacobian J = [[dP/dVa, dP/dVm], [dQ/dVa, dQ/dVm]]
    // H = dP/dVa
    for (let r: i32 = 0; r < nP; r++) {
      const i = load<i32>(nonSlackPtr + (<usize>r << 2));
      const vi = load<f64>(vmPtr + (<usize>i << 3));
      const ai = load<f64>(vaPtr + (<usize>i << 3));
      for (let c: i32 = 0; c < nP; c++) {
        const j = load<i32>(nonSlackPtr + (<usize>c << 2));
        let val: f64 = 0.0;
        if (i == j) {
          const bii = load<f64>(bPtr + (<usize>(i * nBus + i) << 3));
          val = -load<f64>(qCalcPtr + (<usize>i << 3)) - bii * vi * vi;
        } else {
          const vj = load<f64>(vmPtr + (<usize>j << 3));
          const theta = ai - load<f64>(vaPtr + (<usize>j << 3));
          const gij = load<f64>(gPtr + (<usize>(i * nBus + j) << 3));
          const bij = load<f64>(bPtr + (<usize>(i * nBus + j) << 3));
          val = vi * vj * (gij * Math.sin(theta) - bij * Math.cos(theta));
        }
        store<f64>(jacPtr + (<usize>(r * dim + c) << 3), val);
      }
      // N = dP/dVm
      for (let c: i32 = 0; c < nQ; c++) {
        const j = load<i32>(pqPtr + (<usize>c << 2));
        let val: f64 = 0.0;
        if (i == j) {
          const gii = load<f64>(gPtr + (<usize>(i * nBus + i) << 3));
          val = vi > 1e-12 ? load<f64>(pCalcPtr + (<usize>i << 3)) / vi + gii * vi : 0.0;
        } else {
          const theta = ai - load<f64>(vaPtr + (<usize>j << 3));
          const gij = load<f64>(gPtr + (<usize>(i * nBus + j) << 3));
          const bij = load<f64>(bPtr + (<usize>(i * nBus + j) << 3));
          val = vi * (gij * Math.cos(theta) + bij * Math.sin(theta));
        }
        store<f64>(jacPtr + (<usize>(r * dim + nP + c) << 3), val);
      }
    }

    // M = dQ/dVa, L = dQ/dVm
    for (let r: i32 = 0; r < nQ; r++) {
      const i = load<i32>(pqPtr + (<usize>r << 2));
      const vi = load<f64>(vmPtr + (<usize>i << 3));
      const ai = load<f64>(vaPtr + (<usize>i << 3));
      const row = nP + r;
      for (let c: i32 = 0; c < nP; c++) {
        const j = load<i32>(nonSlackPtr + (<usize>c << 2));
        let val: f64 = 0.0;
        if (i == j) {
          const gii = load<f64>(gPtr + (<usize>(i * nBus + i) << 3));
          val = load<f64>(pCalcPtr + (<usize>i << 3)) - gii * vi * vi;
        } else {
          const vj = load<f64>(vmPtr + (<usize>j << 3));
          const theta = ai - load<f64>(vaPtr + (<usize>j << 3));
          const gij = load<f64>(gPtr + (<usize>(i * nBus + j) << 3));
          const bij = load<f64>(bPtr + (<usize>(i * nBus + j) << 3));
          val = -vi * vj * (gij * Math.cos(theta) + bij * Math.sin(theta));
        }
        store<f64>(jacPtr + (<usize>(row * dim + c) << 3), val);
      }
      for (let c: i32 = 0; c < nQ; c++) {
        const j = load<i32>(pqPtr + (<usize>c << 2));
        let val: f64 = 0.0;
        if (i == j) {
          const bii = load<f64>(bPtr + (<usize>(i * nBus + i) << 3));
          val = vi > 1e-12 ? load<f64>(qCalcPtr + (<usize>i << 3)) / vi - bii * vi : 0.0;
        } else {
          const theta = ai - load<f64>(vaPtr + (<usize>j << 3));
          const gij = load<f64>(gPtr + (<usize>(i * nBus + j) << 3));
          const bij = load<f64>(bPtr + (<usize>(i * nBus + j) << 3));
          val = vi * (gij * Math.sin(theta) - bij * Math.cos(theta));
        }
        store<f64>(jacPtr + (<usize>(row * dim + nP + c) << 3), val);
      }
    }

    // 4. Solve J * dx = mismatch
    if (!solveLinearInPlace(jacPtr, mismatchPtr, dim, dxPtr)) {
      break;
    }

    // 5. Update Va and Vm
    for (let r: i32 = 0; r < nP; r++) {
      const i = load<i32>(nonSlackPtr + (<usize>r << 2));
      const off = vaPtr + (<usize>i << 3);
      store<f64>(off, load<f64>(off) + load<f64>(dxPtr + (<usize>r << 3)));
    }
    for (let r: i32 = 0; r < nQ; r++) {
      const i = load<i32>(pqPtr + (<usize>r << 2));
      const off = vmPtr + (<usize>i << 3);
      let nv = load<f64>(off) + load<f64>(dxPtr + (<usize>(nP + r) << 3));
      if (nv < 0.1) nv = 0.1;
      store<f64>(off, nv);
    }
  }

  heap.free(nonSlackPtr);
  heap.free(pqPtr);
  heap.free(pCalcPtr);
  heap.free(qCalcPtr);
  heap.free(mismatchPtr);
  heap.free(jacPtr);
  heap.free(dxPtr);
  return convergedIter;
}

/**
 * Computes dense DC Power Transfer Distribution Factors (PTDF: nBranch x nBus)
 * and Line Outage Distribution Factors (LODF: nBranch x nBranch) in linear memory.
 * Returns 1 on success, 0 if B-matrix is singular.
 */
export function grid_computePtdfLodf(
  nBus: i32,
  nBranch: i32,
  slackBus: i32,
  fromPtr: usize,
  toPtr: usize,
  xPtr: usize,
  outPtdfPtr: usize,
  outLodfPtr: usize,
): i32 {
  const nRed = nBus - 1;
  if (nRed <= 0 || nBranch <= 0) return 0;

  const busToRed = heap.alloc(<usize>nBus << 2);
  let cursor: i32 = 0;
  for (let i: i32 = 0; i < nBus; i++) {
    if (i == slackBus) {
      store<i32>(busToRed + (<usize>i << 2), -1);
    } else {
      store<i32>(busToRed + (<usize>i << 2), cursor);
      cursor++;
    }
  }

  // Assemble reduced susceptance matrix B_red (nRed x nRed)
  const bMat = heap.alloc(<usize>(nRed * nRed) << 3);
  memory.fill(bMat, 0, <usize>(nRed * nRed) << 3);
  for (let k: i32 = 0; k < nBranch; k++) {
    const f = load<i32>(fromPtr + (<usize>k << 2));
    const t = load<i32>(toPtr + (<usize>k << 2));
    const x = load<f64>(xPtr + (<usize>k << 3));
    if (Math.abs(x) < 1e-12) continue;
    const b = 1.0 / x;
    const rf = load<i32>(busToRed + (<usize>f << 2));
    const rt = load<i32>(busToRed + (<usize>t << 2));
    if (rf >= 0) {
      const off = bMat + (<usize>(rf * nRed + rf) << 3);
      store<f64>(off, load<f64>(off) + b);
    }
    if (rt >= 0) {
      const off = bMat + (<usize>(rt * nRed + rt) << 3);
      store<f64>(off, load<f64>(off) + b);
    }
    if (rf >= 0 && rt >= 0) {
      const o1 = bMat + (<usize>(rf * nRed + rt) << 3);
      const o2 = bMat + (<usize>(rt * nRed + rf) << 3);
      store<f64>(o1, load<f64>(o1) - b);
      store<f64>(o2, load<f64>(o2) - b);
    }
  }

  // Invert B_red via nRed solves to get X_red (nRed x nRed)
  const xRed = heap.alloc(<usize>(nRed * nRed) << 3);
  const workA = heap.alloc(<usize>(nRed * nRed) << 3);
  const rhs = heap.alloc(<usize>nRed << 3);
  const col = heap.alloc(<usize>nRed << 3);

  for (let c: i32 = 0; c < nRed; c++) {
    memory.copy(workA, bMat, <usize>(nRed * nRed) << 3);
    memory.fill(rhs, 0, <usize>nRed << 3);
    store<f64>(rhs + (<usize>c << 3), 1.0);
    if (!solveLinearInPlace(workA, rhs, nRed, col)) {
      heap.free(busToRed);
      heap.free(bMat);
      heap.free(xRed);
      heap.free(workA);
      heap.free(rhs);
      heap.free(col);
      return 0;
    }
    for (let r: i32 = 0; r < nRed; r++) {
      store<f64>(xRed + (<usize>(r * nRed + c) << 3), load<f64>(col + (<usize>r << 3)));
    }
  }

  // PTDF(l, i) = (X_red(f_l, i) - X_red(t_l, i)) / x_l
  memory.fill(outPtdfPtr, 0, <usize>(nBranch * nBus) << 3);
  for (let l: i32 = 0; l < nBranch; l++) {
    const f = load<i32>(fromPtr + (<usize>l << 2));
    const t = load<i32>(toPtr + (<usize>l << 2));
    const x = load<f64>(xPtr + (<usize>l << 3));
    if (Math.abs(x) < 1e-12) continue;
    const invX = 1.0 / x;
    const rf = load<i32>(busToRed + (<usize>f << 2));
    const rt = load<i32>(busToRed + (<usize>t << 2));
    for (let i: i32 = 0; i < nBus; i++) {
      const ri = load<i32>(busToRed + (<usize>i << 2));
      if (ri < 0) continue;
      const xf = rf >= 0 ? load<f64>(xRed + (<usize>(rf * nRed + ri) << 3)) : 0.0;
      const xt = rt >= 0 ? load<f64>(xRed + (<usize>(rt * nRed + ri) << 3)) : 0.0;
      store<f64>(outPtdfPtr + (<usize>(l * nBus + i) << 3), (xf - xt) * invX);
    }
  }

  // LODF(l, k) = (PTDF(l, f_k) - PTDF(l, t_k)) / (1 - (PTDF(k, f_k) - PTDF(k, t_k)))
  if (outLodfPtr != 0) {
    memory.fill(outLodfPtr, 0, <usize>(nBranch * nBranch) << 3);
    for (let k: i32 = 0; k < nBranch; k++) {
      const fk = load<i32>(fromPtr + (<usize>k << 2));
      const tk = load<i32>(toPtr + (<usize>k << 2));
      const ptdfKK =
        load<f64>(outPtdfPtr + (<usize>(k * nBus + fk) << 3)) -
        load<f64>(outPtdfPtr + (<usize>(k * nBus + tk) << 3));
      const denom = 1.0 - ptdfKK;
      for (let l: i32 = 0; l < nBranch; l++) {
        if (l == k) {
          store<f64>(outLodfPtr + (<usize>(l * nBranch + k) << 3), -1.0);
        } else if (Math.abs(denom) > 1e-9) {
          const ptdfLK =
            load<f64>(outPtdfPtr + (<usize>(l * nBus + fk) << 3)) -
            load<f64>(outPtdfPtr + (<usize>(l * nBus + tk) << 3));
          store<f64>(outLodfPtr + (<usize>(l * nBranch + k) << 3), ptdfLK / denom);
        }
      }
    }
  }

  heap.free(busToRed);
  heap.free(bMat);
  heap.free(xRed);
  heap.free(workA);
  heap.free(rhs);
  heap.free(col);
  return 1;
}

/**
 * Evaluates AC bus active/reactive power injections (P_calc, Q_calc) and full
 * polar Jacobian blocks (dP/dVa, dP/dVm, dQ/dVa, dQ/dVm) in one linear-memory pass
 * for AC-OPF interior-point / IPOPT NLP callbacks.
 */
export function opf_evalAcBalanceAndJac(
  nBus: i32,
  gPtr: usize,
  bPtr: usize,
  vmPtr: usize,
  vaPtr: usize,
  outPPtr: usize,
  outQPtr: usize,
  outDPdVaPtr: usize,
  outDPdVmPtr: usize,
  outDQdVaPtr: usize,
  outDQdVmPtr: usize,
): void {
  for (let i: i32 = 0; i < nBus; i++) {
    const vi = load<f64>(vmPtr + (<usize>i << 3));
    const ai = load<f64>(vaPtr + (<usize>i << 3));
    let pi: f64 = 0.0;
    let qi: f64 = 0.0;

    for (let j: i32 = 0; j < nBus; j++) {
      const gij = load<f64>(gPtr + (<usize>(i * nBus + j) << 3));
      const bij = load<f64>(bPtr + (<usize>(i * nBus + j) << 3));
      if (gij == 0.0 && bij == 0.0) continue;
      const vj = load<f64>(vmPtr + (<usize>j << 3));
      const theta = ai - load<f64>(vaPtr + (<usize>j << 3));
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const vivj = vi * vj;
      pi += vivj * (gij * cosT + bij * sinT);
      qi += vivj * (gij * sinT - bij * cosT);
    }

    store<f64>(outPPtr + (<usize>i << 3), pi);
    store<f64>(outQPtr + (<usize>i << 3), qi);

    for (let j: i32 = 0; j < nBus; j++) {
      const idx = <usize>(i * nBus + j) << 3;
      const gij = load<f64>(gPtr + idx);
      const bij = load<f64>(bPtr + idx);
      if (i == j) {
        store<f64>(outDPdVaPtr + idx, -qi - bij * vi * vi);
        store<f64>(outDPdVmPtr + idx, vi > 1e-12 ? pi / vi + gij * vi : 0.0);
        store<f64>(outDQdVaPtr + idx, pi - gij * vi * vi);
        store<f64>(outDQdVmPtr + idx, vi > 1e-12 ? qi / vi - bij * vi : 0.0);
      } else if (gij == 0.0 && bij == 0.0) {
        store<f64>(outDPdVaPtr + idx, 0.0);
        store<f64>(outDPdVmPtr + idx, 0.0);
        store<f64>(outDQdVaPtr + idx, 0.0);
        store<f64>(outDQdVmPtr + idx, 0.0);
      } else {
        const vj = load<f64>(vmPtr + (<usize>j << 3));
        const theta = ai - load<f64>(vaPtr + (<usize>j << 3));
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        store<f64>(outDPdVaPtr + idx, vi * vj * (gij * sinT - bij * cosT));
        store<f64>(outDPdVmPtr + idx, vi * (gij * cosT + bij * sinT));
        store<f64>(outDQdVaPtr + idx, -vi * vj * (gij * cosT + bij * sinT));
        store<f64>(outDQdVmPtr + idx, vi * (gij * sinT - bij * cosT));
      }
    }
  }
}

