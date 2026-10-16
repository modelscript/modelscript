// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Advanced Numerical Integrators, Stochastic/Delay Solvers,
 * Unscented Kalman Filter (UKF), Semidefinite Programming (SDP) PSD Cone Projection,
 * HC4 Interval Contractor, and State-Machine / fUML Petri-Net Kernels.
 */

/**
 * Combines `s` RK stages (`kBasePtr`: `7 * n` f64s) with Butcher row `aRowPtr` (`s` f64s)
 * to form `yStageOut = y + h * sum_{j=0}^{s-1} a_j * k_j` in linear memory.
 */
export function tsit5_combine_stage(
  n: i32,
  yPtr: usize,
  kBasePtr: usize,
  aRowPtr: usize,
  s: i32,
  h: f64,
  yStageOutPtr: usize
): void {
  for (let i: i32 = 0; i < n; i++) {
    let sum: f64 = 0.0;
    for (let j: i32 = 0; j < s; j++) {
      const a = load<f64>(aRowPtr + ((j as usize) << 3));
      const kj = load<f64>(kBasePtr + (((j * n + i) as usize) << 3));
      sum += a * kj;
    }
    const yi = load<f64>(yPtr + ((i as usize) << 3));
    store<f64>(yStageOutPtr + ((i as usize) << 3), yi + h * sum);
  }
}

/**
 * Computes the 5th-order Tsitouras solution `yNewOut` (`n` f64s) from `k0..k5`
 * (`kBasePtr`, `7 * n` f64s) and returns the normalized RMS embedded error norm
 * using 4th/5th difference weights `ePtr` (7 f64s).
 */
export function tsit5_compute_step_and_error(
  n: i32,
  yPtr: usize,
  kBasePtr: usize,
  b5Ptr: usize,
  ePtr: usize,
  h: f64,
  atol: f64,
  rtol: f64,
  yNewOutPtr: usize
): f64 {
  if (n <= 0) return 0.0;
  for (let i: i32 = 0; i < n; i++) {
    let sum5: f64 = 0.0;
    for (let j: i32 = 0; j < 6; j++) {
      const b5j = load<f64>(b5Ptr + ((j as usize) << 3));
      const kj = load<f64>(kBasePtr + (((j * n + i) as usize) << 3));
      sum5 += b5j * kj;
    }
    const yi = load<f64>(yPtr + ((i as usize) << 3));
    store<f64>(yNewOutPtr + ((i as usize) << 3), yi + h * sum5);
  }

  let errSqSum: f64 = 0.0;
  for (let i: i32 = 0; i < n; i++) {
    let errSum: f64 = 0.0;
    for (let j: i32 = 0; j < 7; j++) {
      const ej = load<f64>(ePtr + ((j as usize) << 3));
      const kj = load<f64>(kBasePtr + (((j * n + i) as usize) << 3));
      errSum += ej * kj;
    }
    const err = Math.abs(h * errSum);
    const yi = load<f64>(yPtr + ((i as usize) << 3));
    const yNewi = load<f64>(yNewOutPtr + ((i as usize) << 3));
    const sc = atol + rtol * Math.max(Math.abs(yi), Math.abs(yNewi));
    const ratio = err / sc;
    errSqSum += ratio * ratio;
  }

  return Math.sqrt(errSqSum / <f64>n);
}

/**
 * Evaluates cubic Hermite dense output interpolation on `[t0, t0 + h]` at normalized
 * coordinate `theta in [0, 1]` for `n` state variables in linear memory.
 */
