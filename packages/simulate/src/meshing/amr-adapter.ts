// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MeshQualityMetrics, Tet4Mesh } from "../fea/tet4-types.js";
import { MeshQualityAnalyzer } from "./mesh-quality-analyzer.js";

export interface AmrErrorFieldResult {
  /** Per-cell scalar error indicator (non-negative). */
  indicator: Float32Array;
  /** Maximum indicator value across the domain. */
  maxIndicator: number;
  /** Mean indicator value across the domain. */
  meanIndicator: number;
}

export interface OctreeAmrResult {
  /** Per-cell refinement level (0 = base coarse grid, 1..maxLevel = refined). */
  refinementLevel: Uint8Array;
  /** Number of cells marked for refinement (level > 0). */
  refinedCellCount: number;
  /** Fraction of cells refined in [0, 1]. */
  refinedFraction: number;
  /** Whether strict 2:1 neighbor level balance holds everywhere. */
  isBalanced2To1: boolean;
}

export interface TetAmrResult {
  mesh: Tet4Mesh;
  quality: MeshQualityMetrics;
  refinedTetCount: number;
  /** Number of hanging nodes remaining on shared faces/edges (0 for conforming meshes). */
  hangingNodeCount: number;
}

/**
 * Solution-Driven Error Indicators for CFD Adaptive Mesh Refinement (AMR).
 * Supports both feature-based (3D vorticity + velocity gradient) and
 * adjoint-weighted goal-oriented indicators.
 */
export class AmrErrorIndicator {
  /**
   * Computes 3D vorticity magnitude |curl(u)| + velocity gradient norm on a Cartesian grid.
   */
  public static computeFeatureIndicator(
    nx: number,
    ny: number,
    nz: number,
    dx: number,
    vx: Float32Array,
    vy: Float32Array,
    vz: Float32Array,
  ): AmrErrorFieldResult {
    const total = nx * ny * nz;
    const indicator = new Float32Array(total);
    const inv2dx = 1.0 / (2.0 * Math.max(1e-9, dx));
    let maxVal = 0.0;
    let sumVal = 0.0;

    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const idx = x + y * nx + z * nx * ny;
          const xm = idx - 1,
            xp = idx + 1;
          const ym = idx - nx,
            yp = idx + nx;
          const zm = idx - nx * ny,
            zp = idx + nx * ny;

          const dvzDy = (vz[yp]! - vz[ym]!) * inv2dx;
          const dvyDz = (vy[zp]! - vy[zm]!) * inv2dx;
          const dvxDz = (vx[zp]! - vx[zm]!) * inv2dx;
          const dvzDx = (vz[xp]! - vz[xm]!) * inv2dx;
          const dvyDx = (vy[xp]! - vy[xm]!) * inv2dx;
          const dvxDy = (vx[yp]! - vx[ym]!) * inv2dx;

          const wx = dvzDy - dvyDz;
          const wy = dvxDz - dvzDx;
          const wz = dvyDx - dvxDy;
          const vortMag = Math.hypot(wx, wy, wz);
          indicator[idx] = vortMag;
          if (vortMag > maxVal) maxVal = vortMag;
          sumVal += vortMag;
        }
      }
    }

    return {
      indicator,
      maxIndicator: maxVal,
      meanIndicator: total > 0 ? sumVal / total : 0,
    };
  }

  /**
   * Combines local flow residual/feature indicator with discrete adjoint sensitivity field:
   *   eta_i = |psi_i| * (feature_i + eps)
   */
  public static computeAdjointWeightedIndicator(
    featureIndicator: Float32Array,
    adjointSensitivity: Float32Array,
  ): AmrErrorFieldResult {
    const n = Math.min(featureIndicator.length, adjointSensitivity.length);
    const indicator = new Float32Array(n);
    let maxVal = 0.0;
    let sumVal = 0.0;

    for (let i = 0; i < n; i++) {
      const val = Math.abs(adjointSensitivity[i]!) * (featureIndicator[i]! + 1e-6);
      indicator[i] = val;
      if (val > maxVal) maxVal = val;
      sumVal += val;
    }

    return {
      indicator,
      maxIndicator: maxVal,
      meanIndicator: n > 0 ? sumVal / n : 0,
    };
  }
}

