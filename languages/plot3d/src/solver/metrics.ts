// SPDX-License-Identifier: AGPL-3.0-or-later

import { plot3dIndex, type Plot3dGrid, type Plot3dGridBlock } from "../types.js";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Plot3dBlockMetrics {
  blockIndex: number;
  cellCount: number;
  cellVolumes: Float64Array;
  jacobians: Float64Array;
  totalVolume: number;
  minVolume: number;
  maxVolume: number;
  minJacobian: number;
  maxJacobian: number;
  invertedCellCount: number;
  invertedCells: Array<{ i: number; j: number; k: number; volume: number }>;
}

export interface Plot3dGridMetrics {
  totalVolume: number;
  totalCellCount: number;
  minVolume: number;
  maxVolume: number;
  minJacobian: number;
  invertedCellCount: number;
  blocks: Plot3dBlockMetrics[];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function tetVolume6(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): number {
  const a = sub(p1, p0);
  const b = sub(p2, p0);
  const c = sub(p3, p0);
  return dot(cross(a, b), c);
}

/**
 * Computes exact signed hexahedral cell volume via 6-tetrahedra decomposition
 * sharing the main diagonal p000 -> p111. Positive for right-handed (i, j, k).
 */
export function computeHexahedronVolume(
  p000: Vec3,
  p100: Vec3,
  p110: Vec3,
  p010: Vec3,
  p001: Vec3,
  p101: Vec3,
  p111: Vec3,
  p011: Vec3,
): number {
  const v6 =
    tetVolume6(p000, p100, p110, p111) +
    tetVolume6(p000, p110, p010, p111) +
    tetVolume6(p000, p010, p011, p111) +
    tetVolume6(p000, p011, p001, p111) +
    tetVolume6(p000, p001, p101, p111) +
    tetVolume6(p000, p101, p100, p111);
  return v6 / 6.0;
}

/**
 * Computes signed 2D quadrilateral cell area (positive for counter-clockwise right-handed (i, j)).
 */
export function computeQuadArea(
  x00: number,
  y00: number,
  x10: number,
  y10: number,
  x11: number,
  y11: number,
  x01: number,
  y01: number,
): number {
  return 0.5 * ((x11 - x00) * (y01 - y10) - (y11 - y00) * (x01 - x10));
}

/**
 * Computes directed area vector of a quadrilateral face (p0, p1, p2, p3):
 * A = 0.5 * ((p2 - p0) x (p3 - p1)).
 */
export function computeQuadFaceAreaVector(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): Vec3 {
  const d1 = sub(p2, p0);
  const d2 = sub(p3, p1);
  const c = cross(d1, d2);
  return { x: 0.5 * c.x, y: 0.5 * c.y, z: 0.5 * c.z };
}

function nodeVec(block: Plot3dGridBlock, i: number, j: number, k: number): Vec3 {
  const idx = plot3dIndex(i, j, k, block.ni, block.nj);
  return {
    x: block.x[idx]!,
    y: block.y[idx]!,
    z: block.z[idx]!,
  };
}

/**
 * Computes structured-grid cell volumes and nodal metric Jacobians
 * $J = \det(\partial(x,y,z)/\partial(\xi,\eta,\zeta))$ for a single PLOT3D block.
 */
export function computeBlockMetrics(block: Plot3dGridBlock): Plot3dBlockMetrics {
  const { ni, nj, nk } = block;
  const is3d = nk > 1;
  const ciMax = Math.max(0, ni - 1);
  const cjMax = Math.max(0, nj - 1);
  const ckMax = is3d ? Math.max(0, nk - 1) : 1;
  const cellCount = ciMax * cjMax * ckMax;

  const cellVolumes = new Float64Array(cellCount);
  let totalVolume = 0;
  let minVolume = cellCount > 0 ? Number.POSITIVE_INFINITY : 0;
  let maxVolume = cellCount > 0 ? Number.NEGATIVE_INFINITY : 0;
  const invertedCells: Array<{ i: number; j: number; k: number; volume: number }> = [];

  let cIdx = 0;
  for (let k = 0; k < ckMax; k++) {
    for (let j = 0; j < cjMax; j++) {
      for (let i = 0; i < ciMax; i++) {
        let vol: number;
        if (is3d) {
          vol = computeHexahedronVolume(
            nodeVec(block, i, j, k),
            nodeVec(block, i + 1, j, k),
            nodeVec(block, i + 1, j + 1, k),
            nodeVec(block, i, j + 1, k),
            nodeVec(block, i, j, k + 1),
            nodeVec(block, i + 1, j, k + 1),
            nodeVec(block, i + 1, j + 1, k + 1),
            nodeVec(block, i, j + 1, k + 1),
          );
        } else {
          const i00 = plot3dIndex(i, j, 0, ni, nj);
          const i10 = plot3dIndex(i + 1, j, 0, ni, nj);
          const i11 = plot3dIndex(i + 1, j + 1, 0, ni, nj);
          const i01 = plot3dIndex(i, j + 1, 0, ni, nj);
          vol = computeQuadArea(
            block.x[i00]!,
            block.y[i00]!,
            block.x[i10]!,
            block.y[i10]!,
            block.x[i11]!,
            block.y[i11]!,
            block.x[i01]!,
            block.y[i01]!,
          );
        }
        cellVolumes[cIdx++] = vol;
        totalVolume += vol;
        if (vol < minVolume) minVolume = vol;
        if (vol > maxVolume) maxVolume = vol;
        if (vol <= 0) {
          invertedCells.push({ i, j, k, volume: vol });
        }
      }
    }
  }

  // Compute finite-difference coordinate transformation Jacobian at every node
  const nNodes = ni * nj * nk;
  const jacobians = new Float64Array(nNodes);
  let minJacobian = nNodes > 0 ? Number.POSITIVE_INFINITY : 0;
  let maxJacobian = nNodes > 0 ? Number.NEGATIVE_INFINITY : 0;

  const dXi = (i: number, j: number, k: number): Vec3 => {
    if (ni <= 1) return { x: 1, y: 0, z: 0 };
    if (i === 0) return sub(nodeVec(block, 1, j, k), nodeVec(block, 0, j, k));
    if (i === ni - 1) return sub(nodeVec(block, ni - 1, j, k), nodeVec(block, ni - 2, j, k));
    const d = sub(nodeVec(block, i + 1, j, k), nodeVec(block, i - 1, j, k));
    return { x: 0.5 * d.x, y: 0.5 * d.y, z: 0.5 * d.z };
  };
  const dEta = (i: number, j: number, k: number): Vec3 => {
    if (nj <= 1) return { x: 0, y: 1, z: 0 };
    if (j === 0) return sub(nodeVec(block, i, 1, k), nodeVec(block, i, 0, k));
    if (j === nj - 1) return sub(nodeVec(block, i, nj - 1, k), nodeVec(block, i, nj - 2, k));
    const d = sub(nodeVec(block, i, j + 1, k), nodeVec(block, i, j - 1, k));
    return { x: 0.5 * d.x, y: 0.5 * d.y, z: 0.5 * d.z };
  };
  const dZeta = (i: number, j: number, k: number): Vec3 => {
    if (!is3d) return { x: 0, y: 0, z: 1 };
    if (k === 0) return sub(nodeVec(block, i, j, 1), nodeVec(block, i, j, 0));
    if (k === nk - 1) return sub(nodeVec(block, i, j, nk - 1), nodeVec(block, i, j, nk - 2));
    const d = sub(nodeVec(block, i, j, k + 1), nodeVec(block, i, j, k - 1));
    return { x: 0.5 * d.x, y: 0.5 * d.y, z: 0.5 * d.z };
  };

  for (let k = 0; k < nk; k++) {
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const idx = plot3dIndex(i, j, k, ni, nj);
        const jac = dot(cross(dXi(i, j, k), dEta(i, j, k)), dZeta(i, j, k));
        jacobians[idx] = jac;
        if (jac < minJacobian) minJacobian = jac;
        if (jac > maxJacobian) maxJacobian = jac;
      }
    }
  }

  return {
    blockIndex: block.index,
    cellCount,
    cellVolumes,
    jacobians,
    totalVolume,
    minVolume,
    maxVolume,
    minJacobian,
    maxJacobian,
    invertedCellCount: invertedCells.length,
    invertedCells,
  };
}

