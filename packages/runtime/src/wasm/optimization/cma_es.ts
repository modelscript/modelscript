// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript kernels for CMA-ES covariance matrix update and
 * symmetric Jacobi eigendecomposition in linear memory.
 */

export function jacobiEigendecompositionWasm(
  aInPtr: u32,
  n: u32,
  vPtr: u32,
  dPtr: u32,
  maxSweeps: i32,
): void {
  let nn = (n as usize) * (n as usize);
  let bytes = nn << 3;
  let aPtr = heap.alloc(bytes);
  memory.copy(aPtr, aInPtr as usize, bytes);

  let v = vPtr as usize;
  let d = dPtr as usize;
  memory.fill(v, 0, bytes);
  for (let i: u32 = 0; i < n; i++) {
    store<f64>(v + (((i * n + i) as usize) << 3), 1.0);
  }

  for (let sweep: i32 = 0; sweep < maxSweeps; sweep++) {
    let offDiagSum: f64 = 0.0;
    for (let i: u32 = 0; i < n; i++) {
      let rowBase = i * n;
      for (let j: u32 = i + 1; j < n; j++) {
        offDiagSum += Math.abs(load<f64>(aPtr + (((rowBase + j) as usize) << 3)));
      }
    }
    if (offDiagSum < 1e-14) {
      break;
    }

    for (let p: u32 = 0; p < n; p++) {
      let pRow = p * n;
      for (let q: u32 = p + 1; q < n; q++) {
        let pqOff = ((pRow + q) as usize) << 3;
        let apq = load<f64>(aPtr + pqOff);
        if (Math.abs(apq) < 1e-15) continue;

        let ppOff = ((pRow + p) as usize) << 3;
        let qqOff = ((q * n + q) as usize) << 3;
        let app = load<f64>(aPtr + ppOff);
        let aqq = load<f64>(aPtr + qqOff);
        let theta = (aqq - app) / (2.0 * apq);
        let t: f64 =
          theta >= 0.0
            ? 1.0 / (theta + Math.sqrt(theta * theta + 1.0))
            : -1.0 / (-theta + Math.sqrt(theta * theta + 1.0));
        let c = 1.0 / Math.sqrt(t * t + 1.0);
        let s = t * c;
        let tau = s / (1.0 + c);

        store<f64>(aPtr + ppOff, app - t * apq);
        store<f64>(aPtr + qqOff, aqq + t * apq);
        store<f64>(aPtr + pqOff, 0.0);
        store<f64>(aPtr + (((q * n + p) as usize) << 3), 0.0);

        for (let r: u32 = 0; r < p; r++) {
          let rpOff = ((r * n + p) as usize) << 3;
          let rqOff = ((r * n + q) as usize) << 3;
          let arp = load<f64>(aPtr + rpOff);
          let arq = load<f64>(aPtr + rqOff);
          let newArp = arp - s * (arq + tau * arp);
          let newArq = arq + s * (arp - tau * arq);
          store<f64>(aPtr + rpOff, newArp);
          store<f64>(aPtr + rqOff, newArq);
          store<f64>(aPtr + (((pRow + r) as usize) << 3), newArp);
          store<f64>(aPtr + (((q * n + r) as usize) << 3), newArq);
        }

        let qRow = q * n;
        for (let r: u32 = p + 1; r < q; r++) {
          let prOff = ((pRow + r) as usize) << 3;
          let rqOff = ((r * n + q) as usize) << 3;
          let apr = load<f64>(aPtr + prOff);
          let arq = load<f64>(aPtr + rqOff);
          let newApr = apr - s * (arq + tau * apr);
          let newArq = arq + s * (apr - tau * arq);
          store<f64>(aPtr + prOff, newApr);
          store<f64>(aPtr + rqOff, newArq);
          store<f64>(aPtr + (((r * n + p) as usize) << 3), newApr);
          store<f64>(aPtr + (((qRow + r) as usize) << 3), newArq);
        }

        for (let r: u32 = q + 1; r < n; r++) {
          let prOff = ((pRow + r) as usize) << 3;
          let qrOff = ((qRow + r) as usize) << 3;
          let apr = load<f64>(aPtr + prOff);
          let aqr = load<f64>(aPtr + qrOff);
          let newApr = apr - s * (aqr + tau * apr);
          let newAqr = aqr + s * (apr - tau * aqr);
          store<f64>(aPtr + prOff, newApr);
          store<f64>(aPtr + qrOff, newAqr);
          store<f64>(aPtr + (((r * n + p) as usize) << 3), newApr);
          store<f64>(aPtr + (((r * n + q) as usize) << 3), newAqr);
        }

        for (let r: u32 = 0; r < n; r++) {
          let vrpOff = ((r * n + p) as usize) << 3;
          let vrqOff = ((r * n + q) as usize) << 3;
          let vrp = load<f64>(v + vrpOff);
          let vrq = load<f64>(v + vrqOff);
          store<f64>(v + vrpOff, vrp - s * (vrq + tau * vrp));
          store<f64>(v + vrqOff, vrq + s * (vrp - tau * vrq));
        }
      }
    }
  }

  for (let i: u32 = 0; i < n; i++) {
    store<f64>(d + ((i as usize) << 3), load<f64>(aPtr + (((i * n + i) as usize) << 3)));
  }

  heap.free(aPtr);
}

