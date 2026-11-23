// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Radiative view-factor (F_ij) solver:
 *   - Exact Hottel analytical formulas (coaxial parallel disks, aligned parallel rectangles)
 *   - Deterministic Monte Carlo ray-tracing with cosine-weighted hemisphere sampling & shading
 */

import {
  computeSurfaceArea,
  computeSurfaceCentroid,
  computeSurfaceNormal,
  rotatePoint,
  transformPoint,
  vecAdd,
  vecCross,
  vecDot,
  vecLen,
  vecNorm,
  vecScale,
  vecSub,
  type Vec3Tuple,
} from "../cad/index.js";
import type { TrasysSurface } from "../types.js";

export interface ViewFactorOptions {
  /** Number of Monte Carlo rays per active surface (default: 20000). */
  raysPerSurface?: number | undefined;
  /** Deterministic PRNG seed (default: 42). */
  seed?: number | undefined;
  /** Solver mode: 'auto' uses analytical fast-path for unoccluded canonical pairs, else Monte Carlo. */
  method?: "auto" | "monte-carlo" | "analytical" | undefined;
  /** Enforce reciprocity A_i F_ij = A_j F_ji via symmetric averaging (default: true). */
  enforceReciprocity?: boolean | undefined;
}

export interface ViewFactorResult {
  surfaceIds: string[];
  areas: number[];
  /** N x N view-factor matrix F[i][j] = F_{i->j}. */
  matrix: number[][];
  /** View factor from each surface to deep space: F_{i->space} = max(0, 1 - sum_j F_ij). */
  spaceViewFactors: number[];
  /** Max reciprocity residual |A_i F_ij - A_j F_ji|. */
  maxReciprocityError: number;
  /** Max enclosure closure residual |(sum_j F_ij + F_{i->space}) - 1|. */
  maxClosureError: number;
}

/**
 * Exact Hottel analytical view factor between two coaxial parallel circular disks
 * of radii r1, r2 separated by perpendicular distance h.
 */
export function viewFactorCoaxialDisks(r1: number, r2: number, h: number): number {
  if (r1 <= 0 || r2 <= 0 || h <= 0) return 0;
  const R1 = r1 / h;
  const R2 = r2 / h;
  const S = 1 + (1 + R2 * R2) / (R1 * R1);
  const disc = Math.max(0, S * S - 4 * (R2 / R1) * (R2 / R1));
  return 0.5 * (S - Math.sqrt(disc));
}

/**
 * Exact Hottel analytical view factor between two identical, directly opposed,
 * aligned parallel rectangles of dimensions a x b separated by distance c.
 */
export function viewFactorParallelRectangles(a: number, b: number, c: number): number {
  if (a <= 0 || b <= 0 || c <= 0) return 0;
  const X = a / c;
  const Y = b / c;
  const sX = Math.sqrt(1 + X * X);
  const sY = Math.sqrt(1 + Y * Y);
  const term1 = Math.log(Math.sqrt(((1 + X * X) * (1 + Y * Y)) / (1 + X * X + Y * Y)));
  const term2 = X * sY * Math.atan(X / sY);
  const term3 = Y * sX * Math.atan(Y / sX);
  const term4 = -X * Math.atan(X) - Y * Math.atan(Y);
  return (2 / (Math.PI * X * Y)) * (term1 + term2 + term3 + term4);
}

/** Deterministic Mulberry32 PRNG for reproducible Monte Carlo ray tracing. */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds an orthonormal basis (u, v, w) where w = unit normal. */
function orthonormalBasis(n: Vec3Tuple): { u: Vec3Tuple; v: Vec3Tuple; w: Vec3Tuple } {
  const w = vecNorm(n);
  const ref: Vec3Tuple = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = vecNorm(vecCross(ref, w));
  const v = vecCross(w, u);
  return { u, v, w };
}

