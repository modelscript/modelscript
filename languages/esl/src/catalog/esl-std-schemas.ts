// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * ESL cleanroom ESA aerospace & control block archetype IDs matching `assets/esl-std-lib/src/models.ts`.
 */
export const EslArchetypeId = {
  TRANSFER: 1,
  DELAY: 2,
  LIMIT: 3,
  DEADZONE: 4,
  QUATERNION: 10,
  ORBIT_J2: 11,
  TAB1: 20,
  TAB2: 21,
} as const;

export type EslArchetypeId = (typeof EslArchetypeId)[keyof typeof EslArchetypeId];

export type EslBlockCategory = "Control & Transfer" | "Nonlinearities" | "Spacecraft Attitude & Orbit" | "Table Lookup";

export interface EslStdModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: EslBlockCategory;
  archetypeId: EslArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<EslBlockCategory, { fill: string; stroke: string; badge: string }> = {
  "Control & Transfer": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "CTRL" },
  Nonlinearities: { fill: "#4a1d1d", stroke: "#f97316", badge: "NLIN" },
  "Spacecraft Attitude & Orbit": { fill: "#2e2447", stroke: "#c084fc", badge: "AOCS" },
  "Table Lookup": { fill: "#163b3b", stroke: "#2dd4bf", badge: "TABL" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an ESL standard library block.
 */
export function generateEslBlockSvg(modelType: string, category: EslBlockCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "8.2" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: EslStdModelSpec): DiagramPortSpec[] {
  switch (spec.modelType) {
    case "QUATERNION":
      return [
        { name: "omega_x", kind: "signal", side: "left", dx: 0, dy: 12 },
        { name: "omega_y", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "omega_z", kind: "signal", side: "left", dx: 0, dy: 40 },
        { name: "q_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "ORBIT_J2":
      return [
        { name: "r_in", kind: "signal", side: "left", dx: 0, dy: 16 },
        { name: "v_in", kind: "signal", side: "left", dx: 0, dy: 36 },
        { name: "a_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "TAB2":
      return [
        { name: "x_in", kind: "signal", side: "left", dx: 0, dy: 16 },
        { name: "y_in", kind: "signal", side: "left", dx: 0, dy: 36 },
        { name: "z_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    default:
      return [
        { name: "u_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "y_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const ESL_STD_MODEL_SPECS: EslStdModelSpec[] = [
  {
    modelType: "TRANSFER",
    aliases: ["TF", "LAG", "LEAD_LAG", "REALPL"],
    label: "Continuous Transfer Function",
    category: "Control & Transfer",
    archetypeId: EslArchetypeId.TRANSFER,
    description:
      "First/second-order continuous-time Laplace transfer function H(s) = (b0 + b1*s) / (a0 + a1*s + a2*s^2) in controllable canonical form.",
    provenance: "ESA ESL User Manual (Hay & Crosbie, University of Salford / ESTEC, 1985)",
    params: [
      ["gain", 1.0, "1", "DC gain K"],
      ["tau", 0.5, "s", "First-order lag time constant tau"],
      ["wn", 1.0, "rad/s", "Natural frequency for second-order mode"],
      ["zeta", 0.707, "1", "Damping ratio for second-order mode"],
      ["order", 1.0, "1", "Transfer function order (1 or 2)"],
    ],
  },
  {
    modelType: "DELAY",
    aliases: ["TRANSPORT_DELAY", "PADE_DELAY"],
    label: "Transport Time Delay (Padé)",
    category: "Control & Transfer",
    archetypeId: EslArchetypeId.DELAY,
    description:
      "Continuous-time transport delay approximated via first-order Padé rational filter exp(-s*T) ~= (1 - s*T/2) / (1 + s*T/2).",
    provenance: "ESA ESL Reference Manual — Continuous Delay Operator",
    params: [
      ["delayTime", 0.1, "s", "Transport delay duration T"],
      ["initialOutput", 0.0, "1", "Initial delayed output value"],
    ],
  },
  {
    modelType: "LIMIT",
    aliases: ["SATURATION", "CLAMP", "BOUND"],
    label: "Signal Amplitude Limiter",
    category: "Nonlinearities",
    archetypeId: EslArchetypeId.LIMIT,
    description: "Piecewise-linear saturation limiter clamping input signal u to [lower, upper].",
    provenance: "ESA ESL Standard Nonlinearity Library — LIMIT(lo, hi, u)",
    params: [
      ["lower", -1.0, "1", "Lower saturation limit"],
      ["upper", 1.0, "1", "Upper saturation limit"],
    ],
  },
  {
    modelType: "DEADZONE",
    aliases: ["DEADBAND", "DEAD_ZONE"],
    label: "Symmetric/Asymmetric Deadzone",
    category: "Nonlinearities",
    archetypeId: EslArchetypeId.DEADZONE,
    description: "Deadband nonlinearity returning 0 inside [lower, upper] and linear slope outside the deadband.",
    provenance: "ESA ESL Standard Nonlinearity Library — DEADZONE(lo, hi, u)",
    params: [
      ["lower", -0.05, "1", "Lower deadzone threshold"],
      ["upper", 0.05, "1", "Upper deadzone threshold"],
      ["slope", 1.0, "1", "Linear output slope outside deadzone"],
    ],
  },
  {
    modelType: "QUATERNION",
    aliases: ["QUAT_KINEMATICS", "ATTITUDE_QUAT"],
    label: "Spacecraft Attitude Quaternion Kinematics",
    category: "Spacecraft Attitude & Orbit",
    archetypeId: EslArchetypeId.QUATERNION,
    description:
      "Unit-quaternion rigid-body attitude kinematics dq/dt = 0.5 * Omega(w) * q with Baumgarte norm-restoration term.",
    provenance: "ESA ESTEC AOCS Modeling Guidelines / Wertz Spacecraft Attitude Determination and Control",
    params: [
      ["q0_init", 1.0, "1", "Initial scalar quaternion component q0"],
      ["q1_init", 0.0, "1", "Initial vector quaternion component q1"],
      ["q2_init", 0.0, "1", "Initial vector quaternion component q2"],
      ["q3_init", 0.0, "1", "Initial vector quaternion component q3"],
      ["normGain", 1.0, "1/s", "Quaternion unit-norm restoration gain"],
    ],
  },
  {
    modelType: "ORBIT_J2",
    aliases: ["J2_GRAVITY", "OBLATE_EARTH", "KEPLER_J2"],
    label: "Orbital Two-Body + J2 Zonal Perturbation",
    category: "Spacecraft Attitude & Orbit",
    archetypeId: EslArchetypeId.ORBIT_J2,
    description:
      "Geocentric two-body Newtonian gravitation plus Earth J2 zonal harmonic oblateness perturbation acceleration.",
    provenance: "ESA ESOC Flight Dynamics / WGS-84 & EGM-96 Geopotential Constants",
    params: [
      ["mu", 3.986004418e14, "m^3/s^2", "Central body gravitational parameter GM"],
      ["re", 6378137.0, "m", "Equatorial radius of central body"],
      ["j2", 1.08262668e-3, "1", "Second zonal harmonic coefficient J2"],
    ],
  },
  {
    modelType: "TAB1",
    aliases: ["TABLE1D", "INTERP1"],
    label: "1D Piecewise-Linear Table Lookup",
    category: "Table Lookup",
    archetypeId: EslArchetypeId.TAB1,
    description: "One-dimensional piecewise-linear interpolation table y = f(x) with clamped boundary extrapolation.",
    provenance: "ESA ESL Reference Manual — TAB1 Tabular Function",
    params: [
      ["x0", 0.0, "1", "Breakpoint x0"],
      ["x1", 1.0, "1", "Breakpoint x1"],
      ["x2", 2.0, "1", "Breakpoint x2"],
      ["y0", 0.0, "1", "Table value y0"],
      ["y1", 1.0, "1", "Table value y1"],
      ["y2", 0.0, "1", "Table value y2"],
    ],
  },
  {
    modelType: "TAB2",
    aliases: ["TABLE2D", "INTERP2"],
    label: "2D Bilinear Table Lookup",
    category: "Table Lookup",
    archetypeId: EslArchetypeId.TAB2,
    description: "Two-dimensional bilinear interpolation table z = f(x, y) over a 2x2 grid with clamped boundaries.",
    provenance: "ESA ESL Reference Manual — TAB2 Bilinear Tabular Function",
    params: [
      ["x0", 0.0, "1", "X breakpoint 0"],
      ["x1", 1.0, "1", "X breakpoint 1"],
      ["y0", 0.0, "1", "Y breakpoint 0"],
      ["y1", 1.0, "1", "Y breakpoint 1"],
      ["z00", 0.0, "1", "Grid value at (x0, y0)"],
      ["z10", 1.0, "1", "Grid value at (x1, y0)"],
      ["z01", 2.0, "1", "Grid value at (x0, y1)"],
      ["z11", 3.0, "1", "Grid value at (x1, y1)"],
    ],
  },
];

/**
 * Converts `ESL_STD_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`.
 */
export function buildEslCleanroomSchemas(): CleanroomModelSchema[] {
  return ESL_STD_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `esl:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "aerospace",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "esl_block",
      width: 88,
      height: 52,
      svg: generateEslBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
