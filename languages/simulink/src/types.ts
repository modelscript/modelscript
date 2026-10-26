// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type SimulinkBlockType =
  | "Inport"
  | "Outport"
  | "Constant"
  | "Step"
  | "Sine"
  | "Sin"
  | "Ramp"
  | "Clock"
  | "RandomNumber"
  | "Integrator"
  | "UnitDelay"
  | "Gain"
  | "Sum"
  | "Product"
  | "TransferFcn"
  | "StateSpace"
  | "SubSystem"
  | "BusCreator"
  | "BusSelector"
  | "Mux"
  | "Demux"
  | "Math"
  | "RelationalOperator"
  | "LogicalOperator"
  | "Switch"
  | "Scope"
  | "Lookup_nD"
  | "Ground"
  | "Terminator"
  | "Unknown"
  | (string & {});

export interface SimulinkPort {
  id: string | number;
  portNumber: number;
  type: "in" | "out" | "trigger" | "enable";
  name?: string | undefined;
}

export interface SimulinkBranch {
  dstBlock: string;
  dstPort: number;
  points?: [number, number][] | undefined;
}

export interface SimulinkLine {
  id: string;
  srcBlock: string;
  srcPort: number;
  dstBlock?: string | undefined;
  dstPort?: number | undefined;
  branches: SimulinkBranch[];
  name?: string | undefined;
  range?: SourceRange | undefined;
}

export interface SimulinkBlock {
  name: string;
  type: SimulinkBlockType;
  id: string;
  parameters: Map<string, string | number>;
  ports: SimulinkPort[];
  subsystem?: SimulinkSystem | undefined;
  range?: SourceRange | undefined;
}

export interface SimulinkSystem {
  name: string;
  blocks: Map<string, SimulinkBlock>;
  lines: SimulinkLine[];
}

export interface SimulinkModel {
  name: string;
  rootSystem: SimulinkSystem;
  version?: string | undefined;
  solver?: string | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  fixedStep?: number | undefined;
}

export interface SimulinkQuickFix {
  title: string;
  edit: {
    text: string;
    range: SourceRange;
  };
}

export interface SimulinkDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: SourceRange;
  blockName?: string | undefined;
  quickFix?: SimulinkQuickFix | undefined;
}

export interface SimulinkScheduleResult {
  executionOrder: string[];
  algebraicLoops: string[][];
}
