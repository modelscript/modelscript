// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for NASA Ames PLOT3D structured CFD grids, conservative
 * solutions, function files, and variable metadata.
 */

export type Plot3dDimension = "2d" | "3d";
export type Plot3dEndianness = "little" | "big";
export type Plot3dPrecision = "float32" | "float64";
export type Plot3dFormat = "ascii" | "binary";

export interface Plot3dBlockDims {
  ni: number;
  nj: number;
  nk: number;
}

/**
 * Single structured grid block in Fortran column-major (i-fastest) storage:
 * index(i, j, k) = i + ni * (j + nj * k).
 */
export interface Plot3dGridBlock {
  index: number;
  ni: number;
  nj: number;
  nk: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  iblank?: Int32Array | undefined;
}

export interface Plot3dGrid {
  format: Plot3dFormat;
  dimension: Plot3dDimension;
  multiBlock: boolean;
  hasIblank: boolean;
  endianness?: Plot3dEndianness | undefined;
  precision?: Plot3dPrecision | undefined;
  blocks: Plot3dGridBlock[];
}

export interface Plot3dFlowConditions {
  /** Freestream Mach number (FSMACH). */
  fsmach: number;
  /** Angle of attack in degrees (ALPHA). */
  alpha: number;
  /** Freestream Reynolds number (RE). */
  re: number;
  /** Non-dimensional or physical simulation time (TIME). */
  time: number;
}

/**
 * Conservative solution block (Q-file) in Fortran column-major (i-fastest) storage.
 * Variables: rho, rhou, rhov, rhow (0 for 2D), energy (total energy per unit volume).
 */
export interface Plot3dSolutionBlock {
  index: number;
  ni: number;
  nj: number;
  nk: number;
  conditions: Plot3dFlowConditions;
  rho: Float64Array;
  rhou: Float64Array;
  rhov: Float64Array;
  rhow: Float64Array;
  energy: Float64Array;
}

export interface Plot3dSolution {
  format: Plot3dFormat;
  dimension: Plot3dDimension;
  multiBlock: boolean;
  endianness?: Plot3dEndianness | undefined;
  precision?: Plot3dPrecision | undefined;
  blocks: Plot3dSolutionBlock[];
}

export interface Plot3dFunctionBlock {
  index: number;
  ni: number;
  nj: number;
  nk: number;
  nVars: number;
  fields: Float64Array[];
}

export interface Plot3dFunctionFile {
  format: Plot3dFormat;
  dimension: Plot3dDimension;
  multiBlock: boolean;
  blocks: Plot3dFunctionBlock[];
}

export interface Plot3dNamMetadata {
  variableNames: string[];
  title?: string | undefined;
}

export type Plot3dDatasetKind = "grid" | "solution" | "function" | "nam" | "combined";

export interface Plot3dDataset {
  kind: Plot3dDatasetKind;
  grid?: Plot3dGrid | undefined;
  solution?: Plot3dSolution | undefined;
  func?: Plot3dFunctionFile | undefined;
  nam?: Plot3dNamMetadata | undefined;
}

export interface Plot3dDiagnostic {
  id: string;
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  blockIndex?: number | undefined;
  cellIndex?: [number, number, number] | undefined;
  line?: number | undefined;
  column?: number | undefined;
}

/**
 * Helper to compute Fortran column-major (i-fastest) flat array index.
 */
export function plot3dIndex(i: number, j: number, k: number, ni: number, nj: number): number {
  return i + ni * (j + nj * k);
}
