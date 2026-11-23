// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — 3D CSG Surface Evaluator, Ray-Surface Intersection,
 * Point-in-Cell Boolean CSG, Volume Calculator, and `@modelscript/cad` Assembly Builder.
 */

import {
  assembly,
  box,
  cylinder,
  part,
  sphere,
  subtract,
  translate,
  type Assembly,
  type Solid,
} from "@modelscript/cad";
import { extractCsgSurfaceRefs } from "../parser/csg-parser.js";
import type { McnpCellCard, McnpCsgExpr, McnpDeck, McnpSurfaceBoundary, McnpSurfaceCard } from "../types.js";

export type Vec3 = [number, number, number];

const EPS = 1e-9;

function solveQuadraticPositive(a: number, b: number, c: number): number[] {
  const roots: number[] = [];
  if (Math.abs(a) < 1e-14) {
    if (Math.abs(b) > 1e-14) {
      const t = -c / b;
      if (t > EPS) roots.push(t);
    }
    return roots;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return roots;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  if (t1 > EPS) roots.push(t1);
  if (t2 > EPS && Math.abs(t2 - t1) > 1e-12) roots.push(t2);
  roots.sort((u, v) => u - v);
  return roots;
}

function getPlaneCoeffs(surf: McnpSurfaceCard): [number, number, number, number] {
  const p = surf.params;
  if (surf.type === "PX") return [1, 0, 0, p[0] ?? 0];
  if (surf.type === "PY") return [0, 1, 0, p[0] ?? 0];
  if (surf.type === "PZ") return [0, 0, 1, p[0] ?? 0];
  if (p.length >= 9) {
    const x1 = p[0]!,
      y1 = p[1]!,
      z1 = p[2]!;
    const x2 = p[3]!,
      y2 = p[4]!,
      z2 = p[5]!;
    const x3 = p[6]!,
      y3 = p[7]!,
      z3 = p[8]!;
    const ux = x2 - x1,
      uy = y2 - y1,
      uz = z2 - z1;
    const vx = x3 - x1,
      vy = y3 - y1,
      vz = z3 - z1;
    const a = uy * vz - uz * vy;
    const b = uz * vx - ux * vz;
    const c = ux * vy - uy * vx;
    const d = a * x1 + b * y1 + c * z1;
    return [a, b, c, d];
  }
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 0];
}

/**
 * Evaluates the implicit surface equation f(x, y, z) for an MCNP surface card.
 * Negative values correspond to MCNP negative sense (`-id`); positive to `+id`.
 */
