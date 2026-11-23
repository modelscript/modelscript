// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom ACSL (Mitchell & Gauthier Associates, 1975) standard operator archetype IDs
 * matching `assets/acsl-std-lib/src/models.ts`.
 */
export const AcslArchetypeId = {
  INTEG: 1,
  REALPL: 2,
  CMPXPL: 3,
  LEDLAG: 4,
  DELAY: 5,
  PULSE: 6,
  RAMP: 7,
  STEP: 8,
  BOUND: 9,
  DEAD: 10,
  QUANT: 11,
  SW: 12,
  ZHOLD: 13,
  LIMINT: 14,
} as const;

export type AcslArchetypeId = (typeof AcslArchetypeId)[keyof typeof AcslArchetypeId];

export type AcslOperatorCategory =
  "Continuous Dynamics" | "Transfer Functions" | "Signal Generators" | "Nonlinear Operators" | "Discrete & Sampled";

export interface AcslOperatorSpec {
  operatorName: string;
  aliases?: string[];
  label: string;
  category: AcslOperatorCategory;
  archetypeId: AcslArchetypeId;
  signature: string;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<AcslOperatorCategory, { fill: string; stroke: string; badge: string }> = {
  "Continuous Dynamics": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "CONT" },
  "Transfer Functions": { fill: "#2e2447", stroke: "#c084fc", badge: "XFER" },
  "Signal Generators": { fill: "#1e3f2f", stroke: "#34d399", badge: "SIG" },
  "Nonlinear Operators": { fill: "#4a1d1d", stroke: "#f97316", badge: "NONL" },
  "Discrete & Sampled": { fill: "#163b3b", stroke: "#2dd4bf", badge: "DISC" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an ACSL standard operator.
 */
export function generateAcslBlockSvg(operatorName: string, category: AcslOperatorCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = operatorName.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.5" : "10";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForOperator(spec: AcslOperatorSpec): DiagramPortSpec[] {
  switch (spec.category) {
    case "Signal Generators":
      return [{ name: "y", kind: "signal", side: "right", dx: 88, dy: 26 }];
    case "Discrete & Sampled":
      return [
        { name: "u", kind: "signal", side: "left", dx: 0, dy: 18 },
        { name: "clk", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    default:
      return [
        { name: "u", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const ACSL_OPERATOR_SPECS: readonly AcslOperatorSpec[] = [
  {
    operatorName: "INTEG",
    aliases: ["INTEGRATOR"],
    label: "Continuous Integrator",
    category: "Continuous Dynamics",
    archetypeId: AcslArchetypeId.INTEG,
    signature: "INTEG(x_dot, ic)",
    description: "Continuous-time state integrator solving dy/dt = x_dot with initial condition y(t0) = ic.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [["IC", 0.0, "", "Initial condition y(t0)"]],
  },
  {
    operatorName: "LIMINT",
    aliases: ["LIMITED_INTEGRATOR"],
    label: "Limited Integrator",
    category: "Continuous Dynamics",
    archetypeId: AcslArchetypeId.LIMINT,
    signature: "LIMINT(x_dot, ic, lo, hi)",
    description: "Continuous integrator clamped to [lo, hi] with anti-windup derivative gating at saturation limits.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [
      ["IC", 0.0, "", "Initial condition y(t0)"],
      ["LO", -1.0, "", "Lower saturation bound"],
      ["HI", 1.0, "", "Upper saturation bound"],
    ],
  },
  {
    operatorName: "REALPL",
    aliases: ["FIRST_ORDER_LAG"],
    label: "First-Order Real Pole",
    category: "Transfer Functions",
    archetypeId: AcslArchetypeId.REALPL,
    signature: "REALPL(tau, u, ic)",
    description: "First-order lag transfer function 1 / (tau * s + 1), solving tau * dy/dt + y = u.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [
      ["TAU", 1.0, "s", "Time constant tau > 0"],
      ["IC", 0.0, "", "Initial output y(t0)"],
    ],
  },
  {
    operatorName: "CMPXPL",
    aliases: ["SECOND_ORDER_POLE"],
    label: "Second-Order Complex Pole",
    category: "Transfer Functions",
    archetypeId: AcslArchetypeId.CMPXPL,
    signature: "CMPXPL(a, b, u, ic1, ic2)",
    description: "Second-order transfer function 1 / (a * s^2 + b * s + 1) with state initial conditions ic1, ic2.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [
      ["A", 1.0, "s^2", "Second-order coefficient a = 1 / wn^2"],
      ["B", 1.414, "s", "Damping coefficient b = 2 * zeta / wn"],
      ["IC1", 0.0, "", "Initial position y(t0)"],
      ["IC2", 0.0, "", "Initial velocity dy/dt(t0)"],
    ],
  },
  {
    operatorName: "LEDLAG",
    aliases: ["LEAD_LAG"],
    label: "Lead-Lag Compensator",
    category: "Transfer Functions",
    archetypeId: AcslArchetypeId.LEDLAG,
    signature: "LEDLAG(t1, t2, u, ic)",
    description: "First-order lead-lag compensator (t1 * s + 1) / (t2 * s + 1).",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [
      ["T1", 0.5, "s", "Lead time constant"],
      ["T2", 1.0, "s", "Lag time constant (t2 > 0)"],
      ["IC", 0.0, "", "Initial state"],
    ],
  },
  {
    operatorName: "DELAY",
    aliases: ["TRANSPORT_DELAY"],
    label: "Transport Delay",
    category: "Transfer Functions",
    archetypeId: AcslArchetypeId.DELAY,
    signature: "DELAY(u, ic, td, n)",
    description: "Pure time transport delay y(t) = u(t - td) for t >= td, else ic.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [
      ["TD", 1.0, "s", "Delay duration td >= 0"],
      ["IC", 0.0, "", "Initial history value for t < td"],
      ["N", 16, "", "Ring buffer discretization points"],
    ],
  },
  {
    operatorName: "PULSE",
    aliases: ["PULSE_TRAIN"],
    label: "Periodic Pulse Generator",
    category: "Signal Generators",
    archetypeId: AcslArchetypeId.PULSE,
    signature: "PULSE(tz, p, w)",
    description: "Periodic unit pulse starting at tz with period p and pulse width w.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [
      ["TZ", 0.0, "s", "Start time of first pulse"],
      ["P", 1.0, "s", "Pulse repetition period"],
      ["W", 0.5, "s", "Active pulse width"],
    ],
  },
  {
    operatorName: "RAMP",
    aliases: ["UNIT_RAMP"],
    label: "Unit Ramp Generator",
    category: "Signal Generators",
    archetypeId: AcslArchetypeId.RAMP,
    signature: "RAMP(t0)",
    description: "Unit-slope ramp signal max(0, t - t0).",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [["T0", 0.0, "s", "Ramp start time"]],
  },
  {
    operatorName: "STEP",
    aliases: ["UNIT_STEP"],
    label: "Unit Step Generator",
    category: "Signal Generators",
    archetypeId: AcslArchetypeId.STEP,
    signature: "STEP(t0)",
    description: "Heaviside unit step function: 0 for t < t0, 1 for t >= t0.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [["T0", 0.0, "s", "Step transition time"]],
  },
  {
    operatorName: "BOUND",
    aliases: ["SATURATION", "CLAMP"],
    label: "Amplitude Limiter",
    category: "Nonlinear Operators",
    archetypeId: AcslArchetypeId.BOUND,
    signature: "BOUND(lo, hi, u)",
    description: "Saturation limiter clamping input u into [lo, hi].",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [
      ["LO", -1.0, "", "Lower limit"],
      ["HI", 1.0, "", "Upper limit"],
    ],
  },
  {
    operatorName: "DEAD",
    aliases: ["DEADZONE"],
    label: "Dead-Zone Nonlinearity",
    category: "Nonlinear Operators",
    archetypeId: AcslArchetypeId.DEAD,
    signature: "DEAD(lo, hi, u)",
    description: "Dead-zone operator returning 0 for lo <= u <= hi, u - hi for u > hi, and u - lo for u < lo.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [
      ["LO", -0.1, "", "Lower deadband threshold"],
      ["HI", 0.1, "", "Upper deadband threshold"],
    ],
  },
  {
    operatorName: "QUANT",
    aliases: ["QUANTIZER"],
    label: "Uniform Quantizer",
    category: "Nonlinear Operators",
    archetypeId: AcslArchetypeId.QUANT,
    signature: "QUANT(q, u)",
    description: "Uniform staircase quantizer rounding u to nearest integer multiple of step size q.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [["Q", 0.1, "", "Quantization step size q > 0"]],
  },
  {
    operatorName: "SW",
    aliases: ["RSW", "SWITCH"],
    label: "Analogue Switch",
    category: "Nonlinear Operators",
    archetypeId: AcslArchetypeId.SW,
    signature: "SW(cond, a, b)",
    description: "Conditional switch returning a when cond is true (> 0), otherwise b.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [["THRESHOLD", 0.0, "", "Switching threshold"]],
  },
  {
    operatorName: "ZHOLD",
    aliases: ["ZERO_ORDER_HOLD"],
    label: "Zero-Order Hold",
    category: "Discrete & Sampled",
    archetypeId: AcslArchetypeId.ZHOLD,
    signature: "ZHOLD(clk, u)",
    description: "Samples input u when clk is active and holds the sampled value between clock ticks.",
    provenance: "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
    params: [["IC", 0.0, "", "Initial held value"]],
  },
];

/**
 * Builds cleanroom `CleanroomModelSchema[]` entries for all 14 standard ACSL operators.
 */
export function buildAcslCleanroomSchemas(): CleanroomModelSchema[] {
  return ACSL_OPERATOR_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `ACSL.${spec.operatorName}`,
      name: spec.operatorName,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "controls",
      description: `${spec.signature} — ${spec.description}`,
      provenance: spec.provenance,
      symbolKind: "Function",
      width: 88,
      height: 52,
      svg: generateAcslBlockSvg(spec.operatorName, spec.category),
      ports: defaultPortsForOperator(spec),
      parameters,
      wasmKernel: "acslModelStep",
      extra: {
        archetypeId: spec.archetypeId,
        signature: spec.signature,
      },
    };
  });
}
