// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly 3D Tetrahedral (Tet4) Finite Element Analysis (FEA) Kernel.
 *
 * Provides zero-allocation, linear-memory implementations of:
 * - Closed-form 4-node linear tetrahedron (Tet4) 12x12 stiffness matrix K_e = V * B^T * D * B
 * - Compressed Sparse Row (CSR) Sparse Matrix-Vector Multiplication (SpMV)
 * - Jacobi-Preconditioned Conjugate Gradient (PCG) linear solver in linear memory
 * - Batch element & nodal von Mises stress post-processing
 */

/**
 * Computes the 6x12 strain-displacement matrix B (`bOutPtr`, 72 f64s) and
 * 12x12 element stiffness matrix K_e (`keOutPtr`, 144 f64s) for a 4-node tetrahedron
 * with vertex coordinates `coordsPtr` (12 f64s: [x0,y0,z0, ..., x3,y3,z3])
 * and 6x6 constitutive elasticity matrix `dPtr` (36 f64s).
 * Returns the tetrahedron volume V (or <= 0 if degenerate).
 */
export function fea_compute_tet4_stiffness(
  coordsPtr: usize,
  dPtr: usize,
  keOutPtr: usize,
  bOutPtr: usize
): f64 {
  const x0 = load<f64>(coordsPtr + 0);
  const y0 = load<f64>(coordsPtr + 8);
  const z0 = load<f64>(coordsPtr + 16);
  const x1 = load<f64>(coordsPtr + 24);
  const y1 = load<f64>(coordsPtr + 32);
  const z1 = load<f64>(coordsPtr + 40);
  const x2 = load<f64>(coordsPtr + 48);
  const y2 = load<f64>(coordsPtr + 56);
  const z2 = load<f64>(coordsPtr + 64);
  const x3 = load<f64>(coordsPtr + 72);
  const y3 = load<f64>(coordsPtr + 80);
  const z3 = load<f64>(coordsPtr + 88);

  const x21 = x1 - x0;
  const y21 = y1 - y0;
  const z21 = z1 - z0;
  const x31 = x2 - x0;
  const y31 = y2 - y0;
  const z31 = z2 - z0;
  const x41 = x3 - x0;
  const y41 = y3 - y0;
  const z41 = z3 - z0;

  const detJ =
    x21 * (y31 * z41 - y41 * z31) -
    y21 * (x31 * z41 - x41 * z31) +
    z21 * (x31 * y41 - x41 * y31);

  if (detJ <= 1e-18) {
    return 0.0;
  }
  const volume = detJ / 6.0;
  if (volume <= 1e-18) {
    return 0.0;
  }

  const inv6V = 1.0 / detJ;

  const b1 = inv6V * (y31 * z41 - y41 * z31);
  const c1 = inv6V * (z31 * x41 - z41 * x31);
  const d1 = inv6V * (x31 * y41 - x41 * y31);

  const b2 = inv6V * (y41 * z21 - y21 * z41);
  const c2 = inv6V * (z41 * x21 - z21 * x41);
  const d2 = inv6V * (x41 * y21 - x21 * y41);

  const b3 = inv6V * (y21 * z31 - y31 * z21);
  const c3 = inv6V * (z21 * x31 - z31 * x21);
  const d3 = inv6V * (x21 * y31 - x31 * y21);

  const b0 = -(b1 + b2 + b3);
  const c0 = -(c1 + c2 + c3);
  const d0 = -(d1 + d2 + d3);

  // Zero B (72 f64s)
  for (let i: i32 = 0; i < 72; i++) {
    store<f64>(bOutPtr + ((i as usize) << 3), 0.0);
  }

  // Helper to populate column block i (i = 0..3)
  for (let i: i32 = 0; i < 4; i++) {
    const bi = i == 0 ? b0 : i == 1 ? b1 : i == 2 ? b2 : b3;
    const ci = i == 0 ? c0 : i == 1 ? c1 : i == 2 ? c2 : c3;
    const di = i == 0 ? d0 : i == 1 ? d1 : i == 2 ? d2 : d3;
    const col = i * 3;

    store<f64>(bOutPtr + (((0 * 12 + col + 0) as usize) << 3), bi);
    store<f64>(bOutPtr + (((1 * 12 + col + 1) as usize) << 3), ci);
    store<f64>(bOutPtr + (((2 * 12 + col + 2) as usize) << 3), di);
    store<f64>(bOutPtr + (((3 * 12 + col + 0) as usize) << 3), ci);
    store<f64>(bOutPtr + (((3 * 12 + col + 1) as usize) << 3), bi);
    store<f64>(bOutPtr + (((4 * 12 + col + 1) as usize) << 3), di);
    store<f64>(bOutPtr + (((4 * 12 + col + 2) as usize) << 3), ci);
    store<f64>(bOutPtr + (((5 * 12 + col + 0) as usize) << 3), di);
    store<f64>(bOutPtr + (((5 * 12 + col + 2) as usize) << 3), bi);
  }

  // Compute Ke = volume * B^T (12x6) * D (6x6) * B (6x12)
  for (let r: i32 = 0; r < 12; r++) {
    for (let c: i32 = 0; c < 12; c++) {
      let sum: f64 = 0.0;
      for (let k: i32 = 0; k < 6; k++) {
        const bkr = load<f64>(bOutPtr + (((k * 12 + r) as usize) << 3));
        if (bkr == 0.0) continue;
        let dbkc: f64 = 0.0;
        for (let m: i32 = 0; m < 6; m++) {
          dbkc +=
            load<f64>(dPtr + (((k * 6 + m) as usize) << 3)) *
            load<f64>(bOutPtr + (((m * 12 + c) as usize) << 3));
        }
        sum += bkr * dbkc;
      }
      store<f64>(keOutPtr + (((r * 12 + c) as usize) << 3), volume * sum);
    }
  }

  return volume;
}

