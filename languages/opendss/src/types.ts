// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Source line and column range in a .dss file.
 */
export interface DssRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Circuit definition (substation voltage source).
 */
export interface DssCircuit {
  name: string;
  baseKv: number;
  pu: number;
  phases: number;
  bus1: string;
  angle?: number | undefined;
  frequency?: number | undefined;
  range: DssRange;
}

/**
 * Distribution line segment.
 */
export interface DssLine {
  name: string;
  bus1: string;
  bus2: string;
  phases: number;
  phaseNodes1?: number[] | undefined;
  phaseNodes2?: number[] | undefined;
  length: number;
  units?: string | undefined;
  lineCode?: string | undefined;
  r1?: number | undefined;
  x1?: number | undefined;
  c1?: number | undefined;
  r0?: number | undefined;
  x0?: number | undefined;
  c0?: number | undefined;
  rmatrix?: number[][] | undefined;
  xmatrix?: number[][] | undefined;
  geometry?: string | undefined;
  range: DssRange;
}

/**
 * Multi-winding substation or service distribution transformer.
 */
export interface DssTransformer {
  name: string;
  phases: number;
  windings: number;
  buses: string[];
  phaseNodes?: number[][] | undefined; // per winding phase nodes e.g. [[1], [1]] or [[1, 2, 3], [1, 2, 3]]
  kvs: number[];
  kvas: number[];
  pctLoadLoss?: number | undefined;
  xhl?: number | undefined;
  taps?: number[] | undefined;
  minTap?: number | undefined;
  maxTap?: number | undefined;
  numTaps?: number | undefined;
  conn?: string[] | undefined; // e.g. ["delta", "wye"]
  leadLag?: "lead" | "lag" | undefined;
  range: DssRange;
}

/**
 * Power consumption load.
 */
export interface DssLoad {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kv: number;
  kw: number;
  kvar: number;
  pf?: number | undefined;
  model?: number | undefined;
  daily?: string | undefined;
  yearly?: string | undefined;
  duty?: string | undefined;
  range: DssRange;
}

/**
 * Distributed solar photovoltaic (PV) generation system.
 */
export interface DssPVSystem {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kv: number;
  kva: number;
  pmpp: number;
  pctCutIn?: number | undefined;
  pctCutOut?: number | undefined;
  daily?: string | undefined;
  yearly?: string | undefined;
  duty?: string | undefined;
  range: DssRange;
}

/**
 * Battery energy storage system (BESS).
 */
export interface DssStorage {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kv: number;
  kwRated: number;
  kwhRated: number;
  pctStored?: number | undefined;
  range: DssRange;
}

/**
 * Shunt capacitor bank for power factor / voltage support.
 */
export interface DssCapacitor {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kvar: number;
  kv: number;
  range: DssRange;
}

/**
 * Line impedance and geometry line code definition.
 */
export interface DssLineCode {
  name: string;
  nphases: number;
  r1: number;
  x1: number;
  c1?: number | undefined;
  r0?: number | undefined;
  x0?: number | undefined;
  c0?: number | undefined;
  rmatrix?: number[][] | undefined;
  xmatrix?: number[][] | undefined;
  cmatrix?: number[][] | undefined;
  units?: string | undefined;
  baseFreq?: number | undefined;
  range: DssRange;
}

/**
 * Time-series multiplier profile (LoadShape) for QSTS simulation.
 */
export interface DssLoadShape {
  name: string;
  npts: number;
  interval: number;
  mult: number[];
  qmult?: number[] | undefined;
  range: DssRange;
}

/**
 * Synchronous or induction generator.
 */
export interface DssGenerator {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kv: number;
  kw: number;
  kvar?: number | undefined;
  pf?: number | undefined;
  model?: number | undefined; // 1: constant PQ, 2: constant Z, 3: PV bus (voltage regulation)
  vpu?: number | undefined;
  maxKvar?: number | undefined;
  minKvar?: number | undefined;
  daily?: string | undefined;
  yearly?: string | undefined;
  duty?: string | undefined;
  range: DssRange;
}

/**
 * Automatic Step Voltage Regulator control (tap changer on transformer).
 */
export interface DssRegControl {
  name: string;
  transformer: string;
  winding: number;
  vreg: number; // Target regulated voltage on PT secondary (volts, e.g. 120.0)
  band: number; // Voltage deadband (volts, e.g. 2.0)
  ptRatio: number; // Potential transformer ratio (e.g. 60 for 7200V / 120V)
  ctPrim?: number | undefined; // Current transformer primary rating (amps)
  r?: number | undefined; // Line drop compensation R setting (volts)
  x?: number | undefined; // Line drop compensation X setting (volts)
  bus?: string | undefined; // Monitored bus (optional override)
  tapNum?: number | undefined; // Initial tap position (-16 to +16)
  maxTapChange?: number | undefined; // Max tap change per iteration
  range: DssRange;
}

/**
 * Switched capacitor bank controller.
 */
export interface DssCapControl {
  name: string;
  capacitor: string;
  element?: string | undefined;
  terminal?: number | undefined;
  type: "voltage" | "kvar" | "current" | "time";
  onSetting: number;
  offSetting: number;
  delay?: number | undefined;
  ptRatio?: number | undefined;
  ctRatio?: number | undefined;
  range: DssRange;
}

/**
 * Time-Current Characteristic (TCC) curve for protection coordination.
 */
export interface DssTccCurve {
  name: string;
  npts: number;
  c_array: number[]; // Current multipliers (Amps or per-unit of rating)
  t_array: number[]; // Clearing times in seconds
  range: DssRange;
}

