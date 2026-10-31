// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Complex number representation for S/Y/Z parameters.
 */
export interface Complex {
  re: number;
  im: number;
}

/**
 * Frequency unit specified in Touchstone option line.
 */
export type FrequencyUnit = "HZ" | "KHZ" | "MHZ" | "GHZ";

/**
 * Parameter type:
 * S = Scattering, Y = Admittance, Z = Impedance, H = Hybrid-h, G = Hybrid-g.
 */
export type ParameterType = "S" | "Y" | "Z" | "H" | "G";

/**
 * Parameter data format:
 * MA = Magnitude / Angle (degrees)
 * DB = Decibels (20*log10(mag)) / Angle (degrees)
 * RI = Real / Imaginary
 */
export type ParameterFormat = "MA" | "DB" | "RI";

/**
 * Touchstone specification version.
 */
export type TouchstoneVersion = "1.0" | "2.0";

/**
 * Option line configuration.
 */
export interface TouchstoneOptions {
  frequencyUnit: FrequencyUnit;
  parameterType: ParameterType;
  format: ParameterFormat;
  referenceResistance: number;
  portResistances?: number[] | undefined;
  line?: number | undefined;
}

/**
 * A single frequency point and its N-port matrix.
 */
export interface TouchstonePoint {
  frequency: number;
  frequencyHz: number;
  /**
   * matrix[row][col], size N x N.
   */
  matrix: Complex[][];
  line: number;
}

/**
 * Complete parsed Touchstone N-Port network model.
 */
export interface TouchstoneDeck {
  version: TouchstoneVersion;
  numPorts: number;
  options: TouchstoneOptions;
  points: TouchstonePoint[];
  comments: string[];
  sourceFile?: string | undefined;
  hasOptionLine?: boolean | undefined;
  invalidTokens?: { token: string; line: number }[] | undefined;
  incompleteRows?: { expected: number; received: number; line: number }[] | undefined;
}

/**
 * Passivity verification report.
 */
export interface PassivityViolation {
  frequencyHz: number;
  norm: number;
  line: number;
}

export interface PassivityReport {
  isPassive: boolean;
  maxNorm: number;
  worstFrequencyHz: number;
  violations: PassivityViolation[];
}

/**
 * Rational vector-fitting state-space realization:
 * dx/dt = A*x + B*u
 * y     = C*x + D*u
 */
export interface StateSpaceModel {
  order: number;
  numPorts: number;
  A: number[][];
  B: number[][];
  C: number[][];
  D: number[][];
  poles: Complex[];
  residues: Complex[][][];
  relocationIterations?: number | undefined;
  poleHistory?: Complex[][] | undefined;
  isPassive?: boolean | undefined;
  minConductanceEigenvalue?: number | undefined;
  rmsError?: number | undefined;
}