/**
 * Sparse Matrix-Vector Multiplication y = A * x in CSR format.
 */
export function fea_spmv_csr(
  n: i32,
  rowOffsetsPtr: usize,
  colIndicesPtr: usize,
  valuesPtr: usize,
  xPtr: usize,
  yPtr: usize
): void {
  for (let i: i32 = 0; i < n; i++) {
    let sum: f64 = 0.0;
    const start = load<i32>(rowOffsetsPtr + ((i as usize) << 2));
    const end = load<i32>(rowOffsetsPtr + (((i + 1) as usize) << 2));
    for (let p: i32 = start; p < end; p++) {
      const col = load<i32>(colIndicesPtr + ((p as usize) << 2));
      const val = load<f64>(valuesPtr + ((p as usize) << 3));
      const xVal = load<f64>(xPtr + ((col as usize) << 3));
      sum += val * xVal;
    }
    store<f64>(yPtr + ((i as usize) << 3), sum);
  }
}

@inline
function dotProductWasm(aPtr: usize, bPtr: usize, n: i32): f64 {
  let sum: f64 = 0.0;
  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    sum += load<f64>(aPtr + off) * load<f64>(bPtr + off);
  }
  return sum;
}

/**
 * Solves A * x = b using Jacobi-Preconditioned Conjugate Gradient (PCG)
 * entirely in WebAssembly linear memory.
 * Returns the number of iterations performed.
 */
export function fea_solve_csr_pcg(
  n: i32,
  rowOffsetsPtr: usize,
  colIndicesPtr: usize,
  valuesPtr: usize,
  diagInvPtr: usize,
  bPtr: usize,
  xPtr: usize,
  rPtr: usize,
  zPtr: usize,
  pPtr: usize,
  apPtr: usize,
  tol: f64,
  maxIters: i32
): i32 {
  // r = b - A * x
  fea_spmv_csr(n, rowOffsetsPtr, colIndicesPtr, valuesPtr, xPtr, apPtr);
  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    const ri = load<f64>(bPtr + off) - load<f64>(apPtr + off);
    const zi = ri * load<f64>(diagInvPtr + off);
    store<f64>(rPtr + off, ri);
    store<f64>(zPtr + off, zi);
    store<f64>(pPtr + off, zi);
  }

  let rzOld = dotProductWasm(rPtr, zPtr, n);
  const initialResidual = Math.sqrt(Math.max(0.0, rzOld));
  const refNorm = Math.max(initialResidual, 1e-30);
  if (initialResidual < 1e-18) {
    return 0;
  }

  let itersDone: i32 = 0;
  for (let iter: i32 = 0; iter < maxIters; iter++) {
    itersDone = iter + 1;
    fea_spmv_csr(n, rowOffsetsPtr, colIndicesPtr, valuesPtr, pPtr, apPtr);
    const pAp = dotProductWasm(pPtr, apPtr, n);
    if (Math.abs(pAp) < 1e-24) {
      break;
    }

    const alpha = rzOld / pAp;
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      const xi = load<f64>(xPtr + off) + alpha * load<f64>(pPtr + off);
      const ri = load<f64>(rPtr + off) - alpha * load<f64>(apPtr + off);
      const zi = ri * load<f64>(diagInvPtr + off);
      store<f64>(xPtr + off, xi);
      store<f64>(rPtr + off, ri);
      store<f64>(zPtr + off, zi);
    }

    const rzNew = dotProductWasm(rPtr, zPtr, n);
    if (Math.sqrt(Math.max(0.0, rzNew)) / refNorm < tol) {
      break;
    }

    const beta = rzNew / rzOld;
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(pPtr + off, load<f64>(zPtr + off) + beta * load<f64>(pPtr + off));
    }
    rzOld = rzNew;
  }

  return itersDone;
}

/**
 * Batch-evaluates Tet4 element and nodal von Mises stresses in linear memory.
 * Returns the maximum element von Mises stress.
 */