/**
 * 2:1 Balanced Multi-Level Octree Refiner for Cartesian LBM Grids.
 */
export class OctreeLbmRefiner {
  /**
   * Marks the top `refineFraction` (default 15%) of cells by error indicator and enforces
   * strict 2:1 neighbor refinement level grading across all 6 Cartesian faces.
   */
  public static buildRefinementMap(
    nx: number,
    ny: number,
    nz: number,
    indicator: Float32Array,
    options?: { refineFraction?: number | undefined; maxLevel?: number | undefined },
  ): OctreeAmrResult {
    const total = nx * ny * nz;
    const refineFraction = options?.refineFraction ?? 0.15;
    const maxLevel = Math.max(1, options?.maxLevel ?? 2);
    const level = new Uint8Array(total);

    // Determine threshold via sorted copy
    const sorted = Float32Array.from(indicator).sort();
    const threshIdx = Math.max(0, Math.min(total - 1, Math.floor(total * (1.0 - refineFraction))));
    const thresh1 = sorted[threshIdx]!;
    const thresh2Idx = Math.max(0, Math.min(total - 1, Math.floor(total * (1.0 - refineFraction * 0.25))));
    const thresh2 = sorted[thresh2Idx]!;

    for (let i = 0; i < total; i++) {
      const v = indicator[i]!;
      if (v > 0 && v >= thresh2 && maxLevel >= 2) {
        level[i] = 2;
      } else if (v > 0 && v >= thresh1) {
        level[i] = 1;
      }
    }

    // Enforce 2:1 balance: |level(i) - level(nbr)| <= 1
    let changed = true;
    let passes = 0;
    while (changed && passes < maxLevel + 2) {
      changed = false;
      passes++;
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const idx = x + y * nx + z * nx * ny;
            const cur = level[idx]!;
            let maxNbr = 0;
            if (x > 0) maxNbr = Math.max(maxNbr, level[idx - 1]!);
            if (x + 1 < nx) maxNbr = Math.max(maxNbr, level[idx + 1]!);
            if (y > 0) maxNbr = Math.max(maxNbr, level[idx - nx]!);
            if (y + 1 < ny) maxNbr = Math.max(maxNbr, level[idx + nx]!);
            if (z > 0) maxNbr = Math.max(maxNbr, level[idx - nx * ny]!);
            if (z + 1 < nz) maxNbr = Math.max(maxNbr, level[idx + nx * ny]!);
            if (maxNbr > cur + 1) {
              level[idx] = maxNbr - 1;
              changed = true;
            }
          }
        }
      }
    }

    // Verify 2:1 balance and count refined cells
    let refinedCellCount = 0;
    let isBalanced2To1 = true;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + y * nx + z * nx * ny;
          const cur = level[idx]!;
          if (cur > 0) refinedCellCount++;
          if (x + 1 < nx && Math.abs(cur - level[idx + 1]!) > 1) isBalanced2To1 = false;
          if (y + 1 < ny && Math.abs(cur - level[idx + nx]!) > 1) isBalanced2To1 = false;
          if (z + 1 < nz && Math.abs(cur - level[idx + nx * ny]!) > 1) isBalanced2To1 = false;
        }
      }
    }

    return {
      refinementLevel: level,
      refinedCellCount,
      refinedFraction: total > 0 ? refinedCellCount / total : 0,
      isBalanced2To1,
    };
  }

  /**
   * Trilinear 2x refinement prolongation from a coarse grid (nx, ny, nz)
   * to a fine grid (2*nx, 2*ny, 2*nz) using cell-centered coordinates with
   * linear boundary extrapolation so both constant and linear fields are
   * reproduced exactly across interior and boundary cells.
   */
  public static interpolateCoarseToFine(
    coarseField: Float32Array | Float64Array,
    nx: number,
    ny: number,
    nz: number,
  ): Float32Array {
    const fnx = nx * 2;
    const fny = ny * 2;
    const fnz = nz * 2;
    const fine = new Float32Array(fnx * fny * fnz);
    const cStrideZ = nx * ny;
    const fStrideZ = fnx * fny;

    for (let fz = 0; fz < fnz; fz++) {
      const cz = 0.5 * fz - 0.25;
      const z0 = nz > 1 ? Math.max(0, Math.min(nz - 2, Math.floor(cz))) : 0;
      const z1 = nz > 1 ? z0 + 1 : 0;
      const tz = nz > 1 ? cz - z0 : 0.0;
      const wz0 = 1.0 - tz;
      const wz1 = tz;

      for (let fy = 0; fy < fny; fy++) {
        const cy = 0.5 * fy - 0.25;
        const y0 = ny > 1 ? Math.max(0, Math.min(ny - 2, Math.floor(cy))) : 0;
        const y1 = ny > 1 ? y0 + 1 : 0;
        const ty = ny > 1 ? cy - y0 : 0.0;
        const wy0 = 1.0 - ty;
        const wy1 = ty;

        const rowBaseF = fy * fnx + fz * fStrideZ;
        const y0z0 = y0 * nx + z0 * cStrideZ;
        const y1z0 = y1 * nx + z0 * cStrideZ;
        const y0z1 = y0 * nx + z1 * cStrideZ;
        const y1z1 = y1 * nx + z1 * cStrideZ;

        for (let fx = 0; fx < fnx; fx++) {
          const cx = 0.5 * fx - 0.25;
          const x0 = nx > 1 ? Math.max(0, Math.min(nx - 2, Math.floor(cx))) : 0;
          const x1 = nx > 1 ? x0 + 1 : 0;
          const tx = nx > 1 ? cx - x0 : 0.0;
          const wx0 = 1.0 - tx;
          const wx1 = tx;

          const c000 = coarseField[x0 + y0z0]!;
          const c100 = coarseField[x1 + y0z0]!;
          const c010 = coarseField[x0 + y1z0]!;
          const c110 = coarseField[x1 + y1z0]!;
          const c001 = coarseField[x0 + y0z1]!;
          const c101 = coarseField[x1 + y0z1]!;
          const c011 = coarseField[x0 + y1z1]!;
          const c111 = coarseField[x1 + y1z1]!;

          const c00 = wx0 * c000 + wx1 * c100;
          const c10 = wx0 * c010 + wx1 * c110;
          const c01 = wx0 * c001 + wx1 * c101;
          const c11 = wx0 * c011 + wx1 * c111;

          const c0 = wy0 * c00 + wy1 * c10;
          const c1 = wy0 * c01 + wy1 * c11;

          fine[fx + rowBaseF] = wz0 * c0 + wz1 * c1;
        }
      }
    }

    return fine;
  }

  /**
   * Conservative 2x2x2 volume-averaged restriction from a fine grid (2*nx, 2*ny, 2*nz)
   * back to a coarse grid (nx, ny, nz).
   */
  public static restrictFineToCoarse(
    fineField: Float32Array | Float64Array,
    nx: number,
    ny: number,
    nz: number,
  ): Float32Array {
    // Primary convention: (nx, ny, nz) are coarse dimensions and fineField has (2*nx, 2*ny, 2*nz).
    // Fallback if caller passes fine dimensions directly.
    let cnx = nx;
    let cny = ny;
    let cnz = nz;
    let fnx = nx * 2;
    let fny = ny * 2;
    if (fineField.length === nx * ny * nz && nx >= 2 && ny >= 2 && nz >= 2) {
      fnx = nx;
      fny = ny;
      cnx = Math.floor(nx / 2);
      cny = Math.floor(ny / 2);
      cnz = Math.floor(nz / 2);
    }

    const coarse = new Float32Array(cnx * cny * cnz);
    const fStrideZ = fnx * fny;
    const cStrideZ = cnx * cny;

    for (let cz = 0; cz < cnz; cz++) {
      const fz0 = cz * 2;
      const fz1 = fz0 + 1;
      for (let cy = 0; cy < cny; cy++) {
        const fy0 = cy * 2;
        const fy1 = fy0 + 1;
        for (let cx = 0; cx < cnx; cx++) {
          const fx0 = cx * 2;
          const fx1 = fx0 + 1;
          const sum =
            fineField[fx0 + fy0 * fnx + fz0 * fStrideZ]! +
            fineField[fx1 + fy0 * fnx + fz0 * fStrideZ]! +
            fineField[fx0 + fy1 * fnx + fz0 * fStrideZ]! +
            fineField[fx1 + fy1 * fnx + fz0 * fStrideZ]! +
            fineField[fx0 + fy0 * fnx + fz1 * fStrideZ]! +
            fineField[fx1 + fy0 * fnx + fz1 * fStrideZ]! +
            fineField[fx0 + fy1 * fnx + fz1 * fStrideZ]! +
            fineField[fx1 + fy1 * fnx + fz1 * fStrideZ]!;
          coarse[cx + cy * cnx + cz * cStrideZ] = 0.125 * sum;
        }
      }
    }

    return coarse;
  }
}

