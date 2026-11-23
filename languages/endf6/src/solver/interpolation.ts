// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Exact ENDF-6 `INT=1..5` Tabulated Function Interpolation.
 *
 * Implements the 5 standard ENDF-6 interpolation laws (ENDF-102 Section 0.5.2):
 *   - `INT=1`: Histogram (y is constant in x: `y = y1`)
 *   - `INT=2`: Linear-Linear (y is linear in x)
 *   - `INT=3`: Linear-Log (y is linear in ln(x))
 *   - `INT=4`: Log-Linear (ln(y) is linear in x)
 *   - `INT=5`: Log-Log (ln(y) is linear in ln(x))
 */

import type { Endf6InterpolationRegion, Endf6Tab1Record } from "../types.js";

/**
 * Interpolates a single interval `(x1, y1) -> (x2, y2)` at `x` using ENDF-6 law `interp` (`1..5`).
 */
export function interpolateEndfPair(x: number, x1: number, y1: number, x2: number, y2: number, interp: number): number {
  if (x <= x1 || x2 === x1) return y1;
  if (x >= x2) return y2;

  switch (interp) {
    case 1:
      // Histogram: constant y1 over [x1, x2)
      return y1;

    case 2:
      // Linear-Linear: y = y1 + (y2 - y1) * (x - x1) / (x2 - x1)
      return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);

    case 3: {
      // Linear-Log: y is linear in ln(x)
      if (x1 <= 0 || x2 <= 0 || x <= 0) {
        return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
      }
      const frac = Math.log(x / x1) / Math.log(x2 / x1);
      return y1 + (y2 - y1) * frac;
    }

    case 4: {
      // Log-Linear: ln(y) is linear in x
      if (y1 <= 0 || y2 <= 0) {
        return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
      }
      const frac = (x - x1) / (x2 - x1);
      return y1 * Math.pow(y2 / y1, frac);
    }

    case 5: {
      // Log-Log: ln(y) is linear in ln(x)
      if (x1 <= 0 || x2 <= 0 || x <= 0 || y1 <= 0 || y2 <= 0) {
        return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
      }
      const slope = Math.log(y2 / y1) / Math.log(x2 / x1);
      return y1 * Math.pow(x / x1, slope);
    }

    default:
      // Fallback to linear-linear for non-standard codes
      return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
}

/**
 * Resolves the ENDF-6 interpolation law `INT` applicable to interval `[index, index + 1]`
 * (where `index` is 0-based, so upper point index is `index + 2` in 1-based ENDF indexing).
 */
export function findRegionInterp(regions: readonly Endf6InterpolationRegion[], upperIndexOneBased: number): number {
  for (const r of regions) {
    if (upperIndexOneBased <= r.nbt) {
      return r.interp;
    }
  }
  return regions.length > 0 ? regions[regions.length - 1]!.interp : 2;
}

/**
 * Evaluates an ENDF-6 `TAB1` tabulated cross-section record at incident neutron energy `energy` (eV).
 *
 * Uses binary search on the energy grid and applies the region's ENDF `INT=1..5` law.
 * Energies below the first tabulated point return `0` (threshold) unless exact match;
 * energies above the last point return the last tabulated value (or `0` if `clampOutOfRange` is false).
 */
export function evaluateTab1(
  tab1: Endf6Tab1Record,
  energy: number,
  options?: { clampOutOfRange?: boolean | undefined },
): number {
  const pts = tab1.points;
  const n = pts.length;
  if (n === 0) return 0;
  if (n === 1) return energy === pts[0]!.x || options?.clampOutOfRange ? pts[0]!.y : 0;

  if (energy < pts[0]!.x) {
    return options?.clampOutOfRange ? pts[0]!.y : 0;
  }
  if (energy === pts[0]!.x) return pts[0]!.y;
  if (energy > pts[n - 1]!.x) {
    return options?.clampOutOfRange ? pts[n - 1]!.y : 0;
  }
  if (energy === pts[n - 1]!.x) return pts[n - 1]!.y;

  // Binary search for interval [lo, lo + 1] with pts[lo].x <= energy <= pts[lo + 1].x
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (pts[mid]!.x <= energy) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const p1 = pts[lo]!;
  const p2 = pts[lo + 1]!;
  if (energy === p1.x) return p1.y;
  if (energy === p2.x) return p2.y;

  const interp = findRegionInterp(tab1.regions, lo + 2);
  return interpolateEndfPair(energy, p1.x, p1.y, p2.x, p2.y, interp);
}