export function fea_compute_tet4_von_mises(
  numElements: i32,
  numNodes: i32,
  elementsPtr: usize,
  bAllPtr: usize,
  dPtr: usize,
  uPtr: usize,
  elemVmOutPtr: usize,
  nodalVmOutPtr: usize,
  nodeCountsPtr: usize
): f64 {
  for (let i: i32 = 0; i < numNodes; i++) {
    store<f32>(nodalVmOutPtr + ((i as usize) << 2), 0.0);
    store<u32>(nodeCountsPtr + ((i as usize) << 2), 0);
  }

  let maxStress: f64 = 0.0;

  for (let e: i32 = 0; e < numElements; e++) {
    const eBase = (e * 4) as usize;
    const n0 = load<i32>(elementsPtr + ((eBase + 0) << 2));
    const n1 = load<i32>(elementsPtr + ((eBase + 1) << 2));
    const n2 = load<i32>(elementsPtr + ((eBase + 2) << 2));
    const n3 = load<i32>(elementsPtr + ((eBase + 3) << 2));

    const bPtr = bAllPtr + (((e * 72) as usize) << 3);

    // Compute strain eps = B (6x12) * u_e (12x1)
    let eps0: f64 = 0.0,
      eps1: f64 = 0.0,
      eps2: f64 = 0.0,
      eps3: f64 = 0.0,
      eps4: f64 = 0.0,
      eps5: f64 = 0.0;

    for (let i: i32 = 0; i < 4; i++) {
      const ni = i == 0 ? n0 : i == 1 ? n1 : i == 2 ? n2 : n3;
      const ux = load<f64>(uPtr + (((ni * 3 + 0) as usize) << 3));
      const uy = load<f64>(uPtr + (((ni * 3 + 1) as usize) << 3));
      const uz = load<f64>(uPtr + (((ni * 3 + 2) as usize) << 3));
      const col = i * 3;

      eps0 += load<f64>(bPtr + (((0 * 12 + col + 0) as usize) << 3)) * ux;
      eps1 += load<f64>(bPtr + (((1 * 12 + col + 1) as usize) << 3)) * uy;
      eps2 += load<f64>(bPtr + (((2 * 12 + col + 2) as usize) << 3)) * uz;
      eps3 +=
        load<f64>(bPtr + (((3 * 12 + col + 0) as usize) << 3)) * ux +
        load<f64>(bPtr + (((3 * 12 + col + 1) as usize) << 3)) * uy;
      eps4 +=
        load<f64>(bPtr + (((4 * 12 + col + 1) as usize) << 3)) * uy +
        load<f64>(bPtr + (((4 * 12 + col + 2) as usize) << 3)) * uz;
      eps5 +=
        load<f64>(bPtr + (((5 * 12 + col + 0) as usize) << 3)) * ux +
        load<f64>(bPtr + (((5 * 12 + col + 2) as usize) << 3)) * uz;
    }

    // Stress sigma = D * eps
    const d00 = load<f64>(dPtr + 0);
    const d01 = load<f64>(dPtr + 8);
    const d33 = load<f64>(dPtr + (21 << 3));

    const sxx = d00 * eps0 + d01 * (eps1 + eps2);
    const syy = d00 * eps1 + d01 * (eps0 + eps2);
    const szz = d00 * eps2 + d01 * (eps0 + eps1);
    const sxy = d33 * eps3;
    const syz = d33 * eps4;
    const szx = d33 * eps5;

    const diff1 = sxx - syy;
    const diff2 = syy - szz;
    const diff3 = szz - sxx;
    const vm = Math.sqrt(
      0.5 * (diff1 * diff1 + diff2 * diff2 + diff3 * diff3) +
        3.0 * (sxy * sxy + syz * syz + szx * szx)
    );

    store<f32>(elemVmOutPtr + ((e as usize) << 2), <f32>vm);
    if (vm > maxStress) maxStress = vm;

    for (let i: i32 = 0; i < 4; i++) {
      const ni = (i == 0 ? n0 : i == 1 ? n1 : i == 2 ? n2 : n3) as usize;
      store<f32>(nodalVmOutPtr + (ni << 2), load<f32>(nodalVmOutPtr + (ni << 2)) + <f32>vm);
      store<u32>(nodeCountsPtr + (ni << 2), load<u32>(nodeCountsPtr + (ni << 2)) + 1);
    }
  }

  for (let i: i32 = 0; i < numNodes; i++) {
    const ni = i as usize;
    const cnt = load<u32>(nodeCountsPtr + (ni << 2));
    if (cnt > 0) {
      store<f32>(nodalVmOutPtr + (ni << 2), load<f32>(nodalVmOutPtr + (ni << 2)) / <f32>cnt);
    }
  }

  return maxStress;
}

const TET10_DNDR = new StaticArray<f64>(10);
const TET10_DNDS = new StaticArray<f64>(10);
const TET10_DNDT = new StaticArray<f64>(10);

/**
 * Computes the 30x30 element stiffness matrix K_e (`keOutPtr`, 900 f64s) and
 * 4x(6x30) Gauss-point strain-displacement matrices (`bGaussOutPtr`, 720 f64s)
 * for a 10-node quadratic tetrahedron (Tet10) using 4-point Gauss-Legendre quadrature.
 * `coordsPtr`: 30 f64s [x0,y0,z0, ..., x9,y9,z9], `dPtr`: 36 f64s (6x6 constitutive D).
 * Returns total element volume V (or 0.0 if degenerate/inverted at any Gauss point).
 */
