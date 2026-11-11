// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — NEURON Model Description Language (NMODL) AST & Types.
 *
 * Covers TITLE, NEURON, UNITS, PARAMETER, ASSIGNED, STATE, BREAKPOINT,
 * DERIVATIVE, INITIAL, and PROCEDURE blocks for biophysical ion channels.
 */

export interface NmodlRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface NmodlIonUse {
  ion: string; // e.g. "na", "k", "ca"
  read: string[]; // e.g. ["ena"]
  write: string[]; // e.g. ["ina"]
  valence?: number | undefined;
  range?: NmodlRange | undefined;
}

export interface NmodlParameter {
  name: string;
  val: number;
  units?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  range?: NmodlRange | undefined;
}

export interface NmodlVariable {
  name: string;
  units?: string | undefined;
  isState: boolean;
  isAssigned: boolean;
  initVal?: number | undefined;
  range?: NmodlRange | undefined;
}

export interface NmodlEquation {
  lhs: string; // e.g. "m'" or "ina"
  rhs: string; // e.g. "(minf - m) / mtau" or "gna * (v - ena)"
  isDerivative: boolean;
  stateName?: string | undefined; // e.g. "m" if lhs is "m'"
  range?: NmodlRange | undefined;
}

export interface NmodlModel {
  title?: string | undefined;
  suffix: string; // Mechanism suffix e.g. "hh", "na", "kv"
  ions: NmodlIonUse[];
  ranges: string[];
  globals: string[];
  parameters: NmodlParameter[];
  assigned: NmodlVariable[];
  states: NmodlVariable[];
  breakpointEquations: NmodlEquation[];
  derivativeEquations: NmodlEquation[];
  initialEquations: NmodlEquation[];
  rawBlocks: Record<string, string>;
  range?: NmodlRange | undefined;
}

export interface NmodlDocument {
  model: NmodlModel;
  raw: string;
}

export interface NmodlSimOptions {
  tEnd?: number | undefined; // ms (default 50.0 ms)
  dt?: number | undefined; // ms (default 0.025 ms)
  vInit?: number | undefined; // mV (default -65.0 mV)
  stimAmp?: number | undefined; // nA or mA/cm2 (default 10.0)
  stimStart?: number | undefined; // ms (default 5.0 ms)
  stimDuration?: number | undefined; // ms (default 30.0 ms)
}

export interface NmodlSimResult {
  time: number[];
  v: number[];
  states: Record<string, number[]>;
  currents: Record<string, number[]>;
  spikeCount: number;
  firingRateHz: number;
  vPeak: number;
  vRest: number;
}
