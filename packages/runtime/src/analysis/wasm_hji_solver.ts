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

import { getDefaultWasmExports } from "../dae/wasm_loader.js";

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
   * Computes spatial derivatives using 5th-order WENO upwind discretization
   * via `hji_weno5Derivatives` in WASM linear memory.
   */
  public static weno5Derivatives(
    v: Float64Array,
    idx: number,
    stride: number,
    dx: number,
    numPts: number,
  ): { derivMinus: number; derivPlus: number } {
    const w = getDefaultWasmExports();
    if (
      w &&
      typeof w.hji_weno5Derivatives === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function" &&
      v.length > 0
    ) {
      const vPtr = w.alloc(v.byteLength);
      const outPtr = w.alloc(16);
      try {
        new Float64Array(w.memory.buffer, vPtr, v.length).set(v);
        w.hji_weno5Derivatives(vPtr, v.length, idx, stride, dx, numPts, outPtr);
        const out = new Float64Array(w.memory.buffer, outPtr, 2);
        return { derivMinus: out[0]!, derivPlus: out[1]! };
      } finally {
        w.free(vPtr);
        w.free(outPtr);
      }
    }

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

    const dm2 = (v_m2 - v_m3) / dx;
    const dm1 = (v_m1 - v_m2) / dx;
    const d0 = (v_0 - v_m1) / dx;
    const dp1 = (v_p1 - v_0) / dx;
    const dp2 = (v_p2 - v_p1) / dx;
    const dp3 = (v_p3 - v_p2) / dx;

    return {
      derivMinus: HjiLevelSetSolver.weno5Combine(dm2, dm1, d0, dp1, dp2),
      derivPlus: HjiLevelSetSolver.weno5Combine(dp3, dp2, dp1, d0, dm1),
    };
  }

  /**
   * Solves the backward reachable tube over time horizon [0, tEnd].
   */
  public static solve(problem: HjiProblem, tEnd: number, dt: number): HjiResult {
    const { bounds, gridPoints, f, controlBounds, disturbanceBounds, targetLevelSet } = problem;
    const dims = bounds.length;
    const gridCounts = bounds.map((_, d) => gridPoints[d] ?? 21);
    const strides = new Array<number>(dims);
    let totalPts = 1;
    for (let d = 0; d < dims; d++) {
      strides[d] = totalPts;
      totalPts *= gridCounts[d]!;
    }

    const dx = bounds.map((b, d) => (b[1] - b[0]) / Math.max(1, gridCounts[d]! - 1));

    const getPoint = (idx: number, ptOut: number[]): void => {
      for (let d = 0; d < dims; d++) {
        const coord = Math.floor(idx / strides[d]!) % gridCounts[d]!;
        ptOut[d] = bounds[d]![0] + coord * dx[d]!;
      }
    };

    // Initial level-set values V(x, 0) = l(x)
    const V0 = new Float64Array(totalPts);
    let initialUnsafePts = 0;
    const ptBuf = new Array<number>(dims);
    for (let idx = 0; idx < totalPts; idx++) {
      getPoint(idx, ptBuf);
      const val = targetLevelSet(ptBuf);
      V0[idx] = val;
      if (val <= 0) initialUnsafePts++;
    }
    let V = new Float64Array(V0);

    const uCandidates = [controlBounds[0], controlBounds[1]];
    const wCandidates = [disturbanceBounds[0], disturbanceBounds[1]];

    const w = getDefaultWasmExports();
    const useWasm = Boolean(
      w &&
      typeof w.hji_weno5SweepAll === "function" &&
      typeof w.hji_tvdRk3Combine === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function" &&
      totalPts > 0 &&
      dims > 0,
    );

    // Pre-allocate persistent WASM linear-memory scratch buffers for the entire solve
    let vPtr = 0;
    let v0Ptr = 0;
    let ePtr = 0;
    let outPtr = 0;
    let stridesPtr = 0;
    let dxPtr = 0;
    let countsPtr = 0;
    let dMinusAllPtr = 0;
    let dPlusAllPtr = 0;

    if (useWasm) {
      vPtr = w.alloc(totalPts * 8);
      v0Ptr = w.alloc(totalPts * 8);
      ePtr = w.alloc(totalPts * 8);
      outPtr = w.alloc(totalPts * 8);
      stridesPtr = w.alloc(dims * 4);
      dxPtr = w.alloc(dims * 8);
      countsPtr = w.alloc(dims * 4);
      dMinusAllPtr = w.alloc(totalPts * dims * 8);
      dPlusAllPtr = w.alloc(totalPts * dims * 8);

      new Float64Array(w.memory.buffer, v0Ptr, totalPts).set(V0);
      new Int32Array(w.memory.buffer, stridesPtr, dims).set(strides);
      new Float64Array(w.memory.buffer, dxPtr, dims).set(dx);
      new Int32Array(w.memory.buffer, countsPtr, dims).set(gridCounts);
    }

    try {
      const eulerForwardOperator = (stageV: Float64Array, stepDt: number): Float64Array => {
        const outV = new Float64Array(totalPts);
        const pt = new Array<number>(dims);
        const pAvg = new Float64Array(dims);
        const dMinus = new Float64Array(dims);
        const dPlus = new Float64Array(dims);

        let dMinusGrid: Float64Array | null = null;
        let dPlusGrid: Float64Array | null = null;
        if (useWasm) {
          new Float64Array(w.memory.buffer, vPtr, totalPts).set(stageV);
          w.hji_weno5SweepAll(vPtr, totalPts, dims, stridesPtr, dxPtr, countsPtr, dMinusAllPtr, dPlusAllPtr);
          dMinusGrid = new Float64Array(w.memory.buffer, dMinusAllPtr, totalPts * dims);
          dPlusGrid = new Float64Array(w.memory.buffer, dPlusAllPtr, totalPts * dims);
        }

        for (let idx = 0; idx < totalPts; idx++) {
          getPoint(idx, pt);

          if (dMinusGrid && dPlusGrid) {
            const base = idx * dims;
            for (let d = 0; d < dims; d++) {
              const dm = dMinusGrid[base + d]!;
              const dp = dPlusGrid[base + d]!;
              pAvg[d] = 0.5 * (dm + dp);
              dMinus[d] = dm;
              dPlus[d] = dp;
            }
          } else {
            for (let d = 0; d < dims; d++) {
              const weno = HjiLevelSetSolver.weno5Derivatives(stageV, idx, strides[d]!, dx[d]!, gridCounts[d]!);
              pAvg[d] = 0.5 * (weno.derivMinus + weno.derivPlus);
              dMinus[d] = weno.derivMinus;
              dPlus[d] = weno.derivPlus;
            }
          }

          // Optimal Hamiltonian: min_{u} max_{w} (p^T f(x, u, w))
          let minMaxHamiltonian = Infinity;
          const alpha = new Float64Array(dims);

          for (const u of uCandidates) {
            let maxOverW = -Infinity;
            for (const wCand of wCandidates) {
              const fVec = f(pt, u, wCand);
              let term = 0;
              for (let d = 0; d < dims; d++) {
                const fd = fVec[d] ?? 0;
                const absFd = Math.abs(fd);
                if (absFd > alpha[d]!) alpha[d] = absFd;
                term += pAvg[d]! * fd;
              }
              if (term > maxOverW) maxOverW = term;
            }
            if (maxOverW < minMaxHamiltonian) {
              minMaxHamiltonian = maxOverW;
            }
          }

          // Lax-Friedrichs dissipative numerical flux
          let dissipation = 0.0;
          for (let d = 0; d < dims; d++) {
            dissipation += 0.5 * alpha[d]! * (dPlus[d]! - dMinus[d]!);
          }
          const dVdt = -(minMaxHamiltonian - dissipation);

          outV[idx] = stageV[idx]! - stepDt * dVdt;
        }
        return outV;
      };

      const combineStage = (baseV: Float64Array, eulerV: Float64Array, stage: 1 | 2 | 3): Float64Array<ArrayBuffer> => {
        if (useWasm) {
          new Float64Array(w.memory.buffer, vPtr, totalPts).set(baseV);
          new Float64Array(w.memory.buffer, ePtr, totalPts).set(eulerV);
          w.hji_tvdRk3Combine(vPtr, v0Ptr, ePtr, outPtr, totalPts, stage);
          const out = new Float64Array(totalPts);
          out.set(new Float64Array(w.memory.buffer, outPtr, totalPts));
          return out;
        }
        const res = new Float64Array(totalPts);
        if (stage === 1) {
          for (let k = 0; k < totalPts; k++) res[k] = Math.min(baseV[k]!, eulerV[k]!);
        } else if (stage === 2) {
          for (let k = 0; k < totalPts; k++) res[k] = Math.min(baseV[k]!, 0.75 * baseV[k]! + 0.25 * eulerV[k]!);
        } else {
          for (let k = 0; k < totalPts; k++) {
            res[k] = Math.min(baseV[k]!, V0[k]!, (1.0 / 3.0) * baseV[k]! + (2.0 / 3.0) * eulerV[k]!);
          }
        }
        return res;
      };

      let t = 0;
      while (t < tEnd - 1e-10) {
        const currentDt = Math.min(dt, tEnd - t);

        // 3-stage Shu-Osher TVD-RK3 time stepping with BRT min-with-target enforcement
        const e1 = eulerForwardOperator(V, currentDt);
        const v1 = combineStage(V, e1, 1);

        const e2 = eulerForwardOperator(v1, currentDt);
        const v2 = combineStage(V, e2, 2);

        const e3 = eulerForwardOperator(v2, currentDt);
        V = combineStage(V, e3, 3);

        t += currentDt;
      }
    } finally {
      if (useWasm) {
        w.free(vPtr);
        w.free(v0Ptr);
        w.free(ePtr);
        w.free(outPtr);
        w.free(stridesPtr);
        w.free(dxPtr);
        w.free(countsPtr);
        w.free(dMinusAllPtr);
        w.free(dPlusAllPtr);
      }
    }

    let unsafePts = 0;
    for (let i = 0; i < totalPts; i++) {
      if (V[i]! <= 0) unsafePts++;
    }

    const unsafeFraction = unsafePts / totalPts;

    let isSafe: boolean;
    if (problem.initialState) {
      let initIdx = 0;
      for (let d = 0; d < dims; d++) {
        const x0_d = problem.initialState[d] ?? 0;
        const coord = Math.max(0, Math.min(gridCounts[d]! - 1, Math.round((x0_d - bounds[d]![0]) / dx[d]!)));
        initIdx += coord * strides[d]!;
      }
      isSafe = V[initIdx]! > 0;
    } else if (problem.initialLevelSet) {
      isSafe = true;
      const pt = new Array<number>(dims);
      for (let idx = 0; idx < totalPts; idx++) {
        getPoint(idx, pt);
        if (problem.initialLevelSet(pt) <= 0 && V[idx]! <= 0) {
          isSafe = false;
          break;
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
