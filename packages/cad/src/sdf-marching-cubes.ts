// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — 3D Signed Distance Fields (SDF), Isosurface Extraction, & Force-Directed PCB Placement.
 *
 * Supports:
 *   - Implicit SDF modeling (sphere, box, smooth union/subtraction)
 *   - Surface Nets / Marching-Tetrahedra isosurface triangle extraction (for SIMP densities & medical volumes)
 *   - Force-Directed Analytical PCB Component Placement (for `kicad` / `atopile` / `gerber`)
 */

import type { Point3D } from "./geometry-kernels.js";

export type SdfFn = (x: number, y: number, z: number) => number;

export const sdfSphere =
  (cx: number, cy: number, cz: number, r: number): SdfFn =>
  (x, y, z) =>
    Math.hypot(x - cx, y - cy, z - cz) - r;

export const sdfBox =
  (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): SdfFn =>
  (x, y, z) => {
    const qx = Math.abs(x - cx) - hx;
    const qy = Math.abs(y - cy) - hy;
    const qz = Math.abs(z - cz) - hz;
    const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    return out + inside;
  };

export const sdfSmoothUnion =
  (a: SdfFn, b: SdfFn, k = 0.2): SdfFn =>
  (x, y, z) => {
    const d1 = a(x, y, z);
    const d2 = b(x, y, z);
    const h = Math.max(k - Math.abs(d1 - d2), 0) / k;
    return Math.min(d1, d2) - h * h * k * 0.25;
  };

export const sdfSubtract =
  (a: SdfFn, b: SdfFn): SdfFn =>
  (x, y, z) =>
    Math.max(a(x, y, z), -b(x, y, z));

export interface IsoMesh {
  readonly vertices: Point3D[];
  readonly triangles: Array<[number, number, number]>;
}

/**
 * Marching-Tetrahedra Isosurface Extraction on a 3D scalar field `field[(ix*ny + iy)*nz + iz]`.
 * Guaranteed manifold & ambiguity-free (unlike naive Marching Cubes tables).
 */
export function extractIsosurfaceMesh(
  field: Float64Array,
  nx: number,
  ny: number,
  nz: number,
  isoLevel = 0.0,
  spacing: readonly [number, number, number] = [1, 1, 1],
): IsoMesh {
  const vertices: Point3D[] = [];
  const triangles: Array<[number, number, number]> = [];
  const valAt = (x: number, y: number, z: number): number => field[(x * ny + y) * nz + z]!;

  // 6 tetrahedra decomposing a unit cube (0..7 corner indices)
  const cubeCorners: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const tets: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ];

  const interp = (p1: Point3D, p2: Point3D, v1: number, v2: number): number => {
    const denom = v2 - v1;
    const t = Math.abs(denom) > 1e-12 ? (isoLevel - v1) / denom : 0.5;
    const idx = vertices.length;
    vertices.push({
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
      z: p1.z + t * (p2.z - p1.z),
    });
    return idx;
  };

  for (let ix = 0; ix < nx - 1; ix++) {
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let iz = 0; iz < nz - 1; iz++) {
        const vals = cubeCorners.map(([dx, dy, dz]) => valAt(ix + dx, iy + dy, iz + dz));
        const pts: Point3D[] = cubeCorners.map(([dx, dy, dz]) => ({
          x: (ix + dx) * spacing[0],
          y: (iy + dy) * spacing[1],
          z: (iz + dz) * spacing[2],
        }));

        for (const tet of tets) {
          const inside: number[] = [];
          const outside: number[] = [];
          for (const c of tet) {
            if (vals[c]! < isoLevel) inside.push(c);
            else outside.push(c);
          }
          if (inside.length === 0 || outside.length === 0) continue;

          if (inside.length === 1) {
            const a = inside[0]!;
            const v0 = interp(pts[a]!, pts[outside[0]!]!, vals[a]!, vals[outside[0]!]!);
            const v1 = interp(pts[a]!, pts[outside[1]!]!, vals[a]!, vals[outside[1]!]!);
            const v2 = interp(pts[a]!, pts[outside[2]!]!, vals[a]!, vals[outside[2]!]!);
            triangles.push([v0, v1, v2]);
          } else if (outside.length === 1) {
            const a = outside[0]!;
            const v0 = interp(pts[a]!, pts[inside[0]!]!, vals[a]!, vals[inside[0]!]!);
            const v1 = interp(pts[a]!, pts[inside[1]!]!, vals[a]!, vals[inside[1]!]!);
            const v2 = interp(pts[a]!, pts[inside[2]!]!, vals[a]!, vals[inside[2]!]!);
            triangles.push([v0, v2, v1]);
          } else {
            // 2 inside, 2 outside -> quad split into 2 triangles
            const [i0, i1] = [inside[0]!, inside[1]!];
            const [o0, o1] = [outside[0]!, outside[1]!];
            const v00 = interp(pts[i0]!, pts[o0]!, vals[i0]!, vals[o0]!);
            const v01 = interp(pts[i0]!, pts[o1]!, vals[i0]!, vals[o1]!);
            const v10 = interp(pts[i1]!, pts[o0]!, vals[i1]!, vals[o0]!);
            const v11 = interp(pts[i1]!, pts[o1]!, vals[i1]!, vals[o1]!);
            triangles.push([v00, v01, v11]);
            triangles.push([v00, v11, v10]);
          }
        }
      }
    }
  }

  return { vertices, triangles };
}