export function fea_compute_tet10_stiffness(
  coordsPtr: usize,
  dPtr: usize,
  keOutPtr: usize,
  bGaussOutPtr: usize
): f64 {
  const ALPHA: f64 = 0.5854101966249685;
  const BETA: f64 = 0.1381966011250105;
  const WEIGHT: f64 = 1.0 / 24.0;

  for (let i: i32 = 0; i < 900; i++) {
    store<f64>(keOutPtr + ((i as usize) << 3), 0.0);
  }
  for (let i: i32 = 0; i < 720; i++) {
    store<f64>(bGaussOutPtr + ((i as usize) << 3), 0.0);
  }

  let totalVolume: f64 = 0.0;
  const dNdr = TET10_DNDR;
  const dNds = TET10_DNDS;
  const dNdt = TET10_DNDT;

  for (let q: i32 = 0; q < 4; q++) {
    const r: f64 = q == 0 ? ALPHA : BETA;
    const s: f64 = q == 1 ? ALPHA : BETA;
    const t: f64 = q == 2 ? ALPHA : BETA;
    const L1: f64 = 1.0 - r - s - t;
    const L2: f64 = r;
    const L3: f64 = s;
    const L4: f64 = t;

    // Corner node derivatives
    unchecked((dNdr[0] = 1.0 - 4.0 * L1));
    unchecked((dNds[0] = 1.0 - 4.0 * L1));
    unchecked((dNdt[0] = 1.0 - 4.0 * L1));

    unchecked((dNdr[1] = 4.0 * L2 - 1.0));
    unchecked((dNds[1] = 0.0));
    unchecked((dNdt[1] = 0.0));

    unchecked((dNdr[2] = 0.0));
    unchecked((dNds[2] = 4.0 * L3 - 1.0));
    unchecked((dNdt[2] = 0.0));

    unchecked((dNdr[3] = 0.0));
    unchecked((dNds[3] = 0.0));
    unchecked((dNdt[3] = 4.0 * L4 - 1.0));

    // Mid-edge node 4: (0-1) -> 4*L1*L2
    unchecked((dNdr[4] = 4.0 * (L1 - L2)));
    unchecked((dNds[4] = -4.0 * L2));
    unchecked((dNdt[4] = -4.0 * L2));

    // Mid-edge node 5: (1-2) -> 4*L2*L3
    unchecked((dNdr[5] = 4.0 * L3));
    unchecked((dNds[5] = 4.0 * L2));
    unchecked((dNdt[5] = 0.0));

    // Mid-edge node 6: (0-2) -> 4*L1*L3
    unchecked((dNdr[6] = -4.0 * L3));
    unchecked((dNds[6] = 4.0 * (L1 - L3)));
    unchecked((dNdt[6] = -4.0 * L3));

    // Mid-edge node 7: (0-3) -> 4*L1*L4
    unchecked((dNdr[7] = -4.0 * L4));
    unchecked((dNds[7] = -4.0 * L4));
    unchecked((dNdt[7] = 4.0 * (L1 - L4)));

    // Mid-edge node 8: (1-3) -> 4*L2*L4
    unchecked((dNdr[8] = 4.0 * L4));
    unchecked((dNds[8] = 0.0));
    unchecked((dNdt[8] = 4.0 * L2));

    // Mid-edge node 9: (2-3) -> 4*L3*L4
    unchecked((dNdr[9] = 0.0));
    unchecked((dNds[9] = 4.0 * L4));
    unchecked((dNdt[9] = 4.0 * L3));

    let j00: f64 = 0.0,
      j01: f64 = 0.0,
      j02: f64 = 0.0;
    let j10: f64 = 0.0,
      j11: f64 = 0.0,
      j12: f64 = 0.0;
    let j20: f64 = 0.0,
      j21: f64 = 0.0,
      j22: f64 = 0.0;

    for (let i: i32 = 0; i < 10; i++) {
      const cOff = ((i * 3) as usize) << 3;
      const xi = load<f64>(coordsPtr + cOff + 0);
      const yi = load<f64>(coordsPtr + cOff + 8);
      const zi = load<f64>(coordsPtr + cOff + 16);
      const dr = unchecked(dNdr[i]);
      const ds = unchecked(dNds[i]);
      const dt = unchecked(dNdt[i]);

      j00 += dr * xi;
      j01 += dr * yi;
      j02 += dr * zi;
      j10 += ds * xi;
      j11 += ds * yi;
      j12 += ds * zi;
      j20 += dt * xi;
      j21 += dt * yi;
      j22 += dt * zi;
    }

    const detJ =
      j00 * (j11 * j22 - j12 * j21) -
      j01 * (j10 * j22 - j12 * j20) +
      j02 * (j10 * j21 - j11 * j20);

    if (detJ <= 1e-18) {
      return 0.0;
    }

    const dV = detJ * WEIGHT;
    totalVolume += dV;

    const invDet = 1.0 / detJ;
    const invJ00 = (j11 * j22 - j12 * j21) * invDet;
    const invJ01 = (j02 * j21 - j01 * j22) * invDet;
    const invJ02 = (j01 * j12 - j02 * j11) * invDet;
    const invJ10 = (j12 * j20 - j10 * j22) * invDet;
    const invJ11 = (j00 * j22 - j02 * j20) * invDet;
    const invJ12 = (j02 * j10 - j00 * j12) * invDet;
    const invJ20 = (j10 * j21 - j11 * j20) * invDet;
    const invJ21 = (j01 * j20 - j00 * j21) * invDet;
    const invJ22 = (j00 * j11 - j01 * j10) * invDet;

    const bPtr = bGaussOutPtr + (((q * 180) as usize) << 3);

    for (let i: i32 = 0; i < 10; i++) {
      const dr = unchecked(dNdr[i]);
      const ds = unchecked(dNds[i]);
      const dt = unchecked(dNdt[i]);

      const dNdx = invJ00 * dr + invJ01 * ds + invJ02 * dt;
      const dNdy = invJ10 * dr + invJ11 * ds + invJ12 * dt;
      const dNdz = invJ20 * dr + invJ21 * ds + invJ22 * dt;
      const col = i * 3;

      store<f64>(bPtr + (((0 * 30 + col + 0) as usize) << 3), dNdx);
      store<f64>(bPtr + (((1 * 30 + col + 1) as usize) << 3), dNdy);
      store<f64>(bPtr + (((2 * 30 + col + 2) as usize) << 3), dNdz);

      store<f64>(bPtr + (((3 * 30 + col + 0) as usize) << 3), dNdy);
      store<f64>(bPtr + (((3 * 30 + col + 1) as usize) << 3), dNdx);

      store<f64>(bPtr + (((4 * 30 + col + 1) as usize) << 3), dNdz);
      store<f64>(bPtr + (((4 * 30 + col + 2) as usize) << 3), dNdy);

      store<f64>(bPtr + (((5 * 30 + col + 0) as usize) << 3), dNdz);
      store<f64>(bPtr + (((5 * 30 + col + 2) as usize) << 3), dNdx);
    }

    // Ke += dV * B^T (30x6) * D (6x6) * B (6x30)
    for (let a: i32 = 0; a < 30; a++) {
      for (let b: i32 = a; b < 30; b++) {
        let sum: f64 = 0.0;
        for (let rIdx: i32 = 0; rIdx < 6; rIdx++) {
          const bar = load<f64>(bPtr + (((rIdx * 30 + a) as usize) << 3));
          if (bar == 0.0) continue;
          let db: f64 = 0.0;
          for (let cIdx: i32 = 0; cIdx < 6; cIdx++) {
            const bcb = load<f64>(bPtr + (((cIdx * 30 + b) as usize) << 3));
            if (bcb == 0.0) continue;
            db += load<f64>(dPtr + (((rIdx * 6 + cIdx) as usize) << 3)) * bcb;
          }
          sum += bar * db;
        }
        const contrib = dV * sum;
        const abOff = ((a * 30 + b) as usize) << 3;
        store<f64>(keOutPtr + abOff, load<f64>(keOutPtr + abOff) + contrib);
        if (a != b) {
          const baOff = ((b * 30 + a) as usize) << 3;
          store<f64>(keOutPtr + baOff, load<f64>(keOutPtr + baOff) + contrib);
        }
      }
    }
  }

  return totalVolume;
}

