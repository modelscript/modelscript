// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Core ENDF-6 Data Model Types.
 *
 * Represents 80-column Evaluated Nuclear Data File Format (ENDF-6) tapes,
 * materials (MAT), files (MF), sections (MT), and standard ENDF record structures
 * (`HEAD`, `CONT`, `TAB1`, `LIST`, `TEXT`, `SEND`, `FEND`, `MEND`, `TEND`).
 */

export type Endf6TerminatorKind = "SEND" | "FEND" | "MEND" | "TEND";

/** Standard ENDF-6 interpolation scheme codes (`INT`). */
export type Endf6InterpScheme = 1 | 2 | 3 | 4 | 5;

/** A single parsed 80-column ENDF-6 card. */
export interface Endf6Card {
  /** 1-based line number in the tape. */
  line: number;
  /** 0-based character start offset in the source string. */
  startOffset: number;
  /** 0-based character end offset in the source string. */
  endOffset: number;
  /** Raw card text (without trailing newline). */
  raw: string;
  /** Six 11-character fields (columns 1–66). */
  fields: [string, string, string, string, string, string];
  /** Material number MAT (columns 67–70). */
  mat: number;
  /** File number MF (columns 71–72). */
  mf: number;
  /** Section / reaction number MT (columns 73–75). */
  mt: number;
  /** Sequence number NS (columns 76–80), optional. */
  ns: number;
  /** Whether this card is a SEND/FEND/MEND/TEND terminator. */
  terminator: Endf6TerminatorKind | null;
}

/** Standard ENDF-6 CONT control record: (C1, C2, L1, L2, N1, N2). */
export interface Endf6ContRecord {
  c1: number;
  c2: number;
  l1: number;
  l2: number;
  n1: number;
  n2: number;
  mat: number;
  mf: number;
  mt: number;
  line: number;
}

/** Standard ENDF-6 HEAD section header record: (ZA, AWR, L1, L2, N1, N2). */
export interface Endf6HeadRecord {
  /** Nuclide identifier ZA = 1000*Z + A. */
  za: number;
  /** Atomic weight ratio (mass / neutron mass). */
  awr: number;
  l1: number;
  l2: number;
  n1: number;
  n2: number;
  mat: number;
  mf: number;
  mt: number;
  line: number;
}

/** Interpolation region descriptor `(NBT, INT)` in a `TAB1` record. */
export interface Endf6InterpolationRegion {
  /** 1-based upper point index boundary for this interpolation region. */
  nbt: number;
  /** ENDF interpolation law: 1=hist, 2=lin-lin, 3=lin-log, 4=log-lin, 5=log-log. */
  interp: number;
}

/** A single `(x, y)` tabulated point (e.g. energy in eV, cross-section in barns). */
export interface Endf6Point {
  x: number;
  y: number;
}

/** Standard ENDF-6 TAB1 tabulated function record. */
export interface Endf6Tab1Record {
  c1: number;
  c2: number;
  l1: number;
  l2: number;
  /** Number of interpolation regions NR. */
  nr: number;
  /** Number of (x, y) data points NP. */
  np: number;
  regions: Endf6InterpolationRegion[];
  points: Endf6Point[];
  mat: number;
  mf: number;
  mt: number;
  line: number;
}

/** Standard ENDF-6 LIST record. */
export interface Endf6ListRecord {
  c1: number;
  c2: number;
  l1: number;
  l2: number;
  /** Number of items NPL in the list. */
  npl: number;
  n2: number;
  values: number[];
  mat: number;
  mf: number;
  mt: number;
  line: number;
}

/** Directory entry inside MF=1, MT=451. */
export interface Endf6DirectoryEntry {
  mf: number;
  mt: number;
  nc: number;
  mod: number;
}

/** Decoded MF=1, MT=451 descriptive data and section directory. */
export interface Endf6Description {
  za: number;
  awr: number;
  lrp: number;
  lfi: number;
  nlib: number;
  nmod: number;
  elis: number;
  sta: number;
  lis: number;
  liso: number;
  nfor: number;
  awi: number;
  emax: number;
  lrel: number;
  nsub: number;
  nver: number;
  temp: number;
  ldrv: number;
  nwd: number;
  nxc: number;
  textLines: string[];
  directory: Endf6DirectoryEntry[];
  line: number;
}

