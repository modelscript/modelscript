// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Easy5Port } from "../types.js";

export interface BlockDescriptor {
  type: string;
  name: string;
  category: "math" | "continuous" | "discontinuous" | "routing" | "nonlinear" | "custom";
  description: string;
  ports: Easy5Port[];
  defaultParameters: Record<string, number | number[] | string>;
  stateCount?: number | ((params: Record<string, any>) => number) | undefined;
}

export const GP_BLOCK_DESCRIPTORS: Record<string, BlockDescriptor> = {
  GA: {
    type: "GA",
    name: "Gain",
    category: "math",
    description: "Multiplies input signal by scalar gain K: OUT = K * IN",
    ports: [
      { name: "IN", kind: "input", description: "Input signal" },
      { name: "OUT", kind: "output", description: "Scaled output signal" },
    ],
    defaultParameters: {
      K: 1.0,
    },
    stateCount: 0,
  },
  SJ: {
    type: "SJ",
    name: "Summing Junction",
    category: "math",
    description: "Computes algebraic linear combination of up to 4 inputs: OUT = sum(SGN_i * K_i * IN_i)",
    ports: [
      { name: "IN1", kind: "input", description: "First input" },
      { name: "IN2", kind: "input", description: "Second input" },
      { name: "IN3", kind: "input", description: "Third input" },
      { name: "IN4", kind: "input", description: "Fourth input" },
      { name: "OUT", kind: "output", description: "Summed output" },
    ],
    defaultParameters: {
      SGN1: 1.0,
      SGN2: 1.0,
      SGN3: 1.0,
      SGN4: 1.0,
      K1: 1.0,
      K2: 1.0,
      K3: 1.0,
      K4: 1.0,
    },
    stateCount: 0,
  },
  IN: {
    type: "IN",
    name: "Integrator",
    category: "continuous",
    description: "Continuous time integrator with initial state S0 and optional limits: dS/dt = GAIN * IN, OUT = S",
    ports: [
      { name: "IN", kind: "input", description: "Derivative input" },
      { name: "OUT", kind: "output", description: "Integrated state output" },
    ],
    defaultParameters: {
      GAIN: 1.0,
      S0: 0.0,
      UL: 1e9,
      LL: -1e9,
    },
    stateCount: 1,
  },
  TF: {
    type: "TF",
    name: "Transfer Function",
    category: "continuous",
    description: "Linear arbitrary-order rational transfer function H(s) = N(s) / D(s)",
    ports: [
      { name: "IN", kind: "input", description: "Input signal" },
      { name: "OUT", kind: "output", description: "Filtered output signal" },
    ],
    defaultParameters: {
      NUM: [1.0],
      DEN: [1.0, 1.0],
    },
    stateCount: (params: Record<string, any>) => {
      const den = Array.isArray(params["DEN"]) ? params["DEN"] : [1.0, 1.0];
      return Math.max(0, den.length - 1);
    },
  },
  LA: {
    type: "LA",
    name: "Lead-Lag Filter",
    category: "continuous",
    description: "First-order lead-lag compensator: H(s) = GAIN * (1 + TAU1*s) / (1 + TAU2*s)",
    ports: [
      { name: "IN", kind: "input", description: "Input signal" },
      { name: "OUT", kind: "output", description: "Lead-lag compensated output" },
    ],
    defaultParameters: {
      GAIN: 1.0,
      TAU1: 0.0,
      TAU2: 1.0,
      S0: 0.0,
    },
    stateCount: 1,
  },
  LM: {
    type: "LM",
    name: "Limiter",
    category: "nonlinear",
    description: "Saturates input within lower (LL) and upper (UL) boundaries",
    ports: [
      { name: "IN", kind: "input", description: "Input signal" },
      { name: "OUT", kind: "output", description: "Clamped output" },
    ],
    defaultParameters: {
      UL: 1.0,
      LL: -1.0,
    },
    stateCount: 0,
  },
  DZ: {
    type: "DZ",
    name: "Deadband",
    category: "nonlinear",
    description: "Suppresses output within threshold range [DBN, DBP]",
    ports: [
      { name: "IN", kind: "input", description: "Input signal" },
      { name: "OUT", kind: "output", description: "Deadbanded output" },
    ],
    defaultParameters: {
      DBP: 0.1,
      DBN: -0.1,
    },
    stateCount: 0,
  },
  HY: {
    type: "HY",
    name: "Hysteresis",
    category: "nonlinear",
    description: "Two-position relay with hysteresis dead-zone",
    ports: [
      { name: "IN", kind: "input", description: "Input signal" },
      { name: "OUT", kind: "output", description: "Hysteresis switched output" },
    ],
    defaultParameters: {
      HYS: 0.5,
      OUT_HIGH: 1.0,
      OUT_LOW: -1.0,
    },
    stateCount: 0,
  },
  TD: {
    type: "TD",
    name: "Time Delay",
    category: "continuous",
    description: "Pure transportation lag: OUT(t) = IN(t - DELAY)",
    ports: [
      { name: "IN", kind: "input", description: "Input signal" },
      { name: "OUT", kind: "output", description: "Delayed output" },
    ],
    defaultParameters: {
      DELAY: 0.1,
    },
    stateCount: 0,
  },
  SW: {
    type: "SW",
    name: "Switch / Selector",
    category: "routing",
    description: "Routes IN1 when CTL >= THRESHOLD, otherwise routes IN2",
    ports: [
      { name: "IN1", kind: "input", description: "Input 1 (active when high)" },
      { name: "IN2", kind: "input", description: "Input 2 (active when low)" },
      { name: "CTL", kind: "input", description: "Control selector signal" },
      { name: "OUT", kind: "output", description: "Switched output" },
    ],
    defaultParameters: {
      THRESHOLD: 0.0,
    },
    stateCount: 0,
  },
  FN: {
    type: "FN",
    name: "Function Generator / Table Lookup",
    category: "nonlinear",
    description: "Interpolates 1D or 2D table lookup data",
    ports: [
      { name: "IN", kind: "input", description: "Lookup abscissa input" },
      { name: "OUT", kind: "output", description: "Interpolated value" },
    ],
    defaultParameters: {
      TABLE: "",
    },
    stateCount: 0,
  },
  UG: {
    type: "UG",
    name: "User General Component",
    category: "custom",
    description: "Custom user-coded component executing embedded Fortran subroutines",
    ports: [],
    defaultParameters: {},
  },
};

/**
 * Resolves standard block descriptor by type mnemonic (e.g. 'LA', 'GP/LA', 'SJ').
 */
export function getBlockDescriptor(typeStr: string): BlockDescriptor | undefined {
  const norm = typeStr.toUpperCase().replace(/^GP\//, "");
  return GP_BLOCK_DESCRIPTORS[norm];
}
