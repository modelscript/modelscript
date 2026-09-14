// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Tet4Mesh {
  /** Node coordinates [x0, y0, z0, x1, y1, z1, ...]. */
  nodeCoords: Float32Array;
  /** Tetrahedral element vertex indices [e0_0, e0_1, e0_2, e0_3, ...]. */
  elements: Uint32Array;
  /** Total number of nodes. */
  numNodes: number;
  /** Total number of elements. */
  numElements: number;
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
}

export interface FeaBoundaryConditions {
  /** Set of fixed node indices (Dirichlet: ux = uy = uz = 0). */
  fixedNodes: Set<number>;
  /** Applied point loads: nodeIndex -> [Fx, Fy, Fz] in Newtons. */
  nodalLoads: Map<number, [number, number, number]>;
}

export interface FeaStepResult {
  /** Nodal displacement vectors [ux0, uy0, uz0, ux1, uy1, uz1, ...]. */
  displacements: Float32Array;
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
