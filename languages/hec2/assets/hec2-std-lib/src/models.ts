// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript open-channel hydraulics runtime for `@modelscript/hec2-std-lib`.
 *
 * Implements Manning's conveyance equation, normal uniform flow velocity, and
 * USACE HEC-2 contraction/expansion head-loss kernels with zero-GC linear memory.
 */

const PHI_US: f64 = 1.486;
const PHI_SI: f64 = 1.0;

/**
 * Computes Manning conveyance: K = (phi / n) * A * R^(2/3).
 * @param n Manning roughness coefficient (> 0)
 * @param area Cross-sectional flow area A
 * @param hydraulicRadius Hydraulic radius R = A / P
 * @param isSi 1 for SI (phi = 1.0), 0 for US Customary (phi = 1.486)
 */
export function hec2ManningConveyance(n: f64, area: f64, hydraulicRadius: f64, isSi: i32): f64 {
  if (n <= 0.0 || area <= 0.0 || hydraulicRadius <= 0.0) return 0.0;
  const phi: f64 = isSi != 0 ? PHI_SI : PHI_US;
  return (phi / n) * area * Math.pow(hydraulicRadius, 2.0 / 3.0);
}

/**
 * Computes Manning uniform-flow velocity: V = (phi / n) * R^(2/3) * S^(1/2).
 */
export function hec2ManningVelocity(n: f64, hydraulicRadius: f64, slope: f64, isSi: i32): f64 {
  if (n <= 0.0 || hydraulicRadius <= 0.0 || slope <= 0.0) return 0.0;
  const phi: f64 = isSi != 0 ? PHI_SI : PHI_US;
  return (phi / n) * Math.pow(hydraulicRadius, 2.0 / 3.0) * Math.sqrt(slope);
}

/**
 * Computes HEC-2 contraction/expansion eddy head loss:
 *   h_ce = C * |hvUp - hvDown|
 * where C = cchv when hvUp > hvDown (contraction), else cehv (expansion).
 */
export function hec2TransitionHeadLoss(hvDown: f64, hvUp: f64, cchv: f64, cehv: f64): f64 {
  const diff: f64 = hvUp - hvDown;
  const coef: f64 = diff > 0.0 ? cchv : cehv;
  return coef * Math.abs(diff);
}

/**
 * Returns default normal Manning's n for a cleanroom Chow/USACE archetype ID (1..33).
 */
export function hec2DefaultManningN(archetypeId: i32): f64 {
  switch (archetypeId) {
    case 1:
      return 0.013; // CONCRETE_TROWELED
    case 2:
      return 0.015; // CONCRETE_FLOAT_FINISHED
    case 3:
      return 0.017; // CONCRETE_UNFINISHED
    case 4:
      return 0.019; // CONCRETE_SHOTCRETE
    case 10:
      return 0.018; // EARTH_CLEAN_STRAIGHT
    case 11:
      return 0.025; // EARTH_GRAVEL_UNIFORM
    case 12:
      return 0.027; // EARTH_SHORT_GRASS_WEEDS
    case 13:
      return 0.08; // EARTH_DENSE_WEEDS
    case 20:
      return 0.03; // STREAM_CLEAN_STRAIGHT
    case 21:
      return 0.04; // STREAM_WINDING_POOLS
    case 22:
      return 0.07; // STREAM_SLUGGISH_WEEDY
    case 23:
      return 0.05; // STREAM_MOUNTAIN_COBBLES
    case 30:
      return 0.03; // FLOODPLAIN_PASTURE_SHORT
    case 31:
      return 0.035; // FLOODPLAIN_CULTIVATED_CROPS
    case 32:
      return 0.05; // FLOODPLAIN_SCATTERED_BRUSH
    case 33:
      return 0.1; // FLOODPLAIN_HEAVY_TIMBER
    default:
      return 0.03;
  }
}

/**
 * Evaluates conveyance using a cleanroom archetype's default Manning's n.
 */
export function hec2EvalHydraulics(archetypeId: i32, area: f64, hydraulicRadius: f64, isSi: i32): f64 {
  const n = hec2DefaultManningN(archetypeId);
  return hec2ManningConveyance(n, area, hydraulicRadius, isSi);
}
