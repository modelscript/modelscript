// SPDX-License-Identifier: AGPL-3.0-or-later

export const DEFAULT_GAMMA = 1.4;
export const DEFAULT_GAS_CONSTANT_R = 287.05;
export const MIN_DENSITY = 1e-12;
export const MIN_PRESSURE = 1e-12;

export interface CompressibleGridConfig {
  /** Number of cells in X. */
  nx: number;
  /** Number of cells in Y (default 1 for 1D). */
  ny?: number | undefined;
  /** Number of cells in Z (default 1 for 1D/2D). */
  nz?: number | undefined;
  /** Uniform cell spacing in X. */
  dx: number;
  /** Uniform cell spacing in Y (defaults to dx). */
  dy?: number | undefined;
  /** Uniform cell spacing in Z (defaults to dx). */
  dz?: number | undefined;
  /** Ratio of specific heats (default 1.4 for diatomic ideal gas). */
  gamma?: number | undefined;
  /** Specific gas constant R [J/(kg*K)] (default 287.05 for air). */
  gasConstantR?: number | undefined;
  /** Whether to allocate the 6th conserved field rho*nuTilde for Spalart-Allmaras / DDES. */
  includeSpalartAllmaras?: boolean | undefined;
  /** Optional external backing buffer (ArrayBuffer or SharedArrayBuffer). */
  backingBuffer?: ArrayBuffer | SharedArrayBuffer | undefined;
}

export interface PrimitiveState {
  rho: number;
  u: number;
  v: number;
  w: number;
  p: number;
  T: number;
  c: number;
  mach: number;
  nuTilde?: number | undefined;
}

export interface PrimitiveInitSpec {
  rho: number;
  u: number;
  v?: number | undefined;
  w?: number | undefined;
  p: number;
  nuTilde?: number | undefined;
}

export interface ExtractedMacroFields {
  pressure: Float64Array;
  temperature: Float64Array;
  mach: Float64Array;
  u: Float64Array;
  v: Float64Array;
  w: Float64Array;
}

/**
 * Structure-of-Arrays (SoA) linear-memory container for 3D compressible Navier-Stokes
 * conserved variables `[rho, rhoU, rhoV, rhoW, rhoE]` and optional Spalart-Allmaras
 * turbulence transport variable `rhoNuTilde`, stored in IEEE-754 Float64Array views.
 *
 * Memory layout: `stateBuffer[varIdx * totalCells + cellIdx]`, where
 * `cellIdx = (k * ny + j) * nx + i`.
 */
export class CompressibleFieldArena {
  public readonly nx: number;
  public readonly ny: number;
  public readonly nz: number;
  public readonly dx: number;
  public readonly dy: number;
  public readonly dz: number;
  public readonly totalCells: number;
  public readonly nVars: number;
  public readonly gamma: number;
  public readonly gasConstantR: number;
  public readonly includeSpalartAllmaras: boolean;

  public readonly buffer: ArrayBuffer | SharedArrayBuffer;
  public readonly stateBuffer: Float64Array;

  public readonly rho: Float64Array;
  public readonly rhoU: Float64Array;
  public readonly rhoV: Float64Array;
  public readonly rhoW: Float64Array;
  public readonly rhoE: Float64Array;
  public readonly rhoNuTilde: Float64Array | undefined;

  constructor(config: CompressibleGridConfig) {
    this.nx = config.nx;
    this.ny = config.ny ?? 1;
    this.nz = config.nz ?? 1;
    this.dx = config.dx;
    this.dy = config.dy ?? config.dx;
    this.dz = config.dz ?? config.dx;
    this.gamma = config.gamma ?? DEFAULT_GAMMA;
    this.gasConstantR = config.gasConstantR ?? DEFAULT_GAS_CONSTANT_R;
    this.includeSpalartAllmaras = config.includeSpalartAllmaras ?? false;

    if (this.nx <= 0 || this.ny <= 0 || this.nz <= 0) {
      throw new Error(`Invalid grid dimensions: (${this.nx}, ${this.ny}, ${this.nz})`);
    }
    if (this.dx <= 0 || this.dy <= 0 || this.dz <= 0) {
      throw new Error(`Invalid cell spacings: (${this.dx}, ${this.dy}, ${this.dz})`);
    }

    this.totalCells = this.nx * this.ny * this.nz;
    this.nVars = this.includeSpalartAllmaras ? 6 : 5;

    const requiredBytes = this.nVars * this.totalCells * Float64Array.BYTES_PER_ELEMENT;
    if (config.backingBuffer) {
      if (config.backingBuffer.byteLength < requiredBytes) {
        throw new Error(
          `Backing buffer too small: need ${requiredBytes} bytes, got ${config.backingBuffer.byteLength}`,
        );
      }
      this.buffer = config.backingBuffer;
    } else {
      this.buffer = new ArrayBuffer(requiredBytes);
    }

    const strideBytes = this.totalCells * Float64Array.BYTES_PER_ELEMENT;
    this.stateBuffer = new Float64Array(this.buffer, 0, this.nVars * this.totalCells);
    this.rho = new Float64Array(this.buffer, 0 * strideBytes, this.totalCells);
    this.rhoU = new Float64Array(this.buffer, 1 * strideBytes, this.totalCells);
    this.rhoV = new Float64Array(this.buffer, 2 * strideBytes, this.totalCells);
    this.rhoW = new Float64Array(this.buffer, 3 * strideBytes, this.totalCells);
    this.rhoE = new Float64Array(this.buffer, 4 * strideBytes, this.totalCells);
    this.rhoNuTilde = this.includeSpalartAllmaras
      ? new Float64Array(this.buffer, 5 * strideBytes, this.totalCells)
      : undefined;
  }