export function dde_hermite_interpolate(
  n: i32,
  y0Ptr: usize,
  y1Ptr: usize,
  f0Ptr: usize,
  f1Ptr: usize,
  h: f64,
  theta: f64,
  outPtr: usize
): void {
  const theta2 = theta * theta;
  const theta3 = theta2 * theta;
  const h00 = 2.0 * theta3 - 3.0 * theta2 + 1.0;
  const h10 = theta3 - 2.0 * theta2 + theta;
  const h01 = -2.0 * theta3 + 3.0 * theta2;
  const h11 = theta3 - theta2;

  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    const val =
      h00 * load<f64>(y0Ptr + off) +
      h10 * h * load<f64>(f0Ptr + off) +
      h01 * load<f64>(y1Ptr + off) +
      h11 * h * load<f64>(f1Ptr + off);
    store<f64>(outPtr + off, val);
  }
}

/**
 * Computes an Euler-Maruyama stochastic differential equation step:
 * `yNext[i] = y[i] + drift[i] * dt + diff[i] * dW[i]`.
 */
export function sde_euler_maruyama_step(
  n: i32,
  yPtr: usize,
  driftPtr: usize,
  diffPtr: usize,
  dWPtr: usize,
  dt: f64,
  yNextOutPtr: usize
): void {
  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    const yn =
      load<f64>(yPtr + off) +
      load<f64>(driftPtr + off) * dt +
      load<f64>(diffPtr + off) * load<f64>(dWPtr + off);
    store<f64>(yNextOutPtr + off, yn);
  }
}

/**
 * Computes the high-order SRIW1 strong order 1.5 stochastic Runge-Kutta update
 * `yHighOut` and returns the scaled RMS error norm relative to Euler-Maruyama.
 */
export function sde_sriw1_step(
  n: i32,
  yPtr: usize,
  f0Ptr: usize,
  f1Ptr: usize,
  g0Ptr: usize,
  g1Ptr: usize,
  dWPtr: usize,
  dZPtr: usize,
  h: f64,
  atol: f64,
  rtol: f64,
  yHighOutPtr: usize
): f64 {
  if (n <= 0) return 0.0;
  const sqrtH = Math.sqrt(h);
  let errSumSq: f64 = 0.0;

  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    const yi = load<f64>(yPtr + off);
    const f0 = load<f64>(f0Ptr + off);
    const f1 = load<f64>(f1Ptr + off);
    const g0 = load<f64>(g0Ptr + off);
    const g1 = load<f64>(g1Ptr + off);
    const dW = load<f64>(dWPtr + off);
    const dZ = load<f64>(dZPtr + off);

    const yLow = yi + f0 * h + g0 * dW;
    const milsteinCorrection =
      sqrtH > 1e-15 ? ((g1 - g0) / (2.0 * sqrtH)) * (dW * dW - h) : 0.0;
    const dzTerm = h > 1e-15 ? ((g1 - g0) / sqrtH) * (dZ / h - 0.5 * dW) : 0.0;
    const yHigh = yi + 0.5 * (f0 + f1) * h + g0 * dW + milsteinCorrection + dzTerm;

    store<f64>(yHighOutPtr + off, yHigh);

    const scale = atol + rtol * Math.max(Math.abs(yi), Math.abs(yHigh));
    const ratio = Math.abs(yHigh - yLow) / scale;
    errSumSq += ratio * ratio;
  }

  return Math.sqrt(errSumSq / <f64>n);
}

/**
 * Computes the lower-triangular Cholesky factor `outPtr` (`L x L` row-major f64s)
 * of a symmetric positive-definite covariance matrix `aPtr` (`L x L` row-major f64s)
 * with diagonal jitter fallback.
 */
export function ukf_cholesky(L: i32, aPtr: usize, outPtr: usize): i32 {
  for (let i: i32 = 0; i < L * L; i++) {
    store<f64>(outPtr + ((i as usize) << 3), 0.0);
  }

  for (let i: i32 = 0; i < L; i++) {
    for (let j: i32 = 0; j <= i; j++) {
      let sum = load<f64>(aPtr + (((i * L + j) as usize) << 3));
      for (let k: i32 = 0; k < j; k++) {
        sum -=
          load<f64>(outPtr + (((i * L + k) as usize) << 3)) *
          load<f64>(outPtr + (((j * L + k) as usize) << 3));
      }
      if (i == j) {
        const clamped = sum > 1e-12 ? sum : 1e-12;
        store<f64>(outPtr + (((i * L + j) as usize) << 3), Math.sqrt(clamped));
      } else {
        const diag = load<f64>(outPtr + (((j * L + j) as usize) << 3));
        store<f64>(outPtr + (((i * L + j) as usize) << 3), sum / diag);
      }
    }
  }
  return 1;
}

