// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Symplectic Partitioned Runge-Kutta (SPRK) Integrators for Separable Hamiltonian Systems.
 *
 * Academic Citations:
 * - Ruth, R. D. (1983). "A canonical integration technique." IEEE Transactions on Nuclear Science, 30(4), pp. 2669-2671.
 *   https://doi.org/10.1109/TNS.1983.4336580
 * - Forest, E., & Ruth, R. D. (1990). "Fourth-order symplectic integration." Physica D: Nonlinear Phenomena, 43(1), pp. 105-117.
 *   https://doi.org/10.1016/0167-2789(90)90019-L
 * - Candy, J., & Rozmus, W. (1991). "A symplectic integration algorithm for separable Hamiltonian functions."
 *   Journal of Computational Physics, 92(1), pp. 230-256. https://doi.org/10.1016/0021-9991(91)90299-Z
 * - Yoshida, H. (1990). "Construction of higher order symplectic integrators." Physics Letters A, 150(5-7), pp. 262-268.
 *   https://doi.org/10.1016/0375-9601(90)90092-3
 * - Hairer, E., Lubich, C., & Wanner, G. (2006). "Geometric Numerical Integration: Structure-Preserving
 *   Algorithms for Ordinary Differential Equations" (2nd ed.). Springer Series in Computational Mathematics 31.
 *
 * Architectural Characteristics:
 * - Geometric structure preservation: Preserves the differential 2-form $d\omega = \sum dq_i \wedge dp_i = 0$.
 * - No secular energy drift: The numerical solution corresponds to the exact flow of a nearby shadow Hamiltonian $\tilde{H} = H + O(h^p)$.
 * - Time-reversible: Forest-Ruth (Order 4), Yoshida (Order 6 & 8), and Velocity Verlet (Order 2) are symmetric and time-reversible.
 * - Supports both canonical `HamiltonianProblem` interfaces ($\dot{q} = \partial H / \partial p, \dot{p} = -\partial H / \partial q$)
 *   and partitioned `ODEProblem` specifications ($y = [q, p]^T$).
 */

import type { CommonSolverResult, ODEProblem, SolverStats } from "../core/problem-types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type SPRKTableau =
  /** Velocity Verlet / Störmer-Verlet (Order 2, 2 stages, time-reversible). */
  | "verlet"
  /** Ruth 3rd-order symplectic partitioned Runge-Kutta (Order 3, 3 stages, Ruth 1983). */
  | "ruth3"
  /** Forest-Ruth / Candy-Rozmus 4th-order symplectic integrator (Order 4, 4 stages, time-reversible). */
  | "forest-ruth4"
  /** Yoshida 6th-order symplectic composition method (Order 6, time-reversible). */
  | "yoshida6"
  /** Yoshida 8th-order symplectic composition method (Order 8, time-reversible). */
  | "yoshida8";

export interface SPRKOptions {
  /** Symplectic tableau to use (default: "forest-ruth4"). */
  method?: SPRKTableau | undefined;
  /** Integration step size (default: auto or (tEnd - t0) / 1000). */
  dt?: number | undefined;
  /** Maximum number of recorded time points (downsampling if step count is very large). */
  maxOutputPoints?: number | undefined;
  /** Split index d if y = [q_1...q_d, p_1...p_d]. Defaults to y.length / 2. */
  splitIndex?: number | undefined;
  /** Optional energy / Hamiltonian function H(t, q, p) to track conservation across trajectory. */
  hamiltonian?: ((t: number, q: Float64Array, p: Float64Array) => number) | undefined;
}

export interface HamiltonianProblem<P = any> {
  /** Kinetic vector field: dq/dt = dH/dp (velocities) */
  evaluateQ: (t: number, p: Float64Array, q: Float64Array, params?: P) => Float64Array | number[];
  /** Potential vector field: dp/dt = -dH/dq (forces) */
  evaluateP: (t: number, q: Float64Array, p: Float64Array, params?: P) => Float64Array | number[];
  /** Initial generalized coordinates q0 */
  q0: number[] | Float64Array;
  /** Initial conjugate momenta p0 */
  p0: number[] | Float64Array;
  /** Integration time interval [t0, tEnd] */
  tSpan: [number, number];
  /** Optional problem parameters */
  p?: P | undefined;
}

