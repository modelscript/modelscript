// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Core Abstract Syntax Tree (AST) & Analysis Types.
 *
 * Models standard SPICE (2G6, 3F5, HSPICE, LTspice) circuits, components,
 * models, subcircuits, waveforms, simulation directives, and solver output structures.
 */

export interface SpiceSourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  startOffset: number;
  endOffset: number;
}

export type ComponentKind =
  | "R" // Resistor
  | "C" // Capacitor
  | "L" // Inductor
  | "K" // Mutual Inductor
  | "D" // Diode
  | "Q" // Bipolar Junction Transistor (BJT)
  | "M" // MOSFET
  | "J" // JFET
  | "V" // Independent Voltage Source
  | "I" // Independent Current Source
  | "E" // Voltage-Controlled Voltage Source (VCVS)
  | "F" // Current-Controlled Current Source (CCCS)
  | "G" // Voltage-Controlled Current Source (VCCS)
  | "H" // Current-Controlled Voltage Source (CCVS)
  | "X" // Subcircuit Call
  | "S" // Voltage-Controlled Switch
  | "W" // Current-Controlled Switch
  | "T" // Transmission Line
  | "UNKNOWN";

export type WaveformKind = "DC" | "PULSE" | "SINE" | "PWL" | "EXP" | "SFFM";

export interface PulseWaveform {
  kind: "PULSE";
  v1: number;
  v2: number;
  td: number;
  tr: number;
  tf: number;
  pw: number;
  per: number;
}

export interface SineWaveform {
  kind: "SINE";
  vo: number;
  va: number;
  freq: number;
  td?: number | undefined;
  theta?: number | undefined;
}

export interface PwlWaveform {
  kind: "PWL";
  points: [number, number][]; // [time, value] pairs
}

export interface ExpWaveform {
  kind: "EXP";
  v1: number;
  v2: number;
  td1: number;
  tau1: number;
  td2: number;
  tau2: number;
}

export interface SffmWaveform {
  kind: "SFFM";
  vo: number;
  va: number;
  fc: number;
  modIndex: number;
  fs: number;
}

export type WaveformSpec = PulseWaveform | SineWaveform | PwlWaveform | ExpWaveform | SffmWaveform;

export interface SourceSpec {
  dc?: number | undefined;
  acMag?: number | undefined;
  acPhase?: number | undefined;
  waveform?: WaveformSpec | undefined;
}

export interface SpiceComponent {
  name: string;
  kind: ComponentKind;
  nodes: string[];
  value?: number | undefined;
  rawValueExpr?: string | undefined;
  model?: string | undefined;
  params: Map<string, number | string>;
  sourceSpec?: SourceSpec | undefined;
  subcktName?: string | undefined;
  // For mutual inductors (K):
  inductor1?: string | undefined;
  inductor2?: string | undefined;
  couplingFactor?: number | undefined;
  // For controlled sources:
  controlNodes?: [string, string] | undefined; // For E, G
  controlSource?: string | undefined; // For F, H
  gain?: number | undefined; // For E, F, G, H
  rawLine?: string | undefined;
  span?: SpiceSourceSpan | undefined;
}

export type ModelType =
  | "D" // Diode
  | "NPN" // NPN BJT
  | "PNP" // PNP BJT
  | "NMOS" // N-channel MOSFET
  | "PMOS" // P-channel MOSFET
  | "NJF" // N-channel JFET
  | "PJF" // P-channel JFET
  | "SW" // Voltage-Controlled Switch
  | "CSW" // Current-Controlled Switch
  | "R" // Resistor model
  | "C" // Capacitor model
  | "L" // Inductor model
  | "UNKNOWN";

export interface SpiceModel {
  name: string;
  type: ModelType;
  params: Map<string, number>;
  span?: SpiceSourceSpan | undefined;
}

export interface SpiceSubcircuit {
  name: string;
  ports: string[];
  params: Map<string, number | string>;
  components: SpiceComponent[];
  subcircuits: SpiceSubcircuit[];
  models: SpiceModel[];
  span?: SpiceSourceSpan | undefined;
}

export type DirectiveKind =
  | ".TRAN"
  | ".AC"
  | ".DC"
  | ".OP"
  | ".PARAM"
  | ".IC"
  | ".NODESET"
  | ".GLOBAL"
  | ".INCLUDE"
  | ".LIB"
  | ".OPTIONS"
  | ".TEMP"
  | ".FOUR"
  | ".NOISE"
  | ".TF"
  | ".SENS"
  | ".END"
  | ".OTHER";

export interface SpiceDirective {
  kind: DirectiveKind;
  args: string[];
  params: Map<string, number | string>;
  span?: SpiceSourceSpan | undefined;
}

export interface SpiceCircuit {
  title: string;
  components: SpiceComponent[];
  expandedComponents?: SpiceComponent[] | undefined;
  subcircuits: Map<string, SpiceSubcircuit>;
  models: Map<string, SpiceModel>;
  directives: SpiceDirective[];
  globalNodes: Set<string>;
  rawLines: string[];
  comments: { line: number; text: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation & Solver Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OperatingPoint {
  nodeVoltages: Map<string, number>;
  branchCurrents: Map<string, number>;
  converged: boolean;
  iterations: number;
}

export interface TransientOptions {
  tstep: number;
  tstop: number;
  tstart?: number | undefined;
  tmax?: number | undefined;
  uic?: boolean | undefined;
  method?: "trapezoidal" | "euler" | undefined;
}

export interface TransientResult {
  time: number[];
  nodeVoltages: Map<string, number[]>;
  branchCurrents: Map<string, number[]>;
}

export interface AcOptions {
  variation: "DEC" | "OCT" | "LIN";
  points: number;
  fstart: number;
  fstop: number;
}

export interface AcSignal {
  magnitude: number[];
  magnitudeDb: number[];
  phaseDeg: number[];
  real: number[];
  imag: number[];
}

export interface AcResult {
  frequency: number[];
  nodeVoltages: Map<string, AcSignal>;
  branchCurrents: Map<string, AcSignal>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic & Linter Types
// ─────────────────────────────────────────────────────────────────────────────

export type SpiceDiagnosticSeverity = "error" | "warning" | "info";

export interface SpiceQuickFix {
  title: string;
  newText: string;
  span: SpiceSourceSpan;
}

export interface SpiceDiagnostic {
  code: number;
  rule: string;
  severity: SpiceDiagnosticSeverity;
  message: string;
  span?: SpiceSourceSpan | undefined;
  quickFix?: SpiceQuickFix | undefined;
}
