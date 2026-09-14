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
      boxes?: ObstacleBox[];
      cylinders?: ObstacleCylinder[];
      solidWalls?: { minX?: boolean; maxX?: boolean; minY?: boolean; maxY?: boolean; minZ?: boolean; maxZ?: boolean };
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
        const rCells = cyl.radius * Math.min(ny, nz);
        const rSq = rCells * rCells;

        const halfLen = (cyl.length * nx) / 2;

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
}