@inline
function invert3x3Wasm(
  a00: f64,
  a01: f64,
  a02: f64,
  a10: f64,
  a11: f64,
  a12: f64,
  a20: f64,
  a21: f64,
  a22: f64,
  outPtr: usize
): bool {
  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-18) return false;
  const inv = 1.0 / det;
  store<f64>(outPtr + 0, (a11 * a22 - a12 * a21) * inv);
  store<f64>(outPtr + 8, (a02 * a21 - a01 * a22) * inv);
  store<f64>(outPtr + 16, (a01 * a12 - a02 * a11) * inv);
  store<f64>(outPtr + 24, (a12 * a20 - a10 * a22) * inv);
  store<f64>(outPtr + 32, (a00 * a22 - a02 * a20) * inv);
  store<f64>(outPtr + 40, (a02 * a10 - a00 * a12) * inv);
  store<f64>(outPtr + 48, (a10 * a21 - a11 * a20) * inv);
  store<f64>(outPtr + 56, (a01 * a20 - a00 * a21) * inv);
  store<f64>(outPtr + 64, (a00 * a11 - a01 * a10) * inv);
  return true;
}

/**
 * Extracts the 3x3 corotational rotation matrix R (`rOutPtr`, 9 f64s) from reference
 * corner coordinates `coordsPtr` (at least 12 f64s) and nodal displacements `uElemPtr`
 * (at least 12 f64s) via deformation gradient F = ds * dX^-1 and 6-step Higham polar decomposition.
 */
