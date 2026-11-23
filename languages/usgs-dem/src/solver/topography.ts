// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Topographic & Geomorphometric Solver for USGS Digital Elevation Models.
 *
 * Implements:
 * - Bilinear elevation interpolation `interpolateElevation`
 * - Horn (1981) 3×3 finite-difference slope & aspect gradients `computeHornSlopeAspect`
 * - D8 (O'Callaghan & Mark 1984 / Jenson & Domingue 1988) steepest-descent flow direction & accumulation
 * - Strahler (1952) hypsometric integral & elevation statistics `computeHypsometricIntegral`
 * - Cross-section elevation profile extraction `extractElevationProfile`
 */

import type { UsgsDemGrid, UsgsDemModel } from "../types.js";

export interface SlopeAspectCell {
  dzdx: number;
  dzdy: number;
  slopeRad: number;
  slopeDeg: number;
  aspectDeg: number; // 0..360 clockwise from North, -1 for flat
}

export interface TerrainGridMetrics {
  numCols: number;
  numRows: number;
  dzdx: Float64Array;
  dzdy: Float64Array;
  slopeRad: Float64Array;
  slopeDeg: Float64Array;
  aspectDeg: Float64Array;
  meanSlopeDeg: number;
  maxSlopeDeg: number;
}

export interface D8FlowResult {
  numCols: number;
  numRows: number;
  /** ESRI/Jenson-Domingue D8 direction code: 1=E, 2=SE, 4=S, 8=SW, 16=W, 32=NW, 64=N, 128=NE, 0=pit/flat */
  flowDirection: Uint8Array;
  /** Upstream contributing cell count (including self) */
  flowAccumulation: Uint32Array;
  maxAccumulation: number;
  outletIndex: number;
}

export interface HypsometricResult {
  minElevation: number;
  maxElevation: number;
  meanElevation: number;
  relief: number;
  hypsometricIntegral: number;
  validCellCount: number;
}

export interface ElevationProfilePoint {
  distance: number;
  x: number;
  y: number;
  elevation: number;
}

function getGridZ(grid: UsgsDemGrid, row: number, col: number): number {
  const r = Math.max(0, Math.min(grid.numRows - 1, row));
  const c = Math.max(0, Math.min(grid.numCols - 1, col));
  return grid.z[r * grid.numCols + c]!;
}

/**
 * Bilinear interpolation of elevation at planimetric coordinates `(x, y)`.
 * Coordinates may be absolute (matching `grid.xOrigin`, `grid.yOrigin`) or local if `local = true`.
 */
export function interpolateElevation(
  modelOrGrid: UsgsDemModel | UsgsDemGrid,
  x: number,
  y: number,
  local = false,
): number {
  const grid = "grid" in modelOrGrid ? modelOrGrid.grid : modelOrGrid;
  if (grid.numCols === 0 || grid.numRows === 0 || grid.dx <= 0 || grid.dy <= 0) {
    return Number.NaN;
  }

  const lx = local ? x : x - grid.xOrigin;
  const ly = local ? y : y - grid.yOrigin;

  const fc = lx / grid.dx;
  const fr = ly / grid.dy;

  if (fc < 0 || fr < 0 || fc > grid.numCols - 1 || fr > grid.numRows - 1) {
    return Number.NaN;
  }

  const c0 = Math.min(Math.floor(fc), grid.numCols - 2);
  const r0 = Math.min(Math.floor(fr), grid.numRows - 2);
  const c1 = Math.min(c0 + 1, grid.numCols - 1);
  const r1 = Math.min(r0 + 1, grid.numRows - 1);

  const tx = c1 === c0 ? 0 : fc - c0;
  const ty = r1 === r0 ? 0 : fr - r0;

  const z00 = getGridZ(grid, r0, c0);
  const z10 = getGridZ(grid, r0, c1);
  const z01 = getGridZ(grid, r1, c0);
  const z11 = getGridZ(grid, r1, c1);

  if (z00 === grid.voidValue || z10 === grid.voidValue || z01 === grid.voidValue || z11 === grid.voidValue) {
    return Number.NaN;
  }

  const zBottom = z00 * (1 - tx) + z10 * tx;
  const zTop = z01 * (1 - tx) + z11 * tx;
  return zBottom * (1 - ty) + zTop * ty;
}

/**
 * Compute Horn (1981) 3×3 weighted finite-difference gradient, slope, and aspect at `(row, col)`.
 * Uses one-sided exact finite differences on boundary cells so inclined planes remain exact everywhere.
 */
export function computeHornSlopeAspect(
  modelOrGrid: UsgsDemModel | UsgsDemGrid,
  row: number,
  col: number,
): SlopeAspectCell {
  const grid = "grid" in modelOrGrid ? modelOrGrid.grid : modelOrGrid;
  const { numCols, numRows, dx, dy } = grid;

  let dzdx = 0;
  let dzdy = 0;

  if (numCols >= 3 && numRows >= 3 && row > 0 && row < numRows - 1 && col > 0 && col < numCols - 1) {
    // Classic Horn (1981) 3×3 stencil
    const zSW = getGridZ(grid, row - 1, col - 1);
    const zS = getGridZ(grid, row - 1, col);
    const zSE = getGridZ(grid, row - 1, col + 1);
    const zW = getGridZ(grid, row, col - 1);
    const zE = getGridZ(grid, row, col + 1);
    const zNW = getGridZ(grid, row + 1, col - 1);
    const zN = getGridZ(grid, row + 1, col);
    const zNE = getGridZ(grid, row + 1, col + 1);

    dzdx = (zNE + 2 * zE + zSE - (zNW + 2 * zW + zSW)) / (8 * dx);
    dzdy = (zNW + 2 * zN + zNE - (zSW + 2 * zS + zSE)) / (8 * dy);
  } else {
    // Boundary fallback: central where possible, otherwise forward/backward
    if (numCols >= 2) {
      if (col === 0) {
        dzdx = (getGridZ(grid, row, 1) - getGridZ(grid, row, 0)) / dx;
      } else if (col === numCols - 1) {
        dzdx = (getGridZ(grid, row, numCols - 1) - getGridZ(grid, row, numCols - 2)) / dx;
      } else {
        dzdx = (getGridZ(grid, row, col + 1) - getGridZ(grid, row, col - 1)) / (2 * dx);
      }
    }
    if (numRows >= 2) {
      if (row === 0) {
        dzdy = (getGridZ(grid, 1, col) - getGridZ(grid, 0, col)) / dy;
      } else if (row === numRows - 1) {
        dzdy = (getGridZ(grid, numRows - 1, col) - getGridZ(grid, numRows - 2, col)) / dy;
      } else {
        dzdy = (getGridZ(grid, row + 1, col) - getGridZ(grid, row - 1, col)) / (2 * dy);
      }
    }
  }

  const gradMag = Math.hypot(dzdx, dzdy);
  const slopeRad = Math.atan(gradMag);
  const slopeDeg = (slopeRad * 180) / Math.PI;

  let aspectDeg = -1;
  if (gradMag > 1e-15) {
    // Downslope vector is (-dzdx, -dzdy); compass azimuth clockwise from North (+Y)
    aspectDeg = ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360;
  }

  return { dzdx, dzdy, slopeRad, slopeDeg, aspectDeg };
}

/**
 * Compute Horn slope and aspect across the entire DEM grid.
 */
export function computeTerrainGridMetrics(modelOrGrid: UsgsDemModel | UsgsDemGrid): TerrainGridMetrics {
  const grid = "grid" in modelOrGrid ? modelOrGrid.grid : modelOrGrid;
  const n = grid.numCols * grid.numRows;
  const dzdx = new Float64Array(n);
  const dzdy = new Float64Array(n);
  const slopeRad = new Float64Array(n);
  const slopeDeg = new Float64Array(n);
  const aspectDeg = new Float64Array(n);

  let sumSlope = 0;
  let maxSlope = 0;

  for (let r = 0; r < grid.numRows; r++) {
    for (let c = 0; c < grid.numCols; c++) {
      const idx = r * grid.numCols + c;
      const cell = computeHornSlopeAspect(grid, r, c);
      dzdx[idx] = cell.dzdx;
      dzdy[idx] = cell.dzdy;
      slopeRad[idx] = cell.slopeRad;
      slopeDeg[idx] = cell.slopeDeg;
      aspectDeg[idx] = cell.aspectDeg;
      sumSlope += cell.slopeDeg;
      if (cell.slopeDeg > maxSlope) maxSlope = cell.slopeDeg;
    }
  }

  return {
    numCols: grid.numCols,
    numRows: grid.numRows,
    dzdx,
    dzdy,
    slopeRad,
    slopeDeg,
    aspectDeg,
    meanSlopeDeg: n > 0 ? sumSlope / n : 0,
    maxSlopeDeg: maxSlope,
  };
}

// D8 neighbor offsets: [dc, dr, code]
const D8_NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], // E
  [1, -1, 2], // SE
  [0, -1, 4], // S
  [-1, -1, 8], // SW
  [-1, 0, 16], // W
  [-1, 1, 32], // NW
  [0, 1, 64], // N
  [1, 1, 128], // NE
];