  /** Linear cell index for Cartesian coordinates (i, j, k). */
  public index(i: number, j: number = 0, k: number = 0): number {
    return (k * this.ny + j) * this.nx + i;
  }

  /** Ideal-gas static pressure at cell `idx`, floored at MIN_PRESSURE. */
  public pressureAt(idx: number): number {
    const rho = Math.max(this.rho[idx] ?? MIN_DENSITY, MIN_DENSITY);
    const ru = this.rhoU[idx] ?? 0;
    const rv = this.rhoV[idx] ?? 0;
    const rw = this.rhoW[idx] ?? 0;
    const rE = this.rhoE[idx] ?? 0;
    const ke = (0.5 * (ru * ru + rv * rv + rw * rw)) / rho;
    return Math.max((this.gamma - 1.0) * (rE - ke), MIN_PRESSURE);
  }

  /** Ideal-gas static temperature T = p / (rho * R) at cell `idx`. */
  public temperatureAt(idx: number): number {
    const rho = Math.max(this.rho[idx] ?? MIN_DENSITY, MIN_DENSITY);
    const p = this.pressureAt(idx);
    return p / (rho * this.gasConstantR);
  }

  /** Local speed of sound c = sqrt(gamma * p / rho) at cell `idx`. */
  public soundSpeedAt(idx: number): number {
    const rho = Math.max(this.rho[idx] ?? MIN_DENSITY, MIN_DENSITY);
    const p = this.pressureAt(idx);
    return Math.sqrt((this.gamma * p) / rho);
  }

  /** Local Mach number |u| / c at cell `idx`. */
  public machAt(idx: number): number {
    const rho = Math.max(this.rho[idx] ?? MIN_DENSITY, MIN_DENSITY);
    const u = (this.rhoU[idx] ?? 0) / rho;
    const v = (this.rhoV[idx] ?? 0) / rho;
    const w = (this.rhoW[idx] ?? 0) / rho;
    const c = this.soundSpeedAt(idx);
    return Math.sqrt(u * u + v * v + w * w) / Math.max(c, 1e-12);
  }

  /** Extract full primitive state at cell `idx`. */
  public getPrimitive(idx: number): PrimitiveState {
    const rho = Math.max(this.rho[idx] ?? MIN_DENSITY, MIN_DENSITY);
    const invRho = 1.0 / rho;
    const u = (this.rhoU[idx] ?? 0) * invRho;
    const v = (this.rhoV[idx] ?? 0) * invRho;
    const w = (this.rhoW[idx] ?? 0) * invRho;
    const rE = this.rhoE[idx] ?? 0;
    const p = Math.max((this.gamma - 1.0) * (rE - 0.5 * rho * (u * u + v * v + w * w)), MIN_PRESSURE);
    const T = p / (rho * this.gasConstantR);
    const c = Math.sqrt(this.gamma * p * invRho);
    const mach = Math.sqrt(u * u + v * v + w * w) / Math.max(c, 1e-12);
    const state: PrimitiveState = { rho, u, v, w, p, T, c, mach };
    if (this.rhoNuTilde) {
      state.nuTilde = Math.max((this.rhoNuTilde[idx] ?? 0) * invRho, 0.0);
    }
    return state;
  }

  /** Set conserved state at cell `idx` from primitive variables. */
  public setPrimitive(
    idx: number,
    rho: number,
    u: number,
    v: number,
    w: number,
    p: number,
    nuTilde: number = 0.0,
  ): void {
    const rhoSafe = Math.max(rho, MIN_DENSITY);
    const pSafe = Math.max(p, MIN_PRESSURE);
    this.rho[idx] = rhoSafe;
    this.rhoU[idx] = rhoSafe * u;
    this.rhoV[idx] = rhoSafe * v;
    this.rhoW[idx] = rhoSafe * w;
    this.rhoE[idx] = pSafe / (this.gamma - 1.0) + 0.5 * rhoSafe * (u * u + v * v + w * w);
    if (this.rhoNuTilde) {
      this.rhoNuTilde[idx] = rhoSafe * Math.max(nuTilde, 0.0);
    }
  }

  /** Initialize entire domain to a uniform primitive state. */
  public fillUniform(rho: number, u: number, v: number, w: number, p: number, nuTilde: number = 0.0): void {
    for (let idx = 0; idx < this.totalCells; idx++) {
      this.setPrimitive(idx, rho, u, v, w, p, nuTilde);
    }
  }