/**
 * Generates `2 * L + 1` Unscented Kalman Filter (UKF) sigma points (`sigmaOutPtr`: `(2*L+1) * L` f64s)
 * from state mean `statePtr` (`L` f64s), scaling factor `gamma = sqrt(L + lambda)`,
 * and Cholesky factor `cholPtr` (`L x L` f64s).
 */
export function ukf_generate_sigma_points(
  L: i32,
  gamma: f64,
  statePtr: usize,
  cholPtr: usize,
  sigmaOutPtr: usize
): void {
  // Sigma point 0: x
  for (let r: i32 = 0; r < L; r++) {
    store<f64>(sigmaOutPtr + ((r as usize) << 3), load<f64>(statePtr + ((r as usize) << 3)));
  }

  // Sigma points 1..L and L+1..2L
  for (let col: i32 = 0; col < L; col++) {
    const plusBase = ((col + 1) * L) as usize;
    const minusBase = ((col + 1 + L) * L) as usize;
    for (let r: i32 = 0; r < L; r++) {
      const xr = load<f64>(statePtr + ((r as usize) << 3));
      const step = gamma * load<f64>(cholPtr + (((r * L + col) as usize) << 3));
      store<f64>(sigmaOutPtr + ((plusBase + (r as usize)) << 3), xr + step);
      store<f64>(sigmaOutPtr + ((minusBase + (r as usize)) << 3), xr - step);
    }
  }
}

/**
 * Projects a symmetric `n x n` matrix `xPtr` (`n * n` f64s) onto the Positive Semidefinite (PSD)
 * cone $S_+^n$ by cyclic Jacobi eigendecomposition $X = V \Lambda V^T$ and clamping
 * eigenvalues $\lambda_i \leftarrow \max(\epsilon, \lambda_i)$, writing the result to `outPtr`.
 */
