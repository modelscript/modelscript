// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for `@modelscript/gaussian` (.gjf / .com).
 */

export type GaussianPrintLevel = "normal" | "verbose" | "terse";

export interface GaussianLink0Command {
  directive: string;
  value?: string | undefined;
  raw: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GaussianRouteKeyword {
  name: string;
  options: string[];
  raw: string;
}

export interface GaussianRouteSection {
  printLevel: GaussianPrintLevel;
  method?: string | undefined;
  basisSet?: string | undefined;
  keywords: GaussianRouteKeyword[];
  raw: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GaussianValueRef {
  kind: "number" | "variable";
  value?: number | undefined;
  variableName?: string | undefined;
  negated?: boolean | undefined;
  raw: string;
}

export interface GaussianAtomSpec {
  /** 1-based atom index in the molecule specification. */
  index: number;
  kind: "cartesian" | "zmatrix";
  element: string;
  atomicNumber: number;
  isDummy: boolean;
  /** Optional freeze flag (-1 frozen, 0 free). */
  freezeFlag?: number | undefined;
  // Cartesian coordinates (Angstroms)
  x?: GaussianValueRef | undefined;
  y?: GaussianValueRef | undefined;
  z?: GaussianValueRef | undefined;
  // Z-matrix internal coordinates
  bondRef?: number | undefined;
  bondLength?: GaussianValueRef | undefined;
  angleRef?: number | undefined;
  bondAngle?: GaussianValueRef | undefined;
  dihedralRef?: number | undefined;
  dihedralAngle?: GaussianValueRef | undefined;
  /** Optional Gaussian dihedral format code (0 = standard dihedral, 1 = second bond angle). */
  zmatrixFormatCode?: number | undefined;
  raw: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GaussianVariableEntry {
  name: string;
  value: number;
  isConstant: boolean;
  raw: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GaussianComment {
  text: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GaussianParseError {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface GaussianJobStep {
  stepIndex: number;
  link0: GaussianLink0Command[];
  route?: GaussianRouteSection | undefined;
  title?: string | undefined;
  titleLine?: number | undefined;
  charge?: number | undefined;
  multiplicity?: number | undefined;
  chargeMultLine?: number | undefined;
  chargeMultStartOffset?: number | undefined;
  chargeMultEndOffset?: number | undefined;
  atoms: GaussianAtomSpec[];
  variables: Map<string, GaussianVariableEntry>;
  constants: Map<string, GaussianVariableEntry>;
  variableEntries: GaussianVariableEntry[];
  comments: GaussianComment[];
  rawText: string;
  startOffset: number;
  endOffset: number;
}

export interface GaussianInputDocument {
  jobs: GaussianJobStep[];
  parseErrors: GaussianParseError[];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CartesianAtom {
  index: number;
  element: string;
  atomicNumber: number;
  mass: number;
  x: number;
  y: number;
  z: number;
  isDummy: boolean;
}

export interface ZMatrixEntry {
  index: number;
  element: string;
  bondRef?: number | undefined;
  bondLength?: number | undefined;
  angleRef?: number | undefined;
  bondAngle?: number | undefined;
  dihedralRef?: number | undefined;
  dihedralAngle?: number | undefined;
}

export type MolecularRotorType =
  "atom" | "linear" | "spherical_top" | "prolate_symmetric_top" | "oblate_symmetric_top" | "asymmetric_top";

export interface InertiaTensorResult {
  centerOfMass: Vec3;
  totalMass: number;
  /** 3x3 inertia tensor in amu * Angstrom^2. */
  inertiaTensor: [[number, number, number], [number, number, number], [number, number, number]];
  /** Sorted principal moments [I_A, I_B, I_C] in amu * Angstrom^2 (I_A <= I_B <= I_C). */
  principalMoments: [number, number, number];
  /** Principal axes (unit eigenvectors corresponding to I_A, I_B, I_C). */
  principalAxes: [Vec3, Vec3, Vec3];
  /** Rotational constants [A, B, C] in GHz (0 for zero moment along linear axis). */
  rotationalConstantsGHz: [number, number, number];
  /** Rotational constants [A, B, C] in cm^-1. */
  rotationalConstantsCm1: [number, number, number];
  rotorType: MolecularRotorType;
}

export interface NormalModeEntry {
  modeIndex: number;
  frequencyCm1: number;
  angularFrequencyRadS: number;
  reducedMassAmu: number;
  forceConstantMdyneA: number;
  displacementVector: number[];
}

export interface NormalModeResult {
  atomCount: number;
  isLinear: boolean;
  vibrationalModes: NormalModeEntry[];
  frequenciesCm1: number[];
  zeroPointEnergyKcalMol: number;
  zeroPointEnergyHartree: number;
}

export interface MolecularBond {
  atom1: number;
  atom2: number;
  distance: number;
  order: 1 | 2 | 3;
}
