// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symplectic Integrator Suite in Native WebAssembly Linear Memory.
 *
 * Implements structure-preserving, geometric numerical integrators for separable
 * Hamiltonian physical systems H(q, p) = T(p) + V(q):
 * 1. Velocity Verlet (2nd-Order, Störmer-Verlet scheme)
 * 2. Ruth-3 (3rd-Order 3-Stage Symplectic scheme)
 * 3. Candy-Rozmus / Forest-Ruth (4th-Order 4-Stage Symplectic scheme)
 *
 * State buffer layout:
 *   q is at offset qPtr (length n: variables 0..n-1)
 *   p is at offset pPtr (length n: variables n..2n-1)
 * Derivative buffer layout:
 *   f[0..n-1]     = dq/dt = p
 *   f[n..2n-1]    = dp/dt = F(q)
 *
 * Guarantee: Zero artificial energy dissipation or secular energy drift over long integration horizons.
 */

import { DaeBuilder } from "../dae/builder";
import { UnmanagedFloat64Array } from "../core/array";
import { computeDerivatives } from "./integrators";

/**
 * Velocity Verlet 2nd-order symplectic step:
 * p_{1/2} = p_0 + 0.5 * dt * F(q_0)
 * q_1     = q_0 + dt * p_{1/2}
 * p_1     = p_{1/2} + 0.5 * dt * F(q_1)
 */
export function stepVelocityVerlet(
  dae: DaeBuilder,
  qPtr: u32,
  pPtr: u32,
  fPtr: u32,
  n: u32,
  dt: f64
): void {
  let q = changetype<UnmanagedFloat64Array>(qPtr as usize);
  let p = changetype<UnmanagedFloat64Array>(pPtr as usize);
  let f = changetype<UnmanagedFloat64Array>(fPtr as usize);
  let halfDt = 0.5 * dt;

  // 1. Evaluate forces at q0
  computeDerivatives(dae, qPtr, fPtr);

  // 2. Half kick: p_{1/2} = p0 + 0.5 * dt * F(q0)
  //    Full drift: q1 = q0 + dt * p_{1/2}
  for (let i: u32 = 0; i < n; i++) {
    p[i] += halfDt * f[n + i];
    q[i] += dt * p[i];
  }

  // 3. Evaluate forces at q1
  computeDerivatives(dae, qPtr, fPtr);

  // 4. Second half kick: p1 = p_{1/2} + 0.5 * dt * F(q1)
  for (let i: u32 = 0; i < n; i++) {
    p[i] += halfDt * f[n + i];
  }
}

/**
 * Ruth-3: 3rd-order 3-stage symplectic integrator.
 */
export function stepRuth3(
  dae: DaeBuilder,
  qPtr: u32,
  pPtr: u32,
  fPtr: u32,
  n: u32,
  dt: f64
): void {
  let q = changetype<UnmanagedFloat64Array>(qPtr as usize);
  let p = changetype<UnmanagedFloat64Array>(pPtr as usize);
  let f = changetype<UnmanagedFloat64Array>(fPtr as usize);

  const c1: f64 = 7.0 / 24.0;
  const c2: f64 = 3.0 / 4.0;
  const c3: f64 = -1.0 / 24.0;

  const d1: f64 = 2.0 / 3.0;
  const d2: f64 = -2.0 / 3.0;
  const d3: f64 = 1.0;

  // Stage 1
  for (let i: u32 = 0; i < n; i++) q[i] += c1 * dt * p[i];
  computeDerivatives(dae, qPtr, fPtr);
  for (let i: u32 = 0; i < n; i++) p[i] += d1 * dt * f[n + i];

  // Stage 2
  for (let i: u32 = 0; i < n; i++) q[i] += c2 * dt * p[i];
  computeDerivatives(dae, qPtr, fPtr);
  for (let i: u32 = 0; i < n; i++) p[i] += d2 * dt * f[n + i];

  // Stage 3
  for (let i: u32 = 0; i < n; i++) q[i] += c3 * dt * p[i];
  computeDerivatives(dae, qPtr, fPtr);
  for (let i: u32 = 0; i < n; i++) p[i] += d3 * dt * f[n + i];
}

/**
 * Candy-Rozmus / Forest-Ruth: 4th-order 4-stage symplectic integrator.
 */
export function stepCandyRozmus4(
  dae: DaeBuilder,
  qPtr: u32,
  pPtr: u32,
  fPtr: u32,
  n: u32,
  dt: f64
): void {
  let q = changetype<UnmanagedFloat64Array>(qPtr as usize);
  let p = changetype<UnmanagedFloat64Array>(pPtr as usize);
  let f = changetype<UnmanagedFloat64Array>(fPtr as usize);

  const theta: f64 = 1.351207191959657;

  const c1: f64 = theta * 0.5;
  const c2: f64 = (1.0 - theta) * 0.5;
  const c3: f64 = c2;
  const c4: f64 = c1;

  const d1: f64 = theta;
  const d2: f64 = 1.0 - 2.0 * theta;
  const d3: f64 = theta;

  // Stage 1
  for (let i: u32 = 0; i < n; i++) q[i] += c1 * dt * p[i];
  computeDerivatives(dae, qPtr, fPtr);
  for (let i: u32 = 0; i < n; i++) p[i] += d1 * dt * f[n + i];

  // Stage 2
  for (let i: u32 = 0; i < n; i++) q[i] += c2 * dt * p[i];
  computeDerivatives(dae, qPtr, fPtr);
  for (let i: u32 = 0; i < n; i++) p[i] += d2 * dt * f[n + i];

  // Stage 3
  for (let i: u32 = 0; i < n; i++) q[i] += c3 * dt * p[i];
  computeDerivatives(dae, qPtr, fPtr);
  for (let i: u32 = 0; i < n; i++) p[i] += d3 * dt * f[n + i];

  // Stage 4 (d4 = 0, coordinate drift only)
  for (let i: u32 = 0; i < n; i++) q[i] += c4 * dt * p[i];
}

/**
 * Universal dispatcher for symplectic integration.
 */
export function stepSymplectic(
  dae: DaeBuilder,
  qPtr: u32,
  pPtr: u32,
  scratchPtr: u32,
  n: u32,
  dt: f64,
  order: i32 = 4
): void {
  if (order <= 2) {
    stepVelocityVerlet(dae, qPtr, pPtr, scratchPtr, n, dt);
  } else if (order == 3) {
    stepRuth3(dae, qPtr, pPtr, scratchPtr, n, dt);
  } else {
    stepCandyRozmus4(dae, qPtr, pPtr, scratchPtr, n, dt);
  }
}

// ── WebAssembly FFI Exports ──

export function sim_stepSymplectic(
  daePtr: u32,
  qPtr: u32,
  pPtr: u32,
  scratchPtr: u32,
  n: u32,
  dt: f64,
  order: i32
): void {
  stepSymplectic(changetype<DaeBuilder>(daePtr), qPtr, pPtr, scratchPtr, n, dt, order);
}
