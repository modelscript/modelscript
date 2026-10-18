// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Hamilton-Jacobi-Isaacs (HJI) Adversarial Reachability Solver.
 *
 * Implements:
 *   - Backward Reachable Tube (BRT) computation for zero-sum differential games:
 *       \partial_t V + min_{u \in U} max_{w \in W} (\nabla V^T f(x, u, w)) = 0
 *   - 5th-order WENO (Weighted Essentially Non-Oscillatory) spatial derivative approximations.
 *   - Lax-Friedrichs numerical Hamiltonian dissipative flux.
 *   - Total Variation Diminishing Runge-Kutta (TVD-RK3) time stepping.
 */

export interface HjiProblem {
  /** 1D or 2D grid bounds [xMin, xMax] for each axis */
  bounds: [number, number][];
  /** Grid resolution per axis (e.g. [51, 51]) */
  gridPoints: number[];
  /** Vector field: dx/dt = f(x, u, w) */
  f: (x: number[], u: number, w: number) => number[];
  /** Control input bounds [uMin, uMax] */
  controlBounds: [number, number];
  /** Disturbance input bounds [wMin, wMax] */
  disturbanceBounds: [number, number];
  /** Target / Unsafe surface level-set function: l(x) <= 0 is unsafe */
  targetLevelSet: (x: number[]) => number;
  /** Optional initial state x0 to check against the final backward reachable tube */
  initialState?: number[] | undefined;
  /** Optional initial set level-set function: l0(x) <= 0 is inside the initial set */
  initialLevelSet?: ((x: number[]) => number) | undefined;
}

export interface HjiResult {
  isSafe: boolean;
  times: number[];
  /** Grid values V(x, t) at final time */
  finalLevelSet: Float64Array;
  gridPoints: number[];
  unsafeVolumeFraction: number;
  summary: string;
}

export class HjiLevelSetSolver {
  private static weno5Combine(v1: number, v2: number, v3: number, v4: number, v5: number): number {
    const phi1 = v1 / 3.0 - (7.0 * v2) / 6.0 + (11.0 * v3) / 6.0;
    const phi2 = -v2 / 6.0 + (5.0 * v3) / 6.0 + v4 / 3.0;
    const phi3 = v3 / 3.0 + (5.0 * v4) / 6.0 - v5 / 6.0;

    const s1 =
      (13.0 / 12.0) * (v1 - 2.0 * v2 + v3) * (v1 - 2.0 * v2 + v3) +
      0.25 * (v1 - 4.0 * v2 + 3.0 * v3) * (v1 - 4.0 * v2 + 3.0 * v3);
    const s2 = (13.0 / 12.0) * (v2 - 2.0 * v3 + v4) * (v2 - 2.0 * v3 + v4) + 0.25 * (v2 - v4) * (v2 - v4);
    const s3 =
      (13.0 / 12.0) * (v3 - 2.0 * v4 + v5) * (v3 - 2.0 * v4 + v5) +
      0.25 * (3.0 * v3 - 4.0 * v4 + v5) * (3.0 * v3 - 4.0 * v4 + v5);

    const eps = 1e-6;
    const a1 = 0.1 / ((eps + s1) * (eps + s1));
    const a2 = 0.6 / ((eps + s2) * (eps + s2));
    const a3 = 0.3 / ((eps + s3) * (eps + s3));
    const aSum = a1 + a2 + a3;

    return (a1 * phi1 + a2 * phi2 + a3 * phi3) / aSum;
  }

