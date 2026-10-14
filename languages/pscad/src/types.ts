// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PSCAD Language Types.
 *
 * Types representing PSCAD v4/v5 projects (.pscx), workspaces (.pswx),
 * component definitions (.psmx), and extracted electrical netlists.
 */

export interface Point2D {
  x: number;
  y: number;
}

export type PortKind = "electrical" | "signal" | "control";

export interface PscxPort {
  id: string;
  name: string;
  kind: PortKind;
  dimension: number; // 1 for single-phase/scalar, 3 for three-phase
  position: Point2D;
  busConnection?: string | undefined;
}

export interface PscxComponent {
  id: string;
  definitionName: string;
  instanceName?: string | undefined;
  position: Point2D;
  rotation?: number | undefined; // 0, 90, 180, 270
  mirror?: boolean | undefined;
  parameters: Record<string, string | number>;
  ports: PscxPort[];
}

export interface PscxWire {
  id: string;
  vertices: Point2D[];
  connectedPortIds: string[];
}

export interface PscxBus {
  id: string;
  name: string;
  voltageBaseKv?: number | undefined;
  position: Point2D;
  length?: number | undefined;
  phaseCount: number; // 1 or 3
}

export interface PscxModule {
  id: string;
  name: string;
  description?: string | undefined;
  components: PscxComponent[];
  buses: PscxBus[];
  wires: PscxWire[];
}

export interface PscxProjectSettings {
  timeStepUs: number; // e.g. 50.0 microseconds
  durationSec: number; // e.g. 1.0 second
  startType: "flat" | "snapshot";
  snapshotFile?: string | undefined;
  frequencyHz: number; // 50 or 60 Hz
}

export interface PscxProject {
  name: string;
  version: string;
  settings: PscxProjectSettings;
  rootModule: PscxModule;
  subModules: Map<string, PscxModule>;
  linkedLibraries: string[];
}

// ==========================================
// Extracted Electrical Netlist Types for EMT
// ==========================================

export interface EmtBus {
  id: string;
  name: string;
  baseKv: number;
  phaseCount: number;
  connectedBranchIds: string[];
}

export type BranchKind = "rlc" | "transmission_line" | "transformer" | "switch" | "source" | "fmu_ibr";

export interface EmtBranch {
  id: string;
  kind: BranchKind;
  fromBus: string;
  toBus: string;
  resistanceOhm: number;
  inductanceH: number;
  capacitanceF: number;
  status?: "open" | "closed" | undefined;
  metadata?: Record<string, any> | undefined;
}

export interface EmtTransformer {
  id: string;
  fromBus: string;
  toBus: string;
  mvaRating: number;
  primaryKv: number;
  secondaryKv: number;
  leakageReactancePu: number;
  noLoadLossesPu?: number | undefined;
  windingConnection: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D";
}

export interface EmtTransmissionLine {
  id: string;
  fromBus: string;
  toBus: string;
  lengthKm: number;
  rPerKm: number;
  lPerKm: number;
  cPerKm: number;
  modelType: "bergeron" | "pi" | "fdpm";
}

export interface EmtFmuInstance {
  id: string;
  name: string;
  busConnection: string;
  fmuPath: string;
  ratedMva: number;
  ratedKv: number;
  controlMode: "grid_following" | "grid_forming";
}

export interface EmtNetlist {
  buses: Map<string, EmtBus>;
  branches: EmtBranch[];
  transformers: EmtTransformer[];
  transmissionLines: EmtTransmissionLine[];
  fmuInstances: EmtFmuInstance[];
  nominalFrequencyHz: number;
}

// ==========================================
// Diagnostics & Linter Types
// ==========================================

export interface PscadDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  componentId?: string | undefined;
  busId?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
}