export function evaluateSurface(surf: McnpSurfaceCard, pt: Vec3): number {
  const [x, y, z] = pt;
  const p = surf.params;

  switch (surf.type) {
    case "PX":
      return x - (p[0] ?? 0);
    case "PY":
      return y - (p[0] ?? 0);
    case "PZ":
      return z - (p[0] ?? 0);
    case "P": {
      const [a, b, c, d] = getPlaneCoeffs(surf);
      return a * x + b * y + c * z - d;
    }
    case "SO": {
      const r = p[0] ?? 0;
      return x * x + y * y + z * z - r * r;
    }
    case "S":
    case "SPH": {
      const dx = x - (p[0] ?? 0);
      const dy = y - (p[1] ?? 0);
      const dz = z - (p[2] ?? 0);
      const r = p[3] ?? 0;
      return dx * dx + dy * dy + dz * dz - r * r;
    }
    case "SX": {
      const dx = x - (p[0] ?? 0);
      const r = p[1] ?? 0;
      return dx * dx + y * y + z * z - r * r;
    }
    case "SY": {
      const dy = y - (p[0] ?? 0);
      const r = p[1] ?? 0;
      return x * x + dy * dy + z * z - r * r;
    }
    case "SZ": {
      const dz = z - (p[0] ?? 0);
      const r = p[1] ?? 0;
      return x * x + y * y + dz * dz - r * r;
    }
    case "CX": {
      const r = p[0] ?? 0;
      return y * y + z * z - r * r;
    }
    case "CY": {
      const r = p[0] ?? 0;
      return x * x + z * z - r * r;
    }
    case "CZ": {
      const r = p[0] ?? 0;
      return x * x + y * y - r * r;
    }
    case "C/X": {
      const dy = y - (p[0] ?? 0);
      const dz = z - (p[1] ?? 0);
      const r = p[2] ?? 0;
      return dy * dy + dz * dz - r * r;
    }
    case "C/Y": {
      const dx = x - (p[0] ?? 0);
      const dz = z - (p[1] ?? 0);
      const r = p[2] ?? 0;
      return dx * dx + dz * dz - r * r;
    }
    case "C/Z": {
      const dx = x - (p[0] ?? 0);
      const dy = y - (p[1] ?? 0);
      const r = p[2] ?? 0;
      return dx * dx + dy * dy - r * r;
    }
    case "KX": {
      const dx = x - (p[0] ?? 0);
      const t2 = p[1] ?? 1;
      return y * y + z * z - t2 * dx * dx;
    }
    case "KY": {
      const dy = y - (p[0] ?? 0);
      const t2 = p[1] ?? 1;
      return x * x + z * z - t2 * dy * dy;
    }
    case "KZ": {
      const dz = z - (p[0] ?? 0);
      const t2 = p[1] ?? 1;
      return x * x + y * y - t2 * dz * dz;
    }
    case "K/X": {
      const dx = x - (p[0] ?? 0);
      const dy = y - (p[1] ?? 0);
      const dz = z - (p[2] ?? 0);
      const t2 = p[3] ?? 1;
      return dy * dy + dz * dz - t2 * dx * dx;
    }
    case "K/Y": {
      const dx = x - (p[0] ?? 0);
      const dy = y - (p[1] ?? 0);
      const dz = z - (p[2] ?? 0);
      const t2 = p[3] ?? 1;
      return dx * dx + dz * dz - t2 * dy * dy;
    }
    case "K/Z": {
      const dx = x - (p[0] ?? 0);
      const dy = y - (p[1] ?? 0);
      const dz = z - (p[2] ?? 0);
      const t2 = p[3] ?? 1;
      return dx * dx + dy * dy - t2 * dz * dz;
    }
    case "GQ": {
      const [A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0, J = 0, K = 0] = p;
      return A * x * x + B * y * y + C * z * z + D * x * y + E * y * z + F * z * x + G * x + H * y + J * z + K;
    }
    case "RPP": {
      const [xmin = 0, xmax = 0, ymin = 0, ymax = 0, zmin = 0, zmax = 0] = p;
      return Math.max(xmin - x, x - xmax, ymin - y, y - ymax, zmin - z, z - zmax);
    }
    case "RCC": {
      const [vx = 0, vy = 0, vz = 0, hx = 0, hy = 0, hz = 1, r = 1] = p;
      const hLen = Math.hypot(hx, hy, hz);
      if (hLen < EPS) return 1;
      const ux = hx / hLen;
      const uy = hy / hLen;
      const uz = hz / hLen;
      const dx = x - vx;
      const dy = y - vy;
      const dz = z - vz;
      const axial = dx * ux + dy * uy + dz * uz;
      const rx = dx - axial * ux;
      const ry = dy - axial * uy;
      const rz = dz - axial * uz;
      const radialDist = Math.hypot(rx, ry, rz) - r;
      return Math.max(-axial, axial - hLen, radialDist);
    }
  }
}

/**
 * Computes all strictly positive ray-surface intersection distances `t > EPS`
 * for ray `P(t) = origin + t * dir`.
 */
