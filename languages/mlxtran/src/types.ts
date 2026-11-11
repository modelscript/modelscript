// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Monolix MLXTRAN Pharmacometrics AST & Data Types.
 *
 * Covers [LONGITUDINAL], [INDIVIDUAL], [POPULATION], input lists, EQUATION blocks,
 * OUTPUT lists, and PK macros (compartment, depot, absorption, elimination, transfer).
 */

export interface MlxtranRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type MlxtranParamType = "real" | "categorical";

export interface MlxtranParameter {
  name: string;
  type?: MlxtranParamType | undefined;
  init?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  useLog?: boolean | undefined;
  range?: MlxtranRange | undefined;
}

export interface MlxtranEquation {
  lhs: string; // e.g. "ddt_Ad" or "Cc"
  rhs: string; // e.g. "-ka * Ad" or "Ac / V"
  isDerivative: boolean;
  stateName?: string | undefined; // e.g. "Ad" if lhs is "ddt_Ad"
  range?: MlxtranRange | undefined;
}

export type MlxtranMacroKind = "compartment" | "depot" | "absorption" | "elimination" | "transfer" | "iv" | "oral";

export interface MlxtranMacro {
  kind: MlxtranMacroKind;
  params: Record<string, string>; // e.g. { cmt: "1", amount: "Ac", volume: "V" }
  raw: string;
  range?: MlxtranRange | undefined;
}

export interface MlxtranModel {
  name: string;
  description?: string | undefined;
  inputs: MlxtranParameter[];
  equations: MlxtranEquation[];
  macros: MlxtranMacro[];
  outputs: string[];
  rawBlocks: Record<string, string>;
  range?: MlxtranRange | undefined;
}

export interface MlxtranDocument {
  model: MlxtranModel;
  raw: string;
}

export interface MlxtranSimOptions {
  tEnd?: number | undefined;
  dt?: number | undefined;
  dose?: number | undefined;
  doseTime?: number | undefined;
  route?: "iv" | "oral" | undefined;
  params?: Record<string, number> | undefined;
}

export interface MlxtranSimResult {
  time: number[];
  amounts: Record<string, number[]>;
  concentrations: Record<string, number[]>;
  cmax: number;
  tmax: number;
  auc: number;
  halfLife: number;
}
