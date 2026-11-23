// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript geometry & unit conversion kernel for `@modelscript/iges-std-lib`.
 */

const TWO_PI: f64 = 6.283185307179586;

/**
 * Convert an IGES 5.3 unit flag (1..11) to SI meters per model unit.
 */
export function igesUnitToMeters(unitFlag: i32): f64 {
  switch (unitFlag) {
    case 1:
      return 0.0254; // inch
    case 2:
      return 0.001; // millimeter
    case 3:
      return 1.0; // special
    case 4:
      return 0.3048; // foot
    case 5:
      return 1609.344; // mile
    case 6:
      return 1.0; // meter
    case 7:
      return 1000.0; // kilometer
    case 8:
      return 0.0000254; // mil
    case 9:
      return 1e-6; // micron
    case 10:
      return 0.01; // centimeter
    case 11:
      return 2.54e-8; // microinch
    default:
      return 1.0;
  }
}

/**
 * Compute 3D Euclidean length of an IGES Type 110 Line segment.
 */
export function igesLineLength(x1: f64, y1: f64, z1: f64, x2: f64, y2: f64, z2: f64): f64 {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Compute exact arc length of an IGES Type 100 Circular Arc (CCW from start to end; full circle if start == end).
 */
export function igesArcLength(cx: f64, cy: f64, sx: f64, sy: f64, ex: f64, ey: f64): f64 {
  const r = Math.hypot(sx - cx, sy - cy);
  if (r <= 1e-12) return 0.0;
  const startAngle = Math.atan2(sy - cy, sx - cx);
  const endAngle = Math.atan2(ey - cy, ex - cx);
  const same = Math.hypot(ex - sx, ey - sy) <= 1e-9 * r;
  let sweep = endAngle - startAngle;
  if (same) {
    sweep = TWO_PI;
  } else if (sweep <= 0.0) {
    sweep += TWO_PI;
  }
  return r * sweep;
}

/**
 * Evaluate a quadratic rational Bezier / NURBS curve (degree 2, 3 control points) at parameter `t` in [0, 1].
 * Returns the X coordinate (call with Y/Z coordinates for Y/Z).
 */
export function igesQuadNurbsCoord(p0: f64, p1: f64, p2: f64, w0: f64, w1: f64, w2: f64, t: f64): f64 {
  const u = 1.0 - t;
  const b0 = u * u * w0;
  const b1 = 2.0 * u * t * w1;
  const b2 = t * t * w2;
  const denom = b0 + b1 + b2;
  if (denom == 0.0) return 0.0;
  return (b0 * p0 + b1 * p1 + b2 * p2) / denom;
}

/**
 * Unified kernel entry point returning archetype-specific metric (arc length / line length / unit scale).
 */
export function igesEvalKernel(archetypeId: i32, a: f64, b: f64, c: f64, d: f64): f64 {
  if (archetypeId == 100) {
    return igesArcLength(0.0, 0.0, a, b, c, d);
  }
  if (archetypeId == 110) {
    return igesLineLength(a, b, 0.0, c, d, 0.0);
  }
  if (archetypeId >= 1001 && archetypeId <= 1011) {
    return igesUnitToMeters(archetypeId - 1000);
  }
  return 0.0;
}
