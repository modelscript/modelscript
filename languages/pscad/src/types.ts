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
  disabled?: boolean | undefined;
  z?: number | undefined;
  parameters: Record<string, string | number>;
  paramLocations?: Record<string, { line: number; column: number }> | undefined;
  ports: PscxPort[];
  line?: number | undefined;
  column?: number | undefined;
  sourceRange?: { startOffset: number; endOffset: number } | undefined;
}

export interface PscxWire {
  id: string;
  vertices: Point2D[];
  connectedPortIds: string[];
  startPortId?: string | undefined;
  endPortId?: string | undefined;
  line?: number | undefined;
  sourceRange?: { startOffset: number; endOffset: number } | undefined;
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
  sourceRange?: { startOffset: number; endOffset: number } | undefined;
}

export interface PscxSticky {
  id: string;
  position: Point2D;
  width: number;
  height: number;
  text: string;
}

export interface PscxLine {
  id: string;
  classId: string; // e.g. "Divider"
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string | undefined;
  sourceRange?: { startOffset: number; endOffset: number } | undefined;
}

export interface PscadScriptSegment {
  name: string;
  id?: string | undefined;
  classid?: string | undefined;
  content: string;
}

export interface PscadFlyByDoc {
  summary: string;
  ports: Record<string, string>;
}

export interface PscadCheckRule {
  severity: "error" | "warning";
  message: string;
  condition?: string | undefined;
  guard?: string | undefined;
}

export interface PscadBranchDescriptor {
  name?: string | undefined;
  fromNode: string;
  toNode: string;
  kind: "passive" | "breaker" | "ammeter" | "source" | "other";
  r?: number | string | undefined;
  l?: number | string | undefined;
  c?: number | string | undefined;
  extra?: string | undefined;
  raw: string;
}

export interface PscxDefinitionGraphic {
  name: string;
  description?: string | undefined;
  svgXml?: string | undefined;
  graphicsXml?: string | undefined;
  scriptSegments?: Map<string, PscadScriptSegment> | undefined;
  flyBy?: PscadFlyByDoc | undefined;
  checks?: PscadCheckRule[] | undefined;
}

export interface PscxModule {
  id: string;
  name: string;
  description?: string | undefined;
  components: PscxComponent[];
  buses: PscxBus[];
  wires: PscxWire[];
  stickies?: PscxSticky[] | undefined;
  lines?: PscxLine[] | undefined;
  junctions?: Point2D[] | undefined;
  wirelessNets?: Record<string, string[]> | undefined;
  /** Default values of the definition's `<form>` parameters (name → raw expression). */
  parameterDefaults?: Record<string, string> | undefined;
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
  definitions?: Map<string, PscxDefinitionGraphic> | undefined;
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
  /** Closed-contact resistance in ohms (switch branches). */
  rClosedOhm?: number | undefined;
  /** Open-contact resistance in ohms (switch branches). */
  rOpenOhm?: number | undefined;
  /** Naturally commutated diode: conducts N1 (anode) -> N2 (cathode), blocks otherwise. */
  diode?: boolean | undefined;
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
  /** Whether core saturation modeling is enabled for this transformer. */
  saturation?: boolean | undefined;
  /** Core saturation and hysteresis model type (default: `"PIECEWISE_LINEAR"`). */
  coreModel?: "PIECEWISE_LINEAR" | "JILES_ATHERTON" | undefined;
  /** Linear unsaturated magnetizing inductance in Henries. */
  lUnsatH?: number | undefined;
  /** Saturated air-core magnetizing inductance in Henries. */
  lSatH?: number | undefined;
  /** Knee flux linkage in Weber-turns. */
  kneeFluxWb?: number | undefined;
  /** Remanent (residual) core flux linkage in Weber-turns. */
  remanentFluxWb?: number | undefined;
  /** Non-linear Jiles-Atherton dynamic hysteresis parameters. */
  jaParams?:
    | {
        ms?: number | undefined;
        a?: number | undefined;
        alpha?: number | undefined;
        k?: number | undefined;
        c?: number | undefined;
        coreAreaM2?: number | undefined;
        magneticLengthM?: number | undefined;
        primaryTurns?: number | undefined;
      }
    | undefined;
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
  /** True when the source declared an `R`/`r` parameter (so `rSourceOhm` undefined then means an explicit 0). */
  rSourceSpecified?: boolean | undefined;
  /** Constant (DC) source: `AC=0` on a `source_1`. */
  dc?: boolean | undefined;
}

/** Sinusoidal controlled current source (`master:src_ccin_1`); injects `iPeakA * sin(2*pi*f*t + phase)` into `bus`. */
export interface EmtCurrentSource {
  id: string;
  name: string;
  bus: string;
  /** Peak injected current in amperes (positive flows into the bus). */
  iPeakA: number;
  frequencyHz: number;
  phaseRad: number;
  parallelConductance?: number | undefined;
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
  kind:
    | "const"
    | "gain"
    | "sum"
    | "pi"
    | "lag"
    | "leadlag"
    | "limit"
    | "compar"
    | "mult"
    | "div"
    | "square"
    | "inv"
    | "integral"
    | "fp_int"
    | "sensor_v"
    | "sensor_i"
    | "abcdq0_d"
    | "abcdq0_q"
    | "abcdq0_0"
    | "select"
    | "upramp"
    | "tbreakn"
    | "x_power_y"
    | "angle_resolver"
    | "maxmin"
    | "rms3ph"
    | "compare"
    | "range"
    | "ratelimit"
    | "xy_table"
    | "bin_delay"
    | "trans_filt"
    | "trig"
    | "logic"
    | "time_sig"
    | "inv_abcdq0_a"
    | "inv_abcdq0_b"
    | "inv_abcdq0_c";
  inputs: string[];
  params: Record<string, number>;
  /** Bus id (`sensor_v`) or branch id (`sensor_i`) measured by a sensor block. */
  sensorTarget?: string | undefined;
  /** Drives a solver element from this block's output (breaker status: > 0.5 = open, otherwise closed). */
  actuator?: { type: "breaker_status"; targetId: string } | undefined;
}

export interface EmtNetlist {
  buses: Map<string, EmtBus>;
  branches: EmtBranch[];
  transformers: EmtTransformer[];
  saturableTransformers?: EmtTransformer[] | undefined;
  transmissionLines: EmtTransmissionLine[];
  fmuInstances: EmtFmuInstance[];
  sources: EmtSource[];
  currentSources?: EmtCurrentSource[] | undefined;
  faults?: EmtFault[] | undefined;
  surgeArresters?: EmtSurgeArrester[] | undefined;
  synchronousMachines?: EmtSynchronousMachine[] | undefined;
  inductionMachines?: EmtInductionMachine[] | undefined;
  converterBridges?: EmtConverterBridge[] | undefined;
  controlBlocks?: EmtControlBlock[] | undefined;
  customFortranBlocks?: EmtCustomFortranBlock[] | undefined;
  /** Defaults the extractor had to assume because a parameter was missing or unrecognised. */
  assumptions?: string[] | undefined;
  nominalFrequencyHz: number;
}

export interface EmtCustomFortranBlock {
  id: string;
  name: string;
  referencedPorts: string[];
  assignedPorts: string[];
  numRealStates: number;
  numIntStates: number;
  inputs?: { portName: string; sourceId?: string | undefined }[] | undefined;
  outputs?: { portName: string; targetId?: string | undefined }[] | undefined;
  step: (ctx: any) => void;
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
