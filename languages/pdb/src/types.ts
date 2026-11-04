// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Protein Data Bank (.pdb) & Macromolecular CIF (.cif / mmCIF) 3D Structural Biology Types.
 *
 * Conforms to wwPDB Format v3.3 and PDBx/mmCIF (STAR) macromolecular dictionary specifications.
 */

export interface PdbRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type PdbFormat = "pdb" | "mmcif";

export interface PdbAtom {
  recordType: "ATOM" | "HETATM";
  serial: number;
  name: string; // e.g. "N", "CA", "C", "O", "CB", "SG"
  altLoc?: string | undefined;
  resName: string; // 3-letter residue code e.g. "ALA", "GLY", "CYS", "HOH"
  chainId: string; // Chain identifier e.g. "A"
  resSeq: number; // Residue sequence number
  iCode?: string | undefined; // Insertion code
  x: number; // Orthogonal X coordinate in Angstroms [Å]
  y: number; // Orthogonal Y coordinate in Angstroms [Å]
  z: number; // Orthogonal Z coordinate in Angstroms [Å]
  occupancy: number; // Fractional occupancy (nominal [0.0, 1.0])
  tempFactor: number; // Isotropic B-factor [Å^2]
  element: string; // IUPAC element symbol e.g. "C", "N", "O", "S"
  charge?: string | undefined; // Formal charge e.g. "1+", "1-"
  modelNum?: number | undefined;
  range?: PdbRange | undefined;
}

export interface PdbResidue {
  resName: string; // 3-letter code e.g. "ALA"
  oneLetterCode: string; // 1-letter code e.g. "A", or "X" for non-standard
  chainId: string;
  resSeq: number;
  iCode?: string | undefined;
  isStandardAminoAcid: boolean;
  isHetero: boolean;
  atoms: PdbAtom[];
  range?: PdbRange | undefined;
}

export interface PdbChain {
  id: string; // Chain identifier e.g. "A"
  residues: PdbResidue[];
  atoms: PdbAtom[];
  sequence: string; // 1-letter amino acid sequence of standard residues
  range?: PdbRange | undefined;
}

export interface PdbSecondaryStructure {
  kind: "helix" | "sheet";
  id: string; // Helix ID or Sheet ID
  serial: number;
  initResName: string;
  initChainId: string;
  initSeqNum: number;
  endResName: string;
  endChainId: string;
  endSeqNum: number;
  helixClass?: number | undefined;
  sense?: number | undefined;
  length?: number | undefined;
  range?: PdbRange | undefined;
}

export interface PdbDisulfideBond {
  serial: number;
  chainId1: string;
  resName1: string;
  resSeq1: number;
  chainId2: string;
  resName2: string;
  resSeq2: number;
  sym1?: string | undefined;
  sym2?: string | undefined;
  length?: number | undefined; // Annotated or computed SG-SG distance [Å]
  range?: PdbRange | undefined;
}

export interface PdbConect {
  atomSerial: number;
  bondedSerials: number[];
  range?: PdbRange | undefined;
}

export type RamachandranRegion = "favored_alpha" | "favored_beta" | "allowed" | "glycine_proline" | "outlier";

export interface RamachandranAngle {
  chainId: string;
  resName: string;
  resSeq: number;
  phi: number | null; // degrees [-180, 180], null at N-terminus
  psi: number | null; // degrees [-180, 180], null at C-terminus
  omega: number | null; // degrees [-180, 180], peptide bond planarity (~180 trans or ~0 cis)
  region: RamachandranRegion;
  isOutlier: boolean;
  range?: PdbRange | undefined;
}

export interface PdbStructure {
  id: string; // 4-character PDB ID e.g. "1CRN", "1UBQ"
  title: string;
  classification?: string | undefined;
  depositionDate?: string | undefined;
  resolution?: number | undefined;
  format: PdbFormat;
  atoms: PdbAtom[];
  hetAtoms: PdbAtom[];
  residues: PdbResidue[];
  chains: PdbChain[];
  secondaryStructures: PdbSecondaryStructure[];
  disulfideBonds: PdbDisulfideBond[];
  conectRecords: PdbConect[];
  range?: PdbRange | undefined;
}

export interface PdbDocument extends PdbStructure {
  structures: PdbStructure[];
  sourceFile?: string | undefined;
}

export interface ResidueContact {
  indexI: number;
  indexJ: number;
  chainI: string;
  resSeqI: number;
  resNameI: string;
  chainJ: string;
  resSeqJ: number;
  resNameJ: string;
  distance: number; // C_alpha - C_alpha Euclidean distance [Å]
}

export interface ProteinBiophysicsResult {
  structureId: string;
  title: string;
  atomCount: number;
  heavyAtomCount: number;
  residueCount: number;
  chainCount: number;
  molecularWeightDa: number;
  centerOfMass: [number, number, number]; // [x, y, z] in Å
  radiusOfGyration: number; // Rg in Å
  endToEndDistance: number; // N-terminus CA to C-terminus CA distance in Å
  ramachandran: RamachandranAngle[];
  ramachandranFavoredFraction: number;
  ramachandranOutlierCount: number;
  cutoffDistance: number; // GNM cutoff rc in Å (default 7.0 Å)
  springConstant: number; // GNM gamma in kcal/(mol·Å^2)
  caAtoms: PdbAtom[];
  contactMap: number[][]; // N x N binary contact matrix
  contacts: ResidueContact[];
  kirchhoffMatrix: number[][]; // N x N Kirchhoff matrix Gamma
  contactNumbers: number[]; // Diagonal Gamma_ii coordination number for each residue
  predictedFluctuations: number[]; // Mean-square fluctuations <(Delta R_i)^2> [Å^2]
  predictedBFactors: number[]; // Theoretical B-factors B_i = (8*pi^2/3) * <(Delta R_i)^2> [Å^2]
  experimentalBFactors: number[]; // Experimental CA B-factors [Å^2]
  bFactorCorrelation: number; // Pearson correlation r between predicted and experimental B-factors
}
