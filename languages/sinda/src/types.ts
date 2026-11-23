// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for NASA SINDA / SINDA-FLUINT thermal networks.
 */

export const STEFAN_BOLTZMANN = 5.670374419e-8; // W / (m^2 * K^4)

export type SindaNodeKind = "diffusion" | "arithmetic" | "boundary";

export type SindaConductorKind = "linear" | "radiation";

export interface SindaNode {
  /** Positive canonical node ID (abs(rawId)). */
  id: number;
  /** Original signed node ID from deck (+n diffusion, 0 arithmetic marker, -n boundary). */
  rawId: number;
  /** Thermal submodel name (default: "MAIN"). */
  submodel: string;
  /** Node classification: diffusion (C > 0), arithmetic (C = 0), boundary (fixed T). */
  kind: SindaNodeKind;
  /** Initial or fixed temperature T0 (K by default, or user unit + abszro). */
  initialTemp: number;
  /** Thermal capacitance C = m * cp (J/K). 0 for arithmetic and boundary nodes. */
  capacitance: number;
  /** Optional descriptive label or comment. */
  label?: string | undefined;
  /** 1-indexed source line number. */
  line?: number | undefined;
  /** 1-indexed source column number. */
  column?: number | undefined;
  /** Byte/character start offset in source text. */
  startOffset?: number | undefined;
  /** Byte/character end offset in source text. */
  endOffset?: number | undefined;
}

export interface SindaConductor {
  /** Positive canonical conductor ID (abs(rawId)). */
  id: number;
  /** Original signed conductor ID from deck (+g linear, -g radiation). */
  rawId: number;
  /** Thermal submodel name (default: "MAIN"). */
  submodel: string;
  /** Linear conductance (+g: W/K) or radiation conductance (-g: ε*A*F in m^2, multiplied by σ). */
  kind: SindaConductorKind;
  /** First connected node ID (canonical positive ID). */
  nodeI: number;
  /** Second connected node ID (canonical positive ID). */
  nodeJ: number;
  /** Conductance magnitude G (W/K for linear, m^2 radiative interchange factor G_ij for radiation). */
  conductance: number;
  /** 1-indexed source line number. */
  line?: number | undefined;
  /** 1-indexed source column number. */
  column?: number | undefined;
  /** Character start offset in source text. */
  startOffset?: number | undefined;
  /** Character end offset in source text. */
  endOffset?: number | undefined;
}

export interface SindaSource {
  /** Target node ID receiving heat load Q (W). */
  nodeId: number;
  /** Heat load Q in Watts (positive = heating, negative = cooling). */
  heatLoad: number;
  /** Thermal submodel name. */
  submodel: string;
  /** 1-indexed source line number. */
  line?: number | undefined;
  /** Character start offset. */
  startOffset?: number | undefined;
  /** Character end offset. */
  endOffset?: number | undefined;
}

export interface SindaArray {
  /** Array identifier number. */
  id: number;
  /** Numeric data entries. */
  values: number[];
  /** 1-indexed source line number. */
  line?: number | undefined;
}

export interface SindaOptions {
  /** Model title from HEADER OPTIONS DATA. */
  title?: string | undefined;
  /** Absolute zero offset (0.0 for Kelvin, -273.15 for Celsius, -459.67 for Fahrenheit). */
  abszro: number;
  /** Stefan-Boltzmann constant (default 5.670374419e-8 W/(m^2*K^4)). */
  sigma: number;
  /** Unit system hint. */
  units: "SI" | "ENG";
  /** Additional raw option key/value pairs. */
  raw: Record<string, string | number>;
}

export interface SindaExecutionCall {
  /** Solver or output routine name (e.g., STDSTL, FWDBCK, CRANKN, SNFR, TPRINT). */
  routine: string;
  /** Optional routine arguments. */
  args: string[];
  /** 1-indexed source line number. */
  line?: number | undefined;
}

export interface SindaBlock {
  /** Normalized header type (e.g., "OPTIONS DATA", "NODE DATA", "CONDUCTOR DATA"). */
  header: string;
  /** Optional submodel name from header. */
  submodel: string;
  /** Raw non-comment data lines inside the block. */
  lines: string[];
  /** 1-indexed start line. */
  startLine: number;
  /** 1-indexed end line. */
  endLine: number;
}

export interface SindaParseError {
  message: string;
  line: number;
  column: number;
}

export interface SindaDuplicateRef {
  id: number;
  line: number;
}

export interface SindaModel {
  /** Deck title or inferred model name. */
  title: string;
  /** Parsed HEADER OPTIONS DATA configuration. */
  options: SindaOptions;
  /** Canonical node map keyed by positive node ID. */
  nodes: Map<number, SindaNode>;
  /** Duplicate node IDs encountered during parsing. */
  duplicateNodes: SindaDuplicateRef[];
  /** Canonical conductor map keyed by positive conductor ID. */
  conductors: Map<number, SindaConductor>;
  /** Duplicate conductor IDs encountered during parsing. */
  duplicateConductors: SindaDuplicateRef[];
  /** Heat source records from HEADER SOURCE DATA. */
  sources: SindaSource[];
  /** Control constants from HEADER CONSTANTS DATA (TIMEO, TIMEND, DTIMEI, etc.). */
  constants: Record<string, number>;
  /** Lookup arrays from HEADER ARRAY DATA. */
  arrays: Map<number, SindaArray>;
  /** Execution calls from HEADER EXECUTION. */
  execution: SindaExecutionCall[];
  /** Raw statements from HEADER VARIABLES 1. */
  variables1: string[];
  /** Raw statements from HEADER VARIABLES 2. */
  variables2: string[];
  /** Raw statements from HEADER OUTPUT CALLS. */
  outputCalls: string[];
  /** Whether END OF DATA terminator was present. */
  hasEndOfData: boolean;
  /** Syntax errors detected during parsing. */
  parseErrors: SindaParseError[];
  /** Ordered list of parsed HEADER blocks. */
  rawBlocks: SindaBlock[];
}
