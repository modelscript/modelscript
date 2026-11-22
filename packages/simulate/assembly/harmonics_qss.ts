// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Harmonics Sweep, QSS1 Linear Event Integrator, and Batched SDE Ensemble Kernels.
 */

function solveRealBlock(aPtr: usize, bPtr: usize, n: i32, outXPtr: usize): bool {
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
 * Solves complex harmonic nodal admittance system (G + jB)(V_re + jV_im) = (I_re + jI_im)
 * via equivalent 2n x 2n real block matrix [[G, -B], [B, G]].
 * Returns 1 on success, 0 if singular.
 */
export function grid_harmonicsSolveOrder(
  nBus: i32,
  gPtr: usize,
  bPtr: usize,
  iRePtr: usize,
  iImPtr: usize,
  outVRePtr: usize,
  outVImPtr: usize,
): i32 {
  if (nBus <= 0) return 0;
  const dim = 2 * nBus;
  const matPtr = heap.alloc(<usize>(dim * dim) << 3);
  const rhsPtr = heap.alloc(<usize>dim << 3);
  const solPtr = heap.alloc(<usize>dim << 3);

  for (let i: i32 = 0; i < nBus; i++) {
    store<f64>(rhsPtr + (<usize>i << 3), load<f64>(iRePtr + (<usize>i << 3)));
    store<f64>(rhsPtr + (<usize>(nBus + i) << 3), load<f64>(iImPtr + (<usize>i << 3)));
    for (let j: i32 = 0; j < nBus; j++) {
      const gij = load<f64>(gPtr + (<usize>(i * nBus + j) << 3));
      const bij = load<f64>(bPtr + (<usize>(i * nBus + j) << 3));
      store<f64>(matPtr + (<usize>(i * dim + j) << 3), gij);
      store<f64>(matPtr + (<usize>(i * dim + nBus + j) << 3), -bij);
      store<f64>(matPtr + (<usize>((nBus + i) * dim + j) << 3), bij);
      store<f64>(matPtr + (<usize>((nBus + i) * dim + nBus + j) << 3), gij);
    }
  }

  const ok = solveRealBlock(matPtr, rhsPtr, dim, solPtr);
  if (ok) {
    memory.copy(outVRePtr, solPtr, <usize>nBus << 3);
    memory.copy(outVImPtr, solPtr + (<usize>nBus << 3), <usize>nBus << 3);
  }

  heap.free(matPtr);
  heap.free(rhsPtr);
  heap.free(solPtr);
  return ok ? 1 : 0;
}

/**
 * QSS1 (First-Order Quantized State System) event-driven integrator for linear ODE dx/dt = A*x + b.
 * Updates `outXPtr` with final state x(tEnd) and returns total quantized state events processed.
 */
export function qss1_integrateLinear(
  n: i32,
  aPtr: usize,
  bPtr: usize,
  x0Ptr: usize,
  dqPtr: usize,
  t0: f64,
  tEnd: f64,
  maxEvents: i32,
  outXPtr: usize,
): i32 {
  if (n <= 0) return 0;

  const xPtr = heap.alloc(<usize>n << 3);
  const qPtr = heap.alloc(<usize>n << 3);
  const dPtr = heap.alloc(<usize>n << 3);
  const tLastPtr = heap.alloc(<usize>n << 3);
  const tNextPtr = heap.alloc(<usize>n << 3);

  memory.copy(xPtr, x0Ptr, <usize>n << 3);
  memory.copy(qPtr, x0Ptr, <usize>n << 3);

  // Initialize derivatives and next quantum crossing times
  for (let i: i32 = 0; i < n; i++) {
    let di = load<f64>(bPtr + (<usize>i << 3));
    for (let j: i32 = 0; j < n; j++) {
      di += load<f64>(aPtr + (<usize>(i * n + j) << 3)) * load<f64>(qPtr + (<usize>j << 3));
    }
    store<f64>(dPtr + (<usize>i << 3), di);
    store<f64>(tLastPtr + (<usize>i << 3), t0);
    const dq = load<f64>(dqPtr + (<usize>i << 3));
    const dt = Math.abs(di) > 1e-15 ? dq / Math.abs(di) : Infinity;
    store<f64>(tNextPtr + (<usize>i << 3), t0 + dt);
  }

  let t = t0;
  let events: i32 = 0;

  while (events < maxEvents) {
    let minIdx: i32 = -1;
    let minT: f64 = Infinity;
    for (let i: i32 = 0; i < n; i++) {
      const tn = load<f64>(tNextPtr + (<usize>i << 3));
      if (tn < minT) {
        minT = tn;
        minIdx = i;
      }
    }
    if (minIdx < 0 || minT > tEnd) break;

    t = minT;
    const i = minIdx;
    const dtI = t - load<f64>(tLastPtr + (<usize>i << 3));
    const newX = load<f64>(xPtr + (<usize>i << 3)) + load<f64>(dPtr + (<usize>i << 3)) * dtI;
    store<f64>(xPtr + (<usize>i << 3), newX);
    store<f64>(qPtr + (<usize>i << 3), newX);
    store<f64>(tLastPtr + (<usize>i << 3), t);

    // Recompute affected derivatives and next crossing times
    for (let r: i32 = 0; r < n; r++) {
      const aRI = load<f64>(aPtr + (<usize>(r * n + i) << 3));
      if (r != i && aRI == 0.0) continue;

      if (r != i) {
        const dtR = t - load<f64>(tLastPtr + (<usize>r << 3));
        store<f64>(xPtr + (<usize>r << 3), load<f64>(xPtr + (<usize>r << 3)) + load<f64>(dPtr + (<usize>r << 3)) * dtR);
        store<f64>(tLastPtr + (<usize>r << 3), t);
      }

      let dr = load<f64>(bPtr + (<usize>r << 3));
      for (let c: i32 = 0; c < n; c++) {
        dr += load<f64>(aPtr + (<usize>(r * n + c) << 3)) * load<f64>(qPtr + (<usize>c << 3));
      }
      store<f64>(dPtr + (<usize>r << 3), dr);

      const xr = load<f64>(xPtr + (<usize>r << 3));
      const qr = load<f64>(qPtr + (<usize>r << 3));
      const dq = load<f64>(dqPtr + (<usize>r << 3));
      let nextDt: f64 = Infinity;
      if (dr > 1e-15) {
        const rem = qr + dq - xr;
        nextDt = rem > 0.0 ? rem / dr : 0.0;
      } else if (dr < -1e-15) {
        const rem = xr - (qr - dq);
        nextDt = rem > 0.0 ? rem / (-dr) : 0.0;
      }
      store<f64>(tNextPtr + (<usize>r << 3), t + nextDt);
    }
    events++;
  }

  // Advance all states linearly to tEnd
  for (let i: i32 = 0; i < n; i++) {
    const dt = tEnd - load<f64>(tLastPtr + (<usize>i << 3));
    store<f64>(outXPtr + (<usize>i << 3), load<f64>(xPtr + (<usize>i << 3)) + load<f64>(dPtr + (<usize>i << 3)) * dt);
  }

  heap.free(xPtr);
  heap.free(qPtr);
  heap.free(dPtr);
  heap.free(tLastPtr);
  heap.free(tNextPtr);
  return events;
}

/**
 * Batched Euler-Maruyama SDE Ensemble for geometric Brownian motion dX = mu*X*dt + sigma*X*dW.
 * Computes exact ensemble mean and variance at each step in WASM linear memory (zero JS allocations).
 */
export function sde_gbmEnsemble(
  nPaths: i32,
  nSteps: i32,
  dt: f64,
  x0: f64,
  mu: f64,
  sigma: f64,
  seed: u64,
  outMeanPtr: usize,
  outVarPtr: usize,
): void {
  if (nPaths <= 0 || nSteps <= 0) return;

  const sqrtDt = Math.sqrt(dt);
  const pathsPtr = heap.alloc(<usize>nPaths << 3);
  for (let p: i32 = 0; p < nPaths; p++) {
    store<f64>(pathsPtr + (<usize>p << 3), x0);
  }
  store<f64>(outMeanPtr, x0);
  store<f64>(outVarPtr, 0.0);

  let s0: u64 = seed == 0 ? 0x9e3779b97f4a7c15 : seed;
  let s1: u64 = s0 ^ 0xbf58476d1ce4e5b9;

  for (let step: i32 = 1; step <= nSteps; step++) {
    let sum: f64 = 0.0;
    let sum2: f64 = 0.0;

    for (let p: i32 = 0; p < nPaths; p++) {
      // Fast xorshift128+ + Box-Muller
      let a = s0;
      const b = s1;
      s0 = b;
      a ^= a << 23;
      s1 = a ^ b ^ (a >> 17) ^ (b >> 26);
      const u1Raw = <f64>((s1 + b) >> 11) * (1.0 / 9007199254740992.0);

      let a2 = s0;
      const b2 = s1;
      s0 = b2;
      a2 ^= a2 << 23;
      s1 = a2 ^ b2 ^ (a2 >> 17) ^ (b2 >> 26);
      const u2 = <f64>((s1 + b2) >> 11) * (1.0 / 9007199254740992.0);

      const u1 = u1Raw < 1e-15 ? 1e-15 : u1Raw;
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(6.283185307179586 * u2);

      const off = pathsPtr + (<usize>p << 3);
      const x = load<f64>(off);
      const xNext = x + mu * x * dt + sigma * x * sqrtDt * z;
      store<f64>(off, xNext);
      sum += xNext;
      sum2 += xNext * xNext;
    }

    const invN = 1.0 / <f64>nPaths;
    const mean = sum * invN;
    const variance = Math.max(0.0, sum2 * invN - mean * mean);
    store<f64>(outMeanPtr + (<usize>step << 3), mean);
    store<f64>(outVarPtr + (<usize>step << 3), variance);
  }

  heap.free(pathsPtr);
}
