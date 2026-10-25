// SPDX-License-Identifier: AGPL-3.0-or-later

import { getWasmContactBridge } from "./wasm-bridge.js";

export interface PolachContactInput {
  normalForce: number; // Q [N]
  longitudinalCreep: number; // sx [-]
  lateralCreep: number; // sy [-]
  wheelVelocity: number; // forward speed v [m/s]
  ellipseSemiMajor: number; // a [m]
  ellipseSemiMinor: number; // b [m]
  shearModulus?: number; // G [Pa], default 8.2e10
  poissonRatio?: number; // nu [-], default 0.28
  staticFriction?: number; // f0 [-], default 0.40
  kineticFrictionRatio?: number; // k_inf (ratio of dynamic to static friction), default 0.75
  frictionDecayRate?: number; // B [s/m], default 0.4
}

export interface PolachContactOutput {
  fx: number; // longitudinal creep force [N]
  fy: number; // lateral creep force [N]
  resultantForce: number; // sqrt(fx^2 + fy^2) [N]
  effectiveFrictionCoeff: number; // current friction mu(v_slip)
  adhesionRatio: number; // utilized friction fraction
}

/**
 * Pure TypeScript reference implementation of Polach non-linear creep theory.
 */
export function pureTsSolvePolach(input: PolachContactInput): PolachContactOutput {
  const {
    normalForce: Q,
    longitudinalCreep: sx,
    lateralCreep: sy,
    wheelVelocity: v,
    ellipseSemiMajor: a,
    ellipseSemiMinor: b,
    shearModulus: G = 8.2e10,
    poissonRatio: nu = 0.28,
    staticFriction: f0 = 0.4,
    kineticFrictionRatio: kInf = 0.75,
    frictionDecayRate: B = 0.4,
  } = input;

  if (Q <= 0 || a <= 0 || b <= 0) {
    return { fx: 0, fy: 0, resultantForce: 0, effectiveFrictionCoeff: f0, adhesionRatio: 0 };
  }

  const sMag = Math.sqrt(sx * sx + sy * sy);
  if (sMag < 1e-9) {
    return { fx: 0, fy: 0, resultantForce: 0, effectiveFrictionCoeff: f0, adhesionRatio: 0 };
  }

  const w = Math.max(0, v) * sMag;
  const mu = f0 * ((1 - kInf) * Math.exp(-B * w) + kInf);
  const C = (3 / 8) * Math.PI * G * Math.sqrt(a * b) * (1 - nu);
  const epsilon = ((2 / 3) * C * sMag) / Math.max(1e-6, mu * Q);

  const factor = (2 * mu * Q) / Math.PI;
  const F = factor * (epsilon / (1 + epsilon * epsilon) + Math.atan(epsilon));

  const fx = F * (sx / sMag);
  const fy = F * (sy / sMag);
  const adhesionRatio = Math.min(1.0, F / Math.max(1e-6, mu * Q));

  return {
    fx,
    fy,
    resultantForce: F,
    effectiveFrictionCoeff: mu,
    adhesionRatio,
  };
}

/**
 * Polach Non-Linear Wheel-Rail Creep Theory:
 * Models tangential rolling contact with variable friction saturation and slip-velocity dependency:
 *   mu(w) = f_0 * ( (1 - A) * e^(-B*w) + A )
 * where w = v * sqrt(sx^2 + sy^2) is the total sliding velocity.
 *
 * Accelerated via WebAssembly linear memory kernel with transparent TypeScript fallback.
 */
export function solvePolach(input: PolachContactInput): PolachContactOutput {
  try {
    return getWasmContactBridge().solvePolach(input);
  } catch {
    return pureTsSolvePolach(input);
  }
}