/**
 * Compute D8 steepest-descent flow direction and upstream flow accumulation across the DEM grid.
 */
export function computeD8Flow(modelOrGrid: UsgsDemModel | UsgsDemGrid): D8FlowResult {
  const grid = "grid" in modelOrGrid ? modelOrGrid.grid : modelOrGrid;
  const { numCols, numRows, dx, dy, z, voidValue } = grid;
  const n = numCols * numRows;
  const flowDirection = new Uint8Array(n);
  const flowAccumulation = new Uint32Array(n);
  const downstream = new Int32Array(n).fill(-1);
  const inDegree = new Uint32Array(n);

  const diagDist = Math.hypot(dx, dy);

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const idx = r * numCols + c;
      const zc = z[idx]!;
      if (zc === voidValue) continue;

      let bestSlope = 0;
      let bestCode = 0;
      let bestTarget = -1;

      for (const [dc, dr, code] of D8_NEIGHBORS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= numCols || nr < 0 || nr >= numRows) continue;
        const nIdx = nr * numCols + nc;
        const zn = z[nIdx]!;
        if (zn === voidValue) continue;

        const dist = dc !== 0 && dr !== 0 ? diagDist : dc !== 0 ? dx : dy;
        const dropRate = (zc - zn) / dist;
        if (dropRate > bestSlope) {
          bestSlope = dropRate;
          bestCode = code;
          bestTarget = nIdx;
        }
      }

      flowDirection[idx] = bestCode;
      downstream[idx] = bestTarget;
      if (bestTarget >= 0) {
        inDegree[bestTarget] = inDegree[bestTarget]! + 1;
      }
    }
  }

  // Kahn topological accumulation from ridge cells down to outlets
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    flowAccumulation[i] = 1;
    if (inDegree[i] === 0) queue.push(i);
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++]!;
    const target = downstream[curr]!;
    if (target >= 0) {
      flowAccumulation[target] = flowAccumulation[target]! + flowAccumulation[curr]!;
      inDegree[target] = inDegree[target]! - 1;
      if (inDegree[target] === 0) queue.push(target);
    }
  }

  let maxAccumulation = 0;
  let outletIndex = 0;
  for (let i = 0; i < n; i++) {
    if (flowAccumulation[i]! > maxAccumulation) {
      maxAccumulation = flowAccumulation[i]!;
      outletIndex = i;
    }
  }

  return {
    numCols,
    numRows,
    flowDirection,
    flowAccumulation,
    maxAccumulation,
    outletIndex,
  };
}

