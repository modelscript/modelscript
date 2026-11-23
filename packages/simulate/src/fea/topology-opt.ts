// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — SIMP Structural Topology Optimization (Sigmund 2001).
 *
 * Minimizes structural compliance c(x) = U^T K(x) U subject to a volume fraction constraint
 * over a structured Q4 plane-stress mesh using:
 *   - Penalized Young's modulus E(x_e) = E_min + x_e^p * (E0 - E_min)
 *   - Mesh-independent sensitivity filtering (radius rmin)
 *   - Optimality Criteria (OC) density update with bisection Lagrange multiplier
 */

import { solveDenseLinear } from "@modelscript/runtime";

export interface SimpOptions {
  readonly nelx: number;
  readonly nely: number;
  readonly volumeFraction: number;
  readonly penalization?: number | undefined;
  readonly rmin?: number | undefined;
  readonly maxIterations?: number | undefined;
  readonly E0?: number | undefined;
  readonly Emin?: number | undefined;
  readonly nu?: number | undefined;
}

export interface SimpResult {
  /** Element densities [nelx * nely] in (0, 1]. */
  readonly densities: Float64Array;
  readonly compliance: number;
  readonly complianceHistory: number[];
  readonly volumeFractionAchieved: number;
  readonly iterations: number;
}

/** Unit-square 8x8 Q4 plane-stress element stiffness matrix. */
function q4ElementStiffness(nu: number): Float64Array {
  const k = [
    1 / 2 - nu / 6,
    1 / 8 + nu / 8,
    -1 / 4 - nu / 12,
    -1 / 8 + (3 * nu) / 8,
    -1 / 4 + nu / 12,
    -1 / 8 - nu / 8,
    nu / 6,
    1 / 8 - (3 * nu) / 8,
  ];
  const idx = [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [1, 0, 7, 6, 5, 4, 3, 2],
    [2, 7, 0, 5, 6, 3, 4, 1],
    [3, 6, 5, 0, 7, 2, 1, 4],
    [4, 5, 6, 7, 0, 1, 2, 3],
    [5, 4, 3, 2, 1, 0, 7, 6],
    [6, 3, 4, 1, 2, 7, 0, 5],
    [7, 2, 1, 4, 3, 6, 5, 0],
  ];
  const scale = 1.0 / (1.0 - nu * nu);
  const KE = new Float64Array(64);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      KE[i * 8 + j] = scale * k[idx[i]![j]!]!;
    }
  }
  return KE;
}

/**
 * Runs 2D SIMP Topology Optimization on a classic cantilever beam
 * (left edge clamped, downward point load at bottom-right tip).
 */