export function intersectRaySurface(surf: McnpSurfaceCard, origin: Vec3, dir: Vec3): number[] {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;
  const p = surf.params;

  switch (surf.type) {
    case "PX":
    case "PY":
    case "PZ":
    case "P": {
      const [a, b, c, d] = getPlaneCoeffs(surf);
      const denom = a * dx + b * dy + c * dz;
      if (Math.abs(denom) < 1e-14) return [];
      const t = (d - (a * ox + b * oy + c * oz)) / denom;
      return t > EPS ? [t] : [];
    }
    case "SO":
    case "S":
    case "SPH":
    case "SX":
    case "SY":
    case "SZ": {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let r = 0;
      if (surf.type === "SO") {
        r = p[0] ?? 0;
      } else if (surf.type === "S" || surf.type === "SPH") {
        cx = p[0] ?? 0;
        cy = p[1] ?? 0;
        cz = p[2] ?? 0;
        r = p[3] ?? 0;
      } else if (surf.type === "SX") {
        cx = p[0] ?? 0;
        r = p[1] ?? 0;
      } else if (surf.type === "SY") {
        cy = p[0] ?? 0;
        r = p[1] ?? 0;
      } else {
        cz = p[0] ?? 0;
        r = p[1] ?? 0;
      }
      const ex = ox - cx;
      const ey = oy - cy;
      const ez = oz - cz;
      const a = dx * dx + dy * dy + dz * dz;
      const b = 2 * (ex * dx + ey * dy + ez * dz);
      const c = ex * ex + ey * ey + ez * ez - r * r;
      return solveQuadraticPositive(a, b, c);
    }
    case "CX":
    case "C/X": {
      const cy = surf.type === "C/X" ? (p[0] ?? 0) : 0;
      const cz = surf.type === "C/X" ? (p[1] ?? 0) : 0;
      const r = surf.type === "C/X" ? (p[2] ?? 0) : (p[0] ?? 0);
      const ey = oy - cy;
      const ez = oz - cz;
      return solveQuadraticPositive(dy * dy + dz * dz, 2 * (ey * dy + ez * dz), ey * ey + ez * ez - r * r);
    }
    case "CY":
    case "C/Y": {
      const cx = surf.type === "C/Y" ? (p[0] ?? 0) : 0;
      const cz = surf.type === "C/Y" ? (p[1] ?? 0) : 0;
      const r = surf.type === "C/Y" ? (p[2] ?? 0) : (p[0] ?? 0);
      const ex = ox - cx;
      const ez = oz - cz;
      return solveQuadraticPositive(dx * dx + dz * dz, 2 * (ex * dx + ez * dz), ex * ex + ez * ez - r * r);
    }
    case "CZ":
    case "C/Z": {
      const cx = surf.type === "C/Z" ? (p[0] ?? 0) : 0;
      const cy = surf.type === "C/Z" ? (p[1] ?? 0) : 0;
      const r = surf.type === "C/Z" ? (p[2] ?? 0) : (p[0] ?? 0);
      const ex = ox - cx;
      const ey = oy - cy;
      return solveQuadraticPositive(dx * dx + dy * dy, 2 * (ex * dx + ey * dy), ex * ex + ey * ey - r * r);
    }
    case "KX":
    case "K/X": {
      const cx = p[0] ?? 0;
      const cy = surf.type === "K/X" ? (p[1] ?? 0) : 0;
      const cz = surf.type === "K/X" ? (p[2] ?? 0) : 0;
      const t2 = surf.type === "K/X" ? (p[3] ?? 1) : (p[1] ?? 1);
      const ex = ox - cx;
      const ey = oy - cy;
      const ez = oz - cz;
      return solveQuadraticPositive(
        dy * dy + dz * dz - t2 * dx * dx,
        2 * (ey * dy + ez * dz - t2 * ex * dx),
        ey * ey + ez * ez - t2 * ex * ex,
      );
    }
    case "KY":
    case "K/Y": {
      const cx = surf.type === "K/Y" ? (p[0] ?? 0) : 0;
      const cy = surf.type === "K/Y" ? (p[1] ?? 0) : (p[0] ?? 0);
      const cz = surf.type === "K/Y" ? (p[2] ?? 0) : 0;
      const t2 = surf.type === "K/Y" ? (p[3] ?? 1) : (p[1] ?? 1);
      const ex = ox - cx;
      const ey = oy - cy;
      const ez = oz - cz;
      return solveQuadraticPositive(
        dx * dx + dz * dz - t2 * dy * dy,
        2 * (ex * dx + ez * dz - t2 * ey * dy),
        ex * ex + ez * ez - t2 * ey * ey,
      );
    }
    case "KZ":
    case "K/Z": {
      const cx = surf.type === "K/Z" ? (p[0] ?? 0) : 0;
      const cy = surf.type === "K/Z" ? (p[1] ?? 0) : 0;
      const cz = surf.type === "K/Z" ? (p[2] ?? 0) : (p[0] ?? 0);
      const t2 = surf.type === "K/Z" ? (p[3] ?? 1) : (p[1] ?? 1);
      const ex = ox - cx;
      const ey = oy - cy;
      const ez = oz - cz;
      return solveQuadraticPositive(
        dx * dx + dy * dy - t2 * dz * dz,
        2 * (ex * dx + ey * dy - t2 * ez * dz),
        ex * ex + ey * ey - t2 * ez * ez,
      );
    }
    case "GQ": {
      const [A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0, J = 0, K = 0] = p;
      const qa = A * dx * dx + B * dy * dy + C * dz * dz + D * dx * dy + E * dy * dz + F * dz * dx;
      const qb =
        2 * (A * ox * dx + B * oy * dy + C * oz * dz) +
        D * (ox * dy + oy * dx) +
        E * (oy * dz + oz * dy) +
        F * (oz * dx + ox * dz) +
        G * dx +
        H * dy +
        J * dz;
      const qc =
        A * ox * ox +
        B * oy * oy +
        C * oz * oz +
        D * ox * oy +
        E * oy * oz +
        F * oz * ox +
        G * ox +
        H * oy +
        J * oz +
        K;
      return solveQuadraticPositive(qa, qb, qc);
    }
    case "RPP": {
      const [xmin = 0, xmax = 0, ymin = 0, ymax = 0, zmin = 0, zmax = 0] = p;
      let tmin = -Infinity;
      let tmax = Infinity;
      const axes: Array<[number, number, number, number]> = [
        [ox, dx, xmin, xmax],
        [oy, dy, ymin, ymax],
        [oz, dz, zmin, zmax],
      ];
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-14) {
          if (o < lo - EPS || o > hi + EPS) return [];
        } else {
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax + EPS) return [];
        }
      }
      const hits: number[] = [];
      if (tmin > EPS) hits.push(tmin);
      if (tmax > EPS && Math.abs(tmax - tmin) > 1e-12) hits.push(tmax);
      hits.sort((u, v) => u - v);
      return hits;
    }
    case "RCC": {
      const [vx = 0, vy = 0, vz = 0, hx = 0, hy = 0, hz = 1, r = 1] = p;
      const hLen = Math.hypot(hx, hy, hz);
      if (hLen < EPS) return [];
      const ux = hx / hLen;
      const uy = hy / hLen;
      const uz = hz / hLen;
      const ex = ox - vx;
      const ey = oy - vy;
      const ez = oz - vz;

      const dDotU = dx * ux + dy * uy + dz * uz;
      const eDotU = ex * ux + ey * uy + ez * uz;

      const dPerpX = dx - dDotU * ux;
      const dPerpY = dy - dDotU * uy;
      const dPerpZ = dz - dDotU * uz;
      const ePerpX = ex - eDotU * ux;
      const ePerpY = ey - eDotU * uy;
      const ePerpZ = ez - eDotU * uz;

      const hits: number[] = [];
      const cylRoots = solveQuadraticPositive(
        dPerpX * dPerpX + dPerpY * dPerpY + dPerpZ * dPerpZ,
        2 * (ePerpX * dPerpX + ePerpY * dPerpY + ePerpZ * dPerpZ),
        ePerpX * ePerpX + ePerpY * ePerpY + ePerpZ * ePerpZ - r * r,
      );
      for (const t of cylRoots) {
        const axial = eDotU + t * dDotU;
        if (axial >= -EPS && axial <= hLen + EPS) {
          hits.push(t);
        }
      }

      if (Math.abs(dDotU) > 1e-14) {
        for (const capAxial of [0, hLen]) {
          const t = (capAxial - eDotU) / dDotU;
          if (t > EPS) {
            const rx = ePerpX + t * dPerpX;
            const ry = ePerpY + t * dPerpY;
            const rz = ePerpZ + t * dPerpZ;
            if (rx * rx + ry * ry + rz * rz <= r * r + 1e-7) {
              hits.push(t);
            }
          }
        }
      }
      hits.sort((u, v) => u - v);
      return hits;
    }
  }
}

