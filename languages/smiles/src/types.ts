// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Cheminformatics Molecular Graph, SMILES/SMARTS, MDL Molfile V2000/SDF & Thermophysical Types.
 *
 * Conforms to OpenSMILES, Daylight SMARTS, and MDL CTfile V2000 / SDfile specifications.
 */

export interface SmilesRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type ChiralTag = "none" | "@" | "@@";

export type BondOrder = 1 | 2 | 3 | 1.5;

export type BondStereo = "none" | "/" | "\\" | "up" | "down" | "either";

export type MolecularFormat = "smiles" | "smarts" | "mol2000" | "sdf";

export interface MoleculeAtom {
  index: number;
  element: string; // IUPAC element symbol, e.g. "C", "N", "O", "Cl"
  rawSymbol?: string | undefined;
  atomicNumber: number; // 1..118, or 0 for unknown/wildcard
  isotope?: number | undefined; // e.g. 13 for [13CH4]
  formalCharge: number; // e.g. +1, -1, 0
  chiralTag: ChiralTag;
  explicitHydrogens?: number | undefined; // specified in brackets e.g. [NH4+] -> 4
  implicitHydrogens: number; // computed from standard organic subset valence rules
  isAromatic: boolean;
  isBracketed: boolean;
  atomMapNumber?: number | undefined; // e.g. [CH3:1] -> 1
  x?: number | undefined; // 3D/2D coordinates from MDL Molfile V2000
  y?: number | undefined;
  z?: number | undefined;
  range?: SmilesRange | undefined;
}

export interface MoleculeBond {
  index: number;
  source: number; // 0-based atom index
  target: number; // 0-based atom index
  order: BondOrder; // 1, 2, 3, or 1.5 (aromatic)
  isAromatic: boolean;
  stereo: BondStereo;
  isRingClosure?: boolean | undefined;
  ringId?: number | undefined;
  range?: SmilesRange | undefined;
}

export interface UnclosedRingRecord {
  ringId: number;
  atomIndex: number;
  range?: SmilesRange | undefined;
}

export interface ConflictingRingBondRecord {
  ringId: number;
  openAtomIndex: number;
  closeAtomIndex: number;
  openOrder: BondOrder;
  closeOrder: BondOrder;
  range?: SmilesRange | undefined;
}

export interface UnbalancedParenRecord {
  kind: "unclosed" | "unexpected_close";
  offset: number;
  range?: SmilesRange | undefined;
}

export interface MolecularGraph {
  id: string;
  name: string;
  smiles: string;
  format: MolecularFormat;
  atoms: MoleculeAtom[];
  bonds: MoleculeBond[];
  properties: Map<string, string>;
  unclosedRings?: UnclosedRingRecord[] | undefined;
  conflictingRingBonds?: ConflictingRingBondRecord[] | undefined;
  unbalancedParentheses?: UnbalancedParenRecord[] | undefined;
  range?: SmilesRange | undefined;
}

export interface AntoineCoefficients {
  A: number;
  B: number;
  C: number;
}

export interface ThermophysicalEstimate {
  moleculeId: string;
  moleculeName: string;
  formula: string; // Hill system molecular formula (e.g. "C9H8O4")
  molecularWeight: number; // g/mol
  exactMass: number; // monoisotopic mass in Da
  heavyAtomCount: number;
  totalAtomCount: number; // heavy atoms + all implicit/explicit hydrogens
  implicitHydrogenCount: number;
  ringCount: number; // Euler characteristic R = E - V + C
  aromaticRingCount: number;
  connectedComponents: number;
  hBondDonors: number;
  hBondAcceptors: number;
  rotatableBonds: number;
  tpsa: number; // Topological Polar Surface Area (Ertl) [A^2]
  logP: number; // Wildman-Crippen octanol-water logP
  Tb: number; // Normal boiling point [K] (Joback & Reid)
  Tc: number; // Critical temperature [K] (Joback & Reid)
  Pc: number; // Critical pressure [bar] (Joback & Reid)
  Vc: number; // Critical molar volume [cm^3/mol] (Joback & Reid)
  acentricFactor: number; // Lee-Kesler acentric factor omega
  enthalpyOfFormation298K: number; // Ideal-gas standard enthalpy of formation [kJ/mol]
  gibbsEnergyOfFormation298K: number; // Ideal-gas standard Gibbs energy of formation [kJ/mol]
  idealGasCpCoeffs: [number, number, number, number]; // [a, b, c, d] for Cp(T) = a + b*T + c*T^2 + d*T^3 [J/(mol*K)]
  idealGasCp298K: number; // Ideal-gas heat capacity at 298.15 K [J/(mol*K)]
  antoineCoeffs: AntoineCoefficients; // log10(Psat[bar]) = A - B / (T[K] + C)
  groupCounts: Record<string, number>; // Joback functional group decomposition counts
}

export interface SmilesDocument {
  format: MolecularFormat;
  molecules: MolecularGraph[];
  sourceFile?: string | undefined;
  range?: SmilesRange | undefined;
}