/** Cosine-weighted hemisphere sample around unit normal n. */
function sampleCosineHemisphere(n: Vec3Tuple, rng: () => number): Vec3Tuple {
  const r1 = rng();
  const r2 = rng();
  const r = Math.sqrt(r1);
  const phi = 2 * Math.PI * r2;
  const x = r * Math.cos(phi);
  const y = r * Math.sin(phi);
  const z = Math.sqrt(Math.max(0, 1 - r1));
  const { u, v, w } = orthonormalBasis(n);
  return vecNorm([u[0] * x + v[0] * y + w[0] * z, u[1] * x + v[1] * y + w[1] * z, u[2] * x + v[2] * y + w[2] * z]);
}

/** Samples a uniform random point and outward normal on a TRASYS surface. */
function sampleSurfacePoint(surf: TrasysSurface, rng: () => number): { origin: Vec3Tuple; normal: Vec3Tuple } {
  let localPt: Vec3Tuple = [0, 0, 0];
  let localN: Vec3Tuple = [0, 0, 1];

  switch (surf.kind) {
    case "RECTANGLE": {
      const w = surf.dims["width"] ?? 1;
      const h = surf.dims["height"] ?? 1;
      localPt = [(rng() - 0.5) * w, (rng() - 0.5) * h, 0];
      localN = [0, 0, 1];
      break;
    }
    case "DISK": {
      const rOuter = surf.dims["radius"] ?? 0.5;
      const rInner = surf.dims["innerRadius"] ?? 0;
      const r = Math.sqrt(rInner * rInner + rng() * (rOuter * rOuter - rInner * rInner));
      const theta = 2 * Math.PI * rng();
      localPt = [r * Math.cos(theta), r * Math.sin(theta), 0];
      localN = [0, 0, 1];
      break;
    }
    case "SPHERE": {
      const r = surf.dims["radius"] ?? 0.5;
      const u = 2 * rng() - 1;
      const phi = 2 * Math.PI * rng();
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      localN = [s * Math.cos(phi), s * Math.sin(phi), u];
      localPt = vecScale(localN, r);
      break;
    }
    case "CYLINDER": {
      const r = surf.dims["radius"] ?? 0.5;
      const len = surf.dims["length"] ?? surf.dims["height"] ?? 1;
      const phi = 2 * Math.PI * rng();
      const z = (rng() - 0.5) * len;
      localN = [Math.cos(phi), Math.sin(phi), 0];
      localPt = [r * Math.cos(phi), r * Math.sin(phi), z];
      break;
    }
    case "CONE": {
      const r1 = surf.dims["radius"] ?? 0.5;
      const r2 = surf.dims["radiusTop"] ?? 0;
      const len = surf.dims["length"] ?? surf.dims["height"] ?? 1;
      const t = rng();
      const r = r1 + t * (r2 - r1);
      const z = (t - 0.5) * len;
      const phi = 2 * Math.PI * rng();
      const dr = r1 - r2;
      const slant = Math.hypot(dr, len);
      localN = [(len / slant) * Math.cos(phi), (len / slant) * Math.sin(phi), dr / slant];
      localPt = [r * Math.cos(phi), r * Math.sin(phi), z];
      break;
    }
    case "PARABOLOID": {
      const rMax = surf.dims["radius"] ?? 0.5;
      const f = surf.dims["focalLength"] ?? 0.5;
      const r = rMax * Math.sqrt(rng());
      const phi = 2 * Math.PI * rng();
      const x = r * Math.cos(phi);
      const y = r * Math.sin(phi);
      const z = (r * r) / (4 * f);
      localPt = [x, y, z];
      localN = vecNorm([-x / (2 * f), -y / (2 * f), 1]);
      break;
    }
    case "POLYGON": {
      const verts = surf.vertices ?? [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ];
      const v0 = verts[0]!;
      const triIdx = verts.length > 3 ? Math.floor(rng() * (verts.length - 2)) + 1 : 1;
      const v1 = verts[triIdx]!;
      const v2 = verts[triIdx + 1]!;
      let a = rng();
      let b = rng();
      if (a + b > 1) {
        a = 1 - a;
        b = 1 - b;
      }
      localPt = vecAdd(v0, vecAdd(vecScale(vecSub(v1, v0), a), vecScale(vecSub(v2, v0), b)));
      localN = vecNorm(vecCross(vecSub(v1, v0), vecSub(v2, v0)));
      break;
    }
  }

  if (surf.active === "BOTTOM") {
    localN = vecScale(localN, -1);
  } else if (surf.active === "BOTH" && rng() < 0.5) {
    localN = vecScale(localN, -1);
  }

  const origin = transformPoint(localPt, surf.transform);
  const normal = vecNorm(rotatePoint(localN, surf.transform));
  return { origin, normal };
}

