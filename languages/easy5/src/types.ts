// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core Type Definitions for Boeing / MSC Software EASY5 Modeling & Simulation.
 */

export type PortKind = "input" | "output" | "bidirectional";

export interface Easy5Port {
  name: string;
  kind: PortKind;
  dimension?: number | undefined;
  dataType?: "Real" | "Integer" | "Boolean" | undefined;
  description?: string | undefined;
}

export interface Easy5Component {
  /** Unique component identifier / mnemonic in model (e.g. 'LA01', 'SJ02', 'IN01'). */
  id: string;
  /** Component library type (e.g. 'GP/LA', 'GP/SJ', 'GP/IN', 'GP/TF', 'GP/UG', or simple 'LA'). */
  type: string;
  /** Descriptive title / documentation label. */
  title?: string | undefined;
  /** Numerical and expression parameters (XP values, gains, limits, time constants). */
  parameters: Record<string, number | number[] | string>;
  /** Initial values for continuous states (S0 vector). */
  initialStates: Record<string, number>;
  /** Input and output port declarations. */
  ports: Record<string, Easy5Port>;
  /** Embedded Fortran source code for User General (UG/UX) custom blocks. */
  userCode?: string | undefined;
  /** Schematic coordinates for diagram visualization. */
  location?: { x: number; y: number } | undefined;
  /** Source code line (1-indexed) for diagnostic range mapping. */
  line?: number | undefined;
  /** Source code column (1-indexed). */
  column?: number | undefined;
  /** Source start offset. */
  startOffset?: number | undefined;
  /** Source end offset. */
  endOffset?: number | undefined;
}

export interface Easy5Connection {
  fromComponent: string;
  fromPort: string;
  toComponent: string;
  toPort: string;
  line?: number | undefined;
  column?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface Easy5Table {
  name: string;
  dimension: 1 | 2 | 3;
  xValues: number[];
  yValues?: number[] | undefined;
  data: number[] | number[][];
}

export interface Easy5SimulationConfig {
  startTime?: number | undefined;
  stopTime?: number | undefined;
  stepSize?: number | undefined;
  maxStep?: number | undefined;
  minStep?: number | undefined;
  tolerance?: number | undefined;
  algorithm?: "Gear_BDF" | "Adams_Moulton" | "Runge_Kutta_4" | "Euler" | string | undefined;
}

export interface Easy5LinearConfig {
  trim?: boolean | undefined;
  trimTolerance?: number | undefined;
  maxTrimIterations?: number | undefined;
  perturbationSize?: number | undefined;
  operatingPoint?: Record<string, number> | undefined;
  frequencyRange?:
    | {
        minFreqRadS: number;
        maxFreqRadS: number;
        points: number;
      }
    | undefined;
}

export interface Easy5AnalysisDirectives {
  title?: string | undefined;
  simulation?: Easy5SimulationConfig | undefined;
  linear?: Easy5LinearConfig | undefined;
}

export interface Easy5Model {
  name: string;
  title?: string | undefined;
  components: Map<string, Easy5Component>;
  connections: Easy5Connection[];
  tables: Map<string, Easy5Table>;
  directives?: Easy5AnalysisDirectives | undefined;
  sourceText?: string | undefined;
}

/**
 * Linear state-space representation (dx/dt = A x + B u, y = C x + D u).
 */
export interface LinearSystemModel {
  A: number[][];
  B: number[][];
  C: number[][];
  D: number[][];
  stateNames: string[];
  inputNames: string[];
  outputNames: string[];
  operatingPoint?:
    | {
        states: Record<string, number>;
        inputs: Record<string, number>;
        outputs: Record<string, number>;
      }
    | undefined;
}

export interface SystemEigenvalue {
  real: number;
  imag: number;
  magnitude: number;
  frequencyRadS: number;
  frequencyHz: number;
  dampingRatio: number;
  isStable: boolean;
}

export interface BodeChannelData {
  inputName: string;
  outputName: string;
  magnitudeDb: number[];
  phaseDeg: number[];
}

export interface BodePlotData {
  frequenciesRadS: number[];
  channels: BodeChannelData[];
}