  /**
   * Computes spatial derivatives using 5th-order WENO upwind discretization.
   */
  public static weno5Derivatives(
    v: Float64Array,
    idx: number,
    stride: number,
    dx: number,
    numPts: number,
  ): { derivMinus: number; derivPlus: number } {
    // Coordinate along this axis (clamped within [0, numPts - 1] so rows/columns never wrap)
    const coord = numPts > 0 && stride > 0 ? Math.floor(idx / stride) % numPts : 0;
    const getVal = (offset: number) => {
      const clampedCoord = Math.max(0, Math.min(numPts - 1, coord + offset));
      const target = idx + (clampedCoord - coord) * stride;
      if (target < 0) return v[0]!;
      if (target >= v.length) return v[v.length - 1]!;
      return v[target]!;
    };

    const v_m3 = getVal(-3);
    const v_m2 = getVal(-2);
    const v_m1 = getVal(-1);
    const v_0 = getVal(0);
    const v_p1 = getVal(1);
    const v_p2 = getVal(2);
    const v_p3 = getVal(3);

    // One-sided finite differences
    const dm2 = (v_m2 - v_m3) / dx;
    const dm1 = (v_m1 - v_m2) / dx;
    const d0 = (v_0 - v_m1) / dx;
    const dp1 = (v_p1 - v_0) / dx;
    const dp2 = (v_p2 - v_p1) / dx;
    const dp3 = (v_p3 - v_p2) / dx;

    // 5th-order WENO reconstructions
    const dMinusWeno = HjiLevelSetSolver.weno5Combine(dm2, dm1, d0, dp1, dp2);
    const dPlusWeno = HjiLevelSetSolver.weno5Combine(dp3, dp2, dp1, d0, dm1);

    return {
      derivMinus: dMinusWeno,
      derivPlus: dPlusWeno,
    };
  }

