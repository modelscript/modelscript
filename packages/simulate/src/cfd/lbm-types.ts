// SPDX-License-Identifier: AGPL-3.0-or-later

export enum LbmCellType {
  Fluid = 0,
  ObstacleSolid = 1,
  ChannelWall = 2,
  VelocityInlet = 3,
  PressureOutlet = 4,
}

export interface LbmGridConfig {
  /** Number of lattice cells in X. */
  nx: number;
  /** Number of lattice cells in Y. */
  ny: number;
  /** Number of lattice cells in Z. */
  nz: number;
  /** Physical lattice spacing in meters (e.g. 0.002 = 2mm). */
  dx: number;
  /** Physical time step in seconds (e.g. 1e-4s). */
  dt: number;
  /** Dimensionless BGK relaxation time tau > 0.5 (typically 0.55 - 0.8). */
  tau: number;
  /** Physical fluid density in kg/m^3 (1.225 for air, 1000 for water). */
  density: number;
  /** Prescribed inlet velocity vector [vx, vy, vz] in m/s. */
  inletVelocity?: [number, number, number];
}

export interface LbmStepResult {
  /** Net aerodynamic drag and lift force vector [Fx, Fy, Fz] in Newtons acting on the solid obstacle. */
  aerodynamicForceN: [number, number, number];
  /** Maximum macroscopic flow velocity in m/s. */
  maxVelocity: number;
  /** Average inlet-to-outlet pressure drop in Pa. */
  pressureDropPa: number;
  /** Velocity magnitude field for 3D slice visualization (nx * ny * nz Float32Array). */
  velocityMagnitude?: Float32Array;
}