export function sdp_project_psd_cone(
  n: i32,
  xPtr: usize,
  eps: f64,
  outPtr: usize
): void {
  if (n <= 0) return;
  const nn = n * n;
  const a = new StaticArray<f64>(nn);
  const v = new StaticArray<f64>(nn);

  // Symmetrize X into a, initialize V = I
  for (let i: i32 = 0; i < n; i++) {
    for (let j: i32 = 0; j < n; j++) {
      const xij = load<f64>(xPtr + (((i * n + j) as usize) << 3));
      const xji = load<f64>(xPtr + (((j * n + i) as usize) << 3));
      unchecked((a[i * n + j] = 0.5 * (xij + xji)));
      unchecked((v[i * n + j] = i == j ? 1.0 : 0.0));
    }
  }

  // Cyclic Jacobi sweeps
  for (let sweep: i32 = 0; sweep < 35; sweep++) {
    let maxOff: f64 = 0.0;
    for (let p: i32 = 0; p < n - 1; p++) {
      for (let q: i32 = p + 1; q < n; q++) {
        const apq = Math.abs(unchecked(a[p * n + q]));
        if (apq > maxOff) maxOff = apq;
      }
    }
    if (maxOff < 1e-13) break;

    for (let p: i32 = 0; p < n - 1; p++) {
      for (let q: i32 = p + 1; q < n; q++) {
        const apq = unchecked(a[p * n + q]);
        if (Math.abs(apq) < 1e-15) continue;

        const app = unchecked(a[p * n + p]);
        const aqq = unchecked(a[q * n + q]);
        const tau = (aqq - app) / (2.0 * apq);
        const t =
          tau >= 0.0
            ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau))
            : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
        const c = 1.0 / Math.sqrt(1.0 + t * t);
        const s = t * c;

        unchecked((a[p * n + p] = app - t * apq));
        unchecked((a[q * n + q] = aqq + t * apq));
        unchecked((a[p * n + q] = 0.0));
        unchecked((a[q * n + p] = 0.0));

        for (let r: i32 = 0; r < n; r++) {
          if (r != p && r != q) {
            const arp = unchecked(a[r * n + p]);
            const arq = unchecked(a[r * n + q]);
            const newArp = c * arp - s * arq;
            const newArq = s * arp + c * arq;
            unchecked((a[r * n + p] = newArp));
            unchecked((a[p * n + r] = newArp));
            unchecked((a[r * n + q] = newArq));
            unchecked((a[q * n + r] = newArq));
          }
          const vrp = unchecked(v[r * n + p]);
          const vrq = unchecked(v[r * n + q]);
          unchecked((v[r * n + p] = c * vrp - s * vrq));
          unchecked((v[r * n + q] = s * vrp + c * vrq));
        }
      }
    }
  }

  // Reconstruct out = V * max(eps, diag(a)) * V^T
  for (let i: i32 = 0; i < n; i++) {
    for (let j: i32 = i; j < n; j++) {
      let sum: f64 = 0.0;
      for (let k: i32 = 0; k < n; k++) {
        let lam = unchecked(a[k * n + k]);
        if (lam < eps) lam = eps;
        sum += unchecked(v[i * n + k]) * lam * unchecked(v[j * n + k]);
      }
      store<f64>(outPtr + (((i * n + j) as usize) << 3), sum);
      if (i != j) {
        store<f64>(outPtr + (((j * n + i) as usize) << 3), sum);
      }
    }
  }
}

/**
 * Evaluates forward interval arithmetic `[loOut, hiOut]` (written to `outPtr`, 2 f64s)
 * for HC4 constraint propagation:
 * `opKind`: 0 = add, 1 = sub, 2 = mul, 3 = div, 4 = sqr, 5 = sqrt.
 */
export function hc4_eval_interval(
  opKind: i32,
  loA: f64,
  hiA: f64,
  loB: f64,
  hiB: f64,
  outPtr: usize
): void {
  let lo: f64 = 0.0;
  let hi: f64 = 0.0;
  if (opKind == 0) {
    lo = loA + loB;
    hi = hiA + hiB;
  } else if (opKind == 1) {
    lo = loA - hiB;
    hi = hiA - loB;
  } else if (opKind == 2) {
    const p1 = loA * loB;
    const p2 = loA * hiB;
    const p3 = hiA * loB;
    const p4 = hiA * hiB;
    lo = Math.min(Math.min(p1, p2), Math.min(p3, p4));
    hi = Math.max(Math.max(p1, p2), Math.max(p3, p4));
  } else if (opKind == 3) {
    if (loB <= 0.0 && hiB >= 0.0) {
      lo = -Infinity;
      hi = Infinity;
    } else {
      const q1 = loA / loB;
      const q2 = loA / hiB;
      const q3 = hiA / loB;
      const q4 = hiA / hiB;
      lo = Math.min(Math.min(q1, q2), Math.min(q3, q4));
      hi = Math.max(Math.max(q1, q2), Math.max(q3, q4));
    }
  } else if (opKind == 4) {
    const s1 = loA * loA;
    const s2 = hiA * hiA;
    lo = loA <= 0.0 && hiA >= 0.0 ? 0.0 : Math.min(s1, s2);
    hi = Math.max(s1, s2);
  } else if (opKind == 5) {
    lo = loA > 0.0 ? Math.sqrt(loA) : 0.0;
    hi = hiA >= 0.0 ? Math.sqrt(hiA) : -1.0;
  }
  store<f64>(outPtr + 0, lo);
  store<f64>(outPtr + 8, hi);
}

