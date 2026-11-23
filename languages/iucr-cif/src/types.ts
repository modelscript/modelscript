// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core STAR / IUCr CIF 1.1 AST and Crystallographic Domain Types.
 */

export type CifValueKind = "string" | "number" | "unknown" | "inapplicable";

export interface CifNumericValue {
  /** Parsed numeric value (e.g. 5.4310). */
  value: number;
  /** Standard uncertainty parsed from parenthetical digits (e.g. 0.0002 for 5.4310(2)). */
  su?: number | undefined;
  /** Original raw token text. */
  raw: string;
}

export interface CifValue {
  raw: string;
  value: string;
  kind: CifValueKind;
  numeric?: CifNumericValue | undefined;
  line: number;
  column: number;
}

export interface CifTagEntry {
  /** Tag name including leading underscore (preserved case). */
  tag: string;
  /** Lowercased canonical tag key. */
  canonicalTag: string;
  value: CifValue;
  line: number;
  column: number;
}

export interface CifLoop {
  /** Column tag names in order of declaration. */
  tags: string[];
  /** Lowercased canonical column tag names. */
  canonicalTags: string[];
  /** Parsed rows (each row has length === tags.length, padded or truncated if malformed). */
  rows: CifValue[][];
  /** Raw count of values encountered in the loop body (for ICIF3001 validation). */
  rawValueCount: number;
  line: number;
  column: number;
}

export interface CifDataBlock {
  /** Block name after `data_` prefix. */
  name: string;
  /** Map of canonical (lowercased) tag name to its first declared scalar entry. */
  tags: Map<string, CifTagEntry>;
  /** All scalar tag entries in declaration order (including duplicates for linting). */
  tagEntries: CifTagEntry[];
  /** All `loop_` tables in declaration order. */
  loops: CifLoop[];
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface CifParseError {
  message: string;
  line: number;
  column: number;
}

export interface CifDocument {
  blocks: CifDataBlock[];
  errors: CifParseError[];
  comments: string[];
}

export interface UnitCellParams {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
  aSu?: number | undefined;
  bSu?: number | undefined;
  cSu?: number | undefined;
  alphaSu?: number | undefined;
  betaSu?: number | undefined;
  gammaSu?: number | undefined;
}

export interface AtomSite {
  label: string;
  symbol: string;
  fractX: number;
  fractY: number;
  fractZ: number;
  occupancy: number;
  bIso?: number | undefined;
  uIso?: number | undefined;
  multiplicity?: number | undefined;
  wyckoff?: string | undefined;
  line?: number | undefined;
}

export interface CrystalStructure {
  name: string;
  cell: UnitCellParams;
  spaceGroupName?: string | undefined;
  spaceGroupNumber?: number | undefined;
  symmetryOps: string[];
  asymmetricAtoms: AtomSite[];
  zFormulaUnits?: number | undefined;
  formula?: string | undefined;
  wavelength?: number | undefined;
}

export type CrystalSystem =
  "cubic" | "tetragonal" | "orthorhombic" | "hexagonal" | "trigonal" | "monoclinic" | "triclinic";

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export interface MetricTensorResult {
  /** Direct metric tensor G (3x3, Å²). */
  G: Mat3;
  /** Determinant det(G) (Å⁶). */
  detG: number;
  /** Unit-cell volume V = sqrt(det(G)) (Å³). */
  volume: number;
  /** Reciprocal metric tensor G* = G^-1 (Å⁻²). */
  GStar: Mat3;
  /** Orthogonalization matrix M mapping fractional -> Cartesian (Å). */
  M: Mat3;
  /** Deorthogonalization matrix M^-1 mapping Cartesian -> fractional. */
  MInv: Mat3;
  /** Reciprocal cell parameters (a*, b*, c* in Å⁻¹, angles in degrees). */
  reciprocalCell: UnitCellParams;
  /** Classified crystal system from lattice metrics. */
  crystalSystem: CrystalSystem;
}

export interface ExpandedAtom {
  index: number;
  label: string;
  symbol: string;
  fract: Vec3;
  cart: Vec3;
  occupancy: number;
  bIso: number;
  symOpIndex: number;
  asymmetricIndex: number;
}

export interface CrystalBond {
  atomA: number;
  atomB: number;
  labelA: string;
  labelB: string;
  symbolA: string;
  symbolB: string;
  distance: number;
  /** Periodic image shift applied to atomB: [dx, dy, dz]. */
  imageShift: Vec3;
}

export interface XrdPeak {
  /** Representative Miller indices [h, k, l]. */
  hkl: [number, number, number];
  /** Reflection multiplicity (number of equivalent reflections merged). */
  multiplicity: number;
  /** Interplanar spacing d_hkl (Å). */
  dSpacing: number;
  /** Bragg angle 2θ (degrees). */
  twoTheta: number;
  /** Squared structure factor magnitude |F_hkl|^2. */
  fSquared: number;
  /** Lorentz-polarization factor. */
  lpFactor: number;
  /** Raw unnormalized intensity (multiplicity * |F|^2 * LP). */
  rawIntensity: number;
  /** Relative intensity normalized to 0..100. */
  relativeIntensity: number;
}

export interface XrdProfilePoint {
  twoTheta: number;
  intensity: number;
}

export interface XrdSimulationResult {
  wavelength: number;
  twoThetaMin: number;
  twoThetaMax: number;
  peaks: XrdPeak[];
  profile: XrdProfilePoint[];
}

export interface CrystalSolution {
  structure: CrystalStructure;
  metric: MetricTensorResult;
  expandedAtoms: ExpandedAtom[];
  bonds: CrystalBond[];
  nearestNeighborDistance: number;
  /** Theoretical crystallographic density in g/cm³. */
  densityGCm3: number;
  /** Total molecular mass in unit cell (g/mol). */
  unitCellMassGPerMol: number;
  xrd: XrdSimulationResult;
}
