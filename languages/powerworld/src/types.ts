// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerworld — Core AST & Domain Types for PowerWorld Auxiliary (.aux) Files.
 */

export interface AuxSourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface AuxDataRow {
  values: string[];
  record: Record<string, string>;
  span: AuxSourceSpan;
}

export interface AuxDataSection {
  objectType: string;
  fields: string[];
  rows: AuxDataRow[];
  span: AuxSourceSpan;
}

export interface AuxScriptCommand {
  name: string;
  args: string[];
  raw: string;
  span: AuxSourceSpan;
}

export interface AuxScriptBlock {
  commands: AuxScriptCommand[];
  rawBody: string;
  span: AuxSourceSpan;
}

export interface AuxBus {
  busNum: number;
  busName: string;
  nomVoltKv: number;
  puVolt: number;
  angleDeg: number;
  isSlack: boolean;
  areaName?: string | undefined;
  zoneName?: string | undefined;
  span: AuxSourceSpan;
}

export interface AuxGen {
  busNum: number;
  genId: string;
  status: "Closed" | "Open";
  mw: number;
  mvar: number;
  mwMax?: number | undefined;
  mwMin?: number | undefined;
  voltSetPu?: number | undefined;
  span: AuxSourceSpan;
}

export interface AuxLoad {
  busNum: number;
  loadId: string;
  status: "Closed" | "Open";
  mw: number;
  mvar: number;
  span: AuxSourceSpan;
}

export interface AuxBranch {
  fromBus: number;
  toBus: number;
  circuit: string;
  status: "Closed" | "Open";
  rPu: number;
  xPu: number;
  bPu: number;
  rateAMva: number;
  tapRatio: number;
  phaseShiftDeg: number;
  isTransformer: boolean;
  span: AuxSourceSpan;
}

export interface AuxShunt {
  busNum: number;
  shuntId: string;
  status: "Closed" | "Open";
  mw: number;
  mvar: number;
  span: AuxSourceSpan;
}

export interface AuxContingency {
  name: string;
  skip: boolean;
  span: AuxSourceSpan;
}

export interface PowerWorldAuxModel {
  dataSections: AuxDataSection[];
  scriptBlocks: AuxScriptBlock[];
  buses: AuxBus[];
  busByNum: Map<number, AuxBus>;
  generators: AuxGen[];
  loads: AuxLoad[];
  branches: AuxBranch[];
  shunts: AuxShunt[];
  contingencies: AuxContingency[];
}

export type AuxDiagnosticSeverity = "error" | "warning" | "info";

export interface AuxDiagnostic {
  code: string;
  severity: AuxDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}
