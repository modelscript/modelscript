// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data model types for GPSS (General Purpose Simulation System, 1961).
 */

export type GpssBlockOpcode =
  | "GENERATE"
  | "SEIZE"
  | "RELEASE"
  | "ADVANCE"
  | "QUEUE"
  | "DEPART"
  | "ENTER"
  | "LEAVE"
  | "TRANSFER"
  | "SPLIT"
  | "ASSEMBLE"
  | "ASSIGN"
  | "TEST"
  | "GATE"
  | "TABULATE"
  | "TERMINATE";

export type GpssControlOpcode =
  "STORAGE" | "TABLE" | "FUNCTION" | "EQU" | "START" | "RESET" | "CLEAR" | "END" | "SIMULATE" | "RMULT";

export type GpssOpcode = GpssBlockOpcode | GpssControlOpcode;

export const GPSS_BLOCK_OPCODES: ReadonlySet<string> = new Set<GpssBlockOpcode>([
  "GENERATE",
  "SEIZE",
  "RELEASE",
  "ADVANCE",
  "QUEUE",
  "DEPART",
  "ENTER",
  "LEAVE",
  "TRANSFER",
  "SPLIT",
  "ASSEMBLE",
  "ASSIGN",
  "TEST",
  "GATE",
  "TABULATE",
  "TERMINATE",
]);

export const GPSS_CONTROL_OPCODES: ReadonlySet<string> = new Set<GpssControlOpcode>([
  "STORAGE",
  "TABLE",
  "FUNCTION",
  "EQU",
  "START",
  "RESET",
  "CLEAR",
  "END",
  "SIMULATE",
  "RMULT",
]);

export interface GpssStatement {
  /** Optional symbolic label (e.g., `WAIT`, `NEXT`, `JOE`). */
  label?: string | undefined;
  /** Uppercase GPSS opcode (e.g., `GENERATE`, `SEIZE`, `STORAGE`). */
  opcode: string;
  /** Optional auxiliary operator for `TEST` (`E`, `NE`, `G`, `GE`, `L`, `LE`) or `GATE` (`NU`, `U`, `SNF`, `SF`, `SE`, `SNE`). */
  auxOperator?: string | undefined;
  /** Positional operands A through G (empty string for omitted positional operands). */
  operands: string[];
  /** Raw operand substring before comment stripping. */
  rawOperands: string;
  /** Optional inline comment. */
  comment?: string | undefined;
  /** 1-based line number in source. */
  line: number;
  /** 1-based column number in source. */
  column: number;
  /** 0-based byte/char start offset in source. */
  startOffset: number;
  /** 0-based byte/char end offset in source. */
  endOffset: number;
  /** Index within executable `model.blocks` if this is a transaction block. */
  blockIndex?: number | undefined;
}

export interface GpssStorageDef {
  name: string;
  capacity: number;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GpssFunctionDef {
  name: string;
  argument: string;
  mode: "C" | "D" | "L" | "E";
  expectedPoints: number;
  points: Array<[number, number]>;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GpssTableDef {
  name: string;
  argument: string;
  firstUpperLimit: number;
  width: number;
  classCount: number;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GpssEquDef {
  name: string;
  value: number;
  entityType?: string | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface GpssSyntaxError {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface GpssModel {
  name: string;
  statements: GpssStatement[];
  /** Executable transaction blocks in sequential order. */
  blocks: GpssStatement[];
  /** Map from uppercase label to executable block index. */
  labels: Map<string, number>;
  /** All referenced facility names (from `SEIZE`/`RELEASE`/`GATE`). */
  facilities: Set<string>;
  /** All referenced queue names (from `QUEUE`/`DEPART`). */
  queues: Set<string>;
  /** Defined `STORAGE` capacities keyed by uppercase storage name. */
  storages: Map<string, GpssStorageDef>;
  /** Defined `FUNCTION` tables keyed by uppercase function name. */
  functions: Map<string, GpssFunctionDef>;
  /** Defined `TABLE` histograms keyed by uppercase table name. */
  tables: Map<string, GpssTableDef>;
  /** Defined `EQU` constants keyed by uppercase symbol name. */
  equs: Map<string, GpssEquDef>;
  /** Termination count from `START A`. */
  startCount?: number | undefined;
  /** Optional RNG seed from `RMULT A`. */
  rmultSeed?: number | undefined;
  /** Whether a `START` control statement was encountered. */
  hasStart: boolean;
  /** Whether an `END` control statement was encountered. */
  hasEnd: boolean;
  /** Syntax errors detected during parsing. */
  syntaxErrors: GpssSyntaxError[];
}