/**
 * Computes structured-grid volume and Jacobian metrics across all blocks of a `Plot3dGrid`.
 */
export function computeGridMetrics(grid: Plot3dGrid): Plot3dGridMetrics {
  const blocks = grid.blocks.map((b) => computeBlockMetrics(b));
  let totalVolume = 0;
  let totalCellCount = 0;
  let minVolume = blocks.length > 0 ? Number.POSITIVE_INFINITY : 0;
  let maxVolume = blocks.length > 0 ? Number.NEGATIVE_INFINITY : 0;
  let minJacobian = blocks.length > 0 ? Number.POSITIVE_INFINITY : 0;
  let invertedCellCount = 0;

  for (const bm of blocks) {
    totalVolume += bm.totalVolume;
    totalCellCount += bm.cellCount;
    if (bm.cellCount > 0) {
      if (bm.minVolume < minVolume) minVolume = bm.minVolume;
      if (bm.maxVolume > maxVolume) maxVolume = bm.maxVolume;
    }
    if (bm.minJacobian < minJacobian) minJacobian = bm.minJacobian;
    invertedCellCount += bm.invertedCellCount;
  }

  return {
    totalVolume,
    totalCellCount,
    minVolume: Number.isFinite(minVolume) ? minVolume : 0,
    maxVolume: Number.isFinite(maxVolume) ? maxVolume : 0,
    minJacobian: Number.isFinite(minJacobian) ? minJacobian : 0,
    invertedCellCount,
    blocks,
  };
}
