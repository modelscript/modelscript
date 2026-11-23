// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript geometry & shading kernel for `@modelscript/obj-std-lib`.
 */

/**
 * Compute the 3D surface area of a triangle (p0, p1, p2).
 */
export function objTriangleArea(
  x0: f64,
  y0: f64,
  z0: f64,
  x1: f64,
  y1: f64,
  z1: f64,
  x2: f64,
  y2: f64,
  z2: f64,
): f64 {
  const ux = x1 - x0;
  const uy = y1 - y0;
  const uz = z1 - z0;
  const vx = x2 - x0;
  const vy = y2 - y0;
  const vz = z2 - z0;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Compute the signed volume of the tetrahedron formed by the origin and triangle (p0, p1, p2).
 */
export function objSignedTetVolume(
  x0: f64,
  y0: f64,
  z0: f64,
  x1: f64,
  y1: f64,
  z1: f64,
  x2: f64,
  y2: f64,
  z2: f64,
): f64 {
  const cx = y1 * z2 - z1 * y2;
  const cy = z1 * x2 - x1 * z2;
  const cz = x1 * y2 - y1 * x2;
  return (x0 * cx + y0 * cy + z0 * cz) / 6.0;
}

/**
 * Compute Schlick Fresnel reflectance for index of refraction `ni` and view-normal cosine `cosTheta`.
 */
export function objFresnelSchlick(ni: f64, cosTheta: f64): f64 {
  const r0Raw = (1.0 - ni) / (1.0 + ni);
  const r0 = r0Raw * r0Raw;
  const c = cosTheta < 0.0 ? 0.0 : cosTheta > 1.0 ? 1.0 : cosTheta;
  const m = 1.0 - c;
  return r0 + (1.0 - r0) * m * m * m * m * m;
}

/**
 * Compute Blinn-Phong specular highlight term `(max(0, N·H))^Ns`.
 */
export function objSpecularTerm(ndoth: f64, ns: f64): f64 {
  if (ndoth <= 0.0) return 0.0;
  const clamped = ndoth > 1.0 ? 1.0 : ndoth;
  const exp = ns < 1.0 ? 1.0 : ns;
  return Math.pow(clamped, exp);
}

/**
 * Unified kernel entry point returning archetype-specific surface area, volume, or optical reflectance.
 */
export function objEvalKernel(archetypeId: i32, a: f64, b: f64, c: f64, d: f64): f64 {
  // UnitCube volume: a * b * c
  if (archetypeId == 1) {
    return a * b * c;
  }
  // Tetrahedron volume: a^3 / (6 * sqrt(2))
  if (archetypeId == 2) {
    return (a * a * a) / (6.0 * Math.SQRT2);
  }
  // Cylinder volume: pi * r^2 * h
  if (archetypeId == 4) {
    return Math.PI * a * a * b;
  }
  // UVSphere volume: (4/3) * pi * r^3
  if (archetypeId == 5) {
    return (4.0 / 3.0) * Math.PI * a * a * a;
  }
  // Engineering materials: return Fresnel reflectance at incidence cosine `b` for IOR `a`
  if (archetypeId >= 101 && archetypeId <= 105) {
    return objFresnelSchlick(a, b) + 0.0 * (c + d);
  }
  return 0.0;
}