export function fea_compute_corotational_rotation(
  coordsPtr: usize,
  uElemPtr: usize,
  rOutPtr: usize
): void {
  const X0x = load<f64>(coordsPtr + 0),
    X0y = load<f64>(coordsPtr + 8),
    X0z = load<f64>(coordsPtr + 16);
  const X1x = load<f64>(coordsPtr + 24),
    X1y = load<f64>(coordsPtr + 32),
    X1z = load<f64>(coordsPtr + 40);
  const X2x = load<f64>(coordsPtr + 48),
    X2y = load<f64>(coordsPtr + 56),
    X2z = load<f64>(coordsPtr + 64);
  const X3x = load<f64>(coordsPtr + 72),
    X3y = load<f64>(coordsPtr + 80),
    X3z = load<f64>(coordsPtr + 88);

  const x0x = X0x + load<f64>(uElemPtr + 0),
    x0y = X0y + load<f64>(uElemPtr + 8),
    x0z = X0z + load<f64>(uElemPtr + 16);
  const x1x = X1x + load<f64>(uElemPtr + 24),
    x1y = X1y + load<f64>(uElemPtr + 32),
    x1z = X1z + load<f64>(uElemPtr + 40);
  const x2x = X2x + load<f64>(uElemPtr + 48),
    x2y = X2y + load<f64>(uElemPtr + 56),
    x2z = X2z + load<f64>(uElemPtr + 64);
  const x3x = X3x + load<f64>(uElemPtr + 72),
    x3y = X3y + load<f64>(uElemPtr + 80),
    x3z = X3z + load<f64>(uElemPtr + 88);

  // dX columns
  const dX00 = X1x - X0x,
    dX01 = X2x - X0x,
    dX02 = X3x - X0x;
  const dX10 = X1y - X0y,
    dX11 = X2y - X0y,
    dX12 = X3y - X0y;
  const dX20 = X1z - X0z,
    dX21 = X2z - X0z,
    dX22 = X3z - X0z;

  // Compute inv(dX) into rOutPtr temporarily
  if (!invert3x3Wasm(dX00, dX01, dX02, dX10, dX11, dX12, dX20, dX21, dX22, rOutPtr)) {
    store<f64>(rOutPtr + 0, 1.0);
    store<f64>(rOutPtr + 8, 0.0);
    store<f64>(rOutPtr + 16, 0.0);
    store<f64>(rOutPtr + 24, 0.0);
    store<f64>(rOutPtr + 32, 1.0);
    store<f64>(rOutPtr + 40, 0.0);
    store<f64>(rOutPtr + 48, 0.0);
    store<f64>(rOutPtr + 56, 0.0);
    store<f64>(rOutPtr + 64, 1.0);
    return;
  }

  const i00 = load<f64>(rOutPtr + 0),
    i01 = load<f64>(rOutPtr + 8),
    i02 = load<f64>(rOutPtr + 16);
  const i10 = load<f64>(rOutPtr + 24),
    i11 = load<f64>(rOutPtr + 32),
    i12 = load<f64>(rOutPtr + 40);
  const i20 = load<f64>(rOutPtr + 48),
    i21 = load<f64>(rOutPtr + 56),
    i22 = load<f64>(rOutPtr + 64);

  const ds00 = x1x - x0x,
    ds01 = x2x - x0x,
    ds02 = x3x - x0x;
  const ds10 = x1y - x0y,
    ds11 = x2y - x0y,
    ds12 = x3y - x0y;
  const ds20 = x1z - x0z,
    ds21 = x2z - x0z,
    ds22 = x3z - x0z;

  // F = ds * inv(dX)
  let r00 = ds00 * i00 + ds01 * i10 + ds02 * i20;
  let r01 = ds00 * i01 + ds01 * i11 + ds02 * i21;
  let r02 = ds00 * i02 + ds01 * i12 + ds02 * i22;
  let r10 = ds10 * i00 + ds11 * i10 + ds12 * i20;
  let r11 = ds10 * i01 + ds11 * i11 + ds12 * i21;
  let r12 = ds10 * i02 + ds11 * i12 + ds12 * i22;
  let r20 = ds20 * i00 + ds21 * i10 + ds22 * i20;
  let r21 = ds20 * i01 + ds21 * i11 + ds22 * i21;
  let r22 = ds20 * i02 + ds21 * i12 + ds22 * i22;

  // 6-step Higham polar iteration: R_{k+1} = 0.5 * (R_k + R_k^{-T})
  for (let iter: i32 = 0; iter < 6; iter++) {
    if (!invert3x3Wasm(r00, r01, r02, r10, r11, r12, r20, r21, r22, rOutPtr)) {
      break;
    }
    const inv00 = load<f64>(rOutPtr + 0),
      inv01 = load<f64>(rOutPtr + 8),
      inv02 = load<f64>(rOutPtr + 16);
    const inv10 = load<f64>(rOutPtr + 24),
      inv11 = load<f64>(rOutPtr + 32),
      inv12 = load<f64>(rOutPtr + 40);
    const inv20 = load<f64>(rOutPtr + 48),
      inv21 = load<f64>(rOutPtr + 56),
      inv22 = load<f64>(rOutPtr + 64);

    r00 = 0.5 * (r00 + inv00);
    r01 = 0.5 * (r01 + inv10);
    r02 = 0.5 * (r02 + inv20);
    r10 = 0.5 * (r10 + inv01);
    r11 = 0.5 * (r11 + inv11);
    r12 = 0.5 * (r12 + inv21);
    r20 = 0.5 * (r20 + inv02);
    r21 = 0.5 * (r21 + inv12);
    r22 = 0.5 * (r22 + inv22);
  }

  store<f64>(rOutPtr + 0, r00);
  store<f64>(rOutPtr + 8, r01);
  store<f64>(rOutPtr + 16, r02);
  store<f64>(rOutPtr + 24, r10);
  store<f64>(rOutPtr + 32, r11);
  store<f64>(rOutPtr + 40, r12);
  store<f64>(rOutPtr + 48, r20);
  store<f64>(rOutPtr + 56, r21);
  store<f64>(rOutPtr + 64, r22);
}

/**
 * Rotates an element stiffness matrix `keBasePtr` ((3*npe)x(3*npe)) by a 3x3 block-diagonal
 * rotation matrix `rPtr` (9 f64s): K_rot = T * K_base * T^T, writing to `keRotOutPtr`.
 */