  /**
   * Initialize a 1D Riemann problem along X with diaphragm at `splitX`
   * (cell centers at `(i + 0.5) * dx`).
   */
  public initRiemann1D(splitX: number, left: PrimitiveInitSpec, right: PrimitiveInitSpec): void {
    for (let k = 0; k < this.nz; k++) {
      for (let j = 0; j < this.ny; j++) {
        for (let i = 0; i < this.nx; i++) {
          const x = (i + 0.5) * this.dx;
          const s = x < splitX ? left : right;
          this.setPrimitive(this.index(i, j, k), s.rho, s.u, s.v ?? 0.0, s.w ?? 0.0, s.p, s.nuTilde ?? 0.0);
        }
      }
    }
  }

  /** Initialize domain from a spatial callback evaluated at cell centers. */
  public initCustom(fn: (x: number, y: number, z: number, i: number, j: number, k: number) => PrimitiveInitSpec): void {
    for (let k = 0; k < this.nz; k++) {
      const z = (k + 0.5) * this.dz;
      for (let j = 0; j < this.ny; j++) {
        const y = (j + 0.5) * this.dy;
        for (let i = 0; i < this.nx; i++) {
          const x = (i + 0.5) * this.dx;
          const s = fn(x, y, z, i, j, k);
          this.setPrimitive(this.index(i, j, k), s.rho, s.u, s.v ?? 0.0, s.w ?? 0.0, s.p, s.nuTilde ?? 0.0);
        }
      }
    }
  }

  /** Extract contiguous pressure, temperature, Mach, and velocity arrays across all cells. */
  public extractFields(): ExtractedMacroFields {
    const n = this.totalCells;
    const pressure = new Float64Array(n);
    const temperature = new Float64Array(n);
    const mach = new Float64Array(n);
    const u = new Float64Array(n);
    const v = new Float64Array(n);
    const w = new Float64Array(n);
    const gm1 = this.gamma - 1.0;
    const invR = 1.0 / this.gasConstantR;

    for (let idx = 0; idx < n; idx++) {
      const rho = Math.max(this.rho[idx] ?? MIN_DENSITY, MIN_DENSITY);
      const invRho = 1.0 / rho;
      const ui = (this.rhoU[idx] ?? 0) * invRho;
      const vi = (this.rhoV[idx] ?? 0) * invRho;
      const wi = (this.rhoW[idx] ?? 0) * invRho;
      const rE = this.rhoE[idx] ?? 0;
      const p = Math.max(gm1 * (rE - 0.5 * rho * (ui * ui + vi * vi + wi * wi)), MIN_PRESSURE);
      const T = p * invRho * invR;
      const c = Math.sqrt(this.gamma * p * invRho);
      u[idx] = ui;
      v[idx] = vi;
      w[idx] = wi;
      pressure[idx] = p;
      temperature[idx] = T;
      mach[idx] = Math.sqrt(ui * ui + vi * vi + wi * wi) / Math.max(c, 1e-12);
    }

    return { pressure, temperature, mach, u, v, w };
  }

  /** Copy all conserved fields from another compatible arena. */
  public copyFrom(other: CompressibleFieldArena): void {
    if (other.stateBuffer.length !== this.stateBuffer.length) {
      throw new Error("Incompatible CompressibleFieldArena dimensions for copyFrom");
    }
    this.stateBuffer.set(other.stateBuffer);
  }

  /** Deep-clone this arena and its conserved state. */
  public clone(): CompressibleFieldArena {
    const copy = new CompressibleFieldArena({
      nx: this.nx,
      ny: this.ny,
      nz: this.nz,
      dx: this.dx,
      dy: this.dy,
      dz: this.dz,
      gamma: this.gamma,
      gasConstantR: this.gasConstantR,
      includeSpalartAllmaras: this.includeSpalartAllmaras,
    });
    copy.copyFrom(this);
    return copy;
  }

  /** Check strict density and pressure positivity (and finiteness) across all cells. */
  public checkPositivity(): { valid: boolean; minRho: number; minPressure: number } {
    let minRho = Infinity;
    let minPressure = Infinity;
    let valid = true;
    const gm1 = this.gamma - 1.0;

    for (let idx = 0; idx < this.totalCells; idx++) {
      const rho = this.rho[idx] ?? NaN;
      const ru = this.rhoU[idx] ?? NaN;
      const rv = this.rhoV[idx] ?? NaN;
      const rw = this.rhoW[idx] ?? NaN;
      const rE = this.rhoE[idx] ?? NaN;
      if (!Number.isFinite(rho) || !Number.isFinite(rE) || rho <= 0) {
        valid = false;
        minRho = Math.min(minRho, rho);
        continue;
      }
      const p = gm1 * (rE - (0.5 * (ru * ru + rv * rv + rw * rw)) / rho);
      if (!Number.isFinite(p) || p <= 0) {
        valid = false;
      }
      if (rho < minRho) minRho = rho;
      if (p < minPressure) minPressure = p;
    }

    return { valid, minRho, minPressure };
  }
}