/** Transforms a world point into a surface's local coordinate frame. */
function worldToLocalPoint(p: Vec3Tuple, surf: TrasysSurface): Vec3Tuple {
  const shifted: Vec3Tuple = [p[0] - surf.transform.tx, p[1] - surf.transform.ty, p[2] - surf.transform.tz];
  // Inverse of Rz * Ry * Rx is Rx(-rx) * Ry(-ry) * Rz(-rz)
  const deg2rad = Math.PI / 180;
  let [x, y, z] = shifted;
  if (surf.transform.rotz !== 0) {
    const rad = -surf.transform.rotz * deg2rad;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    [x, y] = [c * x - s * y, s * x + c * y];
  }
  if (surf.transform.roty !== 0) {
    const rad = -surf.transform.roty * deg2rad;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    [x, z] = [c * x + s * z, -s * x + c * z];
  }
  if (surf.transform.rotx !== 0) {
    const rad = -surf.transform.rotx * deg2rad;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    [y, z] = [c * y - s * z, s * y + c * z];
  }
  return [x, y, z];
}

function worldToLocalDir(d: Vec3Tuple, surf: TrasysSurface): Vec3Tuple {
  const deg2rad = Math.PI / 180;
  let [x, y, z] = d;
  if (surf.transform.rotz !== 0) {
    const rad = -surf.transform.rotz * deg2rad;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    [x, y] = [c * x - s * y, s * x + c * y];
  }
  if (surf.transform.roty !== 0) {
    const rad = -surf.transform.roty * deg2rad;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    [x, z] = [c * x + s * z, -s * x + c * z];
  }
  if (surf.transform.rotx !== 0) {
    const rad = -surf.transform.rotx * deg2rad;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    [y, z] = [c * y - s * z, s * y + c * z];
  }
  return [x, y, z];
}

/** Ray-surface intersection returning hit distance t > 1e-6 or null. */
function intersectRaySurface(origin: Vec3Tuple, dir: Vec3Tuple, surf: TrasysSurface): number | null {
  const o = worldToLocalPoint(origin, surf);
  const d = worldToLocalDir(dir, surf);

  switch (surf.kind) {
    case "RECTANGLE": {
      if (Math.abs(d[2]) < 1e-12) return null;
      const t = -o[2] / d[2];
      if (t <= 1e-6) return null;
      const hx = o[0] + t * d[0];
      const hy = o[1] + t * d[1];
      const hw = (surf.dims["width"] ?? 1) * 0.5;
      const hh = (surf.dims["height"] ?? 1) * 0.5;
      return Math.abs(hx) <= hw && Math.abs(hy) <= hh ? t : null;
    }
    case "DISK": {
      if (Math.abs(d[2]) < 1e-12) return null;
      const t = -o[2] / d[2];
      if (t <= 1e-6) return null;
      const hx = o[0] + t * d[0];
      const hy = o[1] + t * d[1];
      const r2 = hx * hx + hy * hy;
      const rOuter = surf.dims["radius"] ?? 0.5;
      const rInner = surf.dims["innerRadius"] ?? 0;
      return r2 <= rOuter * rOuter && r2 >= rInner * rInner ? t : null;
    }
    case "SPHERE": {
      const r = surf.dims["radius"] ?? 0.5;
      const a = vecDot(d, d);
      const b = 2 * vecDot(o, d);
      const c = vecDot(o, o) - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      const t1 = (-b - s) / (2 * a);
      const t2 = (-b + s) / (2 * a);
      if (t1 > 1e-6) return t1;
      if (t2 > 1e-6) return t2;
      return null;
    }
    case "CYLINDER": {
      const r = surf.dims["radius"] ?? 0.5;
      const halfL = (surf.dims["length"] ?? surf.dims["height"] ?? 1) * 0.5;
      const a = d[0] * d[0] + d[1] * d[1];
      if (a < 1e-12) return null;
      const b = 2 * (o[0] * d[0] + o[1] * d[1]);
      const c = o[0] * o[0] + o[1] * o[1] - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        if (t > 1e-6) {
          const hz = o[2] + t * d[2];
          if (Math.abs(hz) <= halfL) return t;
        }
      }
      return null;
    }
    case "POLYGON": {
      const verts = surf.vertices ?? [];
      if (verts.length < 3) return null;
      const v0 = verts[0]!;
      let bestT: number | null = null;
      for (let i = 1; i < verts.length - 1; i++) {
        const v1 = verts[i]!;
        const v2 = verts[i + 1]!;
        const e1 = vecSub(v1, v0);
        const e2 = vecSub(v2, v0);
        const h = vecCross(d, e2);
        const a = vecDot(e1, h);
        if (Math.abs(a) < 1e-12) continue;
        const f = 1 / a;
        const s = vecSub(o, v0);
        const u = f * vecDot(s, h);
        if (u < 0 || u > 1) continue;
        const q = vecCross(s, e1);
        const v = f * vecDot(d, q);
        if (v < 0 || u + v > 1) continue;
        const t = f * vecDot(e2, q);
        if (t > 1e-6 && (bestT === null || t < bestT)) {
          bestT = t;
        }
      }
      return bestT;
    }
    case "CONE":
    case "PARABOLOID": {
      // Bounding cylinder/sphere intersection approximation
      const r = surf.dims["radius"] ?? 0.5;
      const halfL = (surf.dims["length"] ?? surf.dims["focalLength"] ?? 1) * 0.5;
      const a = d[0] * d[0] + d[1] * d[1];
      if (a < 1e-12) return null;
      const b = 2 * (o[0] * d[0] + o[1] * d[1]);
      const c = o[0] * o[0] + o[1] * o[1] - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        if (t > 1e-6) {
          const hz = o[2] + t * d[2];
          if (Math.abs(hz) <= halfL) return t;
        }
      }
      return null;
    }
  }
}

