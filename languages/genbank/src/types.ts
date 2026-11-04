// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/genbank — GenBank & FASTA Genomic Sequence & Plasmid Engineering AST & Data Types.
 *
 * Conforms to the INSDC / NCBI GenBank flat-file specification and FASTA sequence standard
 * for plasmid maps, coding sequences (CDS), restriction enzyme digestion, and ORF analysis.
 */

export interface GenbankRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface GenbankLocationSpan {
  start: number;
  end: number;
  partialStart?: boolean | undefined;
  partialEnd?: boolean | undefined;
}

export interface GenbankLocation {
  start: number;
  end: number;
  strand: 1 | -1;
  isComplement: boolean;
  isJoin: boolean;
  spans: GenbankLocationSpan[];
  raw: string;
}

export interface GenbankQualifier {
  key: string;
  value: string;
  range?: GenbankRange | undefined;
}

export type GenbankFeatureKey =
  | "CDS"
  | "promoter"
  | "RBS"
  | "terminator"
  | "rep_origin"
  | "misc_feature"
  | "gene"
  | "mRNA"
  | "tRNA"
  | "rRNA"
  | "regulatory"
  | "protein_bind"
  | "primer_bind"
  | "source"
  | (string & {});

export interface GenbankFeature {
  key: GenbankFeatureKey;
  location: GenbankLocation;
  qualifiers: Record<string, string>;
  qualifierList: GenbankQualifier[];
  range?: GenbankRange | undefined;
}

export type GenbankTopology = "linear" | "circular";

export type GenbankMoleculeType =
  | "DNA"
  | "RNA"
  | "ds-DNA"
  | "ss-DNA"
  | "mRNA"
  | "tRNA"
  | "rRNA"
  | "PROTEIN"
  | (string & {});

export interface GenbankRecord {
  locus: string;
  declaredLength: number;
  moleculeType: GenbankMoleculeType;
  topology: GenbankTopology;
  division?: string | undefined;
  date?: string | undefined;
  definition?: string | undefined;
  accession?: string | undefined;
  version?: string | undefined;
  keywords?: string | undefined;
  source?: string | undefined;
  organism?: string | undefined;
  features: GenbankFeature[];
  sequence: string;
  hasOriginSection?: boolean | undefined;
  originRange?: GenbankRange | undefined;
  range?: GenbankRange | undefined;
}

export interface GenbankDocument {
  format: "genbank" | "fasta";
  records: GenbankRecord[];
  sourceFile?: string | undefined;
}

export interface RestrictionCutSite {
  enzyme: string;
  recognitionSite: string;
  position: number;
  cutPosition: number;
  strand: 1 | -1;
  overhang: "5'-overhang" | "3'-overhang" | "blunt";
}

export interface OrfPrediction {
  id: string;
  frame: 1 | 2 | 3 | -1 | -2 | -3;
  strand: 1 | -1;
  start: number;
  end: number;
  lengthNt: number;
  lengthAa: number;
  startCodon: string;
  stopCodon: string;
  nucleotideSequence: string;
  proteinSequence: string;
  cai: number;
}

export interface SequenceAnalysisOptions {
  minOrfLengthNt?: number | undefined;
  enzymes?: string[] | undefined;
  recordIndex?: number | undefined;
}

export interface SequenceAnalysisResult {
  locus: string;
  length: number;
  topology: GenbankTopology;
  gcContent: number;
  gcPercent: number;
  atContent: number;
  meltingTemperatureC: number;
  molecularWeightDsDnaDa: number;
  molecularWeightSsDnaDa: number;
  baseCounts: {
    A: number;
    T: number;
    G: number;
    C: number;
    U: number;
    N: number;
    other: number;
  };
  orfs: OrfPrediction[];
  restrictionSites: RestrictionCutSite[];
  digestFragments: Record<string, number[]>;
  combinedDigestFragmentSizes: number[];
  caiByFeature: Record<string, number>;
  meanCai: number;
}