/**
 * Longest-Edge Bisection Refiner with Green-Closure Conformity for Unstructured Tet4 Volumetric Meshes.
 */
export class TetAmrRefiner {
  /**
   * Refines marked tetrahedra via longest-edge bisection and applies conforming
   * green-closure (1-to-2, 1-to-3, 1-to-4) and red (1-to-8) splits to all
   * neighboring tetrahedra sharing bisected edges so zero hanging nodes remain.
   */
  public static refineMarkedTetrahedra(mesh: Tet4Mesh, tetError: Float32Array, refineFraction = 0.25): TetAmrResult {
    const numTets = Math.floor(mesh.elements.length / 4);
    const sorted = Float32Array.from(tetError).sort();
    const threshIdx = Math.max(0, Math.min(numTets - 1, Math.floor(numTets * (1.0 - refineFraction))));
    const thresh = sorted[threshIdx]!;

    const coords: number[] = Array.from(mesh.nodeCoords);
    const newElems: number[] = [];
    const edgeMidpoint = new Map<string, number>();

    const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);

    const getMidpoint = (a: number, b: number): number => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}_${hi}`;
      const existing = edgeMidpoint.get(key);
      if (existing !== undefined) return existing;
      const newIdx = coords.length / 3;
      coords.push(
        0.5 * (coords[lo * 3]! + coords[hi * 3]!),
        0.5 * (coords[lo * 3 + 1]! + coords[hi * 3 + 1]!),
        0.5 * (coords[lo * 3 + 2]! + coords[hi * 3 + 2]!),
      );
      edgeMidpoint.set(key, newIdx);
      return newIdx;
    };

    const edgeLenSq = (a: number, b: number): number => {
      const dx = coords[a * 3]! - coords[b * 3]!;
      const dy = coords[a * 3 + 1]! - coords[b * 3 + 1]!;
      const dz = coords[a * 3 + 2]! - coords[b * 3 + 2]!;
      return dx * dx + dy * dy + dz * dz;
    };

    const pushOrientedTet = (a: number, b: number, c: number, d: number): void => {
      const ax = coords[a * 3]!,
        ay = coords[a * 3 + 1]!,
        az = coords[a * 3 + 2]!;
      const bx = coords[b * 3]! - ax,
        by = coords[b * 3 + 1]! - ay,
        bz = coords[b * 3 + 2]! - az;
      const cx = coords[c * 3]! - ax,
        cy = coords[c * 3 + 1]! - ay,
        cz = coords[c * 3 + 2]! - az;
      const dx = coords[d * 3]! - ax,
        dy = coords[d * 3 + 1]! - ay,
        dz = coords[d * 3 + 2]! - az;
      const det = bx * (cy * dz - cz * dy) - by * (cx * dz - cz * dx) + bz * (cx * dy - cy * dx);
      if (det < 0) {
        newElems.push(a, b, d, c);
      } else {
        newElems.push(a, b, c, d);
      }
    };

    const localEdges: Array<[number, number, number, number]> = [
      [0, 1, 2, 3],
      [0, 2, 1, 3],
      [0, 3, 1, 2],
      [1, 2, 0, 3],
      [1, 3, 0, 2],
      [2, 3, 0, 1],
    ];

    // Pass 1: Mark longest edge of every high-error tetrahedron
    let refinedTetCount = 0;
    for (let t = 0; t < numTets; t++) {
      if (tetError[t]! >= thresh && tetError[t]! > 0) {
        const nodes = [
          mesh.elements[t * 4]!,
          mesh.elements[t * 4 + 1]!,
          mesh.elements[t * 4 + 2]!,
          mesh.elements[t * 4 + 3]!,
        ];
        let bestEdge = localEdges[0]!;
        let maxLenSq = -1;
        for (const e of localEdges) {
          const l2 = edgeLenSq(nodes[e[0]]!, nodes[e[1]]!);
          if (l2 > maxLenSq) {
            maxLenSq = l2;
            bestEdge = e;
          }
        }
        getMidpoint(nodes[bestEdge[0]]!, nodes[bestEdge[1]]!);
        refinedTetCount++;
      }
    }

    // Pass 2: Promote non-green edge patterns (3-edge Z-path, 4-edge, 5-edge) to 1-to-8 red refinement
    // so every tetrahedron has a conforming closure pattern in {0, 1, 2a, 2b, 3a, 3b, 6}.
    let promoted = true;
    while (promoted) {
      promoted = false;
      for (let t = 0; t < numTets; t++) {
        const nodes = [
          mesh.elements[t * 4]!,
          mesh.elements[t * 4 + 1]!,
          mesh.elements[t * 4 + 2]!,
          mesh.elements[t * 4 + 3]!,
        ];
        const splitLocal: number[] = [];
        for (let ei = 0; ei < 6; ei++) {
          const e = localEdges[ei]!;
          if (edgeMidpoint.has(edgeKey(nodes[e[0]]!, nodes[e[1]]!))) {
            splitLocal.push(ei);
          }
        }
        const k = splitLocal.length;
        let needsRed = k === 4 || k === 5;
        if (k === 3) {
          const deg = [0, 0, 0, 0];
          for (const ei of splitLocal) {
            const e = localEdges[ei]!;
            deg[e[0]] = deg[e[0]]! + 1;
            deg[e[1]] = deg[e[1]]! + 1;
          }
          // Face pattern has degrees {2,2,2,0}; Star pattern has degrees {3,1,1,1}.
          // Path (Z) pattern has degrees {2,2,1,1} -> promote to 1-to-8.
          const hasZero = deg.includes(0);
          const hasThree = deg.includes(3);
          if (!hasZero && !hasThree) {
            needsRed = true;
          }
        }
        if (needsRed) {
          for (const e of localEdges) {
            const a = nodes[e[0]]!;
            const b = nodes[e[1]]!;
            if (!edgeMidpoint.has(edgeKey(a, b))) {
              getMidpoint(a, b);
              promoted = true;
            }
          }
        }
      }
    }

    // Pass 3: Emit conforming child tetrahedra for all elements (marked + green/red closures)
    for (let t = 0; t < numTets; t++) {
      const n0 = mesh.elements[t * 4]!;
      const n1 = mesh.elements[t * 4 + 1]!;
      const n2 = mesh.elements[t * 4 + 2]!;
      const n3 = mesh.elements[t * 4 + 3]!;
      const nodes = [n0, n1, n2, n3];

      const splitEdges: Array<[number, number, number, number]> = [];
      for (const e of localEdges) {
        if (edgeMidpoint.has(edgeKey(nodes[e[0]]!, nodes[e[1]]!))) {
          splitEdges.push(e);
        }
      }

      const k = splitEdges.length;
      if (k === 0) {
        newElems.push(n0, n1, n2, n3);
      } else if (k === 1) {
        // 1-to-2 bisection
        const e = splitEdges[0]!;
        const va = nodes[e[0]]!;
        const vb = nodes[e[1]]!;
        const vc = nodes[e[2]]!;
        const vd = nodes[e[3]]!;
        const vm = edgeMidpoint.get(edgeKey(va, vb))!;
        pushOrientedTet(va, vm, vc, vd);
        pushOrientedTet(vm, vb, vc, vd);
      } else if (k === 2) {
        const e0 = splitEdges[0]!;
        const e1 = splitEdges[1]!;
        const set0 = new Set([e0[0], e0[1]]);
        const shared: number[] = [];
        if (set0.has(e1[0])) shared.push(e1[0]);
        if (set0.has(e1[1])) shared.push(e1[1]);

        if (shared.length === 0) {
          // 2a: Two opposite split edges -> 1-to-4 split
          const va = nodes[e0[0]]!;
          const vb = nodes[e0[1]]!;
          const vc = nodes[e1[0]]!;
          const vd = nodes[e1[1]]!;
          const m1 = edgeMidpoint.get(edgeKey(va, vb))!;
          const m2 = edgeMidpoint.get(edgeKey(vc, vd))!;
          pushOrientedTet(va, m1, vc, m2);
          pushOrientedTet(va, m1, m2, vd);
          pushOrientedTet(m1, vb, vc, m2);
          pushOrientedTet(m1, vb, m2, vd);
        } else {
          // 2b: Two adjacent split edges sharing vertex a -> 1-to-3 split
          // Use canonical diagonal on quad face (m_ab, b, c, m_ac) ordered by global vertex ID
          const aIdx = shared[0]!;
          const bIdx = e0[0] === aIdx ? e0[1] : e0[0];
          const cIdx = e1[0] === aIdx ? e1[1] : e1[0];
          const dIdx = [0, 1, 2, 3].find((i) => i !== aIdx && i !== bIdx && i !== cIdx)!;

          const va = nodes[aIdx]!;
          let vb = nodes[bIdx]!;
          let vc = nodes[cIdx]!;
          const vd = nodes[dIdx]!;
          if (vc < vb) {
            const tmp = vb;
            vb = vc;
            vc = tmp;
          }
          const mab = edgeMidpoint.get(edgeKey(va, vb))!;
          const mac = edgeMidpoint.get(edgeKey(va, vc))!;

          // Since vb < vc, canonical quad diagonal is (vb, mac)
          pushOrientedTet(va, mab, mac, vd);
          pushOrientedTet(mab, vb, mac, vd);
          pushOrientedTet(vb, vc, mac, vd);
        }
      } else if (k === 3) {
        const deg = [0, 0, 0, 0];
        for (const e of splitEdges) {
          deg[e[0]] = deg[e[0]]! + 1;
          deg[e[1]] = deg[e[1]]! + 1;
        }
        const zeroIdx = deg.indexOf(0);
        if (zeroIdx !== -1) {
          // 3a: All 3 edges of a single face are split -> 1-to-4 split lifted to apex d
          const faceIdxs = [0, 1, 2, 3].filter((i) => i !== zeroIdx);
          const va = nodes[faceIdxs[0]!]!;
          const vb = nodes[faceIdxs[1]!]!;
          const vc = nodes[faceIdxs[2]!]!;
          const vd = nodes[zeroIdx]!;
          const mab = edgeMidpoint.get(edgeKey(va, vb))!;
          const mbc = edgeMidpoint.get(edgeKey(vb, vc))!;
          const mca = edgeMidpoint.get(edgeKey(vc, va))!;
          pushOrientedTet(va, mab, mca, vd);
          pushOrientedTet(mab, vb, mbc, vd);
          pushOrientedTet(mca, mbc, vc, vd);
          pushOrientedTet(mab, mbc, mca, vd);
        } else {
          // 3b: Star of 3 edges at one vertex a -> 1-to-4 split (corner tet + 3 prism tets)
          const apexIdx = deg.indexOf(3);
          const va = nodes[apexIdx]!;
          const others = [0, 1, 2, 3]
            .filter((i) => i !== apexIdx)
            .map((i) => nodes[i]!)
            .sort((u, v) => u - v);
          const vb = others[0]!;
          const vc = others[1]!;
          const vd = others[2]!;
          const mb = edgeMidpoint.get(edgeKey(va, vb))!;
          const mc = edgeMidpoint.get(edgeKey(va, vc))!;
          const md = edgeMidpoint.get(edgeKey(va, vd))!;
          // vb < vc < vd guarantees canonical diagonals (vb, mc), (vc, md), (vb, md) on all 3 quad faces
          pushOrientedTet(va, mb, mc, md);
          pushOrientedTet(vb, mb, mc, md);
          pushOrientedTet(vb, vc, mc, md);
          pushOrientedTet(vb, vc, vd, md);
        }
      } else {
        // k === 6: Bey 1-to-8 red refinement (4 corner tets + 4 octahedron tets around shortest diagonal)
        const m01 = edgeMidpoint.get(edgeKey(n0, n1))!;
        const m02 = edgeMidpoint.get(edgeKey(n0, n2))!;
        const m03 = edgeMidpoint.get(edgeKey(n0, n3))!;
        const m12 = edgeMidpoint.get(edgeKey(n1, n2))!;
        const m13 = edgeMidpoint.get(edgeKey(n1, n3))!;
        const m23 = edgeMidpoint.get(edgeKey(n2, n3))!;

        // 4 corner tetrahedra
        pushOrientedTet(n0, m01, m02, m03);
        pushOrientedTet(m01, n1, m12, m13);
        pushOrientedTet(m02, m12, n2, m23);
        pushOrientedTet(m03, m13, m23, n3);

        // Inner octahedron split along shortest interior diagonal
        const dA = edgeLenSq(m01, m23);
        const dB = edgeLenSq(m02, m13);
        const dC = edgeLenSq(m03, m12);
        if (dA <= dB && dA <= dC) {
          pushOrientedTet(m01, m23, m02, m03);
          pushOrientedTet(m01, m23, m03, m13);
          pushOrientedTet(m01, m23, m13, m12);
          pushOrientedTet(m01, m23, m12, m02);
        } else if (dB <= dC) {
          pushOrientedTet(m02, m13, m01, m03);
          pushOrientedTet(m02, m13, m03, m23);
          pushOrientedTet(m02, m13, m23, m12);
          pushOrientedTet(m02, m13, m12, m01);
        } else {
          pushOrientedTet(m03, m12, m01, m02);
          pushOrientedTet(m03, m12, m02, m23);
          pushOrientedTet(m03, m12, m23, m13);
          pushOrientedTet(m03, m12, m13, m01);
        }
      }
    }

    // Verify conformity: count any bisected edge that still appears unsplit in the output mesh
    const hangingNodes = new Set<number>();
    const numOutTets = newElems.length / 4;
    for (let t = 0; t < numOutTets; t++) {
      const base = t * 4;
      const tn = [newElems[base]!, newElems[base + 1]!, newElems[base + 2]!, newElems[base + 3]!];
      for (const e of localEdges) {
        const mid = edgeMidpoint.get(edgeKey(tn[e[0]]!, tn[e[1]]!));
        if (mid !== undefined) {
          hangingNodes.add(mid);
        }
      }
    }

    const adaptedMesh: Tet4Mesh = {
      nodeCoords: new Float32Array(coords),
      elements: new Uint32Array(newElems),
      numNodes: coords.length / 3,
      numElements: numOutTets,
      boundaryNodes: mesh.boundaryNodes,
      ...(mesh.boundaryFaces ? { boundaryFaces: mesh.boundaryFaces } : {}),
    };

    const quality = MeshQualityAnalyzer.analyze(adaptedMesh);
    return {
      mesh: adaptedMesh,
      quality,
      refinedTetCount,
      hangingNodeCount: hangingNodes.size,
    };
  }
}