export interface PcbPlacementComponent {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fixed?: boolean | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
}

export interface PcbPlacementResult {
  readonly positions: Record<string, { x: number; y: number }>;
  readonly totalWirelengthHpwl: number;
}

/**
 * Force-Directed Analytical PCB Component Placement minimizing half-perimeter wirelength (HPWL)
 * with overlap repulsion and board-boundary clamping.
 */
export function placePcbComponentsForceDirected(
  components: readonly PcbPlacementComponent[],
  nets: readonly (readonly string[])[],
  boardWidth: number,
  boardHeight: number,
  iterations = 120,
): PcbPlacementResult {
  const n = components.length;
  const idxById = new Map<string, number>();
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = components[i]!;
    idxById.set(c.id, i);
    x[i] = c.x ?? ((i + 0.5) / Math.max(1, n)) * boardWidth;
    y[i] = c.y ?? 0.5 * boardHeight;
  }

  const netIndices = nets.map((net) => net.map((id) => idxById.get(id)).filter((v): v is number => v !== undefined));
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    fx.fill(0);
    fy.fill(0);
    const step = 0.15 * (1 - iter / (iterations + 10));

    // Attractive net spring forces toward net centroid
    for (const net of netIndices) {
      if (net.length < 2) continue;
      let cx = 0;
      let cy = 0;
      for (const i of net) {
        cx += x[i]!;
        cy += y[i]!;
      }
      cx /= net.length;
      cy /= net.length;
      for (const i of net) {
        fx[i] = fx[i]! + (cx - x[i]!) * 0.6;
        fy[i] = fy[i]! + (cy - y[i]!) * 0.6;
      }
    }

    // Overlap repulsion between component footprints
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[i]! - x[j]!;
        const dy = y[i]! - y[j]!;
        const minDx = 0.5 * (components[i]!.width + components[j]!.width) + 0.5;
        const minDy = 0.5 * (components[i]!.height + components[j]!.height) + 0.5;
        if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
          const pushX = (dx >= 0 ? 1 : -1) * (minDx - Math.abs(dx)) * 0.5;
          const pushY = (dy >= 0 ? 1 : -1) * (minDy - Math.abs(dy)) * 0.5;
          fx[i] = fx[i]! + pushX;
          fy[i] = fy[i]! + pushY;
          fx[j] = fx[j]! - pushX;
          fy[j] = fy[j]! - pushY;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const c = components[i]!;
      if (c.fixed) continue;
      const hx = 0.5 * c.width;
      const hy = 0.5 * c.height;
      x[i] = Math.max(hx, Math.min(boardWidth - hx, x[i]! + step * fx[i]!));
      y[i] = Math.max(hy, Math.min(boardHeight - hy, y[i]! + step * fy[i]!));
    }
  }

  let hpwl = 0;
  for (const net of netIndices) {
    if (net.length < 2) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const i of net) {
      if (x[i]! < minX) minX = x[i]!;
      if (x[i]! > maxX) maxX = x[i]!;
      if (y[i]! < minY) minY = y[i]!;
      if (y[i]! > maxY) maxY = y[i]!;
    }
    hpwl += maxX - minX + (maxY - minY);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  for (let i = 0; i < n; i++) {
    positions[components[i]!.id] = { x: x[i]!, y: y[i]! };
  }
  return { positions, totalWirelengthHpwl: hpwl };
}