/**
 * Evaluates whether a 3D point `pt` satisfies an MCNP Boolean CSG expression.
 */
export function evaluateCsgPoint(
  expr: McnpCsgExpr | null,
  pt: Vec3,
  deck: McnpDeck,
  visitedCells: Set<number> = new Set(),
): boolean {
  if (!expr) return false;

  switch (expr.kind) {
    case "surface": {
      const surf = deck.surfaces.get(expr.id);
      if (!surf) return false;
      const val = evaluateSurface(surf, pt);
      return expr.sense < 0 ? val <= 0 : val >= 0;
    }
    case "union":
      return expr.operands.some((op) => evaluateCsgPoint(op, pt, deck, visitedCells));
    case "intersection":
      return expr.operands.every((op) => evaluateCsgPoint(op, pt, deck, visitedCells));
    case "complement": {
      if (expr.expr) {
        return !evaluateCsgPoint(expr.expr, pt, deck, visitedCells);
      }
      if (expr.cellId !== undefined) {
        if (visitedCells.has(expr.cellId)) return false;
        const target = deck.cells.get(expr.cellId);
        if (!target) return false;
        const nextVisited = new Set(visitedCells);
        nextVisited.add(expr.cellId);
        return !evaluateCsgPoint(target.csg, pt, deck, nextVisited);
      }
      return false;
    }
  }
}

