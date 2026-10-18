// SPDX-License-Identifier: AGPL-3.0-or-later

import { type LbmGridConfig, LbmCellType } from "./lbm-types.js";

export interface ObstacleBox {
  min: [number, number, number]; // [x, y, z] in normalized lattice coordinates [0, 1]
  max: [number, number, number];
}

export interface ObstacleCylinder {
  center: [number, number, number]; // [x, y, z] in normalized lattice coords
  radius: number; // radius in normalized units
  axis: "x" | "y" | "z";
  length: number;
}

/**
 * 3D Grid Voxelizer for Lattice Boltzmann Simulation.
 * Synthesizes Cartesian occupancy buffers classifying fluid, solid obstacle,
 * inlet, and outlet cells.
 */
export class LbmVoxelizer {
  public static voxelize(
    config: LbmGridConfig,
    obstacles: {
      boxes?: ObstacleBox[] | undefined;
      cylinders?: ObstacleCylinder[] | undefined;
      solidWalls?:
        | {
            minX?: boolean | undefined;
            maxX?: boolean | undefined;
            minY?: boolean | undefined;
            maxY?: boolean | undefined;
            minZ?: boolean | undefined;
            maxZ?: boolean | undefined;
          }
        | undefined;
    },
  ): Uint8Array {
    const { nx, ny, nz } = config;
    const totalCells = nx * ny * nz;
    const grid = new Uint8Array(totalCells); // defaults to 0 = LbmCellType.Fluid

    const cellIdx = (x: number, y: number, z: number): number => {
      return x + y * nx + z * nx * ny;
    };

    // 1. Boundary channel conditions (e.g. wind tunnel walls, inlet, outlet)
    // By default: minX = VelocityInlet, maxX = PressureOutlet, outer boundaries = SolidBounceBack
    const walls = obstacles.solidWalls ?? {
      minY: true,
      maxY: true,
      minZ: true,
      maxZ: true,
    };

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = cellIdx(x, y, z);

          if (x === 0) {
            grid[idx] = LbmCellType.VelocityInlet;
          } else if (x === nx - 1) {
            grid[idx] = LbmCellType.PressureOutlet;
          } else if (
            (y === 0 && walls.minY) ||
            (y === ny - 1 && walls.maxY) ||
            (z === 0 && walls.minZ) ||
            (z === nz - 1 && walls.maxZ) ||
            (x === 0 && walls.minX) ||
            (x === nx - 1 && walls.maxX)
          ) {
            grid[idx] = LbmCellType.ChannelWall;
          }
        }
      }
    }

    // 2. Voxelize Box obstacles
    if (obstacles.boxes) {
      for (const b of obstacles.boxes) {
        const x0 = Math.max(1, Math.floor(b.min[0] * nx));
        const x1 = Math.min(nx - 2, Math.ceil(b.max[0] * nx));
        const y0 = Math.max(1, Math.floor(b.min[1] * ny));
        const y1 = Math.min(ny - 2, Math.ceil(b.max[1] * ny));
        const z0 = Math.max(1, Math.floor(b.min[2] * nz));
        const z1 = Math.min(nz - 2, Math.ceil(b.max[2] * nz));

        for (let z = z0; z <= z1; z++) {
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              grid[cellIdx(x, y, z)] = LbmCellType.ObstacleSolid;
            }
          }
        }
      }
    }

    // 3. Voxelize Cylinder obstacles (e.g. drone arm, motor pod, spar)
    if (obstacles.cylinders) {
      for (const cyl of obstacles.cylinders) {
        const cx = cyl.center[0] * nx;
        const cy = cyl.center[1] * ny;
        const cz = cyl.center[2] * nz;
        const rCells =
          cyl.radius * (cyl.axis === "x" ? Math.min(ny, nz) : cyl.axis === "y" ? Math.min(nx, nz) : Math.min(nx, ny));
        const rSq = rCells * rCells;

        const axisCells = cyl.axis === "z" ? nz : cyl.axis === "x" ? nx : ny;
        const halfLen = (cyl.length * axisCells) / 2;

        for (let z = 1; z < nz - 1; z++) {
          for (let y = 1; y < ny - 1; y++) {
            for (let x = 1; x < nx - 1; x++) {
              let inCyl = false;
              if (cyl.axis === "z") {
                const distSq = (x - cx) ** 2 + (y - cy) ** 2;
                if (distSq <= rSq && Math.abs(z - cz) <= halfLen) inCyl = true;
              } else if (cyl.axis === "x") {
                const distSq = (y - cy) ** 2 + (z - cz) ** 2;
                if (distSq <= rSq && Math.abs(x - cx) <= halfLen) inCyl = true;
              } else {
                const distSq = (x - cx) ** 2 + (z - cz) ** 2;
                if (distSq <= rSq && Math.abs(y - cy) <= halfLen) inCyl = true;
              }

              if (inCyl) {
                grid[cellIdx(x, y, z)] = LbmCellType.ObstacleSolid;
              }
            }
          }
        }
      }
    }

    return grid;
  }

  /**
   * Computes sub-grid distance fraction delta in (0, 1) along each discrete velocity vector
   * from fluid cell centers to the exact CAD boundary for Bouzidi curved wall boundary conditions.
   */
  public static computeWallDistances(
    config: LbmGridConfig,
    obstacles: {
      boxes?: ObstacleBox[] | undefined;
      cylinders?: ObstacleCylinder[] | undefined;
      solidWalls?:
        | {
            minX?: boolean | undefined;
            maxX?: boolean | undefined;
            minY?: boolean | undefined;
            maxY?: boolean | undefined;
            minZ?: boolean | undefined;
            maxZ?: boolean | undefined;
          }
        | undefined;
    },
    grid: Uint8Array,
  ): Float32Array {
    const { nx, ny, nz } = config;
    const totalCells = nx * ny * nz;
    const deltaWall = new Float32Array(totalCells * 19);
    deltaWall.fill(0.5); // default halfway bounce-back

    const CX = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
    const CY = [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1];
    const CZ = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1];

    const cellIdx = (x: number, y: number, z: number): number => {
      return x + y * nx + z * nx * ny;
    };

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = cellIdx(x, y, z);
          const cType = grid[idx];
          if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) {
            continue;
          }

          for (let i = 1; i < 19; i++) {
            const nxCoord = x + CX[i]!;
            const nyCoord = y + CY[i]!;
            const nzCoord = z + CZ[i]!;

            if (nxCoord < 0 || nxCoord >= nx || nyCoord < 0 || nyCoord >= ny || nzCoord < 0 || nzCoord >= nz) {
              continue;
            }

            const targetIdx = cellIdx(nxCoord, nyCoord, nzCoord);
            if (grid[targetIdx] !== LbmCellType.ObstacleSolid) {
              continue;
            }

            let bestS = Infinity;

            // Neighbor is solid obstacle. Check exact boundary distance along ray
            if (obstacles.cylinders) {
              for (const cyl of obstacles.cylinders) {
                const cx = cyl.center[0] * nx;
                const cy = cyl.center[1] * ny;
                const cz = cyl.center[2] * nz;
                const r =
                  cyl.radius *
                  (cyl.axis === "x" ? Math.min(ny, nz) : cyl.axis === "y" ? Math.min(nx, nz) : Math.min(nx, ny));
                const axisCells = cyl.axis === "z" ? nz : cyl.axis === "x" ? nx : ny;
                const halfLen = (cyl.length * axisCells) / 2;

                let p0x = 0,
                  p0y = 0,
                  p0z = 0,
                  dx = 0,
                  dy = 0,
                  dz = 0;
                if (cyl.axis === "z") {
                  p0x = x - cx;
                  p0y = y - cy;
                  p0z = z - cz;
                  dx = CX[i]!;
                  dy = CY[i]!;
                  dz = CZ[i]!;
                } else if (cyl.axis === "x") {
                  p0x = y - cy;
                  p0y = z - cz;
                  p0z = x - cx;
                  dx = CY[i]!;
                  dy = CZ[i]!;
                  dz = CX[i]!;
                } else {
                  p0x = x - cx;
                  p0y = z - cz;
                  p0z = y - cy;
                  dx = CX[i]!;
                  dy = CZ[i]!;
                  dz = CY[i]!;
                }

                // 1. Curved lateral cylinder surface
                const a = dx * dx + dy * dy;
                if (a > 0) {
                  const b = 2 * (p0x * dx + p0y * dy);
                  const c = p0x * p0x + p0y * p0y - r * r;
                  const disc = b * b - 4 * a * c;
                  if (disc >= 0) {
                    const s = (-b - Math.sqrt(disc)) / (2 * a);
                    if (s > 0 && s <= 1.0 && Math.abs(p0z + s * dz) <= halfLen + 1e-6) {
                      if (s < bestS) bestS = s;
                    }
                  }
                }

                // 2. Flat axial end-caps at p0z + s * dz = +-halfLen
                if (dz !== 0) {
                  for (const capZ of [-halfLen, halfLen]) {
                    const sCap = (capZ - p0z) / dz;
                    if (sCap > 0 && sCap <= 1.0) {
                      const rx = p0x + sCap * dx;
                      const ry = p0y + sCap * dy;
                      if (rx * rx + ry * ry <= r * r + 1e-6 && sCap < bestS) {
                        bestS = sCap;
                      }
                    }
                  }
                }
              }
            }

            if (obstacles.boxes) {
              for (const box of obstacles.boxes) {
                const bMinX = box.min[0] * nx,
                  bMaxX = box.max[0] * nx;
                const bMinY = box.min[1] * ny,
                  bMaxY = box.max[1] * ny;
                const bMinZ = box.min[2] * nz,
                  bMaxZ = box.max[2] * nz;

                let tMin = -Infinity;
                let tMax = Infinity;
                const orig = [x, y, z];
                const dir = [CX[i]!, CY[i]!, CZ[i]!];
                const bMin = [bMinX, bMinY, bMinZ];
                const bMax = [bMaxX, bMaxY, bMaxZ];
                let hit = true;
                for (let axis = 0; axis < 3; axis++) {
                  const d = dir[axis]!;
                  const o = orig[axis]!;
                  if (d === 0) {
                    if (o < bMin[axis]! || o > bMax[axis]!) {
                      hit = false;
                      break;
                    }
                  } else {
                    let t1 = (bMin[axis]! - o) / d;
                    let t2 = (bMax[axis]! - o) / d;
                    if (t1 > t2) {
                      const tmp = t1;
                      t1 = t2;
                      t2 = tmp;
                    }
                    if (t1 > tMin) tMin = t1;
                    if (t2 < tMax) tMax = t2;
                  }
                }
                if (hit && tMin <= tMax && tMin > 0 && tMin <= 1.0 && tMin < bestS) {
                  bestS = tMin;
                }
              }
            }

            if (bestS <= 1.0) {
              deltaWall[i * totalCells + idx] = Math.max(0.05, Math.min(0.95, bestS));
            }
          }
        }
      }
    }

    return deltaWall;
  }
}