/**
 * Finds the Lowest Common Ancestor (LCA) state ID between `sourceId` and `targetId`
 * in a flat parent-pointer array `parentIdsPtr` (`i32[numStates]`, where `-1` is root).
 */
export function statemachine_find_lca(
  numStates: i32,
  parentIdsPtr: usize,
  sourceId: i32,
  targetId: i32
): i32 {
  if (numStates <= 0 || sourceId < 0 || targetId < 0) return -1;
  const visited = new StaticArray<u8>(numStates);
  let curr = sourceId;
  let guard: i32 = 0;
  while (curr >= 0 && curr < numStates && guard < numStates) {
    unchecked((visited[curr] = 1));
    curr = load<i32>(parentIdsPtr + ((curr as usize) << 2));
    guard++;
  }
  curr = targetId;
  guard = 0;
  while (curr >= 0 && curr < numStates && guard < numStates) {
    if (unchecked(visited[curr]) != 0) {
      return curr;
    }
    curr = load<i32>(parentIdsPtr + ((curr as usize) << 2));
    guard++;
  }
  return -1;
}

/**
 * Performs one synchronous Petri-net token firing step over `numNodes` fUML activity nodes
 * (`nodeKindsPtr`: 0=action/fork/merge, 1=join, 2=final) and `numEdges` directed edges
 * (`edgeSrcPtr`, `edgeTgtPtr`, `edgeTokensPtr`: `i32[numEdges]`).
 * Writes fired node flags (`u8[numNodes]`) to `firedOutPtr` and returns the count of fired nodes.
 */
export function fuml_step_petri_tokens(
  numNodes: i32,
  numEdges: i32,
  nodeKindsPtr: usize,
  edgeSrcPtr: usize,
  edgeTgtPtr: usize,
  edgeTokensPtr: usize,
  firedOutPtr: usize
): i32 {
  if (numNodes <= 0) return 0;
  let firedCount: i32 = 0;

  for (let n: i32 = 0; n < numNodes; n++) {
    store<u8>(firedOutPtr + (n as usize), 0);
    const kind = load<i32>(nodeKindsPtr + ((n as usize) << 2));
    let inCount: i32 = 0;
    let readyCount: i32 = 0;

    for (let e: i32 = 0; e < numEdges; e++) {
      if (load<i32>(edgeTgtPtr + ((e as usize) << 2)) == n) {
        inCount++;
        if (load<i32>(edgeTokensPtr + ((e as usize) << 2)) > 0) {
          readyCount++;
        }
      }
    }

    if (inCount > 0) {
      const canFire = kind == 1 ? readyCount == inCount : readyCount > 0;
      if (canFire) {
        store<u8>(firedOutPtr + (n as usize), 1);
        firedCount++;
      }
    }
  }

  if (firedCount == 0) return 0;

  // Consume input tokens and produce output tokens for fired nodes
  for (let n: i32 = 0; n < numNodes; n++) {
    if (load<u8>(firedOutPtr + (n as usize)) == 0) continue;
    const kind = load<i32>(nodeKindsPtr + ((n as usize) << 2));
    let consumedOne: bool = false;

    for (let e: i32 = 0; e < numEdges; e++) {
      const off = (e as usize) << 2;
      if (load<i32>(edgeTgtPtr + off) == n) {
        const tok = load<i32>(edgeTokensPtr + off);
        if (tok > 0 && (kind == 1 || !consumedOne)) {
          store<i32>(edgeTokensPtr + off, tok - 1);
          consumedOne = true;
        }
      }
    }

    if (kind != 2) {
      for (let e: i32 = 0; e < numEdges; e++) {
        const off = (e as usize) << 2;
        if (load<i32>(edgeSrcPtr + off) == n) {
          store<i32>(edgeTokensPtr + off, load<i32>(edgeTokensPtr + off) + 1);
        }
      }
    }
  }

  return firedCount;
}