/** Single-Level Breit-Wigner (SLBW) resonance parameter entry in MF=2, MT=151. */
export interface Endf6Resonance {
  /** Resonance energy Er (eV). */
  er: number;
  /** Total angular momentum J (AJ). */
  aj: number;
  /** Total width Gamma (eV) (GT). */
  gt: number;
  /** Neutron width Gamma_n (eV) (GN). */
  gn: number;
  /** Radiative capture width Gamma_gamma (eV) (GG). */
  gg: number;
  /** Fission width Gamma_f (eV) (GF). */
  gf: number;
  line: number;
}

/** Resolved resonance energy range in MF=2, MT=151. */
export interface Endf6ResonanceRange {
  za: number;
  awr: number;
  /** Lower energy limit EL (eV). */
  el: number;
  /** Upper energy limit EH (eV). */
  eh: number;
  /** 1=resolved, 2=unresolved. */
  lru: number;
  /** Formalism: 1=SLBW, 2=MLBW, 3=Reich-Moore, 7=R-Matrix Limited. */
  lrf: number;
  /** Target nucleus spin I (SPI). */
  spi: number;
  /** Scattering radius AP (10^-12 cm = 10 fm). */
  ap: number;
  /** Orbital angular momentum l (0=s-wave, 1=p-wave, ...). */
  l: number;
  resonances: Endf6Resonance[];
  line: number;
}

/** Decoded MF=3 pointwise neutron cross-section section. */
export interface Endf6CrossSectionSection {
  mat: number;
  mt: number;
  za: number;
  awr: number;
  /** Mass-difference Q-value QM (eV). */
  qm: number;
  /** Reaction Q-value QI (eV). */
  qi: number;
  /** Complex breakup flag LR. */
  lr: number;
  tab1: Endf6Tab1Record;
  line: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

/** Decay mode branch in MF=8, MT=457. */
export interface Endf6DecayMode {
  /** Decay mode type RTYP (1=beta-, 2=EC/beta+, 3=IT, 4=alpha, 5=n, 6=SF). */
  rtyp: number;
  /** Isomeric state flag RFS. */
  rfs: number;
  /** Decay Q-value (eV). */
  q: number;
  /** Uncertainty in Q (eV). */
  dq: number;
  /** Branching ratio BR (0..1). */
  br: number;
  /** Uncertainty in BR. */
  dbr: number;
}

/** Decoded MF=8, MT=457 radioactive decay data. */
export interface Endf6DecayData {
  za: number;
  awr: number;
  lis: number;
  liso: number;
  /** Stability flag: 0=radioactive, 1=stable. */
  nst: number;
  /** Half-life T_1/2 (seconds). */
  halfLife: number;
  /** Uncertainty in half-life (seconds). */
  halfLifeUnc: number;
  /** Average decay energies (eV): light-particle (beta), electromagnetic (gamma), heavy-particle (alpha). */
  averageEnergies: number[];
  /** Spin of the nuclide. */
  spin: number;
  /** Parity (+1 or -1). */
  parity: number;
  decayModes: Endf6DecayMode[];
  line: number;
}

/** Raw section wrapper for any (MAT, MF, MT) block. */
export interface Endf6Section {
  mat: number;
  mf: number;
  mt: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  cards: Endf6Card[];
  head?: Endf6HeadRecord | undefined;
  hasSend: boolean;
}

/** A parsed ENDF-6 material (unique MAT number). */
export interface Endf6Material {
  mat: number;
  za: number;
  awr: number;
  /** Human-readable nuclide label (e.g. "U-235" or "MAT 9228"). */
  name: string;
  description?: Endf6Description | undefined;
  resonances: Endf6ResonanceRange[];
  /** Pointwise cross-sections indexed by MT number (MF=3). */
  crossSections: Map<number, Endf6CrossSectionSection>;
  decay?: Endf6DecayData | undefined;
  sections: Endf6Section[];
  /** Files (MF numbers) that had an explicit FEND terminator. */
  terminatedFiles: Set<number>;
  /** Files (MF numbers) present in this material. */
  presentFiles: Set<number>;
  hasMend: boolean;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

/** Parse issue recorded while reading cards. */
export interface Endf6ParseError {
  line: number;
  message: string;
}

/** Top-level parsed ENDF-6 tape. */
export interface Endf6Tape {
  /** Tape identification header (TPID, first 66 chars of line 1 if MF=0, MT=0). */
  tpid: string;
  materials: Map<number, Endf6Material>;
  cards: Endf6Card[];
  hasTend: boolean;
  parseErrors: Endf6ParseError[];
}

/** Diagnostic emitted by `lintEndf6Tape` / `lintEndf6Source`. */
export interface Endf6Diagnostic {
  id: string;
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  mat?: number | undefined;
  mf?: number | undefined;
  mt?: number | undefined;
}
