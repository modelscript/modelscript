// SPDX-License-Identifier: AGPL-3.0-or-later

export enum LbmCellType {
  Fluid = 0,
  ObstacleSolid = 1,
  ChannelWall = 2,
  VelocityInlet = 3,
  PressureOutlet = 4,
}

export interface LbmThermalConfig {
  /** Enable double-distribution D3Q7 thermal energy transport. */
  enabled: boolean;
  /** Prandtl number Pr = nu / alpha (default: 0.71 for air). */
  prandtl?: number | undefined;
  /** Freestream / ambient inlet temperature in Kelvin (default: 288.15 K). */
  ambientTempK?: number | undefined;
  /** Prescribed solid obstacle wall temperature in Kelvin (isothermal BC). */
  wallTempK?: number | undefined;
  /** Prescribed wall heat flux in W/m^2 (Neumann BC, used when wallTempK is omitted). */
  heatFluxW?: number | undefined;
  /** Thermal expansion coefficient beta in 1/K for Boussinesq buoyancy (default: 0 = passive scalar). */
  thermalExpansionBeta?: number | undefined;
  /** Gravitational acceleration vector [gx, gy, gz] in m/s^2 for buoyancy (default: [0, -9.81, 0]). */
  gravity?: [number, number, number] | undefined;
}

export interface LbmWallModelConfig {
  /** Von Karman constant kappa (default: 0.41). */
  kappa?: number | undefined;
  /** Law-of-the-wall intercept constant B (default: 5.2). */
  lawOfWallB?: number | undefined;
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
  inletVelocity?: [number, number, number] | undefined;
  /**
   * Turbulence modeling option:
   * - 'laminar' (default)
   * - 'smagorinsky_les': standard Smagorinsky subgrid eddy viscosity
   * - 'dynamic_smagorinsky': local wall-damped dynamic Smagorinsky
   * - 'wmles': Wall-Modeled LES with algebraic Spalding law-of-the-wall shear model
   */
  turbulenceModel?: "laminar" | "smagorinsky_les" | "dynamic_smagorinsky" | "wmles" | undefined;
  /** Collision operator: 'bgk' (default) or 'regularized' (Hermite 2nd-order regularized for high-Re stability). */
  collisionOperator?: "bgk" | "regularized" | undefined;
  /** Smagorinsky constant Cs (default: 0.14). */
  smagorinskyConstant?: number | undefined;
  /** Wall-model parameters when turbulenceModel === 'wmles'. */
  wallModel?: LbmWallModelConfig | undefined;
  /** Optional double-distribution D3Q7 thermal energy equation configuration. */
  thermal?: LbmThermalConfig | undefined;
  /** Whether to use Bouzidi curved wall boundary interpolation (default: true if deltaWall is present). */
  curvedBoundary?: boolean | undefined;
  /** Sub-grid distance fractions delta in (0, 1) to obstacle boundary along each discrete velocity direction (nx * ny * nz * 19). */
  deltaWall?: Float32Array | undefined;
}

export interface LbmStepResult {
  /** Net aerodynamic drag and lift force vector [Fx, Fy, Fz] in Newtons acting on the solid obstacle. */
  aerodynamicForceN: [number, number, number];
  /** Maximum macroscopic flow velocity in m/s. */
  maxVelocity: number;
  /** Average inlet-to-outlet pressure drop in Pa. */
  pressureDropPa: number;
  /** Velocity magnitude field for 3D slice visualization (nx * ny * nz Float32Array). */
  velocityMagnitude?: Float32Array | undefined;
  /** Mean fluid temperature adjacent to obstacle walls in Kelvin (when thermal.enabled). */
  meanWallTemperatureK?: number | undefined;
  /** Mean wall shear stress magnitude in Pascals across wall-adjacent cells (when turbulenceModel === 'wmles'). */
  meanWallShearPa?: number | undefined;
}
