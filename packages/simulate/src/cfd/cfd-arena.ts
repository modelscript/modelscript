// SPDX-License-Identifier: AGPL-3.0-or-later

import { type LbmGridConfig, LbmCellType } from "./lbm-types.js";

// D3Q19 Discrete Velocities [cx, cy, cz]
export const D3Q19_CX = new Int32Array([0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]);
export const D3Q19_CY = new Int32Array([0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1]);
export const D3Q19_CZ = new Int32Array([0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1]);

// Opposite velocity direction mapping
export const D3Q19_OPP = new Int32Array([0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17]);

// D3Q19 Lattice Weights
export const D3Q19_WEIGHTS = new Float32Array([
  1.0 / 3.0, // i = 0
  1.0 / 18.0,
  1.0 / 18.0,
  1.0 / 18.0,
  1.0 / 18.0,
  1.0 / 18.0,
  1.0 / 18.0, // 1..6
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0, // 7..12
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0, // 13..18
]);

export interface CfdArenaOptions {
  /** Underlying buffer (ArrayBuffer or SharedArrayBuffer for zero-copy thread sharing). */
  backingBuffer?: ArrayBuffer | SharedArrayBuffer;
  /** Whether to allocate dual buffers for standard pull-streaming or single buffer for AA-pattern in-place streaming. */
  scheme?: "aa-inplace" | "two-buffer";
}

/**
 * High-Performance CFD Field Arena.
 * Organizes lattice Boltzmann distribution functions in a Structure-of-Arrays (SoA) layout:
 * fSoA[q * totalCells + cellIdx].
 *
 * This ensures that threads in a GPU warp or CPU SIMD lanes accessing the same direction q
 * read contiguous 32-bit floats, providing 100% memory coalescing and zero cache bank conflicts.
 */
export class CfdFieldArena {
  public readonly config: LbmGridConfig;
  public readonly totalCells: number;
  public readonly qDirections: number = 19;
  public readonly scheme: "aa-inplace" | "two-buffer";

  // Backing memory buffer
  public readonly buffer: ArrayBuffer | SharedArrayBuffer;

  // SoA Distribution functions:
  // In 'aa-inplace': f0 holds the active distributions.
  // In 'two-buffer': f0 (ping) and f1 (pong) hold alternating states.
  public readonly f0: Float32Array;
  public readonly f1?: Float32Array;

  // Macroscopic flow fields packed as [vx, vy, vz, rho] per cell (vec4<f32> for WebGPU alignment)
  public readonly macroFields: Float32Array;

  // Direct typed views for macroscopic fields
  public readonly rho: Float32Array;
  public readonly vx: Float32Array;
  public readonly vy: Float32Array;
  public readonly vz: Float32Array;

  // Cell classification (Fluid=0, ObstacleSolid=1, ChannelWall=2, VelocityInlet=3, PressureOutlet=4)
  public readonly cellTypes: Uint32Array;

  // Bouzidi curved boundary sub-grid distance fractions delta in (0, 1)
  public readonly deltaWall?: Float32Array;

  constructor(config: LbmGridConfig, cellTypes?: Uint8Array | Uint32Array, options?: CfdArenaOptions) {
    this.config = config;
    this.totalCells = config.nx * config.ny * config.nz;
    this.scheme = options?.scheme ?? "two-buffer";

    const q = this.qDirections;
    const n = this.totalCells;

    const fBytes = n * q * 4;
    const f1Bytes = this.scheme === "two-buffer" ? fBytes : 0;
    const macroBytes = n * 4 * 4;
    const scalarFieldBytes = n * 4;
    const cellTypeBytes = n * 4;
    const deltaWallBytes = config.deltaWall ? n * q * 4 : 0;

    const totalBytes = fBytes + f1Bytes + macroBytes + scalarFieldBytes * 4 + cellTypeBytes + deltaWallBytes;

    this.buffer = options?.backingBuffer ?? new ArrayBuffer(totalBytes);

    let offset = 0;
    this.f0 = new Float32Array(this.buffer, offset, n * q);
    offset += fBytes;

    if (this.scheme === "two-buffer") {
      this.f1 = new Float32Array(this.buffer, offset, n * q);
      offset += fBytes;
    }

    this.macroFields = new Float32Array(this.buffer, offset, n * 4);
    offset += macroBytes;

    this.rho = new Float32Array(this.buffer, offset, n);
    offset += scalarFieldBytes;

    this.vx = new Float32Array(this.buffer, offset, n);
    offset += scalarFieldBytes;

    this.vy = new Float32Array(this.buffer, offset, n);
    offset += scalarFieldBytes;

    this.vz = new Float32Array(this.buffer, offset, n);
    offset += scalarFieldBytes;

    this.cellTypes = new Uint32Array(this.buffer, offset, n);
    offset += cellTypeBytes;

    if (cellTypes) {
      for (let i = 0; i < n; i++) {
        this.cellTypes[i] = cellTypes[i]!;
      }
    }

    if (config.deltaWall) {
      this.deltaWall = new Float32Array(this.buffer, offset, n * q);
      this.deltaWall.set(config.deltaWall);
    }

    this.initializeEquilibrium();
  }

  /**
   * SoA Index calculation: direction * totalCells + cellIdx
   */
  public getSoAIndex(cellIdx: number, direction: number): number {
    return direction * this.totalCells + cellIdx;
  }

  /**
   * Fast accessors
   */
  public getF(fBuffer: Float32Array, cellIdx: number, direction: number): number {
    return fBuffer[direction * this.totalCells + cellIdx]!;
  }

  public setF(fBuffer: Float32Array, cellIdx: number, direction: number, value: number): void {
    fBuffer[direction * this.totalCells + cellIdx] = value;
  }

  /**
   * Initializes equilibrium distributions across the domain.
   */
  public initializeEquilibrium(): void {
    const { nx, ny, nz, dx, dt } = this.config;
    const inletV = this.config.inletVelocity ?? [0, 0, 0];
    const n = this.totalCells;

    const uLatX = inletV[0] * (dt / dx);
    const uLatY = inletV[1] * (dt / dx);
    const uLatZ = inletV[2] * (dt / dx);

    const rho0 = 1.0;

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + y * nx + z * nx * ny;
          const isSolid =
            this.cellTypes[idx] === LbmCellType.ObstacleSolid || this.cellTypes[idx] === LbmCellType.ChannelWall;

          const ux = isSolid ? 0.0 : uLatX;
          const uy = isSolid ? 0.0 : uLatY;
          const uz = isSolid ? 0.0 : uLatZ;

          const physUx = ux * (dx / dt);
          const physUy = uy * (dx / dt);
          const physUz = uz * (dx / dt);

          this.rho[idx] = rho0;
          this.vx[idx] = physUx;
          this.vy[idx] = physUy;
          this.vz[idx] = physUz;

          const macroOffset = idx * 4;
          this.macroFields[macroOffset + 0] = physUx;
          this.macroFields[macroOffset + 1] = physUy;
          this.macroFields[macroOffset + 2] = physUz;
          this.macroFields[macroOffset + 3] = rho0;

          const uSq = ux * ux + uy * uy + uz * uz;

          for (let i = 0; i < 19; i++) {
            const cu = D3Q19_CX[i]! * ux + D3Q19_CY[i]! * uy + D3Q19_CZ[i]! * uz;
            const feq = D3Q19_WEIGHTS[i]! * rho0 * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
            const soaIdx = i * n + idx;
            this.f0[soaIdx] = feq;
            if (this.f1) {
              this.f1[soaIdx] = feq;
            }
          }
        }
      }
    }
  }
}