export function runSimpTopologyOptimization(opts: SimpOptions): SimpResult {
  const { nelx, nely, volumeFraction } = opts;
  const penal = opts.penalization ?? 3.0;
  const rmin = opts.rmin ?? 1.5;
  const maxIter = opts.maxIterations ?? 20;
  const E0 = opts.E0 ?? 1.0;
  const Emin = opts.Emin ?? 1e-6;
  const nu = opts.nu ?? 0.3;

  const numElems = nelx * nely;
  const x = new Float64Array(numElems).fill(volumeFraction);
  const dc = new Float64Array(numElems);
  const dcn = new Float64Array(numElems);
  const KE = q4ElementStiffness(nu);

  const ndof = 2 * (nelx + 1) * (nely + 1);
  const fixedDof = new Uint8Array(ndof);
  // Clamp left edge (node col 0, all rows)
  for (let ey = 0; ey <= nely; ey++) {
    fixedDof[2 * ey] = 1;
    fixedDof[2 * ey + 1] = 1;
  }
  const freeMap: number[] = [];
  const dofToFree = new Int32Array(ndof).fill(-1);
  for (let d = 0; d < ndof; d++) {
    if (!fixedDof[d]) {
      dofToFree[d] = freeMap.length;
      freeMap.push(d);
    }
  }
  const nfree = freeMap.length;

  // Point load at bottom-right corner (vertical y-DOF)
  const loadNode = nelx * (nely + 1) + nely;
  const loadDof = 2 * loadNode + 1;
  const Ffree = new Float64Array(nfree);
  if (dofToFree[loadDof]! >= 0) Ffree[dofToFree[loadDof]!] = -1.0;

  const elemDofs = (ex: number, ey: number): Int32Array => {
    const n1 = ex * (nely + 1) + ey;
    const n2 = (ex + 1) * (nely + 1) + ey;
    return Int32Array.from([2 * n1, 2 * n1 + 1, 2 * n2, 2 * n2 + 1, 2 * n2 + 2, 2 * n2 + 3, 2 * n1 + 2, 2 * n1 + 3]);
  };

  const complianceHistory: number[] = [];
  let compliance = Infinity;
  let iter = 0;

  for (; iter < maxIter; iter++) {
    // Assemble global free stiffness matrix Kfree
    const Kfree = new Float64Array(nfree * nfree);
    for (let ex = 0; ex < nelx; ex++) {
      for (let ey = 0; ey < nely; ey++) {
        const xe = x[ex * nely + ey]!;
        const Ee = Emin + Math.pow(xe, penal) * (E0 - Emin);
        const dofs = elemDofs(ex, ey);
        for (let i = 0; i < 8; i++) {
          const fi = dofToFree[dofs[i]!]!;
          if (fi < 0) continue;
          for (let j = 0; j < 8; j++) {
            const fj = dofToFree[dofs[j]!]!;
            if (fj < 0) continue;
            Kfree[fi * nfree + fj] = Kfree[fi * nfree + fj]! + Ee * KE[i * 8 + j]!;
          }
        }
      }
    }

    const Ufree = solveDenseLinear(Kfree, Ffree, nfree);
    const U = new Float64Array(ndof);
    for (let i = 0; i < nfree; i++) U[freeMap[i]!] = Ufree[i]!;

    // Compute compliance & sensitivities dc
    compliance = 0;
    for (let ex = 0; ex < nelx; ex++) {
      for (let ey = 0; ey < nely; ey++) {
        const dofs = elemDofs(ex, ey);
        let ce = 0;
        for (let i = 0; i < 8; i++) {
          const ui = U[dofs[i]!]!;
          for (let j = 0; j < 8; j++) {
            ce += ui * KE[i * 8 + j]! * U[dofs[j]!]!;
          }
        }
        const eIdx = ex * nely + ey;
        const xe = x[eIdx]!;
        compliance += (Emin + Math.pow(xe, penal) * (E0 - Emin)) * ce;
        dc[eIdx] = -penal * Math.pow(xe, penal - 1) * (E0 - Emin) * ce;
      }
    }
    complianceHistory.push(compliance);

    // Sensitivity filtering
    const rCeil = Math.ceil(rmin);
    for (let ex = 0; ex < nelx; ex++) {
      for (let ey = 0; ey < nely; ey++) {
        let sumW = 0;
        let sumVal = 0;
        const iMin = Math.max(0, ex - rCeil);
        const iMax = Math.min(nelx - 1, ex + rCeil);
        const jMin = Math.max(0, ey - rCeil);
        const jMax = Math.min(nely - 1, ey + rCeil);
        for (let ix = iMin; ix <= iMax; ix++) {
          for (let iy = jMin; iy <= jMax; iy++) {
            const fac = rmin - Math.hypot(ex - ix, ey - iy);
            if (fac > 0) {
              const nIdx = ix * nely + iy;
              sumW += fac;
              sumVal += fac * x[nIdx]! * dc[nIdx]!;
            }
          }
        }
        const eIdx = ex * nely + ey;
        dcn[eIdx] = sumVal / Math.max(1e-12, x[eIdx]! * sumW);
      }
    }

    // Optimality Criteria (OC) update via bisection on Lagrange multiplier
    let l1 = 0;
    let l2 = 1e6;
    const move = 0.2;
    const xNew = new Float64Array(numElems);
    while ((l2 - l1) / (l1 + l2 + 1e-12) > 1e-4) {
      const lmid = 0.5 * (l1 + l2);
      let volSum = 0;
      for (let e = 0; e < numElems; e++) {
        const xe = x[e]!;
        const Be = Math.sqrt(Math.max(0, -dcn[e]! / Math.max(1e-15, lmid)));
        const cand = Math.max(0.001, Math.max(xe - move, Math.min(1.0, Math.min(xe + move, xe * Be))));
        xNew[e] = cand;
        volSum += cand;
      }
      if (volSum - volumeFraction * numElems > 0) l1 = lmid;
      else l2 = lmid;
    }

    let maxChange = 0;
    for (let e = 0; e < numElems; e++) {
      const ch = Math.abs(xNew[e]! - x[e]!);
      if (ch > maxChange) maxChange = ch;
      x[e] = xNew[e]!;
    }
    if (maxChange < 1e-2) {
      iter++;
      break;
    }
  }

  let vol = 0;
  for (let e = 0; e < numElems; e++) vol += x[e]!;
  return {
    densities: x,
    compliance,
    complianceHistory,
    volumeFractionAchieved: vol / numElems,
    iterations: iter,
  };
}
