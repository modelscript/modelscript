// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Hamilton-Jacobi-Isaacs (HJI) PDE Grid Kernels:
 * - 5th-order WENO spatial derivative reconstruction (single point & full-grid sweep)
 * - 3-stage Shu-Osher TVD-RK3 time stepping with Backward Reachable Tube (BRT) min enforcement
 */

@inline
function weno5Combine(v1: f64, v2: f64, v3: f64, v4: f64, v5: f64): f64 {
  const phi1 = v1 / 3.0 - (7.0 * v2) / 6.0 + (11.0 * v3) / 6.0;
  const phi2 = -v2 / 6.0 + (5.0 * v3) / 6.0 + v4 / 3.0;
  const phi3 = v3 / 3.0 + (5.0 * v4) / 6.0 - v5 / 6.0;

  const t1a = v1 - 2.0 * v2 + v3;
  const t1b = v1 - 4.0 * v2 + 3.0 * v3;
  const s1 = (13.0 / 12.0) * t1a * t1a + 0.25 * t1b * t1b;

  const t2a = v2 - 2.0 * v3 + v4;
  const t2b = v2 - v4;
  const s2 = (13.0 / 12.0) * t2a * t2a + 0.25 * t2b * t2b;

  const t3a = v3 - 2.0 * v4 + v5;
  const t3b = 3.0 * v3 - 4.0 * v4 + v5;
  const s3 = (13.0 / 12.0) * t3a * t3a + 0.25 * t3b * t3b;

  const eps: f64 = 1e-6;
  const d1 = eps + s1;
  const d2 = eps + s2;
  const d3 = eps + s3;
  const a1 = 0.1 / (d1 * d1);
  const a2 = 0.6 / (d2 * d2);
  const a3 = 0.3 / (d3 * d3);
  return (a1 * phi1 + a2 * phi2 + a3 * phi3) / (a1 + a2 + a3);
}

@inline
function getClampedGridVal(
  vPtr: usize,
  vLen: i32,
  idx: i32,
  coord: i32,
  stride: i32,
  numPts: i32,
  offset: i32,
): f64 {
  let c = coord + offset;
  if (c < 0) c = 0;
  else if (c >= numPts) c = numPts - 1;
  let target = idx + (c - coord) * stride;
  if (target < 0) target = 0;
  else if (target >= vLen) target = vLen - 1;
  return load<f64>(vPtr + (<usize>target << 3));
}

/**
 * Computes 5th-order WENO spatial derivatives [derivMinus, derivPlus] at a single grid point.
 */
export function hji_weno5Derivatives(
  vPtr: usize,
  vLen: i32,
  idx: i32,
  stride: i32,
  dx: f64,
  numPts: i32,
  outDerivPtr: usize,
): void {
  const coord: i32 = numPts > 0 && stride > 0 ? (idx / stride) % numPts : 0;
  const invDx = 1.0 / dx;

  const vm3 = getClampedGridVal(vPtr, vLen, idx, coord, stride, numPts, -3);
  const vm2 = getClampedGridVal(vPtr, vLen, idx, coord, stride, numPts, -2);
  const vm1 = getClampedGridVal(vPtr, vLen, idx, coord, stride, numPts, -1);
  const v0 = getClampedGridVal(vPtr, vLen, idx, coord, stride, numPts, 0);
  const vp1 = getClampedGridVal(vPtr, vLen, idx, coord, stride, numPts, 1);
  const vp2 = getClampedGridVal(vPtr, vLen, idx, coord, stride, numPts, 2);
  const vp3 = getClampedGridVal(vPtr, vLen, idx, coord, stride, numPts, 3);

  const dm2 = (vm2 - vm3) * invDx;
  const dm1 = (vm1 - vm2) * invDx;
  const d0 = (v0 - vm1) * invDx;
  const dp1 = (vp1 - v0) * invDx;
  const dp2 = (vp2 - vp1) * invDx;
  const dp3 = (vp3 - vp2) * invDx;

  store<f64>(outDerivPtr, weno5Combine(dm2, dm1, d0, dp1, dp2));
  store<f64>(outDerivPtr + 8, weno5Combine(dp3, dp2, dp1, d0, dm1));
}