/**
 * Checks whether a pair of surfaces qualifies for exact Hottel analytical view-factor evaluation
 * (two unoccluded coaxial parallel disks or two identical aligned parallel rectangles facing each other).
 */
function tryAnalyticalPair(s1: TrasysSurface, s2: TrasysSurface, allSurfaces: TrasysSurface[]): number | null {
  if (allSurfaces.length > 2) return null; // Could have shading occluders
  const c1 = computeSurfaceCentroid(s1);
  const c2 = computeSurfaceCentroid(s2);
  const n1 = computeSurfaceNormal(s1);
  const n2 = computeSurfaceNormal(s2);
  const sep = vecSub(c2, c1);
  const dist = vecLen(sep);
  if (dist < 1e-9) return null;

  const axis = vecScale(sep, 1 / dist);
  // Check if normals are parallel to separation axis and facing each other (or BOTH sides active)
  const dot1 = vecDot(n1, axis);
  const dot2 = vecDot(n2, vecScale(axis, -1));
  const facing =
    Math.abs(dot1) > 1 - 1e-6 &&
    (dot1 > 0 || s1.active === "BOTH") &&
    Math.abs(dot2) > 1 - 1e-6 &&
    (dot2 > 0 || s2.active === "BOTH");
  if (!facing) return null;

  if (s1.kind === "DISK" && s2.kind === "DISK") {
    const r1 = s1.dims["radius"] ?? 0;
    const r2 = s2.dims["radius"] ?? 0;
    const ri1 = s1.dims["innerRadius"] ?? 0;
    const ri2 = s2.dims["innerRadius"] ?? 0;
    if (ri1 === 0 && ri2 === 0 && r1 > 0 && r2 > 0) {
      return viewFactorCoaxialDisks(r1, r2, dist);
    }
  }

  if (s1.kind === "RECTANGLE" && s2.kind === "RECTANGLE") {
    const w1 = s1.dims["width"] ?? 0;
    const h1 = s1.dims["height"] ?? 0;
    const w2 = s2.dims["width"] ?? 0;
    const h2 = s2.dims["height"] ?? 0;
    if (Math.abs(w1 - w2) < 1e-9 && Math.abs(h1 - h2) < 1e-9 && w1 > 0 && h1 > 0) {
      return viewFactorParallelRectangles(w1, h1, dist);
    }
  }

  return null;
}