export function fea_rotate_element_stiffness(
  npe: i32,
  keBasePtr: usize,
  rPtr: usize,
  keRotOutPtr: usize
): void {
  const dim = npe * 3;
  for (let i: i32 = 0; i < npe; i++) {
    for (let j: i32 = 0; j < npe; j++) {
      // Compute 3x3 block (i,j): R * K_ij * R^T
      // First tmp = R * K_ij
      for (let a: i32 = 0; a < 3; a++) {
        const ra0 = load<f64>(rPtr + (((a * 3 + 0) as usize) << 3));
        const ra1 = load<f64>(rPtr + (((a * 3 + 1) as usize) << 3));
        const ra2 = load<f64>(rPtr + (((a * 3 + 2) as usize) << 3));

        const r0 = (i * 3 + 0) * dim + j * 3;
        const r1 = (i * 3 + 1) * dim + j * 3;
        const r2 = (i * 3 + 2) * dim + j * 3;

        const t0 =
          ra0 * load<f64>(keBasePtr + (((r0 + 0) as usize) << 3)) +
          ra1 * load<f64>(keBasePtr + (((r1 + 0) as usize) << 3)) +
          ra2 * load<f64>(keBasePtr + (((r2 + 0) as usize) << 3));
        const t1 =
          ra0 * load<f64>(keBasePtr + (((r0 + 1) as usize) << 3)) +
          ra1 * load<f64>(keBasePtr + (((r1 + 1) as usize) << 3)) +
          ra2 * load<f64>(keBasePtr + (((r2 + 1) as usize) << 3));
        const t2 =
          ra0 * load<f64>(keBasePtr + (((r0 + 2) as usize) << 3)) +
          ra1 * load<f64>(keBasePtr + (((r1 + 2) as usize) << 3)) +
          ra2 * load<f64>(keBasePtr + (((r2 + 2) as usize) << 3));

        for (let b: i32 = 0; b < 3; b++) {
          const rb0 = load<f64>(rPtr + (((b * 3 + 0) as usize) << 3));
          const rb1 = load<f64>(rPtr + (((b * 3 + 1) as usize) << 3));
          const rb2 = load<f64>(rPtr + (((b * 3 + 2) as usize) << 3));
          const outIdx = ((i * 3 + a) * dim + (j * 3 + b)) as usize;
          store<f64>(keRotOutPtr + (outIdx << 3), t0 * rb0 + t1 * rb1 + t2 * rb2);
        }
      }
    }
  }
}

/**
 * Computes Newmark-beta effective predictor vectors wM and wK in linear memory
 * prior to multiplying by M and K.
 */
export function fea_newmark_beta_predict_rhs(
  numDofs: i32,
  fixedMaskPtr: usize,
  uPtr: usize,
  vPtr: usize,
  aPtr: usize,
  wMPtr: usize,
  wKPtr: usize,
  a0: f64,
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
  a5: f64,
  alphaM: f64,
  betaK: f64
): void {
  for (let d: i32 = 0; d < numDofs; d++) {
    const off = (d as usize) << 3;
    if (load<u8>(fixedMaskPtr + (d as usize)) != 0) {
      store<f64>(wMPtr + off, 0.0);
      store<f64>(wKPtr + off, 0.0);
    } else {
      const ud = load<f64>(uPtr + off);
      const vd = load<f64>(vPtr + off);
      const ad = load<f64>(aPtr + off);
      store<f64>(
        wMPtr + off,
        (a0 + alphaM * a1) * ud + (a2 + alphaM * a4) * vd + (a3 + alphaM * a5) * ad
      );
      store<f64>(wKPtr + off, betaK * (a1 * ud + a4 * vd + a5 * ad));
    }
  }
}

/**
 * Updates Newmark-beta displacement `uOldPtr <- uNewPtr`, velocity `vPtr`,
 * and acceleration `aPtr` vectors in linear memory after solving for `uNewPtr`.
 */
export function fea_newmark_beta_update_kinematics(
  numDofs: i32,
  fixedMaskPtr: usize,
  uOldPtr: usize,
  uNewPtr: usize,
  vPtr: usize,
  aPtr: usize,
  a0: f64,
  a2: f64,
  a3: f64,
  a6: f64,
  a7: f64
): void {
  for (let d: i32 = 0; d < numDofs; d++) {
    const off = (d as usize) << 3;
    if (load<u8>(fixedMaskPtr + (d as usize)) != 0) {
      store<f64>(uNewPtr + off, 0.0);
      store<f64>(uOldPtr + off, 0.0);
      store<f64>(vPtr + off, 0.0);
      store<f64>(aPtr + off, 0.0);
    } else {
      const uOld = load<f64>(uOldPtr + off);
      const uNew = load<f64>(uNewPtr + off);
      const vOld = load<f64>(vPtr + off);
      const aOld = load<f64>(aPtr + off);
      const aNew = a0 * (uNew - uOld) - a2 * vOld - a3 * aOld;
      const vNew = vOld + a6 * aOld + a7 * aNew;
      store<f64>(uOldPtr + off, uNew);
      store<f64>(vPtr + off, vNew);
      store<f64>(aPtr + off, aNew);
    }
  }
}

