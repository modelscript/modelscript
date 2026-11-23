// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom DYNAMO standard library function archetype IDs matching
 * `assets/dynamo-std-lib/src/models.ts`.
 */
export const DynamoArchetypeId = {
  // Information & Material Delays
  SMOOTH: 1,
  DLINF1: 2,
  DLINF3: 3,
  DELAY1: 4,
  DELAY3: 5,
  // Table Lookup Functions
  TABLE: 10,
  TABHL: 11,
  // Logical / Switching Functions
  CLIP: 20,
  SWITCH: 21,
  // Test Input Functions
  STEP: 30,
  PULSE: 31,
  RAMP: 32,
} as const;

export type DynamoArchetypeId = (typeof DynamoArchetypeId)[keyof typeof DynamoArchetypeId];

export type DynamoFunctionCategory =
  "Information & Material Delays" | "Table Lookup" | "Logical & Switching" | "Test Inputs";

export interface DynamoFunctionSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: DynamoFunctionCategory;
  archetypeId: DynamoArchetypeId;
  signature: string;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<DynamoFunctionCategory, { fill: string; stroke: string; badge: string }> = {
  "Information & Material Delays": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "DLAY" },
  "Table Lookup": { fill: "#163b3b", stroke: "#2dd4bf", badge: "TABL" },
  "Logical & Switching": { fill: "#2e2447", stroke: "#c084fc", badge: "LOGC" },
  "Test Inputs": { fill: "#4a251d", stroke: "#fb923c", badge: "TEST" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a DYNAMO standard function.
 */
export function generateDynamoBlockSvg(fnName: string, category: DynamoFunctionCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = fnName.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.5" : "9.8";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: DynamoFunctionSpec): DiagramPortSpec[] {
  switch (spec.category) {
    case "Information & Material Delays":
      return [
        { name: "in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "Table Lookup":
      return [
        { name: "x", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "Logical & Switching":
      return [
        { name: "p", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "q", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "r", kind: "signal", side: "left", dx: 0, dy: 38 },
        { name: "out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "Test Inputs":
      return [
        { name: "time", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const DYNAMO_STD_FUNCTION_SPECS: DynamoFunctionSpec[] = [
  {
    name: "SMOOTH",
    aliases: ["SMTH1"],
    label: "1st-Order Exponential Smooth",
    category: "Information & Material Delays",
    archetypeId: DynamoArchetypeId.SMOOTH,
    signature: "SMOOTH(IN, DEL)",
    description: "First-order exponential information smoothing: dS/dt = (IN - S) / DEL, initialized at S(0) = IN(0).",
    provenance: "Pugh (1963) DYNAMO User's Manual / Forrester Industrial Dynamics",
    params: [
      ["DEL", 1.0, "time", "Smoothing time constant (delay)"],
      ["INIT", 0.0, "1", "Optional initial smoothed value"],
    ],
  },
  {
    name: "DLINF1",
    aliases: ["SMOOTH1"],
    label: "1st-Order Information Delay",
    category: "Information & Material Delays",
    archetypeId: DynamoArchetypeId.DLINF1,
    signature: "DLINF1(IN, DEL)",
    description: "First-order exponential information delay equivalent to SMOOTH(IN, DEL): dY/dt = (IN - Y) / DEL.",
    provenance: "Pugh (1976) DYNAMO User's Manual, 5th Ed.",
    params: [
      ["DEL", 1.0, "time", "Information delay time constant"],
      ["INIT", 0.0, "1", "Initial output value"],
    ],
  },
  {
    name: "DLINF3",
    aliases: ["SMTH3"],
    label: "3rd-Order Information Delay",
    category: "Information & Material Delays",
    archetypeId: DynamoArchetypeId.DLINF3,
    signature: "DLINF3(IN, DEL)",
    description:
      "Third-order exponential information delay constructed as three cascaded first-order stages each with delay DEL/3.",
    provenance: "Pugh (1976) DYNAMO User's Manual, 5th Ed.",
    params: [
      ["DEL", 3.0, "time", "Total third-order information delay"],
      ["INIT", 0.0, "1", "Initial output value"],
    ],
  },
  {
    name: "DELAY1",
    aliases: ["DEL1"],
    label: "1st-Order Material Delay",
    category: "Information & Material Delays",
    archetypeId: DynamoArchetypeId.DELAY1,
    signature: "DELAY1(IN, DEL)",
    description: "First-order exponential material delay conserving flow: dL/dt = IN - OUT, OUT = L / DEL.",
    provenance: "Forrester (1961) Industrial Dynamics / Pugh DYNAMO User's Manual",
    params: [
      ["DEL", 1.0, "time", "Material delay time constant"],
      ["INIT", 0.0, "1/time", "Initial inflow rate"],
    ],
  },
  {
    name: "DELAY3",
    aliases: ["DEL3"],
    label: "3rd-Order Material Delay",
    category: "Information & Material Delays",
    archetypeId: DynamoArchetypeId.DELAY3,
    signature: "DELAY3(IN, DEL)",
    description:
      "Third-order Erlang material delay conserving total stock across three cascaded compartments of time constant DEL/3.",
    provenance: "Forrester (1961) Industrial Dynamics / Pugh DYNAMO User's Manual",
    params: [
      ["DEL", 3.0, "time", "Total third-order material delay"],
      ["INIT", 0.0, "1/time", "Initial inflow rate"],
    ],
  },
  {
    name: "TABLE",
    aliases: ["TAB"],
    label: "Linear Table Lookup (Extrapolating)",
    category: "Table Lookup",
    archetypeId: DynamoArchetypeId.TABLE,
    signature: "TABLE(TAB, X, XLOW, XHIGH, XINCR)",
    description:
      "Piecewise linear interpolation over uniformly spaced table TAB from XLOW to XHIGH in steps of XINCR, linearly extrapolating outside bounds.",
    provenance: "Pugh (1963) DYNAMO User's Manual",
    params: [
      ["XLOW", 0.0, "1", "Minimum independent variable value"],
      ["XHIGH", 1.0, "1", "Maximum independent variable value"],
      ["XINCR", 0.25, "1", "Table grid spacing"],
    ],
  },
  {
    name: "TABHL",
    aliases: ["TABLEHL"],
    label: "Linear Table Lookup (Clamped)",
    category: "Table Lookup",
    archetypeId: DynamoArchetypeId.TABHL,
    signature: "TABHL(TAB, X, XLOW, XHIGH, XINCR)",
    description:
      "Piecewise linear interpolation over uniformly spaced table TAB from XLOW to XHIGH in steps of XINCR, clamping to endpoints outside [XLOW, XHIGH].",
    provenance: "Pugh (1963) DYNAMO User's Manual",
    params: [
      ["XLOW", 0.0, "1", "Minimum independent variable value"],
      ["XHIGH", 1.0, "1", "Maximum independent variable value"],
      ["XINCR", 0.25, "1", "Table grid spacing"],
    ],
  },
  {
    name: "CLIP",
    aliases: ["FIFGE"],
    label: "Conditional Threshold Switch",
    category: "Logical & Switching",
    archetypeId: DynamoArchetypeId.CLIP,
    signature: "CLIP(P, Q, R, S)",
    description: "Returns P if R >= S, otherwise returns Q.",
    provenance: "Pugh (1963) DYNAMO User's Manual",
    params: [
      ["P", 1.0, "1", "Value returned when R >= S"],
      ["Q", 0.0, "1", "Value returned when R < S"],
      ["R", 0.0, "1", "Test value"],
      ["S", 0.0, "1", "Threshold value"],
    ],
  },
  {
    name: "SWITCH",
    aliases: ["FIFZE"],
    label: "Zero-Equality Switch",
    category: "Logical & Switching",
    archetypeId: DynamoArchetypeId.SWITCH,
    signature: "SWITCH(P, Q, R)",
    description: "Returns P if R == 0, otherwise returns Q.",
    provenance: "Pugh (1963) DYNAMO User's Manual",
    params: [
      ["P", 1.0, "1", "Value returned when R == 0"],
      ["Q", 0.0, "1", "Value returned when R != 0"],
      ["R", 0.0, "1", "Selector value"],
    ],
  },
  {
    name: "STEP",
    label: "Step Test Input",
    category: "Test Inputs",
    archetypeId: DynamoArchetypeId.STEP,
    signature: "STEP(HEIGHT, STIME)",
    description: "Returns HEIGHT when TIME >= STIME, and 0 otherwise.",
    provenance: "Forrester (1961) Industrial Dynamics / Pugh DYNAMO User's Manual",
    params: [
      ["HEIGHT", 1.0, "1", "Step amplitude"],
      ["STIME", 0.0, "time", "Step activation time"],
    ],
  },
  {
    name: "PULSE",
    label: "Periodic Pulse Train",
    category: "Test Inputs",
    archetypeId: DynamoArchetypeId.PULSE,
    signature: "PULSE(HEIGHT, FIRST, INTERVAL)",
    description:
      "Generates a pulse of amplitude HEIGHT starting at TIME = FIRST and repeating every INTERVAL (single DT width).",
    provenance: "Forrester (1961) Industrial Dynamics / Pugh DYNAMO User's Manual",
    params: [
      ["HEIGHT", 1.0, "1", "Pulse amplitude"],
      ["FIRST", 1.0, "time", "Time of first pulse"],
      ["INTERVAL", 10.0, "time", "Repeat interval (0 or <=0 for single pulse)"],
    ],
  },
  {
    name: "RAMP",
    label: "Ramp Test Input",
    category: "Test Inputs",
    archetypeId: DynamoArchetypeId.RAMP,
    signature: "RAMP(SLOPE, RTIME)",
    description: "Returns SLOPE * (TIME - RTIME) when TIME >= RTIME, and 0 otherwise.",
    provenance: "Forrester (1961) Industrial Dynamics / Pugh DYNAMO User's Manual",
    params: [
      ["SLOPE", 1.0, "1/time", "Ramp slope"],
      ["RTIME", 0.0, "time", "Ramp start time"],
    ],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/dynamo-std-lib`.
 */
export function buildDynamoCleanroomSchemas(): CleanroomModelSchema[] {
  return DYNAMO_STD_FUNCTION_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real" as const,
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `DYNAMO.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "system-dynamics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Function",
      width: 88,
      height: 52,
      svg: generateDynamoBlockSvg(spec.name, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: `dynamo_eval_${spec.name.toLowerCase()}`,
      extra: {
        archetypeId: spec.archetypeId,
        signature: spec.signature,
      },
    };
  });
}