/**
 * Updates covariance matrix C (rank-1 + rank-mu), enforces symmetry,
 * computes eigendecomposition C = B * diag(eigVals) * B^T, and writes
 * D[i] = sqrt(max(1e-14, eigVals[i])).
 *
 * `yMuPtr` is row-major (mu x n): candidate k's y vector is at `yMuPtr + k * n * 8`.
 */
export function cmaEsUpdateCovarianceWasm(
  n: u32,
  mu: u32,
  cPtr: u32,
  bPtr: u32,
  dPtr: u32,
  eigValsPtr: u32,
  pCPtr: u32,
  yMuPtr: u32,
  weightsPtr: u32,
  cOldFactor: f64,
  c1: f64,
  cMu: f64,
): void {
  let C = cPtr as usize;
  let pC = pCPtr as usize;
  let yMu = yMuPtr as usize;
  let weights = weightsPtr as usize;
  let D = dPtr as usize;
  let eigVals = eigValsPtr as usize;

  for (let i: u32 = 0; i < n; i++) {
    let pCi = load<f64>(pC + ((i as usize) << 3));
    let iRow = i * n;
    for (let j: u32 = 0; j < n; j++) {
      let rankMuSum: f64 = 0.0;
      for (let k: u32 = 0; k < mu; k++) {
        let wk = load<f64>(weights + ((k as usize) << 3));
        let yBase = yMu + (((k * n) as usize) << 3);
        let yki = load<f64>(yBase + ((i as usize) << 3));
        let ykj = load<f64>(yBase + ((j as usize) << 3));
        rankMuSum += wk * yki * ykj;
      }
      let ijOff = ((iRow + j) as usize) << 3;
      let pCj = load<f64>(pC + ((j as usize) << 3));
      store<f64>(C + ijOff, cOldFactor * load<f64>(C + ijOff) + c1 * pCi * pCj + cMu * rankMuSum);
    }
  }

  for (let i: u32 = 0; i < n; i++) {
    let iRow = i * n;
    for (let j: u32 = i + 1; j < n; j++) {
      let ijOff = ((iRow + j) as usize) << 3;
      let jiOff = ((j * n + i) as usize) << 3;
      let avg = 0.5 * (load<f64>(C + ijOff) + load<f64>(C + jiOff));
      store<f64>(C + ijOff, avg);
      store<f64>(C + jiOff, avg);
    }
  }

  jacobiEigendecompositionWasm(cPtr, n, bPtr, eigValsPtr, 50);
  for (let i: u32 = 0; i < n; i++) {
    let off = (i as usize) << 3;
    let ev = load<f64>(eigVals + off);
    store<f64>(D + off, Math.sqrt(ev > 1e-14 ? ev : 1e-14));
  }
}
