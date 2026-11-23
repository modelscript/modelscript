// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * USACE HEC-1 Muskingum Channel Routing (`RM` card).
 *
 * Implements multi-subreach Muskingum routing:
 *   O_i = C0 * I_i + C1 * I_{i-1} + C2 * O_{i-1}
 * where:
 *   C0 = (dt - 2 * K_sub * X) / (2 * K_sub * (1 - X) + dt)
 *   C1 = (dt + 2 * K_sub * X) / (2 * K_sub * (1 - X) + dt)
 *   C2 = (2 * K_sub * (1 - X) - dt) / (2 * K_sub * (1 - X) + dt)
 * satisfying C0 + C1 + C2 === 1 identically for exact mass conservation.
 */

import type { Hec1HydrographPoint } from "../types.js";

export interface MuskingumRoutingOptions {
  /** Total travel time K (hours). */
  kHours: number;
  /** Weighting factor X in [0, 0.5]. */
  x: number;
  /** Number of subreaches NSTPS (>= 1). */
  nstps?: number | undefined;
  /** Optional explicit dt (hours); inferred from inflow timestamps if omitted. */
  dtHours?: number | undefined;
}

export interface MuskingumCoefficients {
  kSub: number;
  c0: number;
  c1: number;
  c2: number;
  /** True when dt / (2 * K_sub) >= X (i.e., C0 >= 0) and C2 >= 0. */
  stable: boolean;
}

/**
 * Computes Muskingum routing coefficients (C0, C1, C2) for a single subreach.
 */
export function computeMuskingumCoefficients(
  kHours: number,
  x: number,
  dtHours: number,
  nstps = 1,
): MuskingumCoefficients {
  const steps = Math.max(1, Math.round(nstps));
  const kSub = Math.max(1e-9, kHours) / steps;
  const safeX = Math.max(0.0, Math.min(0.5, x));
  const denom = 2.0 * kSub * (1.0 - safeX) + dtHours;

  const c0 = (dtHours - 2.0 * kSub * safeX) / denom;
  const c1 = (dtHours + 2.0 * kSub * safeX) / denom;
  const c2 = (2.0 * kSub * (1.0 - safeX) - dtHours) / denom;

  return {
    kSub,
    c0,
    c1,
    c2,
    stable: c0 >= -1e-12 && c2 >= -1e-12,
  };
}

/**
 * Routes an inflow hydrograph through `nstps` Muskingum subreaches.
 */
export function routeMuskingum(
  inflow: readonly Hec1HydrographPoint[],
  options: MuskingumRoutingOptions,
): Hec1HydrographPoint[] {
  if (inflow.length === 0) return [];
  if (inflow.length === 1) return [{ timeHours: inflow[0]!.timeHours, flow: inflow[0]!.flow }];

  const dt = options.dtHours ?? inflow[1]!.timeHours - inflow[0]!.timeHours;
  const nstps = Math.max(1, Math.round(options.nstps ?? 1));
  const { c0, c1, c2 } = computeMuskingumCoefficients(options.kHours, options.x, dt, nstps);

  let current = Float64Array.from(inflow, (p) => p.flow);

  for (let s = 0; s < nstps; s++) {
    const out = new Float64Array(current.length);
    out[0] = current[0]!;
    for (let i = 1; i < current.length; i++) {
      out[i] = c0 * current[i]! + c1 * current[i - 1]! + c2 * out[i - 1]!;
    }
    current = out;
  }

  return inflow.map((p, idx) => ({
    timeHours: p.timeHours,
    flow: current[idx]!,
  }));
}

/**
 * Computes trapezoidal integral of a hydrograph (volume in flow-unit * hours).
 */
export function integrateHydrographVolume(hydrograph: readonly Hec1HydrographPoint[]): number {
  if (hydrograph.length < 2) return 0.0;
  let vol = 0.0;
  for (let i = 1; i < hydrograph.length; i++) {
    const dt = hydrograph[i]!.timeHours - hydrograph[i - 1]!.timeHours;
    vol += 0.5 * (hydrograph[i - 1]!.flow + hydrograph[i]!.flow) * dt;
  }
  return vol;
}
