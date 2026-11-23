// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript geometry kernel for `@modelscript/dxf-std-lib`.
 *
 * Provides zero-GC linear-memory analytical geometry evaluators for DXF primitives:
 * LINE, ARC, CIRCLE, LWPOLYLINE bulge arcs, ELLIPSE, 3DFACE triangles, and INSERT 2D transforms.
 */

const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;
const DEG_TO_RAD: f64 = 0.017453292519943295;

/** Euclidean length of a 3D LINE segment. */
export function dxfLineLength(x1: f64, y1: f64, z1: f64, x2: f64, y2: f64, z2: f64): f64 {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Circumference of a CIRCLE entity. */
export function dxfCircleCircumference(radius: f64): f64 {
  return radius > 0.0 ? TWO_PI * radius : 0.0;
}

/** Area of a CIRCLE entity. */
export function dxfCircleArea(radius: f64): f64 {
  return radius > 0.0 ? PI * radius * radius : 0.0;
}

/** Arc length of a CCW ARC entity given radius and angles in degrees. */
export function dxfArcLength(radius: f64, startDeg: f64, endDeg: f64): f64 {
  if (radius <= 0.0) return 0.0;
  let sweep = (endDeg - startDeg) % 360.0;
  if (sweep < 0.0) sweep += 360.0;
  if (sweep == 0.0 && endDeg != startDeg) sweep = 360.0;
  return radius * sweep * DEG_TO_RAD;
}

/** Exact arc length of an LWPOLYLINE bulge segment (bulge = tan(theta / 4)). */
export function dxfBulgeArcLength(x1: f64, y1: f64, x2: f64, y2: f64, bulge: f64): f64 {
  const chord = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  const absB = Math.abs(bulge);
  if (absB <= 1e-12) return chord;
  const theta = 4.0 * Math.atan(absB);
  const radius = (chord * (1.0 + bulge * bulge)) / (4.0 * absB);
  return radius * theta;
}

/** Exact signed circular segment area of an LWPOLYLINE bulge segment. */
export function dxfBulgeSegmentArea(x1: f64, y1: f64, x2: f64, y2: f64, bulge: f64): f64 {
  const absB = Math.abs(bulge);
  if (absB <= 1e-12) return 0.0;
  const chord = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  if (chord <= 1e-12) return 0.0;
  const theta = 4.0 * Math.atan(absB);
  const radius = (chord * (1.0 + bulge * bulge)) / (4.0 * absB);
  const sign: f64 = bulge > 0.0 ? 1.0 : -1.0;
  return sign * 0.5 * radius * radius * (theta - Math.sin(theta));
}

/** Full area of an ELLIPSE entity given semi-major radius and minor/major ratio. */
export function dxfEllipseArea(majorRadius: f64, ratio: f64): f64 {
  if (majorRadius <= 0.0 || ratio <= 0.0) return 0.0;
  return PI * majorRadius * (majorRadius * ratio);
}

/** Area of a 3D triangle (used for 3DFACE surface evaluation). */
export function dxfTriangleArea3D(
  x0: f64, y0: f64, z0: f64,
  x1: f64, y1: f64, z1: f64,
  x2: f64, y2: f64, z2: f64,
): f64 {
  const abx = x1 - x0;
  const aby = y1 - y0;
  const abz = z1 - z0;
  const acx = x2 - x0;
  const acy = y2 - y0;
  const acz = z2 - z0;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/** Transforms a 2D point's X coordinate under an INSERT (scale, CCW rotation in degrees, translation). */
export function dxfInsertTransformX(x: f64, y: f64, sx: f64, sy: f64, rotDeg: f64, tx: f64): f64 {
  const rad = rotDeg * DEG_TO_RAD;
  return Math.cos(rad) * (x * sx) - Math.sin(rad) * (y * sy) + tx;
}

/** Transforms a 2D point's Y coordinate under an INSERT (scale, CCW rotation in degrees, translation). */
export function dxfInsertTransformY(x: f64, y: f64, sx: f64, sy: f64, rotDeg: f64, ty: f64): f64 {
  const rad = rotDeg * DEG_TO_RAD;
  return Math.sin(rad) * (x * sx) + Math.cos(rad) * (y * sy) + ty;
}