@inline
function dist3Wasm(ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64): f64 {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

@inline
function crossMagWasm(
  ax: f64,
  ay: f64,
  az: f64,
  bx: f64,
  by: f64,
  bz: f64,
  cx: f64,
  cy: f64,
  cz: f64
): f64 {
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az;
  const vx = cx - ax,
    vy = cy - ay,
    vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.sqrt(nx * nx + ny * ny + nz * nz);
}

/**
 * Evaluates scaled Jacobian and aspect ratio quality metrics for `numElements`
 * tetrahedral elements (`nodesPerElement` = 4 or 10) in linear memory.
 * Writes `jacobiansOutPtr` (f64[numElements]), `aspectRatiosOutPtr` (f64[numElements]),
 * and `statsOutPtr` (f64[6]: [minJ, maxJ, avgJ, minAR, maxAR, avgAR]).
 * Returns `numInverted` (count of elements with J <= 0).
 */
export function fea_analyze_tet_mesh_quality(
  numElements: i32,
  nodesPerElement: i32,
  nodeCoordsPtr: usize,
  elementsPtr: usize,
  jacobiansOutPtr: usize,
  aspectRatiosOutPtr: usize,
  statsOutPtr: usize
): i32 {
  if (numElements <= 0) {
    for (let i: i32 = 0; i < 6; i++) store<f64>(statsOutPtr + ((i as usize) << 3), 0.0);
    return 0;
  }

  let minJ: f64 = 1e30;
  let maxJ: f64 = -1e30;
  let sumJ: f64 = 0.0;
  let minAR: f64 = 1e30;
  let maxAR: f64 = -1e30;
  let sumAR: f64 = 0.0;
  let numInverted: i32 = 0;
  const sqrt2: f64 = 1.4142135623730951;
  const sqrt6: f64 = 2.449489742783178;

  for (let e: i32 = 0; e < numElements; e++) {
    const base = (e * nodesPerElement) as usize;
    const i0 = load<i32>(elementsPtr + ((base + 0) << 2)) as usize;
    const i1 = load<i32>(elementsPtr + ((base + 1) << 2)) as usize;
    const i2 = load<i32>(elementsPtr + ((base + 2) << 2)) as usize;
    const i3 = load<i32>(elementsPtr + ((base + 3) << 2)) as usize;

    const p0x = load<f64>(nodeCoordsPtr + ((i0 * 3 + 0) << 3));
    const p0y = load<f64>(nodeCoordsPtr + ((i0 * 3 + 1) << 3));
    const p0z = load<f64>(nodeCoordsPtr + ((i0 * 3 + 2) << 3));

    const p1x = load<f64>(nodeCoordsPtr + ((i1 * 3 + 0) << 3));
    const p1y = load<f64>(nodeCoordsPtr + ((i1 * 3 + 1) << 3));
    const p1z = load<f64>(nodeCoordsPtr + ((i1 * 3 + 2) << 3));

    const p2x = load<f64>(nodeCoordsPtr + ((i2 * 3 + 0) << 3));
    const p2y = load<f64>(nodeCoordsPtr + ((i2 * 3 + 1) << 3));
    const p2z = load<f64>(nodeCoordsPtr + ((i2 * 3 + 2) << 3));

    const p3x = load<f64>(nodeCoordsPtr + ((i3 * 3 + 0) << 3));
    const p3y = load<f64>(nodeCoordsPtr + ((i3 * 3 + 1) << 3));
    const p3z = load<f64>(nodeCoordsPtr + ((i3 * 3 + 2) << 3));

    const e01x = p1x - p0x,
      e01y = p1y - p0y,
      e01z = p1z - p0z;
    const e02x = p2x - p0x,
      e02y = p2y - p0y,
      e02z = p2z - p0z;
    const e03x = p3x - p0x,
      e03y = p3y - p0y,
      e03z = p3z - p0z;

    const detJ =
      e01x * (e02y * e03z - e02z * e03y) -
      e01y * (e02x * e03z - e02z * e03x) +
      e01z * (e02x * e03y - e02y * e03x);

    const l01 = dist3Wasm(p0x, p0y, p0z, p1x, p1y, p1z);
    const l02 = dist3Wasm(p0x, p0y, p0z, p2x, p2y, p2z);
    const l03 = dist3Wasm(p0x, p0y, p0z, p3x, p3y, p3z);
    const l12 = dist3Wasm(p1x, p1y, p1z, p2x, p2y, p2z);
    const l13 = dist3Wasm(p1x, p1y, p1z, p3x, p3y, p3z);
    const l23 = dist3Wasm(p2x, p2y, p2z, p3x, p3y, p3z);

    let lMax = l01;
    if (l02 > lMax) lMax = l02;
    if (l03 > lMax) lMax = l03;
    if (l12 > lMax) lMax = l12;
    if (l13 > lMax) lMax = l13;
    if (l23 > lMax) lMax = l23;

    let lMin = l01;
    if (l02 < lMin) lMin = l02;
    if (l03 < lMin) lMin = l03;
    if (l12 < lMin) lMin = l12;
    if (l13 < lMin) lMin = l13;
    if (l23 < lMin) lMin = l23;
    if (lMin < 1e-12) lMin = 1e-12;

    const d0 = l01 * l02 * l03;
    const d1 = l01 * l12 * l13;
    const d2 = l02 * l12 * l23;
    const d3 = l03 * l13 * l23;
    let denom = d0;
    if (d1 > denom) denom = d1;
    if (d2 > denom) denom = d2;
    if (d3 > denom) denom = d3;
    let scaledJ = denom > 1e-15 ? (sqrt2 * detJ) / denom : 0.0;
    if (scaledJ > 1.0) scaledJ = 1.0;
    if (scaledJ < -1.0) scaledJ = -1.0;
    if (scaledJ <= 0.0) numInverted++;

    const ar = lMax / lMin;

    const eOff = (e as usize) << 3;
    store<f64>(jacobiansOutPtr + eOff, scaledJ);
    store<f64>(aspectRatiosOutPtr + eOff, ar);

    if (scaledJ < minJ) minJ = scaledJ;
    if (scaledJ > maxJ) maxJ = scaledJ;
    sumJ += scaledJ;

    if (ar < minAR) minAR = ar;
    if (ar > maxAR) maxAR = ar;
    sumAR += ar;
  }

  const invN = 1.0 / <f64>numElements;
  store<f64>(statsOutPtr + 0, minJ);
  store<f64>(statsOutPtr + 8, maxJ);
  store<f64>(statsOutPtr + 16, sumJ * invN);
  store<f64>(statsOutPtr + 24, minAR);
  store<f64>(statsOutPtr + 32, maxAR);
  store<f64>(statsOutPtr + 40, sumAR * invN);

  return numInverted;
}