/**
 * Protection relay element.
 */
export interface DssRelay {
  name: string;
  monitoredElement: string;
  monitoredTerminal: number;
  type: "current" | "voltage";
  phaseCurve?: string | undefined;
  groundCurve?: string | undefined;
  phaseTrip?: number | undefined; // Pickup current (Amps)
  groundTrip?: number | undefined;
  tdPhase?: number | undefined; // Time dial multiplier
  tdGround?: number | undefined;
  range: DssRange;
}

/**
 * Protection fuse element.
 */
export interface DssFuse {
  name: string;
  monitoredElement: string;
  monitoredTerminal: number;
  fuseCurve: string;
  ratedCurrent: number;
  range: DssRange;
}

/**
 * Conductor physical characteristics for overhead lines.
 */
export interface DssWireData {
  name: string;
  diam: number; // Conductor diameter in inches or mm
  rdac: number; // AC resistance at 60 Hz in Ohms per unit length
  gmrac: number; // Geometric Mean Radius in inches or mm
  normAmps?: number | undefined;
  emergAmps?: number | undefined;
  units?: string | undefined;
  range: DssRange;
}

/**
 * Concentric Neutral (CN) cable data.
 */
export interface DssCNData {
  name: string;
  diam: number;
  rdac: number;
  gmrac: number;
  k: number; // Number of neutral strands
  diaStrand: number;
  gmrStrand: number;
  rStrand: number;
  epsR?: number | undefined;
  insLayer?: number | undefined;
  diaIns?: number | undefined;
  diaCable?: number | undefined;
  range: DssRange;
}

/**
 * Tape-Shielded (TS) cable data.
 */
export interface DssTSData {
  name: string;
  diam: number;
  rdac: number;
  gmrac: number;
  diaShield: number;
  tapeLayer: number;
  tapeLap: number;
  epsR?: number | undefined;
  diaIns?: number | undefined;
  diaCable?: number | undefined;
  range: DssRange;
}

/**
 * Conductor coordinate spacing on cross-arms / poles.
 */
export interface DssLineSpacing {
  name: string;
  nconds: number;
  nphases: number;
  x: number[]; // Horizontal coordinates (m or ft)
  y: number[]; // Vertical coordinates / heights (m or ft)
  units?: string | undefined;
  range: DssRange;
}

/**
 * Physical line geometry definition linking wire data to coordinates.
 */
export interface DssLineGeometry {
  name: string;
  nconds: number;
  nphases: number;
  wires: string[];
  spacing: string;
  cncables?: string[] | undefined;
  tscables?: string[] | undefined;
  reduce: boolean;
  range: DssRange;
}

/**
 * IEEE 1547-2018 Advanced Inverter Controller.
 */
export interface DssInvControl {
  name: string;
  derList: string[];
  mode: "VOLTVAR" | "VOLTWATT" | "DYNAMIC_REACTIVE_CURRENT" | "COMBINED";
  voltageCurveX?: number[] | undefined; // Voltage breakpoints (p.u.)
  reactiveCurveY?: number[] | undefined; // Reactive power breakpoints (% of rated)
  activeCurveY?: number[] | undefined; // Active power curtailment breakpoints (% of rated)
  vvcCurve?: string | undefined;
  vwcCurve?: string | undefined;
  voltageLowPu?: number | undefined;
  voltageHighPu?: number | undefined;
  range: DssRange;
}

/**
 * Automatic circuit recloser with multi-shot trip sequences.
 */
export interface DssRecloser {
  name: string;
  monitoredElement: string;
  monitoredTerminal: number;
  numFastShots: number;
  numSlowShots: number;
  fastCurve?: string | undefined;
  slowCurve?: string | undefined;
  phaseTrip: number;
  groundTrip?: number | undefined;
  tdPhase?: number | undefined;
  tdGround?: number | undefined;
  resetTimeSeconds: number;
  intervalSeconds: number[];
  range: DssRange;
}

/**
 * Distribution automation sectionalizer or tie switch control.
 */
export interface DssSwtControl {
  name: string;
  switchedObj: string;
  switchedTerm: number;
  action: "open" | "close";
  lock: boolean;
  range: DssRange;
}

/**
 * Complete parsed OpenDSS distribution circuit deck.
 */
export interface DssDeck {
  circuit?: DssCircuit | undefined;
  lines: Map<string, DssLine>;
  transformers: Map<string, DssTransformer>;
  loads: Map<string, DssLoad>;
  pvSystems: Map<string, DssPVSystem>;
  storages: Map<string, DssStorage>;
  capacitors: Map<string, DssCapacitor>;
  generators: Map<string, DssGenerator>;
  regControls: Map<string, DssRegControl>;
  capControls: Map<string, DssCapControl>;
  tccCurves: Map<string, DssTccCurve>;
  relays: Map<string, DssRelay>;
  fuses: Map<string, DssFuse>;
  reclosers: Map<string, DssRecloser>;
  invControls: Map<string, DssInvControl>;
  swtControls: Map<string, DssSwtControl>;
  wireData: Map<string, DssWireData>;
  cnData: Map<string, DssCNData>;
  tsData: Map<string, DssTSData>;
  lineSpacings: Map<string, DssLineSpacing>;
  lineGeometries: Map<string, DssLineGeometry>;
  lineCodes: Map<string, DssLineCode>;
  loadShapes?: Map<string, DssLoadShape> | undefined;
  voltageBases: number[];
  comments: string[];
  sourceFile?: string | undefined;
}