/**
 * Full-grid 5th-order WENO derivative sweep across all grid points and dimensions.
 * Writes f64[totalPts * dims] to outDMinusPtr and outDPlusPtr (layout: idx * dims + d).
 */
export function hji_weno5SweepAll(
  vPtr: usize,
  totalPts: i32,
  dims: i32,
  stridesPtr: usize,
  dxPtr: usize,
  gridCountsPtr: usize,
  outDMinusPtr: usize,
  outDPlusPtr: usize,
): void {
  for (let d: i32 = 0; d < dims; d++) {
    const stride = load<i32>(stridesPtr + (<usize>d << 2));
    const numPts = load<i32>(gridCountsPtr + (<usize>d << 2));
    const invDx = 1.0 / load<f64>(dxPtr + (<usize>d << 3));

    for (let idx: i32 = 0; idx < totalPts; idx++) {
      const coord: i32 = numPts > 0 && stride > 0 ? (idx / stride) % numPts : 0;

      const vm3 = getClampedGridVal(vPtr, totalPts, idx, coord, stride, numPts, -3);
      const vm2 = getClampedGridVal(vPtr, totalPts, idx, coord, stride, numPts, -2);
      const vm1 = getClampedGridVal(vPtr, totalPts, idx, coord, stride, numPts, -1);
      const v0 = getClampedGridVal(vPtr, totalPts, idx, coord, stride, numPts, 0);
      const vp1 = getClampedGridVal(vPtr, totalPts, idx, coord, stride, numPts, 1);
      const vp2 = getClampedGridVal(vPtr, totalPts, idx, coord, stride, numPts, 2);
      const vp3 = getClampedGridVal(vPtr, totalPts, idx, coord, stride, numPts, 3);

      const dm2 = (vm2 - vm3) * invDx;
      const dm1 = (vm1 - vm2) * invDx;
      const d0 = (v0 - vm1) * invDx;
      const dp1 = (vp1 - v0) * invDx;
      const dp2 = (vp2 - vp1) * invDx;
      const dp3 = (vp3 - vp2) * invDx;

      const outOff = (<usize>(idx * dims + d)) << 3;
      store<f64>(outDMinusPtr + outOff, weno5Combine(dm2, dm1, d0, dp1, dp2));
      store<f64>(outDPlusPtr + outOff, weno5Combine(dp3, dp2, dp1, d0, dm1));
    }
  }
}

/**
 * 3-stage Shu-Osher TVD-RK3 combination with BRT min-with-target enforcement.
 * - stage == 1: out[k] = min(V[k], E[k])
 * - stage == 2: out[k] = min(V[k], 0.75 * V[k] + 0.25 * E[k])
 * - stage == 3: out[k] = min(V[k], V0[k], (1/3) * V[k] + (2/3) * E[k])
 */
export function hji_tvdRk3Combine(
  vPtr: usize,
  v0Ptr: usize,
  ePtr: usize,
  outPtr: usize,
  n: i32,
  stage: i32,
): void {
  if (stage == 1) {
    for (let k: i32 = 0; k < n; k++) {
      const off = (<usize>k) << 3;
      const vk = load<f64>(vPtr + off);
      const ek = load<f64>(ePtr + off);
      store<f64>(outPtr + off, vk < ek ? vk : ek);
    }
  } else if (stage == 2) {
    for (let k: i32 = 0; k < n; k++) {
      const off = (<usize>k) << 3;
      const vk = load<f64>(vPtr + off);
      const comb = 0.75 * vk + 0.25 * load<f64>(ePtr + off);
      store<f64>(outPtr + off, vk < comb ? vk : comb);
    }
  } else {
    const oneThird: f64 = 1.0 / 3.0;
    const twoThirds: f64 = 2.0 / 3.0;
    for (let k: i32 = 0; k < n; k++) {
      const off = (<usize>k) << 3;
      const vk = load<f64>(vPtr + off);
      const v0k = load<f64>(v0Ptr + off);
      const comb = oneThird * vk + twoThirds * load<f64>(ePtr + off);
      let m = vk < v0k ? vk : v0k;
      if (comb < m) m = comb;
      store<f64>(outPtr + off, m);
    }
  }
}
