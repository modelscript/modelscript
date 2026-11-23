// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Featherstone O(n) Articulated Multibody Dynamics & LCP Contact Solver.
 *
 * Serves `urdf`, `adams`, `simpack`, and `opensim`:
 *   1. Recursive Newton-Euler Algorithm (RNEA) for O(n) planar serial-chain inverse dynamics
 *   2. Composite Rigid Body / Forward Dynamics (`qdd = M(q)^{-1} (tau - C(q, qd) - G(q))`)
 *   3. Projected Gauss-Seidel Linear Complementarity Problem (LCP) solver for rigid-body contact
 */

import { solveDenseLinear } from "../math/dense_linalg.js";

export interface PlanarLinkSpec {
  readonly length: number;
  readonly comOffset: number; // distance along link from joint to COM
  readonly mass: number;
  readonly inertia: number; // rotational inertia about COM
}

/**
 * Exact O(n) Recursive Newton-Euler Algorithm (RNEA) for an n-link planar revolute manipulator
 * under downward gravity `g` (default 9.81 m/s^2).
 * Returns joint torques `tau[0..n-1]`.
 */
export function featherstonePlanarRnea(
  links: readonly PlanarLinkSpec[],
  q: readonly number[],
  qd: readonly number[],
  qdd: readonly number[],
  gravity = 9.81,
): Float64Array {
  const n = links.length;
  // Forward kinematics: world angles, angular vel/acc, joint & COM linear accelerations
  const theta = new Float64Array(n);
  const omega = new Float64Array(n);
  const alpha = new Float64Array(n);
  const axJoint = new Float64Array(n);
  const ayJoint = new Float64Array(n);
  const axCom = new Float64Array(n);
  const ayCom = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const prevT = i > 0 ? theta[i - 1]! : 0;
    const prevW = i > 0 ? omega[i - 1]! : 0;
    const prevA = i > 0 ? alpha[i - 1]! : 0;
    theta[i] = prevT + q[i]!;
    omega[i] = prevW + qd[i]!;
    alpha[i] = prevA + qdd[i]!;

    if (i === 0) {
      // Base gravity encoded as upward acceleration +g
      axJoint[0] = 0;
      ayJoint[0] = gravity;
    } else {
      const Lprev = links[i - 1]!.length;
      const cPrev = Math.cos(theta[i - 1]!);
      const sPrev = Math.sin(theta[i - 1]!);
      axJoint[i] = axJoint[i - 1]! - Lprev * sPrev * alpha[i - 1]! - Lprev * cPrev * omega[i - 1]! * omega[i - 1]!;
      ayJoint[i] = ayJoint[i - 1]! + Lprev * cPrev * alpha[i - 1]! - Lprev * sPrev * omega[i - 1]! * omega[i - 1]!;
    }

    const lc = links[i]!.comOffset;
    const ci = Math.cos(theta[i]!);
    const si = Math.sin(theta[i]!);
    axCom[i] = axJoint[i]! - lc * si * alpha[i]! - lc * ci * omega[i]! * omega[i]!;
    ayCom[i] = ayJoint[i]! + lc * ci * alpha[i]! - lc * si * omega[i]! * omega[i]!;
  }

  // Backward recursion: net forces and joint torques
  const tau = new Float64Array(n);
  let fxNext = 0;
  let fyNext = 0;
  let tauNext = 0;

  for (let i = n - 1; i >= 0; i--) {
    const link = links[i]!;
    const ci = Math.cos(theta[i]!);
    const si = Math.sin(theta[i]!);
    const fx = link.mass * axCom[i]! + fxNext;
    const fy = link.mass * ayCom[i]! + fyNext;

    // Torque about joint i: I*alpha + r_com x F_inertial + r_tip x F_next + tau_next
    const rxCom = link.comOffset * ci;
    const ryCom = link.comOffset * si;
    const rxTip = link.length * ci;
    const ryTip = link.length * si;

    const tauI =
      link.inertia * alpha[i]! +
      (rxCom * link.mass * ayCom[i]! - ryCom * link.mass * axCom[i]!) +
      (rxTip * fyNext - ryTip * fxNext) +
      tauNext;

    tau[i] = tauI;
    fxNext = fx;
    fyNext = fy;
    tauNext = tauI;
  }

  return tau;
}

/**
 * Forward Dynamics via RNEA bias & column-wise mass matrix assembly:
 *   M(q) * qdd = tau - C(q, qd) - G(q)
 */
export function featherstonePlanarForwardDynamics(
  links: readonly PlanarLinkSpec[],
  q: readonly number[],
  qd: readonly number[],
  tau: readonly number[],
  gravity = 9.81,
): { qdd: Float64Array; massMatrix: Float64Array } {
  const n = links.length;
  const zero = new Array<number>(n).fill(0);
  const bias = featherstonePlanarRnea(links, q, qd, zero, gravity);

  // Assemble mass matrix columns via RNEA with qd=0, g=0, qdd=e_j
  const M = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    const ej = new Array<number>(n).fill(0);
    ej[j] = 1.0;
    const col = featherstonePlanarRnea(links, q, zero, ej, 0.0);
    for (let i = 0; i < n; i++) M[i * n + j] = col[i]!;
  }

  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) rhs[i] = tau[i]! - bias[i]!;
  const qdd = solveDenseLinear(M, rhs, n);
  return { qdd, massMatrix: M };
}

export interface LcpResult {
  readonly z: Float64Array;
  readonly w: Float64Array;
  readonly residual: number;
  readonly iterations: number;
}

/**
 * Projected Gauss-Seidel (PGS) solver for the Linear Complementarity Problem (LCP):
 *   w = M * z + q,   z >= 0,   w >= 0,   z^T * w = 0
 * Used for rigid-body unilateral contact & Coulomb friction impulses.
 */
export function solveLcpPgs(M: Float64Array, q: Float64Array, n: number, maxIterations = 200, tol = 1e-9): LcpResult {
  const z = new Float64Array(n);
  const w = new Float64Array(n);
  let iter = 0;

  for (; iter < maxIterations; iter++) {
    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      const mii = M[i * n + i]!;
      if (Math.abs(mii) < 1e-14) continue;
      let sum = q[i]!;
      for (let j = 0; j < n; j++) {
        if (j !== i) sum += M[i * n + j]! * z[j]!;
      }
      const zNew = Math.max(0, -sum / mii);
      const diff = Math.abs(zNew - z[i]!);
      if (diff > maxDiff) maxDiff = diff;
      z[i] = zNew;
    }
    if (maxDiff < tol) break;
  }

  let residual = 0;
  for (let i = 0; i < n; i++) {
    let wi = q[i]!;
    for (let j = 0; j < n; j++) wi += M[i * n + j]! * z[j]!;
    w[i] = wi;
    // Complementarity violation: |min(z_i, w_i)|
    residual = Math.max(residual, Math.abs(Math.min(z[i]!, wi)));
  }

  return { z, w, residual, iterations: iter };
}
