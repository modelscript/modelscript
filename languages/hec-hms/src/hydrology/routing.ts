// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Muskingum and channel routing routines for HEC-HMS.
 */

import type { HmsHydrographPoint } from "../types.js";

export interface MuskingumOptions {
  kHours: number; // Travel time K
  x: number; // Weighting factor (0.0 to 0.5)
  subreaches?: number; // Number of subreaches
}

/**
 * Routes an inflow hydrograph through a reach using the Muskingum method.
 */
export function routeMuskingum(inflow: HmsHydrographPoint[], options: MuskingumOptions): HmsHydrographPoint[] {
  if (inflow.length < 2) return [...inflow];

  const dt = inflow[1]!.timeHours - inflow[0]!.timeHours;
  const subreaches = Math.max(1, options.subreaches ?? 1);
  const kSub = options.kHours / subreaches;
  const x = Math.max(0.0, Math.min(0.5, options.x));

  let currentInflow = inflow.map((p) => p.flow);

  // Route through each subreach
  for (let s = 0; s < subreaches; s++) {
    const denom = 2.0 * kSub * (1.0 - x) + dt;
    const c0 = (dt - 2.0 * kSub * x) / denom;
    const c1 = (dt + 2.0 * kSub * x) / denom;
    const c2 = (2.0 * kSub * (1.0 - x) - dt) / denom;

    const outFlows = new Float64Array(currentInflow.length);
    outFlows[0] = currentInflow[0]!;

    for (let i = 1; i < currentInflow.length; i++) {
      outFlows[i] = Math.max(0.0, c0 * currentInflow[i]! + c1 * currentInflow[i - 1]! + c2 * outFlows[i - 1]!);
    }

    currentInflow = Array.from(outFlows);
  }

  return inflow.map((p, idx) => ({
    timeHours: p.timeHours,
    flow: currentInflow[idx]!,
  }));
}