export interface SPRKResult extends CommonSolverResult {
  /** Recorded coordinate trajectories $q(t_k)$. */
  q: number[][];
  /** Recorded momentum trajectories $p(t_k)$. */
  p: number[][];
  /** Energy values $H(t_k)$ if a Hamiltonian function was provided. */
  energy?: number[] | undefined;
  /** Maximum relative energy drift: $\max_k |H(t_k) - H(t_0)| / (|H(t_0)| + 10^{-15})$. */
  maxEnergyDrift?: number | undefined;
  /** Step and evaluation statistics. */
  stats: SolverStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tableau Coefficients
// ─────────────────────────────────────────────────────────────────────────────

// Forest-Ruth / Candy-Rozmus 4th order coefficients
const THETA_4 = 1.0 / (2.0 - Math.pow(2.0, 1.0 / 3.0)); // ~1.3512071919596576
const C_FOREST_RUTH_4 = new Float64Array([THETA_4 / 2.0, (1.0 - THETA_4) / 2.0, (1.0 - THETA_4) / 2.0, THETA_4 / 2.0]);
const D_FOREST_RUTH_4 = new Float64Array([THETA_4, 1.0 - 2.0 * THETA_4, THETA_4, 0.0]);

// Ruth 3rd order coefficients (Ruth 1983)
const C_RUTH_3 = new Float64Array([7.0 / 24.0, 3.0 / 4.0, -1.0 / 24.0]);
const D_RUTH_3 = new Float64Array([2.0 / 3.0, -2.0 / 3.0, 1.0]);

// Yoshida composition factors
// For Order 6 from Order 4:
const Z1_6 = 1.0 / (2.0 - Math.pow(2.0, 1.0 / 5.0)); // ~1.1746717580893635
const Z0_6 = 1.0 - 2.0 * Z1_6; // ~-1.3493435161787270

// For Order 8 from Order 6:
const Z1_8 = 1.0 / (2.0 - Math.pow(2.0, 1.0 / 7.0)); // ~1.1161829393253857
const Z0_8 = 1.0 - 2.0 * Z1_8; // ~-1.2323658786507714

// ─────────────────────────────────────────────────────────────────────────────
// Elementary Symplectic Steps
// ─────────────────────────────────────────────────────────────────────────────

export type FieldEvalQ = (t: number, p: Float64Array, q: Float64Array) => Float64Array | number[];
export type FieldEvalP = (t: number, q: Float64Array, p: Float64Array) => Float64Array | number[];

/**
 * 2nd-order Velocity Verlet / Störmer-Verlet step:
 *   p_{1/2} = p_0 + (h/2) * f_p(q_0)
 *   q_1     = q_0 + h     * f_q(p_{1/2})
 *   p_1     = p_{1/2} + (h/2) * f_p(q_1)
 */
export function stepVerlet(
  q: Float64Array,
  p: Float64Array,
  h: number,
  t: number,
  evalQ: FieldEvalQ,
  evalP: FieldEvalP,
  d: number,
): void {
  const halfH = 0.5 * h;
  // Half kick
  const fp0 = evalP(t, q, p);
  for (let j = 0; j < d; j++) {
    p[j] = p[j]! + halfH * fp0[j]!;
  }
  // Full drift
  const fq = evalQ(t + halfH, p, q);
  for (let j = 0; j < d; j++) {
    q[j] = q[j]! + h * fq[j]!;
  }
  // Half kick
  const fp1 = evalP(t + h, q, p);
  for (let j = 0; j < d; j++) {
    p[j] = p[j]! + halfH * fp1[j]!;
  }
}

/**
 * 3rd-order Ruth step (Ruth 1983):
 * 3 stages alternating drift (c) and kick (d).
 */
export function stepRuth3(
  q: Float64Array,
  p: Float64Array,
  h: number,
  t: number,
  evalQ: FieldEvalQ,
  evalP: FieldEvalP,
  d: number,
): void {
  let currT = t;
  for (let i = 0; i < 3; i++) {
    const ci = C_RUTH_3[i]!;
    const di = D_RUTH_3[i]!;
    // Drift
    const fq = evalQ(currT, p, q);
    for (let j = 0; j < d; j++) {
      q[j] = q[j]! + h * ci * fq[j]!;
    }
    currT += h * ci;
    // Kick
    const fp = evalP(currT, q, p);
    for (let j = 0; j < d; j++) {
      p[j] = p[j]! + h * di * fp[j]!;
    }
  }
}

/**
 * 4th-order Forest-Ruth / Candy-Rozmus step (Forest & Ruth 1990):
 * 4 stages, time-reversible, with $d_4 = 0$ saving one force evaluation.
 */
export function stepForestRuth4(
  q: Float64Array,
  p: Float64Array,
  h: number,
  t: number,
  evalQ: FieldEvalQ,
  evalP: FieldEvalP,
  d: number,
): void {
  let currT = t;
  for (let i = 0; i < 4; i++) {
    const ci = C_FOREST_RUTH_4[i]!;
    const di = D_FOREST_RUTH_4[i]!;

    const fq = evalQ(currT, p, q);
    for (let j = 0; j < d; j++) {
      q[j] = q[j]! + h * ci * fq[j]!;
    }
    currT += h * ci;

    if (di !== 0.0) {
      const fp = evalP(currT, q, p);
      for (let j = 0; j < d; j++) {
        p[j] = p[j]! + h * di * fp[j]!;
      }
    }
  }
}

/**
 * 6th-order Yoshida composition step (Yoshida 1990):
 * Triplet symmetric composition of 4th-order Forest-Ruth steps: $S_4(z_1 h) \circ S_4(z_0 h) \circ S_4(z_1 h)$.
 */
export function stepYoshida6(
  q: Float64Array,
  p: Float64Array,
  h: number,
  t: number,
  evalQ: FieldEvalQ,
  evalP: FieldEvalP,
  d: number,
): void {
  const h1 = Z1_6 * h;
  const h0 = Z0_6 * h;
  stepForestRuth4(q, p, h1, t, evalQ, evalP, d);
  stepForestRuth4(q, p, h0, t + h1, evalQ, evalP, d);
  stepForestRuth4(q, p, h1, t + h1 + h0, evalQ, evalP, d);
}

/**
 * 8th-order Yoshida composition step (Yoshida 1990):
 * Triplet symmetric composition of 6th-order Yoshida steps: $S_6(z_1 h) \circ S_6(z_0 h) \circ S_6(z_1 h)$.
 */
export function stepYoshida8(
  q: Float64Array,
  p: Float64Array,
  h: number,
  t: number,
  evalQ: FieldEvalQ,
  evalP: FieldEvalP,
  d: number,
): void {
  const h1 = Z1_8 * h;
  const h0 = Z0_8 * h;
  stepYoshida6(q, p, h1, t, evalQ, evalP, d);
  stepYoshida6(q, p, h0, t + h1, evalQ, evalP, d);
  stepYoshida6(q, p, h1, t + h1 + h0, evalQ, evalP, d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Solver Entrypoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Integrates a separable Hamiltonian or partitioned ODE system using Symplectic Partitioned Runge-Kutta (SPRK).
 *
 * Guarantees zero secular energy drift, preserving phase-space volume and first integrals over millions of steps.
 */
export function solveSPRK<P = any>(problem: HamiltonianProblem<P> | ODEProblem<P>, options?: SPRKOptions): SPRKResult {
  const method = options?.method ?? "forest-ruth4";
  const [t0, tEnd] = problem.tSpan;
  const totalDuration = tEnd - t0;
  if (totalDuration <= 0) {
    throw new Error(`solveSPRK: Invalid time span [${t0}, ${tEnd}], tEnd must be greater than t0.`);
  }

  // Determine problem dimensions and vector fields
  let q: Float64Array;
  let p: Float64Array;
  let d: number;
  let evalQ: FieldEvalQ;
  let evalP: FieldEvalP;

  if ("evaluateQ" in problem && "evaluateP" in problem) {
    // Canonical HamiltonianProblem
    q = new Float64Array(problem.q0);
    p = new Float64Array(problem.p0);
    d = q.length;
    if (p.length !== d) {
      throw new Error(`solveSPRK: Dimension mismatch: q0 has length ${d} but p0 has length ${p.length}.`);
    }
    const probP = problem.p;
    evalQ = (t, _p, _q) => problem.evaluateQ(t, _p, _q, probP);
    evalP = (t, _q, _p) => problem.evaluateP(t, _q, _p, probP);
  } else {
    // Partitioned ODEProblem: y = [q, p]
    const totalDim = problem.y0.length;
    d = options?.splitIndex ?? Math.floor(totalDim / 2);
    if (d <= 0 || d * 2 !== totalDim) {
      throw new Error(
        `solveSPRK: Cannot partition ODE state of length ${totalDim}. Expected even dimension splitIndex (got ${d}).`,
      );
    }
    q = new Float64Array(problem.y0.slice(0, d));
    p = new Float64Array(problem.y0.slice(d, 2 * d));
    const probF = problem.f;
    const probP = problem.p;

    // Buffer to avoid reallocating during RHS evaluation
    const yBuf: number[] = new Array(totalDim);

    evalQ = (t, currP, currQ) => {
      for (let i = 0; i < d; i++) {
        yBuf[i] = currQ[i]!;
        yBuf[d + i] = currP[i]!;
      }
      const dy = probF(t, yBuf, probP);
      const res = new Float64Array(d);
      for (let i = 0; i < d; i++) res[i] = dy[i]!;
      return res;
    };

    evalP = (t, currQ, currP) => {
      for (let i = 0; i < d; i++) {
        yBuf[i] = currQ[i]!;
        yBuf[d + i] = currP[i]!;
      }
      const dy = probF(t, yBuf, probP);
      const res = new Float64Array(d);
      for (let i = 0; i < d; i++) res[i] = dy[d + i]!;
      return res;
    };
  }

  // Step size selection
  const dt = options?.dt ?? Math.min(totalDuration / 1000.0, 0.01);
  const totalSteps = Math.max(1, Math.round(totalDuration / dt));
  const actualDt = totalDuration / totalSteps;

  // Max output points (avoid multi-million array allocation in long orbits)
  const maxOutput = options?.maxOutputPoints ?? 10000;
  const saveEvery = Math.max(1, Math.floor(totalSteps / maxOutput));

  const times: number[] = [t0];
  const qHistory: number[][] = [Array.from(q)];
  const pHistory: number[][] = [Array.from(p)];
  const states: number[][] = [Array.from(q).concat(Array.from(p))];

  const hasHamiltonian = options?.hamiltonian !== undefined;
  const energyHistory: number[] | undefined = hasHamiltonian ? [options.hamiltonian!(t0, q, p)] : undefined;
  let maxEnergyDrift = 0.0;
  const h0 = energyHistory ? energyHistory[0]! : 0.0;

  // Step function selector
  let stepFn: (q: Float64Array, p: Float64Array, h: number, t: number) => void;
  let fEvalsPerStep = 2;

  switch (method) {
    case "verlet":
      stepFn = (_q, _p, _h, _t) => stepVerlet(_q, _p, _h, _t, evalQ, evalP, d);
      fEvalsPerStep = 3;
      break;
    case "ruth3":
      stepFn = (_q, _p, _h, _t) => stepRuth3(_q, _p, _h, _t, evalQ, evalP, d);
      fEvalsPerStep = 6;
      break;
    case "forest-ruth4":
      stepFn = (_q, _p, _h, _t) => stepForestRuth4(_q, _p, _h, _t, evalQ, evalP, d);
      fEvalsPerStep = 7; // d4 = 0 saves 1 evaluation
      break;
    case "yoshida6":
      stepFn = (_q, _p, _h, _t) => stepYoshida6(_q, _p, _h, _t, evalQ, evalP, d);
      fEvalsPerStep = 21;
      break;
    case "yoshida8":
      stepFn = (_q, _p, _h, _t) => stepYoshida8(_q, _p, _h, _t, evalQ, evalP, d);
      fEvalsPerStep = 63;
      break;
    default:
      throw new Error(`solveSPRK: Unknown SPRK method '${method}'.`);
  }

  let t = t0;
  let fEvals = 0;

  // Main integration loop
  for (let s = 1; s <= totalSteps; s++) {
    stepFn(q, p, actualDt, t);
    t = s === totalSteps ? tEnd : t0 + s * actualDt;
    fEvals += fEvalsPerStep;

    if (s % saveEvery === 0 || s === totalSteps) {
      times.push(t);
      qHistory.push(Array.from(q));
      pHistory.push(Array.from(p));
      states.push(Array.from(q).concat(Array.from(p)));

      if (hasHamiltonian && energyHistory) {
        const currentH = options.hamiltonian!(t, q, p);
        energyHistory.push(currentH);
        const drift = Math.abs(currentH - h0) / (Math.abs(h0) + 1e-15);
        if (drift > maxEnergyDrift) {
          maxEnergyDrift = drift;
        }
      }
    }
  }

  return {
    times,
    states,
    q: qHistory,
    p: pHistory,
    energy: energyHistory,
    maxEnergyDrift: hasHamiltonian ? maxEnergyDrift : undefined,
    stats: {
      acceptedSteps: totalSteps,
      rejectedSteps: 0,
      fEvals,
      converged: true,
    },
  };
}
