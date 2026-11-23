// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * CSMP/360 & CSSL-67 cleanroom standard block archetype IDs matching `assets/csmp-std-lib/src/models.ts`.
 */
export const CsmpArchetypeId = {
  // Mathematical / Dynamic
  INTGRL: 1,
  DERIV: 2,
  DELAY: 3,
  ZHOLD: 4,
  // System Transfer Blocks
  REALPL: 10,
  CMPXPL: 11,
  LEDLAG: 12,
  // Nonlinear & Switching
  HYSTRS: 20,
  LIMIT: 21,
  DEADSP: 22,
  // Function Generators
  AFGEN: 30,
  NLFGEN: 31,
} as const;

export type CsmpArchetypeId = (typeof CsmpArchetypeId)[keyof typeof CsmpArchetypeId];

export type CsmpBlockCategory =
  "Integration & Differentiation" | "Transfer Functions" | "Nonlinear & Switching" | "Function Generators";

export interface CsmpBlockSpec {
  blockType: string;
  aliases?: string[];
  label: string;
  category: CsmpBlockCategory;
  archetypeId: CsmpArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<CsmpBlockCategory, { fill: string; stroke: string; badge: string }> = {
  "Integration & Differentiation": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "INTG" },
  "Transfer Functions": { fill: "#163b3b", stroke: "#2dd4bf", badge: "XFER" },
  "Nonlinear & Switching": { fill: "#4a1d1d", stroke: "#f97316", badge: "NLIN" },
  "Function Generators": { fill: "#2e2447", stroke: "#c084fc", badge: "FGEN" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a CSMP/360 block.
 */
export function generateCsmpBlockSvg(blockType: string, category: CsmpBlockCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = blockType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.5" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: CsmpBlockSpec): DiagramPortSpec[] {
  switch (spec.blockType) {
    case "INTGRL":
      return [
        { name: "ic", kind: "signal", side: "top", dx: 44, dy: 0 },
        { name: "x", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "ZHOLD":
      return [
        { name: "trigger", kind: "signal", side: "top", dx: 44, dy: 0 },
        { name: "x", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    default:
      return [
        { name: "x", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const CSMP_BLOCK_SPECS: CsmpBlockSpec[] = [
  {
    blockType: "INTGRL",
    aliases: ["INTEGRATOR", "INTEG"],
    label: "Integrator (INTGRL)",
    category: "Integration & Differentiation",
    archetypeId: CsmpArchetypeId.INTGRL,
    description: "Continuous time integrator: Y(t) = IC + integral_0^t X(tau) dtau (dY/dt = X).",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 1; SCi CSSL-67",
    params: [["IC", 0.0, "", "Initial condition Y(0)"]],
  },
  {
    blockType: "DERIV",
    aliases: ["DERIVATIVE"],
    label: "Derivative (DERIV)",
    category: "Integration & Differentiation",
    archetypeId: CsmpArchetypeId.DERIV,
    description: "Numerical time derivative Y(t) = dX/dt with quadratic backward difference.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 1",
    params: [["IC", 0.0, "", "Initial value of X at t = 0"]],
  },
  {
    blockType: "DELAY",
    aliases: ["DEADTIME", "TRANSPORT_DELAY"],
    label: "Dead Time Delay (DELAY)",
    category: "Integration & Differentiation",
    archetypeId: CsmpArchetypeId.DELAY,
    description: "Transport dead-time delay: Y(t) = X(t - P) for t >= P, else 0.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 1",
    params: [
      ["N", 16, "", "Number of delay buffer samples"],
      ["P", 1.0, "s", "Delay time constant"],
    ],
  },
  {
    blockType: "ZHOLD",
    aliases: ["ZERO_ORDER_HOLD"],
    label: "Zero-Order Hold (ZHOLD)",
    category: "Integration & Differentiation",
    archetypeId: CsmpArchetypeId.ZHOLD,
    description: "Samples input X when trigger X1 > 0 and holds the value while X1 <= 0.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 1",
    params: [["IC", 0.0, "", "Initial held output value"]],
  },
  {
    blockType: "REALPL",
    aliases: ["FIRST_ORDER_LAG", "REAL_POLE"],
    label: "Real Pole / 1st-Order Lag (REALPL)",
    category: "Transfer Functions",
    archetypeId: CsmpArchetypeId.REALPL,
    description: "First-order lag transfer function: P * dY/dt + Y = X, Y(0) = IC.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 1",
    params: [
      ["IC", 0.0, "", "Initial condition Y(0)"],
      ["P", 1.0, "s", "First-order time constant"],
    ],
  },
  {
    blockType: "CMPXPL",
    aliases: ["COMPLEX_POLE", "SECOND_ORDER"],
    label: "Complex Pole / 2nd-Order System (CMPXPL)",
    category: "Transfer Functions",
    archetypeId: CsmpArchetypeId.CMPXPL,
    description: "Second-order transfer function: d2Y/dt2 + 2*P1*P2*dY/dt + P2^2*Y = X.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 1",
    params: [
      ["IC1", 0.0, "", "Initial position Y(0)"],
      ["IC2", 0.0, "", "Initial velocity dY/dt(0)"],
      ["P1", 0.5, "", "Damping ratio zeta"],
      ["P2", 1.0, "rad/s", "Undamped natural frequency omega_n"],
    ],
  },
  {
    blockType: "LEDLAG",
    aliases: ["LEAD_LAG"],
    label: "Lead-Lag Compensator (LEDLAG)",
    category: "Transfer Functions",
    archetypeId: CsmpArchetypeId.LEDLAG,
    description: "Lead-lag transfer function: (P1*s + 1) / (P2*s + 1) applied to input X.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 1",
    params: [
      ["P1", 1.0, "s", "Lead time constant"],
      ["P2", 0.5, "s", "Lag time constant"],
    ],
  },
  {
    blockType: "HYSTRS",
    aliases: ["HYSTERESIS"],
    label: "Hysteresis Loop (HYSTRS)",
    category: "Nonlinear & Switching",
    archetypeId: CsmpArchetypeId.HYSTRS,
    description: "Hysteresis nonlinearity with half-width (P2 - P1)/2 and initial state IC.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 2",
    params: [
      ["IC", 0.0, "", "Initial output state"],
      ["P1", -1.0, "", "Lower switching threshold"],
      ["P2", 1.0, "", "Upper switching threshold"],
    ],
  },
  {
    blockType: "LIMIT",
    aliases: ["LIMITER", "SATURATION"],
    label: "Limiter / Saturation (LIMIT)",
    category: "Nonlinear & Switching",
    archetypeId: CsmpArchetypeId.LIMIT,
    description: "Clamps input X to the closed interval [P1, P2]: Y = min(P2, max(P1, X)).",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 2",
    params: [
      ["P1", -1.0, "", "Lower saturation limit"],
      ["P2", 1.0, "", "Upper saturation limit"],
    ],
  },
  {
    blockType: "DEADSP",
    aliases: ["DEADSPACE", "DEADZONE"],
    label: "Dead Space / Dead Zone (DEADSP)",
    category: "Nonlinear & Switching",
    archetypeId: CsmpArchetypeId.DEADSP,
    description: "Zero output for P1 <= X <= P2; Y = X - P2 for X > P2; Y = X - P1 for X < P1.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 2",
    params: [
      ["P1", -1.0, "", "Lower dead-zone bound"],
      ["P2", 1.0, "", "Upper dead-zone bound"],
    ],
  },
  {
    blockType: "AFGEN",
    aliases: ["ARBITRARY_FUNCTION"],
    label: "Arbitrary Linear Function Generator (AFGEN)",
    category: "Function Generators",
    archetypeId: CsmpArchetypeId.AFGEN,
    description: "Piecewise-linear interpolation of a FUNCTION table (x_i, y_i) at input X.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 3",
    params: [["N_POINTS", 2, "", "Number of (x, y) breakpoints in table"]],
  },
  {
    blockType: "NLFGEN",
    aliases: ["NONLINEAR_FUNCTION"],
    label: "Quadratic Function Generator (NLFGEN)",
    category: "Function Generators",
    archetypeId: CsmpArchetypeId.NLFGEN,
    description: "Lagrange quadratic interpolation of a FUNCTION table (x_i, y_i) at input X.",
    provenance: "IBM System/360 CSMP User's Manual GH20-0367-4, Table 3",
    params: [["N_POINTS", 3, "", "Number of (x, y) breakpoints in table"]],
  },
];

/**
 * Converts `CSMP_BLOCK_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG block icons and port layouts.
 */
export function buildCsmpCleanroomSchemas(): CleanroomModelSchema[] {
  return CSMP_BLOCK_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `csmp:${spec.blockType}`,
      name: spec.blockType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "controls",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "csmp_block",
      width: 88,
      height: 52,
      svg: generateCsmpBlockSvg(spec.blockType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: spec.blockType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
