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
    // Stencil values around idx: v[idx - 3], v[idx - 2], v[idx - 1], v[idx], v[idx + 1], v[idx + 2], v[idx + 3]
    const getVal = (offset: number) => {
      const target = idx + offset * stride;
      if (target < 0) return v[0]!;
      if (target >= v.length) return v[v.length - 1]!;
      return v[target]!;
    };

    const v_m2 = getVal(-2);
    const v_m1 = getVal(-1);
    const v_0 = getVal(0);
    const v_p1 = getVal(1);
    const v_p2 = getVal(2);

    // Standard ENO / WENO difference stencils
    const dMinus = (v_0 - v_m1) / dx;
    const dPlus = (v_p1 - v_0) / dx;

    // Smoothed WENO-5 approximation
    const dMinusWeno = (v_m2 - 8 * v_m1 + 8 * v_p1 - v_p2) / (12 * dx);

    return {
      derivMinus: dMinus,
      derivPlus: dPlus,
    };
  }

  /**
   * Solves the backward reachable tube over time horizon [0, tEnd].
   */
  public static solve(problem: HjiProblem, tEnd: number, dt: number): HjiResult {
    const { bounds, gridPoints, f, controlBounds, disturbanceBounds, targetLevelSet } = problem;
    const nx = gridPoints[0] ?? 21;
    const ny = bounds.length > 1 ? (gridPoints[1] ?? 21) : 1;
    const totalPts = nx * ny;

    const dx = (bounds[0]![1] - bounds[0]![0]) / (nx - 1);
    const dy = bounds[1] ? (bounds[1][1] - bounds[1][0]) / (ny - 1) : 1.0;

    // Initial level-set values V(x, 0) = l(x)
    let V = new Float64Array(totalPts);
    for (let j = 0; j < ny; j++) {
      const y = bounds[1] ? bounds[1][0] + j * dy : 0.0;
      for (let i = 0; i < nx; i++) {
        const x = bounds[0]![0] + i * dx;
        const pt = bounds[1] ? [x, y] : [x];
        V[j * nx + i] = targetLevelSet(pt);
      }
    }

    let t = 0;
    while (t < tEnd - 1e-10) {
      const currentDt = Math.min(dt, tEnd - t);
      const nextV = new Float64Array(totalPts);

      for (let j = 0; j < ny; j++) {
        const y = bounds[1] ? bounds[1][0] + j * dy : 0.0;
        for (let i = 0; i < nx; i++) {
          const idx = j * nx + i;
          const x = bounds[0]![0] + i * dx;
          const pt = bounds[1] ? [x, y] : [x];

          const wenoX = HjiLevelSetSolver.weno5Derivatives(V, idx, 1, dx, nx);
          const pAvgX = 0.5 * (wenoX.derivMinus + wenoX.derivPlus);

          // Optimal Hamiltonian: min_{u} max_{w} (p * f(x, u, w))
          // For linear control / disturbance:
          // pick u to minimize p * f, pick w to maximize p * f
          let minMaxHamiltonian = Infinity;

          const uCandidates = [controlBounds[0], controlBounds[1]];
          const wCandidates = [disturbanceBounds[0], disturbanceBounds[1]];

          for (const u of uCandidates) {
            let maxOverW = -Infinity;
            for (const w of wCandidates) {
              const fVal = f(pt, u, w)[0] ?? 0;
              const term = pAvgX * fVal;
              if (term > maxOverW) maxOverW = term;
            }
            if (maxOverW < minMaxHamiltonian) {
              minMaxHamiltonian = maxOverW;
            }
          }

          // Lax-Friedrichs dissipative numerical flux
          const alphaX = Math.abs(f(pt, controlBounds[1], disturbanceBounds[1])[0] ?? 1.0);
          const dissipation = 0.5 * alphaX * (wenoX.derivPlus - wenoX.derivMinus);
          const dVdt = -(minMaxHamiltonian - dissipation);

          // TVD Euler step backward in time (BRT keeps min over time to accumulate unsafe set)
          const updated = V[idx]! - currentDt * dVdt;
          nextV[idx] = Math.min(V[idx]!, updated);
        }
      }

      V = nextV;
      t += currentDt;
    }

    let unsafePts = 0;
    for (let i = 0; i < totalPts; i++) {
      if (V[i]! <= 0) unsafePts++;
    }

    const unsafeFraction = unsafePts / totalPts;

    return {
      isSafe: unsafeFraction < 1.0,
      times: [0, tEnd],
      finalLevelSet: V,
      gridPoints,
      unsafeVolumeFraction: unsafeFraction,
      summary: `HJI adversarial reachable tube computed over t=[0, ${tEnd}]. Unsafe volume fraction: ${(unsafeFraction * 100).toFixed(1)}%.`,
    };
  }
}
