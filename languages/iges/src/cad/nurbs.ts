// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Cox-de Boor Rational B-Spline (NURBS) Curve (Type 126) & Surface (Type 128) Evaluator.
 *
 * Implements Algorithm A2.1 (FindSpan) and Algorithm A2.2 (BasisFuns) from
 * Piegl & Tiller, "The NURBS Book" (2nd ed.).
 */

import type { IgesNurbsCurveEntity, IgesNurbsSurfaceEntity, Point3D } from "../types.js";

/**
 * Find the knot span index `i` such that `knots[i] <= u < knots[i + 1]`
 * (or `i = n` at the right endpoint `u >= knots[n + 1]`).
 *
 * @param n Upper index of control points (`k` in IGES, so there are `n + 1` control points)
 * @param degree Degree `p` (`m` in IGES)
 * @param u Parameter value
 * @param knots Knot vector of length `n + p + 2`
 */
export function findKnotSpan(n: number, degree: number, u: number, knots: readonly number[]): number {
  if (u >= knots[n + 1]!) return n;
  if (u <= knots[degree]!) return degree;

  let low = degree;
  let high = n + 1;
  let mid = (low + high) >> 1;

  while (u < knots[mid]! || u >= knots[mid + 1]!) {
    if (u < knots[mid]!) {
      high = mid;
    } else {
      low = mid;
    }
    mid = (low + high) >> 1;
    if (high - low <= 1) break;
  }
  return mid;
}

/**
 * Compute the `degree + 1` non-vanishing B-spline basis functions `N_{span-degree, degree}(u) ... N_{span, degree}(u)`
 * using the numerically stable Cox-de Boor recurrence.
 */
export function computeBasisFunctions(span: number, u: number, degree: number, knots: readonly number[]): number[] {
  const N = new Array<number>(degree + 1).fill(0);
  const left = new Array<number>(degree + 1).fill(0);
  const right = new Array<number>(degree + 1).fill(0);

  N[0] = 1.0;

  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j]!;
    right[j] = knots[span + j]! - u;
    let saved = 0.0;

    for (let r = 0; r < j; r++) {
      const denom = right[r + 1]! + left[j - r]!;
      const temp = denom !== 0 ? N[r]! / denom : 0.0;
      N[r] = saved + right[r + 1]! * temp;
      saved = left[j - r]! * temp;
    }
    N[j] = saved;
  }

  return N;
}

/**
 * Evaluate a Type 126 Rational B-Spline Curve (NURBS) at parameter `u`.
 */
export function evaluateNurbsCurve(curve: IgesNurbsCurveEntity, u: number): Point3D {
  const n = curve.k;
  const p = curve.m;
  const clampedU = Math.min(Math.max(u, curve.v0), curve.v1);
  const span = findKnotSpan(n, p, clampedU, curve.knots);
  const basis = computeBasisFunctions(span, clampedU, p, curve.knots);

  let wx = 0;
  let wy = 0;
  let wz = 0;
  let wSum = 0;

  for (let j = 0; j <= p; j++) {
    const idx = span - p + j;
    const pt = curve.controlPoints[idx];
    const w = curve.weights[idx] ?? 1.0;
    if (!pt) continue;
    const bw = basis[j]! * w;
    wx += bw * pt[0];
    wy += bw * pt[1];
    wz += bw * pt[2];
    wSum += bw;
  }

  if (Math.abs(wSum) < 1e-15) {
    return [0, 0, 0];
  }
  return [wx / wSum, wy / wSum, wz / wSum];
}

/**
 * Tessellate a Type 126 NURBS curve uniformly across `[v0, v1]` into `samples + 1` points.
 */
export function tessellateNurbsCurve(curve: IgesNurbsCurveEntity, samples = 32): Point3D[] {
  const count = Math.max(2, samples);
  const pts: Point3D[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = curve.v0 + t * (curve.v1 - curve.v0);
    pts.push(evaluateNurbsCurve(curve, u));
  }
  return pts;
}

/**
 * Evaluate a Type 128 Tensor-Product Rational B-Spline Surface (NURBS) at `(u, v)`.
 */
export function evaluateNurbsSurface(surface: IgesNurbsSurfaceEntity, u: number, v: number): Point3D {
  const nU = surface.k1;
  const nV = surface.k2;
  const pU = surface.m1;
  const pV = surface.m2;

  const clampedU = Math.min(Math.max(u, surface.u0), surface.u1);
  const clampedV = Math.min(Math.max(v, surface.v0), surface.v1);

  const spanU = findKnotSpan(nU, pU, clampedU, surface.knotsU);
  const spanV = findKnotSpan(nV, pV, clampedV, surface.knotsV);

  const basisU = computeBasisFunctions(spanU, clampedU, pU, surface.knotsU);
  const basisV = computeBasisFunctions(spanV, clampedV, pV, surface.knotsV);

  let wx = 0;
  let wy = 0;
  let wz = 0;
  let wSum = 0;

  const stride = nU + 1;

  for (let l = 0; l <= pV; l++) {
    const jIdx = spanV - pV + l;
    const bv = basisV[l]!;
    for (let k = 0; k <= pU; k++) {
      const iIdx = spanU - pU + k;
      const flatIdx = jIdx * stride + iIdx;
      const pt = surface.controlPoints[flatIdx];
      const w = surface.weights[flatIdx] ?? 1.0;
      if (!pt) continue;
      const coeff = basisU[k]! * bv * w;
      wx += coeff * pt[0];
      wy += coeff * pt[1];
      wz += coeff * pt[2];
      wSum += coeff;
    }
  }

  if (Math.abs(wSum) < 1e-15) {
    return [0, 0, 0];
  }
  return [wx / wSum, wy / wSum, wz / wSum];
}

export interface TessellatedSurfaceMesh {
  vertices: Point3D[];
  triangles: Array<[number, number, number]>;
  surfaceArea: number;
}

/**
 * Tessellate a Type 128 NURBS surface into a triangle mesh and compute its surface area.
 */
export function tessellateNurbsSurface(
  surface: IgesNurbsSurfaceEntity,
  uSamples = 12,
  vSamples = 12,
): TessellatedSurfaceMesh {
  const nu = Math.max(2, uSamples);
  const nv = Math.max(2, vSamples);
  const vertices: Point3D[] = [];
  const triangles: Array<[number, number, number]> = [];

  for (let j = 0; j <= nv; j++) {
    const v = surface.v0 + (j / nv) * (surface.v1 - surface.v0);
    for (let i = 0; i <= nu; i++) {
      const u = surface.u0 + (i / nu) * (surface.u1 - surface.u0);
      vertices.push(evaluateNurbsSurface(surface, u, v));
    }
  }

  const rowLen = nu + 1;
  let surfaceArea = 0;

  const triArea = (a: Point3D, b: Point3D, c: Point3D): number => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    return 0.5 * Math.hypot(cx, cy, cz);
  };

  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const i00 = j * rowLen + i;
      const i10 = j * rowLen + (i + 1);
      const i01 = (j + 1) * rowLen + i;
      const i11 = (j + 1) * rowLen + (i + 1);
      triangles.push([i00, i10, i11]);
      triangles.push([i00, i11, i01]);
      surfaceArea += triArea(vertices[i00]!, vertices[i10]!, vertices[i11]!);
      surfaceArea += triArea(vertices[i00]!, vertices[i11]!, vertices[i01]!);
    }
  }

  return { vertices, triangles, surfaceArea };
}
