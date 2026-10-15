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
  width?: number | undefined;
  height?: number | undefined;
  rotation?: number | undefined; // 0, 90, 180, 270
  mirror?: boolean | undefined;
  parameters: Record<string, string | number>;
  paramLocations?: Record<string, { line: number; column: number }> | undefined;
  ports: PscxPort[];
  line?: number | undefined;
  column?: number | undefined;
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
  vertices?: Point2D[] | undefined;
  phaseCount: number; // 1 or 3
  line?: number | undefined;
  column?: number | undefined;
}

export interface PscxSticky {
  id: string;
  position: Point2D;
  width: number;
  height: number;
  text: string;
}

export interface PscxModule {
  id: string;
  name: string;
  description?: string | undefined;
  components: PscxComponent[];
  buses: PscxBus[];
  wires: PscxWire[];
  stickies?: PscxSticky[] | undefined;
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
  projectType?: "case" | "library" | undefined;
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
  openTimeSec?: number | undefined;
  closeTimeSec?: number | undefined;
  choppingCurrentAmp?: number | undefined;
  singlePoleTripPhase?: 0 | 1 | 2 | undefined;
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
  isCable?: boolean | undefined;
  coreRadiusM?: number | undefined;
  insulationRadiusM?: number | undefined;
  insulationEpsR?: number | undefined;
  burialDepthM?: number | undefined;
  soilResistivityOhmM?: number | undefined;
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

export interface EmtSource {
  id: string;
  name: string;
  bus: string;
  vPeakKv: number;
  frequencyHz: number;
  phaseRad: number;
  mvaRating: number;
  rSourceOhm?: number | undefined;
  lSourceH?: number | undefined;
}

export interface EmtFault {
  id: string;
  bus: string;
  faultType: "SLG" | "LL" | "DLG" | "3PH";
  startSec: number;
  endSec: number;
  rFaultOhm?: number | undefined;
}

export interface EmtSurgeArrester {
  id: string;
  fromBus: string;
  toBus: string;
  vRefKv: number;
}

export interface EmtSynchronousMachine {
  id: string;
  bus: string;
  ratedMva: number;
  ratedKvLL: number;
  frequencyHz: number;
  xd?: number | undefined;
  xq?: number | undefined;
  xdPrime?: number | undefined;
  xqPrime?: number | undefined;
  xdSub?: number | undefined;
  xqSub?: number | undefined;
  hInertiaSec?: number | undefined;
  dampingPu?: number | undefined;
  mechanicalPowerPu?: number | undefined;
  fieldVoltagePu?: number | undefined;
}

export interface EmtInductionMachine {
  id: string;
  bus: string;
  ratedMva: number;
  ratedKvLL: number;
  frequencyHz: number;
  machineType?: "squirrel_cage" | "dfig" | undefined;
  rsPu?: number | undefined;
  xsPu?: number | undefined;
  xmPu?: number | undefined;
  rrPu?: number | undefined;
  xrPu?: number | undefined;
  hInertiaSec?: number | undefined;
  dampingPu?: number | undefined;
  mechanicalTorquePu?: number | undefined;
  initialSlip?: number | undefined;
  vRotorDPu?: number | undefined;
  vRotorQPu?: number | undefined;
  crowbarResistancePu?: number | undefined;
  crowbarTriggerCurrentPu?: number | undefined;
}

export interface EmtConverterBridge {
  id: string;
  acBus: string;
  kind: "vsc_pwm" | "lcc_6pulse" | "mmc_thevenin";
  ratedKvLL: number;
  ratedMva: number;
  vDcNominalKv?: number | undefined;
  carrierFreqHz?: number | undefined;
  firingAngleDeg?: number | undefined;
  numSubmodulesPerArm?: number | undefined;
  submoduleCapacitanceF?: number | undefined;
  armInductanceH?: number | undefined;
}

export interface EmtControlBlock {
  id: string;
  kind: "const" | "gain" | "sum" | "pi" | "lag" | "leadlag" | "limit" | "compar";
  inputs: string[];
  params: Record<string, number>;
}

export interface EmtNetlist {
  buses: Map<string, EmtBus>;
  branches: EmtBranch[];
  transformers: EmtTransformer[];
  transmissionLines: EmtTransmissionLine[];
  fmuInstances: EmtFmuInstance[];
  sources: EmtSource[];
  faults?: EmtFault[] | undefined;
  surgeArresters?: EmtSurgeArrester[] | undefined;
  synchronousMachines?: EmtSynchronousMachine[] | undefined;
  inductionMachines?: EmtInductionMachine[] | undefined;
  converterBridges?: EmtConverterBridge[] | undefined;
  controlBlocks?: EmtControlBlock[] | undefined;
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
  endLine?: number | undefined;
  endColumn?: number | undefined;
}
