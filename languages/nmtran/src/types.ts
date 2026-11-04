// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — NONMEM / NMTRAN Pharmacometrics & PK/PD Control Stream AST & Data Types.
 *
 * Covers $PROBLEM, $INPUT, $DATA, $SUBROUTINES (ADVAN1-ADVAN13, TRANS1-TRANS6),
 * $MODEL, $PK, $DES, $ERROR, $THETA, $OMEGA, $SIGMA, $ESTIMATION, $SIMULATION, and dosing records.
 */

export interface NmtranRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface NmtranSubroutine {
  advan: string; // e.g. "ADVAN1".."ADVAN13"
  trans: string; // e.g. "TRANS1".."TRANS6" (defaults to "TRANS1")
  tol?: number | undefined;
  other?: string[] | undefined;
  range?: NmtranRange | undefined;
}

export interface ThetaSpec {
  index: number; // 1-based index: THETA(1), THETA(2), ...
  name?: string | undefined;
  lower?: number | undefined; // -Infinity if unbounded
  init: number;
  upper?: number | undefined; // +Infinity if unbounded
  fixed: boolean;
  units?: string | undefined;
  range?: NmtranRange | undefined;
}

export type ThetaBound = ThetaSpec;

export interface OmegaSpec {
  index: number; // 1-based index: ETA(1), ETA(2), ...
  name?: string | undefined;
  variance: number; // diagonal variance estimate
  fixed: boolean;
  blockSize?: number | undefined;
  covariances?: number[] | undefined;
  same?: boolean | undefined;
  range?: NmtranRange | undefined;
}

export type OmegaBlock = OmegaSpec;

export interface SigmaSpec {
  index: number; // 1-based index: EPS(1), EPS(2), ...
  name?: string | undefined;
  variance: number;
  fixed: boolean;
  range?: NmtranRange | undefined;
}

export interface CompartmentDef {
  index: number; // 1-based compartment number
  name: string;
  defDose: boolean;
  defObs: boolean;
  initialOff?: boolean | undefined;
  noOff?: boolean | undefined;
  range?: NmtranRange | undefined;
}

export interface PkStatement {
  lhs: string; // e.g. "CL", "V", "KA", "K", "S1", "F1", "ALAG1"
  rhs: string; // e.g. "THETA(1) * EXP(ETA(1))"
  thetaRefs: number[];
  etaRefs: number[];
  range?: NmtranRange | undefined;
}

export type PkAssignment = PkStatement;

export interface DesEquation {
  compartmentIndex: number; // i in DADT(i) (or 0 for auxiliary assignments in $DES)
  lhs: string; // e.g. "DADT(1)" or intermediate variable name
  rhs: string; // e.g. "-KA * A(1)"
  isDerivative: boolean;
  thetaRefs: number[];
  etaRefs: number[];
  compartmentRefs: number[]; // indices referenced via A(k) or DADT(k)
  range?: NmtranRange | undefined;
}

export interface ErrorStatement {
  lhs: string; // e.g. "IPRED", "W", "Y"
  rhs: string; // e.g. "F + F * EPS(1)"
  thetaRefs: number[];
  etaRefs: number[];
  epsRefs: number[];
  compartmentRefs: number[];
  range?: NmtranRange | undefined;
}

export interface DosingRecord {
  id?: string | number | undefined;
  time: number;
  amt: number;
  rate: number; // 0 for bolus, > 0 for zero-order infusion
  cmt: number; // 1-based compartment index
  evid: number; // 1 = dose event, 0 = observation, 4 = reset+dose
  ii: number; // inter-dose interval
  addl: number; // additional doses
  dv?: number | undefined;
  mdv?: number | undefined;
  range?: NmtranRange | undefined;
}

export type DosingEvent = DosingRecord;

export interface NmtranEstimationSpec {
  method: string;
  interaction: boolean;
  maxEval?: number | undefined;
  sigDigits?: number | undefined;
  print?: number | undefined;
  noAbort?: boolean | undefined;
  posthoc?: boolean | undefined;
  range?: NmtranRange | undefined;
}

export interface NmtranSimulationSpec {
  seed: number;
  subProblems: number;
  onlySimulation: boolean;
  range?: NmtranRange | undefined;
}

export interface NmtranControlStream {
  problem: string;
  hasProblemRecord: boolean;
  problemRange?: NmtranRange | undefined;
  inputs: string[];
  dataFile?: string | undefined;
  ignoreChars?: string[] | undefined;
  subroutines: NmtranSubroutine;
  nCompartments?: number | undefined;
  compartments: CompartmentDef[];
  pkStatements: PkStatement[];
  desEquations: DesEquation[];
  hasDesBlock: boolean;
  errorStatements: ErrorStatement[];
  hasErrorBlock: boolean;
  thetas: ThetaSpec[];
  omegas: OmegaSpec[];
  sigmas: SigmaSpec[];
  estimations: NmtranEstimationSpec[];
  simulation?: NmtranSimulationSpec | undefined;
  dosingRecords: DosingRecord[];
  range?: NmtranRange | undefined;
}

export interface NmtranDocument {
  controlStream: NmtranControlStream;
  sourceFile?: string | undefined;
}
