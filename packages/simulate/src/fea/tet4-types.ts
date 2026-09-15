// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Tet4Mesh {
  /** Node coordinates [x0, y0, z0, x1, y1, z1, ...]. */
  nodeCoords: Float32Array;
  /** Tetrahedral element vertex indices [e0_0, ... e0_3, ...]. */
  elements: Uint32Array;
  /** Total number of nodes. */
  numNodes: number;
  /** Total number of elements. */
  numElements: number;
  /** Element formulation order: 'linear' (Tet4, 4 nodes) or 'quadratic' (Tet10, 10 nodes). Default: 'linear'. */
  elementOrder?: "linear" | "quadratic";
  /** Number of nodes per element (4 for Tet4, 10 for Tet10). Default: 4. */
  nodesPerElement?: number;
  /** Mapping from boundary patch / port name to node indices on that boundary. */
  boundaryNodes: Map<string, number[]>;
  /** Mapping from boundary patch / port name to surface triangular face node triples. */
  boundaryFaces?: Map<string, [number, number, number][]>;
}

export interface MaterialProperties {
  /** Young's modulus in Pa (e.g., 70e9 for Aluminum, 210e9 for Steel). */
  E: number;
  /** Poisson's ratio (e.g., 0.33 for Aluminum, 0.30 for Steel). */
  nu: number;
  /** Material density in kg/m^3 (e.g., 2700 for Aluminum). */
  rho?: number;
  /** Yield strength in Pa (e.g., 270e6 for Aluminum 6061-T6). */
  yieldStrength?: number;
  /** Mass-proportional Rayleigh damping coefficient (alpha_M in C = alpha_M * M + beta_K * K). */
  alphaM?: number;
  /** Stiffness-proportional Rayleigh damping coefficient (beta_K in C = alpha_M * M + beta_K * K). */
  betaK?: number;
}

export interface FeaBoundaryConditions {
  /** Set of fixed node indices (Dirichlet: ux = uy = uz = 0). */
  fixedNodes: Set<number>;
  /** Applied point loads: nodeIndex -> [Fx, Fy, Fz] in Newtons. */
  nodalLoads: Map<number, [number, number, number]>;
  /** Enable geometrically non-linear corotational kinematics to eliminate artificial stress under rigid rotations. */
  corotational?: boolean;
  /** Enable transient dynamic elastodynamics (M*u'' + C*u' + K*u = F) via Newmark-beta integration. */
  transient?: boolean;
  /** Transient time step size in seconds (e.g., 0.005 = 5ms). */
  dt?: number;
  /** Whether to reset velocity and acceleration states to zero. */
  resetDynamics?: boolean;
}

export interface FeaStepResult {
  /** Nodal displacement vectors [ux0, uy0, uz0, ux1, uy1, uz1, ...]. */
  displacements: Float32Array;
  /** Nodal velocity vectors [vx0, vy0, vz0, vx1, vy1, vz1, ...]. Present when transient is true. */
  velocities?: Float32Array;
  /** Nodal acceleration vectors [ax0, ay0, az0, ax1, ay1, az1, ...]. Present when transient is true. */
  accelerations?: Float32Array;
  /** Per-element von Mises stresses in Pa. */
  elementVonMises: Float32Array;
  /** Per-node interpolated von Mises stresses in Pa (for vertex color rendering). */
  nodalVonMises: Float32Array;
  /** Maximum displacement magnitude in meters. */
  maxDisplacement: number;
  /** Maximum von Mises stress in Pa. */
  maxVonMisesStress: number;
  /** Safety factor relative to yield strength (if specified). */
  safetyFactor?: number;
}
