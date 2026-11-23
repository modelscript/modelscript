// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data types for MDL Molfile (V2000 / V3000) and Structure-Data File (SDF) documents.
 */

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type MolfileVersion = "V2000" | "V3000";

export interface MolHeader {
  title: string;
  programLine: string;
  comment: string;
  dimensionCode: "2D" | "3D" | "";
}

export interface MolCountsLine {
  atomCount: number;
  bondCount: number;
  chiralFlag: boolean;
  version: MolfileVersion;
  line: number;
  raw: string;
}

export interface MolAtom {
  /** 1-based atom index in the CTAB. */
  index: number;
  x: number;
  y: number;
  z: number;
  element: string;
  /** V2000 mass difference field (-3..+4). */
  massDiff: number;
  /** Explicit isotope mass number from `M  ISO` or V3000 `MASS=`. */
  isotope?: number | undefined;
  /** Formal charge (e.g. -2, -1, 0, +1, +2). */
  charge: number;
  /** Spin multiplicity from `M  RAD` or V3000 `RAD=` (0=none, 1=singlet, 2=doublet, 3=triplet). */
  radical: number;
  /** Atom stereo parity (0=not stereo, 1=odd, 2=even, 3=either). */
  stereoParity: number;
  /** Explicit valence field (0=default, 1..14=valence, 15=zero valence). */
  valence: number;
  /** Optional atom-atom mapping number. */
  atomMap?: number | undefined;
  /** 1-based source line number. */
  line: number;
}

export interface MolBond {
  /** 1-based bond index in the CTAB. */
  index: number;
  /** 1-based index of first atom. */
  atom1: number;
  /** 1-based index of second atom. */
  atom2: number;
  /** Bond order/type: 1=single, 2=double, 3=triple, 4=aromatic, 5..8=query. */
  order: number;
  /** Stereo flag: 0=not stereo, 1=up, 3=cis/trans either, 4=either, 6=down. */
  stereo: number;
  /** Ring/chain topology flag (0=either, 1=ring, 2=chain). */
  topology?: number | undefined;
  /** 1-based source line number. */
  line: number;
}

export type MolPropertyKind = "CHG" | "ISO" | "RAD" | "RGP" | "END" | "V30" | "OTHER";

export interface MolPropertyLine {
  kind: MolPropertyKind;
  raw: string;
  line: number;
}

export interface SdfDataItem {
  tag: string;
  value: string;
  line: number;
}

export interface MolParseError {
  message: string;
  line: number;
}

export interface MolRecord {
  id: string;
  name: string;
  header: MolHeader;
  counts: MolCountsLine;
  atoms: MolAtom[];
  bonds: MolBond[];
  properties: MolPropertyLine[];
  hasMEnd: boolean;
  dataItems: Record<string, string>;
  sdfDataItems: SdfDataItem[];
  range: SourceRange;
  parseErrors: MolParseError[];
}

export interface MolfileDocument {
  format: "mol" | "sdf";
  sourceFile?: string | undefined;
  records: MolRecord[];
  rawText: string;
}

export interface ElementData {
  symbol: string;
  atomicNumber: number;
  name: string;
  /** IUPAC standard atomic weight (g/mol). */
  atomicWeight: number;
  /** Exact monoisotopic mass of most abundant isotope (Da). */
  monoisotopicMass: number;
  /** Covalent single-bond radius (Angstrom). */
  covalentRadius: number;
  /** Allowed neutral valences in ascending order. */
  valences: readonly number[];
  /** UFF effective nuclear charge Z* for harmonic bond-stretch force constant. */
  uffZStar: number;
}

export interface BondGeometry {
  bondIndex: number;
  atom1: number;
  atom2: number;
  element1: string;
  element2: string;
  order: number;
  /** Actual 3D Euclidean distance (Angstrom). */
  length: number;
  /** Equilibrium bond length r0 (Angstrom). */
  equilibriumLength: number;
  /** Harmonic force constant kb (kcal/(mol*A^2)). */
  forceConstant: number;
  /** Harmonic bond-stretch energy 0.5 * kb * (r - r0)^2 (kcal/mol). */
  stretchEnergy: number;
}

export interface BondAngleGeometry {
  atom1: number;
  vertex: number;
  atom3: number;
  /** Bond angle in degrees [0, 180]. */
  angleDeg: number;
}

export interface DihedralGeometry {
  atom1: number;
  atom2: number;
  atom3: number;
  atom4: number;
  /** Signed dihedral/torsion angle in degrees [-180, 180]. */
  dihedralDeg: number;
}

export interface MolecularAnalysis {
  recordId: string;
  name: string;
  formula: string;
  molecularWeight: number;
  exactMass: number;
  heavyAtomCount: number;
  explicitHydrogenCount: number;
  implicitHydrogenCount: number;
  totalHydrogenCount: number;
  implicitHydrogensByAtom: Record<number, number>;
  bondCount: number;
  ringCount: number;
  /** SSSR rings as arrays of 1-based atom indices. */
  sssrRings: number[][];
  aromaticAtomCount: number;
  formalChargeTotal: number;
  has3DCoordinates: boolean;
  bondGeometries: BondGeometry[];
  bondAngles: BondAngleGeometry[];
  dihedrals: DihedralGeometry[];
  /** Total UFF/harmonic bond-stretch energy (kcal/mol). */
  totalStretchEnergy: number;
}
