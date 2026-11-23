// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript topographic & synthetic terrain runtime for `@modelscript/usgs-dem-std-lib`.
 *
 * Implements analytical synthetic terrain surfaces (Gaussian hill, inclined plane, V-valley)
 * and Manning kinematic-wave overland runoff evaluation in zero-GC WebAssembly linear memory.
 */

const ARCH_GAUSSIAN_HILL: i32 = 10;
const ARCH_INCLINED_PLANE: i32 = 11;
const ARCH_V_VALLEY: i32 = 12;
const ARCH_MANNING_KINEMATIC_WAVE: i32 = 22;

/**
 * Evaluates a canonical USGS DEM archetype at coordinates (x, y) with up to 4 parameters.
 *
 * - ARCH_GAUSSIAN_HILL (10): p0=z0, p1=H, p2=sigma, p3=0 -> z(x,y) = z0 + H * exp(-(x^2 + y^2)/(2*sigma^2))
 * - ARCH_INCLINED_PLANE (11): p0=z0, p1=gradX, p2=gradY, p3=0 -> z(x,y) = z0 + gradX*x + gradY*y
 * - ARCH_V_VALLEY (12): p0=z0, p1=sideSlope, p2=channelSlope, p3=xc -> z(x,y) = z0 + sideSlope*|x-xc| + channelSlope*y
 * - ARCH_MANNING_KINEMATIC_WAVE (22): x=depth h, y=0, p0=manningN, p1=slope -> q = (sqrt(slope)/manningN) * h^(5/3)
 */
export function usgsDemEval(archetypeId: i32, x: f64, y: f64, p0: f64, p1: f64, p2: f64, p3: f64): f64 {
  if (archetypeId == ARCH_GAUSSIAN_HILL) {
    const sigma = p2 > 1e-9 ? p2 : 1.0;
    const r2 = x * x + y * y;
    return p0 + p1 * Math.exp(-r2 / (2.0 * sigma * sigma));
  }
  if (archetypeId == ARCH_INCLINED_PLANE) {
    return p0 + p1 * x + p2 * y;
  }
  if (archetypeId == ARCH_V_VALLEY) {
    return p0 + p1 * Math.abs(x - p3) + p2 * y;
  }
  if (archetypeId == ARCH_MANNING_KINEMATIC_WAVE) {
    const n = p0 > 1e-6 ? p0 : 0.035;
    const s = p1 > 0.0 ? p1 : 0.0;
    const h = x > 0.0 ? x : 0.0;
    return (Math.sqrt(s) / n) * Math.pow(h, 5.0 / 3.0);
  }
  return 0.0;
}

/**
 * Evaluates Horn (1981) slope magnitude in degrees from partial derivatives dzdx and dzdy.
 */
export function usgsDemSlopeDeg(dzdx: f64, dzdy: f64): f64 {
  const grad = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
  return Math.atan(grad) * (180.0 / Math.PI);
}
