// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Built-in 20-sim Bond Graph & Signal/Control block catalog.
 *
 * Provides port schemas, default parameters, and documentation when `.emx` models
 * reference standard 20-sim library blocks without inlined `<SpecificationCode>`.
 */

import type { BondGraphElementKind, TwentySimPort } from "../types.js";

export interface TwentySimBlockSpec {
  id: string;
  aliases: string[];
  category: "bond-graph" | "signal" | "control";
  elementKind: BondGraphElementKind;
  description: string;
  defaultParams: Record<string, number>;
  ports: TwentySimPort[];
}

export const TWENTYSIM_BLOCK_CATALOG: TwentySimBlockSpec[] = [
  {
    id: "0",
    aliases: ["ZeroJunction", "0-Junction", "Junction0"],
    category: "bond-graph",
    elementKind: "0",
    description: "0-Junction (common effort, zero-sum flow).",
    defaultParams: {},
    ports: [{ name: "p", kind: "power", direction: "inout", effortVar: "p.e", flowVar: "p.f" }],
  },
  {
    id: "1",
    aliases: ["OneJunction", "1-Junction", "Junction1"],
    category: "bond-graph",
    elementKind: "1",
    description: "1-Junction (common flow, zero-sum effort).",
    defaultParams: {},
    ports: [{ name: "p", kind: "power", direction: "inout", effortVar: "p.e", flowVar: "p.f" }],
  },
  {
    id: "R",
    aliases: ["Resistor", "Resistance", "Damper"],
    category: "bond-graph",
    elementKind: "R",
    description: "Linear resistive / dissipative element (e = r * f).",
    defaultParams: { r: 1.0 },
    ports: [{ name: "p", kind: "power", direction: "inout", effortVar: "p.e", flowVar: "p.f" }],
  },
  {
    id: "C",
    aliases: ["Capacitor", "Capacitance", "Spring", "Compliance"],
    category: "bond-graph",
    elementKind: "C",
    description: "Linear capacitive / compliance storage element (dq/dt = f, e = q / c).",
    defaultParams: { c: 1.0, q0: 0.0 },
    ports: [{ name: "p", kind: "power", direction: "inout", effortVar: "p.e", flowVar: "p.f" }],
  },
  {
    id: "I",
    aliases: ["Inductor", "Inertia", "Mass"],
    category: "bond-graph",
    elementKind: "I",
    description: "Linear inertial / inductive storage element (dp/dt = e, f = p / i).",
    defaultParams: { i: 1.0, p0: 0.0 },
    ports: [{ name: "p", kind: "power", direction: "inout", effortVar: "p.e", flowVar: "p.f" }],
  },
  {
    id: "Se",
    aliases: ["EffortSource", "SourceEffort"],
    category: "bond-graph",
    elementKind: "Se",
    description: "Constant effort source (imposes effort e = effort).",
    defaultParams: { effort: 1.0 },
    ports: [{ name: "p", kind: "power", direction: "inout", effortVar: "p.e", flowVar: "p.f", restriction: "effort" }],
  },
  {
    id: "Sf",
    aliases: ["FlowSource", "SourceFlow"],
    category: "bond-graph",
    elementKind: "Sf",
    description: "Constant flow source (imposes flow f = flow).",
    defaultParams: { flow: 1.0 },
    ports: [{ name: "p", kind: "power", direction: "inout", effortVar: "p.e", flowVar: "p.f", restriction: "flow" }],
  },
  {
    id: "TF",
    aliases: ["Transformer"],
    category: "bond-graph",
    elementKind: "TF",
    description: "Ideal transformer (p1.e = r * p2.e, p2.f = r * p1.f).",
    defaultParams: { r: 1.0 },
    ports: [
      { name: "p1", kind: "power", direction: "inout", effortVar: "p1.e", flowVar: "p1.f" },
      { name: "p2", kind: "power", direction: "inout", effortVar: "p2.e", flowVar: "p2.f" },
    ],
  },
  {
    id: "GY",
    aliases: ["Gyrator"],
    category: "bond-graph",
    elementKind: "GY",
    description: "Ideal gyrator (p1.e = r * p2.f, p2.e = r * p1.f).",
    defaultParams: { r: 1.0 },
    ports: [
      { name: "p1", kind: "power", direction: "inout", effortVar: "p1.e", flowVar: "p1.f" },
      { name: "p2", kind: "power", direction: "inout", effortVar: "p2.e", flowVar: "p2.f" },
    ],
  },
  {
    id: "Gain",
    aliases: ["Amplifier", "Attenuate"],
    category: "signal",
    elementKind: "Signal",
    description: "Signal gain block (output = K * input).",
    defaultParams: { K: 1.0 },
    ports: [
      { name: "input", kind: "signal", direction: "in" },
      { name: "output", kind: "signal", direction: "out" },
    ],
  },
  {
    id: "PlusMinus",
    aliases: ["Sum", "Splitter"],
    category: "signal",
    elementKind: "Signal",
    description: "Signal difference block (output = plus - minus).",
    defaultParams: {},
    ports: [
      { name: "plus", kind: "signal", direction: "in" },
      { name: "minus", kind: "signal", direction: "in" },
      { name: "output", kind: "signal", direction: "out" },
    ],
  },
  {
    id: "Integrate",
    aliases: ["Integrator"],
    category: "signal",
    elementKind: "Signal",
    description: "Signal time integrator (output = int(input, initial)).",
    defaultParams: { initial: 0.0 },
    ports: [
      { name: "input", kind: "signal", direction: "in" },
      { name: "output", kind: "signal", direction: "out" },
    ],
  },
  {
    id: "Step",
    aliases: ["StepSource"],
    category: "signal",
    elementKind: "Signal",
    description: "Step signal source (output = time >= start_time ? amplitude : 0).",
    defaultParams: { amplitude: 1.0, start_time: 0.0 },
    ports: [{ name: "output", kind: "signal", direction: "out" }],
  },
  {
    id: "Sine",
    aliases: ["WaveGenerator", "SineSource"],
    category: "signal",
    elementKind: "Signal",
    description: "Sinusoidal signal source (output = amplitude * sin(omega * time)).",
    defaultParams: { amplitude: 1.0, omega: 1.0 },
    ports: [{ name: "output", kind: "signal", direction: "out" }],
  },
  {
    id: "PID",
    aliases: ["PIDController"],
    category: "control",
    elementKind: "Signal",
    description: "Proportional-Integral-Derivative signal controller.",
    defaultParams: { kp: 1.0, ki: 0.0, kd: 0.0 },
    ports: [
      { name: "error", kind: "signal", direction: "in" },
      { name: "output", kind: "signal", direction: "out" },
    ],
  },
  {
    id: "Constant",
    aliases: ["Const"],
    category: "signal",
    elementKind: "Signal",
    description: "Constant signal generator (output = C).",
    defaultParams: { C: 1.0 },
    ports: [{ name: "output", kind: "signal", direction: "out" }],
  },
];

export function lookupTwentySimBlock(typeName: string | undefined): TwentySimBlockSpec | undefined {
  if (!typeName) return undefined;
  const norm = typeName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return TWENTYSIM_BLOCK_CATALOG.find(
    (spec) =>
      spec.id.toLowerCase().replace(/[^a-z0-9]/g, "") === norm ||
      spec.aliases.some((a) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === norm),
  );
}