/**
 * Finds the MCNP cell containing 3D point `pt`.
 */
export function findCellAtPoint(deck: McnpDeck, pt: Vec3): McnpCellCard | undefined {
  for (const cell of deck.cells.values()) {
    if (evaluateCsgPoint(cell.csg, pt, deck)) {
      return cell;
    }
  }
  return undefined;
}

export interface RayBoundaryHit {
  distance: number;
  surfaceId: number;
  boundary?: McnpSurfaceBoundary | undefined;
}

/**
 * Traces a ray from `origin` in unit direction `dir` inside `cell` to the nearest bounding surface.
 */
export function traceRayToBoundary(deck: McnpDeck, cell: McnpCellCard, origin: Vec3, dir: Vec3): RayBoundaryHit | null {
  const surfIds = extractCsgSurfaceRefs(cell.csg);
  const candidateIds = surfIds.length > 0 ? surfIds : Array.from(deck.surfaces.keys());

  let bestDist = Infinity;
  let bestSurfId = -1;
  let bestBoundary: McnpSurfaceBoundary | undefined;

  for (const sid of candidateIds) {
    const surf = deck.surfaces.get(sid);
    if (!surf) continue;
    const hits = intersectRaySurface(surf, origin, dir);
    for (const t of hits) {
      if (t < bestDist) {
        bestDist = t;
        bestSurfId = sid;
        bestBoundary = surf.boundary;
      }
    }
  }

  if (bestSurfId < 0 || !Number.isFinite(bestDist)) return null;
  return { distance: bestDist, surfaceId: bestSurfId, boundary: bestBoundary };
}

/**
 * Computes the analytical volume (cm^3) for canonical MCNP cells (spheres, spherical shells,
 * RPP boxes, RCC cylinders) or returns explicit `VOL` if specified on the cell card.
 */
export function computeExactCellVolume(deck: McnpDeck, cellId: number): number | undefined {
  const cell = deck.cells.get(cellId);
  if (!cell) return undefined;
  if (cell.vol !== undefined && cell.vol > 0) return cell.vol;
  if (!cell.csg) return undefined;

  const sphereRadius = (s: McnpSurfaceCard): number | undefined => {
    if (s.type === "SO") return s.params[0];
    if (s.type === "S" || s.type === "SPH") return s.params[3];
    if (s.type === "SX" || s.type === "SY" || s.type === "SZ") return s.params[1];
    return undefined;
  };

  if (cell.csg.kind === "surface" && cell.csg.sense === -1) {
    const surf = deck.surfaces.get(cell.csg.id);
    if (!surf) return undefined;
    const r = sphereRadius(surf);
    if (r !== undefined && r > 0) {
      return (4 / 3) * Math.PI * r * r * r;
    }
    if (surf.type === "RPP" && surf.params.length >= 6) {
      const [x0, x1, y0, y1, z0, z1] = surf.params;
      return Math.abs((x1! - x0!) * (y1! - y0!) * (z1! - z0!));
    }
    if (surf.type === "RCC" && surf.params.length >= 7) {
      const h = Math.hypot(surf.params[3]!, surf.params[4]!, surf.params[5]!);
      const rccR = surf.params[6]!;
      return Math.PI * rccR * rccR * h;
    }
  }

  // Concentric spherical shell: -outer +inner
  if (cell.csg.kind === "intersection" && cell.csg.operands.length === 2) {
    const [a, b] = cell.csg.operands;
    if (a?.kind === "surface" && b?.kind === "surface" && a.sense !== b.sense) {
      const sOuter = deck.surfaces.get(a.sense === -1 ? a.id : b.id);
      const sInner = deck.surfaces.get(a.sense === 1 ? a.id : b.id);
      if (sOuter && sInner) {
        const rOut = sphereRadius(sOuter);
        const rIn = sphereRadius(sInner);
        if (rOut !== undefined && rIn !== undefined && rOut > rIn) {
          return (4 / 3) * Math.PI * (rOut * rOut * rOut - rIn * rIn * rIn);
        }
      }
    }
  }

  return undefined;
}

/**
 * Deterministic seeded PRNG (Mulberry32) for reproducible Monte Carlo geometry sampling.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BoundingBox3D {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  zmin: number;
  zmax: number;
}

/**
 * Estimates the volume of an arbitrary MCNP CSG cell using seeded Monte Carlo hit-or-miss sampling.
 */