  /**
   * Solves the backward reachable tube over time horizon [0, tEnd].
   */
  public static solve(problem: HjiProblem, tEnd: number, dt: number): HjiResult {
    const { bounds, gridPoints, f, controlBounds, disturbanceBounds, targetLevelSet } = problem;
    const dims = bounds.length;
    const nx = gridPoints[0] ?? 21;
    const ny = dims > 1 ? (gridPoints[1] ?? 21) : 1;
    const totalPts = nx * ny;

    const dx = (bounds[0]![1] - bounds[0]![0]) / Math.max(1, nx - 1);
    const dy = dims > 1 && bounds[1] ? (bounds[1][1] - bounds[1][0]) / Math.max(1, ny - 1) : 1.0;

    // Initial level-set values V(x, 0) = l(x)
    const V0 = new Float64Array(totalPts);
    let initialUnsafePts = 0;
    for (let j = 0; j < ny; j++) {
      const y = dims > 1 && bounds[1] ? bounds[1][0] + j * dy : 0.0;
      for (let i = 0; i < nx; i++) {
        const x = bounds[0]![0] + i * dx;
        const pt = dims > 1 ? [x, y] : [x];
        const val = targetLevelSet(pt);
        V0[j * nx + i] = val;
        if (val <= 0) initialUnsafePts++;
      }
    }
    let V = new Float64Array(V0);

    const uCandidates = [controlBounds[0], controlBounds[1]];
    const wCandidates = [disturbanceBounds[0], disturbanceBounds[1]];

    const eulerForwardOperator = (stageV: Float64Array, stepDt: number): Float64Array => {
      const outV = new Float64Array(totalPts);
      for (let j = 0; j < ny; j++) {
        const y = dims > 1 && bounds[1] ? bounds[1][0] + j * dy : 0.0;
        for (let i = 0; i < nx; i++) {
          const idx = j * nx + i;
          const x = bounds[0]![0] + i * dx;
          const pt = dims > 1 ? [x, y] : [x];

          const wenoX = HjiLevelSetSolver.weno5Derivatives(stageV, idx, 1, dx, nx);
          const pAvgX = 0.5 * (wenoX.derivMinus + wenoX.derivPlus);

          const wenoY =
            dims >= 2 && ny > 1
              ? HjiLevelSetSolver.weno5Derivatives(stageV, idx, nx, dy, ny)
              : { derivMinus: 0, derivPlus: 0 };
          const pAvgY = 0.5 * (wenoY.derivMinus + wenoY.derivPlus);

          // Optimal Hamiltonian: min_{u} max_{w} (p^T f(x, u, w))
          let minMaxHamiltonian = Infinity;
          let alphaX = 0.0;
          let alphaY = 0.0;

          for (const u of uCandidates) {
            let maxOverW = -Infinity;
            for (const w of wCandidates) {
              const fVec = f(pt, u, w);
              const fx = fVec[0] ?? 0;
              const fy = dims >= 2 ? (fVec[1] ?? 0) : 0;
              if (Math.abs(fx) > alphaX) alphaX = Math.abs(fx);
              if (Math.abs(fy) > alphaY) alphaY = Math.abs(fy);

              const term = pAvgX * fx + (dims >= 2 ? pAvgY * fy : 0);
              if (term > maxOverW) maxOverW = term;
            }
            if (maxOverW < minMaxHamiltonian) {
              minMaxHamiltonian = maxOverW;
            }
          }

          // Lax-Friedrichs dissipative numerical flux
          const dissipation =
            0.5 * alphaX * (wenoX.derivPlus - wenoX.derivMinus) +
            (dims >= 2 ? 0.5 * alphaY * (wenoY.derivPlus - wenoY.derivMinus) : 0);
          const dVdt = -(minMaxHamiltonian - dissipation);

          outV[idx] = stageV[idx]! - stepDt * dVdt;
        }
      }
      return outV;
    };

    let t = 0;
    while (t < tEnd - 1e-10) {
      const currentDt = Math.min(dt, tEnd - t);

      // 3-stage Shu-Osher TVD-RK3 time stepping with BRT min-with-target enforcement:
      // Stage 1: V^(1) = min(V, E(V, dt))
      const e1 = eulerForwardOperator(V, currentDt);
      const v1 = new Float64Array(totalPts);
      for (let k = 0; k < totalPts; k++) {
        v1[k] = Math.min(V[k]!, e1[k]!);
      }

      // Stage 2: V^(2) = min(V, 3/4 * V + 1/4 * E(V^(1), dt))
      const e2 = eulerForwardOperator(v1, currentDt);
      const v2 = new Float64Array(totalPts);
      for (let k = 0; k < totalPts; k++) {
        v2[k] = Math.min(V[k]!, 0.75 * V[k]! + 0.25 * e2[k]!);
      }

      // Stage 3: V^(n+1) = min(V, 1/3 * V + 2/3 * E(V^(2), dt))
      const e3 = eulerForwardOperator(v2, currentDt);
      const nextV = new Float64Array(totalPts);
      for (let k = 0; k < totalPts; k++) {
        nextV[k] = Math.min(V[k]!, V0[k]!, (1.0 / 3.0) * V[k]! + (2.0 / 3.0) * e3[k]!);
      }

      V = nextV;
      t += currentDt;
    }

    let unsafePts = 0;
    for (let i = 0; i < totalPts; i++) {
      if (V[i]! <= 0) unsafePts++;
    }

    const unsafeFraction = unsafePts / totalPts;

    let isSafe: boolean;
    if (problem.initialState) {
      const x0 = problem.initialState[0] ?? 0;
      const i0 = Math.max(0, Math.min(nx - 1, Math.round((x0 - bounds[0]![0]) / dx)));
      const y0 = dims > 1 ? (problem.initialState[1] ?? 0) : 0;
      const j0 = dims > 1 && bounds[1] ? Math.max(0, Math.min(ny - 1, Math.round((y0 - bounds[1][0]) / dy))) : 0;
      isSafe = V[j0 * nx + i0]! > 0;
    } else if (problem.initialLevelSet) {
      isSafe = true;
      for (let j = 0; j < ny && isSafe; j++) {
        const y = dims > 1 && bounds[1] ? bounds[1][0] + j * dy : 0.0;
        for (let i = 0; i < nx; i++) {
          const x = bounds[0]![0] + i * dx;
          const pt = dims > 1 ? [x, y] : [x];
          if (problem.initialLevelSet(pt) <= 0 && V[j * nx + i]! <= 0) {
            isSafe = false;
            break;
          }
        }
      }
    } else if (initialUnsafePts === 0) {
      isSafe = unsafePts === 0;
    } else {
      isSafe = unsafePts < totalPts;
    }

    return {
      isSafe,
      times: [0, tEnd],
      finalLevelSet: V,
      gridPoints,
      unsafeVolumeFraction: unsafeFraction,
      summary: `HJI adversarial reachable tube computed over t=[0, ${tEnd}]. Unsafe volume fraction: ${(unsafeFraction * 100).toFixed(1)}%.`,
    };
  }
}