/**
 * Computes the N x N view-factor matrix F_ij and space view factors for active TRASYS surfaces.
 */
export function computeViewFactors(surfaces: TrasysSurface[], options?: ViewFactorOptions): ViewFactorResult {
  const activeSurfaces = surfaces.filter((s) => s.active !== "NONE");
  const n = activeSurfaces.length;
  const surfaceIds = activeSurfaces.map((s) => s.id);
  const areas = activeSurfaces.map((s) => computeSurfaceArea(s));
  const matrix: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));

  const method = options?.method ?? "auto";
  const raysPerSurface = options?.raysPerSurface ?? 20000;
  const enforceReciprocity = options?.enforceReciprocity ?? true;
  const rng = createRng(options?.seed ?? 42);

  // Shading surfaces include all surfaces with shade=true
  const occluders = surfaces.filter((s) => s.shade);

  for (let i = 0; i < n; i++) {
    const si = activeSurfaces[i]!;
    let usedAnalytical = false;

    if (method === "auto" || method === "analytical") {
      if (n === 2 && occluders.length <= 2) {
        const j = 1 - i;
        const sj = activeSurfaces[j]!;
        const fExact = tryAnalyticalPair(si, sj, surfaces);
        if (fExact !== null) {
          matrix[i]![j] = fExact;
          usedAnalytical = true;
        }
      }
    }

    if (!usedAnalytical && method !== "analytical" && n > 1) {
      const hits = new Int32Array(n);
      for (let r = 0; r < raysPerSurface; r++) {
        const { origin, normal } = sampleSurfacePoint(si, rng);
        const dir = sampleCosineHemisphere(normal, rng);

        let bestT = Infinity;
        let hitActiveIdx = -1;

        for (let k = 0; k < surfaces.length; k++) {
          const sk = surfaces[k]!;
          if (sk === si && (si.kind === "RECTANGLE" || si.kind === "DISK" || si.kind === "POLYGON")) {
            continue; // Planar surface cannot self-intersect
          }
          if (!sk.shade && sk.active === "NONE") continue;
          const t = intersectRaySurface(origin, dir, sk);
          if (t !== null && t < bestT) {
            bestT = t;
            hitActiveIdx = activeSurfaces.indexOf(sk);
          }
        }

        if (hitActiveIdx >= 0) {
          hits[hitActiveIdx] = (hits[hitActiveIdx] ?? 0) + 1;
        }
      }
      for (let j = 0; j < n; j++) {
        matrix[i]![j] = (hits[j] ?? 0) / raysPerSurface;
      }
    }
  }

  // Optional reciprocity symmetrization: A_i F_ij = A_j F_ji
  if (enforceReciprocity) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ai = areas[i] ?? 0;
        const aj = areas[j] ?? 0;
        if (ai > 0 && aj > 0) {
          const avgAf = 0.5 * (ai * (matrix[i]![j] ?? 0) + aj * (matrix[j]![i] ?? 0));
          matrix[i]![j] = avgAf / ai;
          matrix[j]![i] = avgAf / aj;
        }
      }
    }
  }

  // Space view factors and diagnostics
  const spaceViewFactors: number[] = [];
  let maxClosureError = 0;
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      rowSum += matrix[i]![j] ?? 0;
    }
    const fSpace = Math.max(0, 1 - rowSum);
    spaceViewFactors.push(fSpace);
    const closureErr = Math.abs(rowSum + fSpace - 1);
    if (closureErr > maxClosureError) maxClosureError = closureErr;
  }

  let maxReciprocityError = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const err = Math.abs((areas[i] ?? 0) * (matrix[i]![j] ?? 0) - (areas[j] ?? 0) * (matrix[j]![i] ?? 0));
      if (err > maxReciprocityError) maxReciprocityError = err;
    }
  }

  return {
    surfaceIds,
    areas,
    matrix,
    spaceViewFactors,
    maxReciprocityError,
    maxClosureError,
  };
}