export function estimateCellVolumeMonteCarlo(
  deck: McnpDeck,
  cellId: number,
  bounds: BoundingBox3D,
  samples: number = 50000,
  seed: number = 42,
): { volume: number; stdErr: number; hitFraction: number } {
  const cell = deck.cells.get(cellId);
  if (!cell) return { volume: 0, stdErr: 0, hitFraction: 0 };

  const rng = mulberry32(seed);
  const dx = bounds.xmax - bounds.xmin;
  const dy = bounds.ymax - bounds.ymin;
  const dz = bounds.zmax - bounds.zmin;
  const boxVol = Math.abs(dx * dy * dz);

  let hits = 0;
  for (let i = 0; i < samples; i++) {
    const x = bounds.xmin + rng() * dx;
    const y = bounds.ymin + rng() * dy;
    const z = bounds.zmin + rng() * dz;
    if (evaluateCsgPoint(cell.csg, [x, y, z], deck)) {
      hits++;
    }
  }

  const p = hits / samples;
  const volume = boxVol * p;
  const stdErr = boxVol * Math.sqrt((p * (1 - p)) / samples);
  return { volume, stdErr, hitFraction: p };
}

function surfaceToCadSolid(surf: McnpSurfaceCard): Solid | null {
  const p = surf.params;
  switch (surf.type) {
    case "SO":
      return sphere({ radius: p[0] ?? 1, name: `surf_${surf.id}` });
    case "S":
    case "SPH": {
      const s = sphere({ radius: p[3] ?? 1, name: `surf_${surf.id}` });
      const cx = p[0] ?? 0;
      const cy = p[1] ?? 0;
      const cz = p[2] ?? 0;
      return cx === 0 && cy === 0 && cz === 0 ? s : translate(s, [cx, cy, cz]);
    }
    case "SX":
      return translate(sphere({ radius: p[1] ?? 1, name: `surf_${surf.id}` }), [p[0] ?? 0, 0, 0]);
    case "SY":
      return translate(sphere({ radius: p[1] ?? 1, name: `surf_${surf.id}` }), [0, p[0] ?? 0, 0]);
    case "SZ":
      return translate(sphere({ radius: p[1] ?? 1, name: `surf_${surf.id}` }), [0, 0, p[0] ?? 0]);
    case "RPP": {
      const [x0 = 0, x1 = 1, y0 = 0, y1 = 1, z0 = 0, z1 = 1] = p;
      const b = box({
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
        depth: Math.abs(z1 - z0),
        name: `surf_${surf.id}`,
      });
      return translate(b, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
    }
    case "RCC": {
      const [vx = 0, vy = 0, vz = 0, hx = 0, hy = 0, hz = 1, r = 1] = p;
      const h = Math.hypot(hx, hy, hz);
      const c = cylinder({ radius: r, height: h, name: `surf_${surf.id}` });
      return translate(c, [vx + hx / 2, vy + hy / 2, vz + hz / 2]);
    }
    default:
      return null;
  }
}

/**
 * Converts an MCNP deck's non-graveyard CSG cells into a `@modelscript/cad` 3D `Assembly`.
 */
export function mcnpToCadAssembly(deck: McnpDeck): Assembly {
  const parts = [];

  for (const cell of deck.cells.values()) {
    const isGraveyard = Object.values(cell.imp).some((v) => v === 0);
    if (isGraveyard || !cell.csg) continue;

    let solid: Solid | null = null;
    if (cell.csg.kind === "surface" && cell.csg.sense === -1) {
      const surf = deck.surfaces.get(cell.csg.id);
      if (surf) solid = surfaceToCadSolid(surf);
    } else if (cell.csg.kind === "intersection" && cell.csg.operands.length === 2) {
      const [a, b] = cell.csg.operands;
      if (a?.kind === "surface" && b?.kind === "surface" && a.sense !== b.sense) {
        const sOuter = deck.surfaces.get(a.sense === -1 ? a.id : b.id);
        const sInner = deck.surfaces.get(a.sense === 1 ? a.id : b.id);
        const outerSolid = sOuter ? surfaceToCadSolid(sOuter) : null;
        const innerSolid = sInner ? surfaceToCadSolid(sInner) : null;
        if (outerSolid && innerSolid) {
          solid = subtract(outerSolid, innerSolid);
        }
      }
    }

    if (solid) {
      parts.push(
        part(solid, {
          material: cell.materialId > 0 ? `M${cell.materialId}` : "VOID",
        }),
      );
    }
  }

  return assembly(deck.title || "MCNP_Geometry", parts);
}