/**
 * Compute Strahler's hypsometric integral `HI = (meanZ - minZ) / (maxZ - minZ)` and elevation statistics.
 */
export function computeHypsometricIntegral(modelOrGrid: UsgsDemModel | UsgsDemGrid): HypsometricResult {
  const grid = "grid" in modelOrGrid ? modelOrGrid.grid : modelOrGrid;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < grid.z.length; i++) {
    const v = grid.z[i]!;
    if (v === grid.voidValue || !Number.isFinite(v)) continue;
    if (v < minZ) minZ = v;
    if (v > maxZ) maxZ = v;
    sum += v;
    count++;
  }

  if (count === 0) {
    return {
      minElevation: 0,
      maxElevation: 0,
      meanElevation: 0,
      relief: 0,
      hypsometricIntegral: 0,
      validCellCount: 0,
    };
  }

  const meanElevation = sum / count;
  const relief = maxZ - minZ;
  const hypsometricIntegral = relief > 1e-12 ? (meanElevation - minZ) / relief : 0.5;

  return {
    minElevation: minZ,
    maxElevation: maxZ,
    meanElevation,
    relief,
    hypsometricIntegral,
    validCellCount: count,
  };
}

/**
 * Extract an elevation cross-section profile along a line segment from `(x0, y0)` to `(x1, y1)`.
 */
export function extractElevationProfile(
  modelOrGrid: UsgsDemModel | UsgsDemGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  samples = 50,
  local = true,
): ElevationProfilePoint[] {
  const n = Math.max(2, Math.trunc(samples));
  const totalDist = Math.hypot(x1 - x0, y1 - y0);
  const out: ElevationProfilePoint[] = [];

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = x0 + t * (x1 - x0);
    const y = y0 + t * (y1 - y0);
    const elevation = interpolateElevation(modelOrGrid, x, y, local);
    out.push({
      distance: t * totalDist,
      x,
      y,
      elevation,
    });
  }

  return out;
}
