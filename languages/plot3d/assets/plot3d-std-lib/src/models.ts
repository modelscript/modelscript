// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript CFD runtime for `@modelscript/plot3d-std-lib`.
 *
 * Implements zero-GC structured hexahedral volume and isentropic Euler flow
 * evaluation kernels for standard PLOT3D archetypes.
 */

export function plot3dGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Evaluates static pressure from conservative Euler state (rho, rhou, rhov, rhow, e).
 */
export function plot3dStaticPressure(
  rho: f64,
  rhou: f64,
  rhov: f64,
  rhow: f64,
  energy: f64,
  gamma: f64,
): f64 {
  if (rho <= 0.0) return 0.0;
  const ke = (0.5 * (rhou * rhou + rhov * rhov + rhow * rhow)) / rho;
  return (gamma - 1.0) * (energy - ke);
}

/**
 * Evaluates local Mach number from conservative Euler state.
 */
export function plot3dMachNumber(
  rho: f64,
  rhou: f64,
  rhov: f64,
  rhow: f64,
  energy: f64,
  gamma: f64,
): f64 {
  if (rho <= 0.0) return 0.0;
  const p = plot3dStaticPressure(rho, rhou, rhov, rhow, energy, gamma);
  if (p <= 0.0) return 0.0;
  const a = Math.sqrt((gamma * p) / rho);
  const v = Math.sqrt(rhou * rhou + rhov * rhov + rhow * rhow) / rho;
  return a > 0.0 ? v / a : 0.0;
}

/**
 * Evaluates isentropic total-to-static pressure ratio p0 / p = (1 + (gamma - 1)/2 * M^2)^(gamma / (gamma - 1)).
 */
export function plot3dTotalPressureRatio(mach: f64, gamma: f64): f64 {
  const gm1 = gamma - 1.0;
  const base = 1.0 + 0.5 * gm1 * mach * mach;
  return Math.pow(base, gamma / gm1);
}

/**
 * Evaluates archetype summary metric (e.g., total box volume for Grid3D, p0/p for SolutionQ/Nozzle).
 */
export function plot3dEvalArchetype(archetypeId: i32, p0: f64, p1: f64, p2: f64): f64 {
  if (archetypeId == 1 || archetypeId == 5) {
    // Grid3D / FlatPlateMesh: bounding volume lx * ly * lz
    return p0 * p1 * p2;
  }
  if (archetypeId == 2 || archetypeId == 4) {
    // SolutionQ / IsentropicNozzle: isentropic total pressure ratio for (mach=p0, gamma=p1)
    const gamma = p1 > 1.0 ? p1 : 1.4;
    return plot3dTotalPressureRatio(p0, gamma);
  }
  // FunctionF: total node-variable entries
  return p0 * p1 * p2;
}
