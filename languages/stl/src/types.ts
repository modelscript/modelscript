// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for 3D Systems STL (Stereolithography ASCII & Binary Mesh Format, 1987).
 */

export type Vec3 = [number, number, number];

export type Mat3 = [Vec3, Vec3, Vec3];

export type StlFormat = "ascii" | "binary";

export interface StlFacet {
  normal: Vec3;
  vertices: [Vec3, Vec3, Vec3];
  /** Optional 16-bit attribute byte count from binary STL records. */
  attributeByteCount?: number | undefined;
  /** 1-based starting line number (ASCII STL). */
  line?: number | undefined;
  /** Byte/character start offset in source text. */
  startOffset?: number | undefined;
  /** Byte/character end offset in source text. */
  endOffset?: number | undefined;
}

export interface StlSolid {
  name: string;
  /** Name appearing on the closing `endsolid` line, if present. */
  endName?: string | undefined;
  /** Whether a closing `endsolid` statement was encountered. */
  closed: boolean;
  facets: StlFacet[];
  /** 1-based starting line number. */
  line?: number | undefined;
  /** 1-based ending line number. */
  endLine?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface StlParseError {
  message: string;
  line: number;
  column: number;
  code?: string | undefined;
  offset?: number | undefined;
}

export interface StlMeshDocument {
  format: StlFormat;
  /** 80-byte header text for binary STL, or primary solid name for ASCII STL. */
  header?: string | undefined;
  solids: StlSolid[];
  /** Flattened view of all facets across all solids. */
  facets: StlFacet[];
  errors: StlParseError[];
  /** Declared triangle count in binary header (if binary). */
  declaredFacetCount?: number | undefined;
  /** Original byte length (if binary). */
  byteLength?: number | undefined;
}

export type StlDiagnosticSeverity = "error" | "warning" | "info";

export interface StlDiagnostic {
  code: string;
  rule: string;
  severity: StlDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  facetIndex?: number | undefined;
  solidName?: string | undefined;
}

export interface StlBoundingBox {
  min: Vec3;
  max: Vec3;
  extents: Vec3;
}

export interface StlTopologySummary {
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  /** Euler characteristic chi = V - E + F (2 for a closed genus-0 manifold). */
  eulerCharacteristic: number;
  /** Number of undirected edges shared by exactly 1 triangle. */
  openBoundaryEdges: number;
  /** Number of undirected edges shared by > 2 triangles. */
  nonManifoldEdges: number;
  /** True iff every edge has at most 2 incident triangles and faceCount > 0. */
  isManifold: boolean;
  /** True iff every edge has exactly 2 incident triangles and faceCount > 0. */
  isWatertight: boolean;
  /** Connected genus estimate g = (2 - chi) / 2 when watertight & single-shell. */
  estimatedGenus: number | null;
}

export interface StlMassProperties {
  /** Exact signed tetrahedral volume V = (1/6) sum(v0 . (v1 x v2)). */
  signedVolume: number;
  /** Absolute volume |V|. */
  volume: number;
  /** Total triangle surface area. */
  surfaceArea: number;
  /** Material density used for mass and inertia tensor (default 1.0). */
  density: number;
  /** Total mass = density * |V|. */
  mass: number;
  /** Exact volume-weighted centroid (center of mass). */
  centroid: Vec3;
  /** 3x3 inertia tensor about the centroid (kg*m^2 for SI units). */
  inertiaTensor: Mat3;
  /** 3x3 inertia tensor about the coordinate origin. */
  inertiaTensorOrigin: Mat3;
  boundingBox: StlBoundingBox;
  facetCount: number;
}
